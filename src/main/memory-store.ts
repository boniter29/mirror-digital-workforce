import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryCoreState, MemoryUsage } from "../shared/types.js";

export const MEMORY_LIMIT = 2_200;
export const USER_LIMIT = 1_375;
const DELIMITER = "\n§\n";

export type MemoryTarget = "memory" | "user";
export type MemoryAction = "add" | "replace" | "remove";

export interface FrozenMemorySnapshot {
  readonly memory: string;
  readonly user: string;
  readonly capturedAt: string;
  readonly memoryUsage: MemoryUsage;
  readonly userUsage: MemoryUsage;
}

export interface MemoryMutationInput {
  action: MemoryAction;
  target: MemoryTarget;
  content?: string;
  oldText?: string;
}

export interface MemoryMutationResult {
  action: MemoryAction;
  target: MemoryTarget;
  usage: MemoryUsage;
  message: string;
  liveContent: string;
  frozenSnapshotUnchanged: true;
}

export class MemoryStore {
  readonly memoryPath: string;
  readonly userPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly harnessDir: string) {
    this.memoryPath = join(harnessDir, "MEMORY.md");
    this.userPath = join(harnessDir, "USER.md");
  }

  async init(): Promise<void> {
    await mkdir(this.harnessDir, { recursive: true });
    await Promise.all([this.ensureFile(this.memoryPath), this.ensureFile(this.userPath)]);
  }

  async snapshot(): Promise<FrozenMemorySnapshot> {
    const [memory, user] = await Promise.all([this.read("memory"), this.read("user")]);
    return this.restoreSnapshot(memory, user, new Date().toISOString());
  }

  restoreSnapshot(memory: string, user: string, capturedAt: string): FrozenMemorySnapshot {
    assertSafeDocument(memory, "MEMORY.md", MEMORY_LIMIT);
    assertSafeDocument(user, "USER.md", USER_LIMIT);
    return Object.freeze({
      memory,
      user,
      capturedAt,
      memoryUsage: usageOf(memory, MEMORY_LIMIT),
      userUsage: usageOf(user, USER_LIMIT),
    });
  }

  async health(episodic: Pick<MemoryCoreState, "episodicSessions" | "episodicMessages">, externalProvider: string | null): Promise<MemoryCoreState> {
    const [memory, user] = await Promise.all([this.read("memory"), this.read("user")]);
    return {
      memory: usageOf(memory, MEMORY_LIMIT),
      user: usageOf(user, USER_LIMIT),
      episodicSessions: episodic.episodicSessions,
      episodicMessages: episodic.episodicMessages,
      externalProvider,
    };
  }

  async read(target: MemoryTarget): Promise<string> {
    await this.init();
    const content = await readFile(this.pathFor(target), "utf8");
    return normalizeDocument(content);
  }

  async mutate(input: MemoryMutationInput): Promise<MemoryMutationResult> {
    let result!: MemoryMutationResult;
    const operation = this.mutationQueue.then(async () => {
      result = await this.applyMutation(input);
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async applyMutation(input: MemoryMutationInput): Promise<MemoryMutationResult> {
    const limit = input.target === "memory" ? MEMORY_LIMIT : USER_LIMIT;
    const label = input.target === "memory" ? "MEMORY.md" : "USER.md";
    const current = await this.read(input.target);
    assertSafeDocument(current, label, limit);
    const entries = splitEntries(current);

    if (input.content !== undefined) scanMemoryWrite(input.content);
    if (input.oldText !== undefined) scanInvisibleCharacters(input.oldText);

    if (input.action === "add") {
      const content = requiredContent(input.content);
      entries.push(content);
    } else {
      const oldText = input.oldText?.trim();
      if (!oldText) throw new Error(`${input.action} 操作需要 old_text 子串。`);
      const matches = entries.map((entry, index) => entry.includes(oldText) ? index : -1).filter((index) => index >= 0);
      if (matches.length === 0) throw new Error(`在 ${label} 中没有找到包含“${oldText}”的条目。`);
      if (matches.length > 1) throw new Error(`“${oldText}”匹配了 ${matches.length} 条记忆，请使用更唯一的子串。`);
      if (input.action === "replace") entries[matches[0]] = requiredContent(input.content);
      else entries.splice(matches[0], 1);
    }

    const next = entries.join(DELIMITER);
    if (next.length > limit) {
      throw new Error(`${label} 将达到 ${next.length}/${limit} 字符。禁止自动压缩；请先用 replace/remove 手动合并或精炼现有条目。`);
    }
    await this.atomicWrite(this.pathFor(input.target), next);
    const usage = usageOf(next, limit);
    return {
      action: input.action,
      target: input.target,
      usage,
      message: `${label} 已${input.action === "add" ? "新增" : input.action === "replace" ? "替换" : "移除"}条目，当前 ${usage.percent}%（${usage.used}/${usage.limit} 字符）。`,
      liveContent: next,
      frozenSnapshotUnchanged: true,
    };
  }

  private pathFor(target: MemoryTarget): string {
    return target === "memory" ? this.memoryPath : this.userPath;
  }

  private async ensureFile(path: string): Promise<void> {
    try {
      await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(path, "", "utf8");
    }
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  }
}

export function formatFrozenMemory(snapshot: FrozenMemorySnapshot): string {
  return [
    "══════════════════════════════════════════════",
    `MEMORY（Agent 笔记 / 环境事实 / 经验教训）[${snapshot.memoryUsage.percent}% — ${snapshot.memoryUsage.used}/${snapshot.memoryUsage.limit} chars]`,
    "══════════════════════════════════════════════",
    snapshot.memory || "（空）",
    "",
    "══════════════════════════════════════════════",
    `USER PROFILE（用户画像 / 偏好 / 沟通风格）[${snapshot.userUsage.percent}% — ${snapshot.userUsage.used}/${snapshot.userUsage.limit} chars]`,
    "══════════════════════════════════════════════",
    snapshot.user || "（空）",
    "",
    `FROZEN SNAPSHOT captured_at=${snapshot.capturedAt}`,
    "本会话中 memory 工具的写入会立即落盘，但此快照不可变，只在下一次新会话生效。",
  ].join("\n");
}

export function scanMemoryWrite(content: string): void {
  if (content.includes("§")) throw new Error("单条记忆不能包含 §；该字符仅用于分隔条目。");
  scanInvisibleCharacters(content);
  const threats: Array<[RegExp, string]> = [
    [/\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|messages?)/i, "Prompt Injection"],
    [/(?:reveal|print|leak|expose)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|message)/i, "Prompt Injection"],
    [/<\/?(?:system|developer|assistant|tool)[^>]*>/i, "伪造角色标签"],
    [/\b(?:api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*[^\s]{8,}/i, "凭证泄露"],
    [/\b(?:sk-ant-|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})/i, "凭证泄露"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, "私钥泄露"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, "Token 泄露"],
    [/(?:ssh-rsa|ssh-ed25519)\s+[A-Za-z0-9+/]{40,}/i, "SSH 凭证泄露"],
  ];
  for (const [pattern, label] of threats) {
    if (pattern.test(content)) throw new Error(`记忆写入被安全扫描阻止：检测到${label}风险。`);
  }
}

function scanInvisibleCharacters(content: string): void {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD]|\p{Cf}/u.test(content)) {
    throw new Error("记忆写入被安全扫描阻止：检测到不可见或控制字符。");
  }
}

function assertSafeDocument(content: string, label: string, limit: number): void {
  if (content.length > limit) throw new Error(`${label} 已超过硬上限：${content.length}/${limit} 字符。请人工编辑并精炼后重试。`);
  for (const entry of splitEntries(content)) scanMemoryWrite(entry);
}

function requiredContent(content: string | undefined): string {
  const normalized = content?.trim();
  if (!normalized) throw new Error("add/replace 操作需要非空 content。");
  return normalized;
}

function normalizeDocument(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function splitEntries(content: string): string[] {
  return content ? content.split(/\n\s*§\s*\n/g).map((entry) => entry.trim()).filter(Boolean) : [];
}

function usageOf(content: string, limit: number): MemoryUsage {
  return {
    used: content.length,
    limit,
    percent: Math.min(100, Math.round((content.length / limit) * 100)),
    entries: splitEntries(content).length,
  };
}
