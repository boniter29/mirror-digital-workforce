import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

export interface LocalOcrStatus {
  available: boolean;
  provider: "rapidocr_onnxruntime" | "unavailable";
  model: string;
  localFirst: boolean;
  offline: boolean;
  executable?: string;
  pid?: number;
  pythonBundled?: boolean;
  supported?: string[];
  error?: string;
}

export interface LocalOcrRecognition {
  success: true;
  provider: "rapidocr_onnxruntime";
  model: string;
  pageCount: number;
  pages: Array<Record<string, unknown>>;
  durationMs: number;
  runtime?: Record<string, unknown>;
}

interface SidecarResponse {
  id?: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface LocalOcrSidecarOptions {
  executable?: string;
  args?: string[];
  cwd?: string;
  requestTimeoutMs?: number;
  onDiagnostic?: (message: string) => void;
}

/** Long-lived, port-free OCR process. The packaged exe contains Python,
 * RapidOCR, PP-OCRv6-small, ONNX Runtime and PDF rendering dependencies. */
export class LocalOcrSidecar {
  private process?: ChildProcessWithoutNullStreams;
  private output?: Interface;
  private readonly pending = new Map<string, PendingRequest>();
  private startPromise?: Promise<LocalOcrStatus>;
  private lastError?: string;
  private stopping = false;

  constructor(private readonly options: LocalOcrSidecarOptions = {}) {}

  async start(): Promise<LocalOcrStatus> {
    if (this.process && !this.process.killed) return this.requestStatus();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.spawnAndCheck().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  async status(): Promise<LocalOcrStatus> {
    try {
      return await this.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      return unavailable(message, this.resolveExecutable());
    }
  }

  async recognize(path: string, pageRanges?: string): Promise<LocalOcrRecognition> {
    const status = await this.start();
    if (!status.available) throw new Error(status.error || "本地 PP-OCRv6 不可用。");
    return await this.request("recognize", { path, page_ranges: pageRanges }, this.options.requestTimeoutMs ?? 15 * 60_000) as LocalOcrRecognition;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.process;
    if (!child) return;
    try { await this.request("shutdown", {}, 2_000); } catch { /* force below */ }
    if (!child.killed) child.kill();
    this.cleanup(new Error("OCR Sidecar 已停止。"));
    this.stopping = false;
  }

  private async spawnAndCheck(): Promise<LocalOcrStatus> {
    const executable = this.resolveExecutable();
    if (!executable || !existsSync(executable)) {
      throw new Error("未找到随应用安装的 PP-OCRv6 Sidecar；请重新安装包含本地视觉组件的镜我 v0.6.0 或更高版本。");
    }
    const child = spawn(executable, this.options.args ?? [], {
      cwd: this.options.cwd ?? resolve(executable, ".."),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    this.process = child;
    child.stdin.setDefaultEncoding("utf8");
    this.output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.output.on("line", (line) => this.handleLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const text = chunk.trim();
      if (text) this.options.onDiagnostic?.(text.slice(-4_000));
    });
    child.once("error", (error) => this.cleanup(error));
    child.once("exit", (code, signal) => {
      if (!this.stopping) this.lastError = `OCR Sidecar 异常退出（code=${code ?? "null"}, signal=${signal ?? "none"}）。`;
      this.cleanup(new Error(this.lastError || "OCR Sidecar 已退出。"));
    });
    return this.requestStatus();
  }

  private async requestStatus(): Promise<LocalOcrStatus> {
    const result = await this.request("status", {}, 12_000) as Omit<LocalOcrStatus, "executable">;
    return { ...result, executable: this.resolveExecutable() };
  }

  private request(action: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const child = this.process;
    if (!child || child.killed || !child.stdin.writable) return Promise.reject(new Error(this.lastError || "OCR Sidecar 尚未启动。"));
    const id = randomUUID();
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`OCR Sidecar ${action} 超时（${Math.round(timeoutMs / 1000)} 秒）。`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      child.stdin.write(`${JSON.stringify({ id, action, ...payload })}\n`, "utf8", (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  private handleLine(line: string): void {
    let response: SidecarResponse;
    try { response = JSON.parse(line) as SidecarResponse; } catch {
      this.options.onDiagnostic?.(`忽略 OCR Sidecar 非协议输出：${line.slice(0, 500)}`);
      return;
    }
    if (!response.id) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error || "OCR Sidecar 返回未知错误。"));
  }

  private cleanup(error: Error): void {
    this.output?.close();
    this.output = undefined;
    this.process = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private resolveExecutable(): string | undefined {
    if (this.options.executable) return resolve(this.options.executable);
    if (process.env.MIRROR_OCR_SIDECAR?.trim()) return resolve(process.env.MIRROR_OCR_SIDECAR.trim());
    const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      resources ? join(resources, "tools", "ocr", "mirror-ocr.exe") : undefined,
      join(process.cwd(), "build-resources", "ocr", "mirror-ocr.exe"),
    ].filter((item): item is string => Boolean(item));
    return candidates.find((item) => existsSync(item)) ?? candidates[0];
  }
}

function unavailable(error: string, executable?: string): LocalOcrStatus {
  return { available: false, provider: "unavailable", model: "PP-OCRv6-small", localFirst: true, offline: true, executable, error };
}
