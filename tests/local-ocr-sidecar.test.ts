import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalOcrSidecar } from "../src/main/local-ocr-sidecar";

const running: LocalOcrSidecar[] = [];
const fixture = resolve("tests/fixtures/fake-ocr-sidecar.cjs");

function sidecar(options: { timeout?: number; diagnostics?: string[] } = {}) {
  const instance = new LocalOcrSidecar({
    executable: process.execPath, args: [fixture], requestTimeoutMs: options.timeout,
    onDiagnostic: (message) => options.diagnostics?.push(message),
  });
  running.push(instance);
  return instance;
}

afterEach(async () => { await Promise.all(running.splice(0).map((item) => item.stop())); });

describe("port-free local OCR sidecar lifecycle", () => {
  it("starts once and carries Unicode JSONL without a network port", async () => {
    const instance = sidecar();
    const status = await instance.start();
    const result = await instance.recognize("C:\\资料\\截图 中文.png", "1");
    expect(status).toMatchObject({ available: true, model: "PP-OCRv6-small", offline: true });
    expect(JSON.stringify(result)).toContain("截图 中文.png");
    expect(status.pid).toBe((await instance.status()).pid);
  });

  it("isolates accidental library stdout and still resolves the response", async () => {
    const diagnostics: string[] = [];
    const instance = sidecar({ diagnostics });
    const result = await instance.recognize("noise.png");
    expect(result.success).toBe(true);
    expect(diagnostics.join("\n")).toContain("非协议输出");
  });

  it("rejects pending work on crash and restarts on the next request", async () => {
    const instance = sidecar();
    await expect(instance.recognize("crash.png")).rejects.toThrow("异常退出");
    await expect(instance.status()).resolves.toMatchObject({ available: true, model: "PP-OCRv6-small" });
  });

  it("times out a hung model request instead of hanging the app", async () => {
    const instance = sidecar({ timeout: 80 });
    await expect(instance.recognize("hang.png")).rejects.toThrow("超时");
  });

  it("handles concurrent requests without mixing responses", async () => {
    const instance = sidecar();
    const results = await Promise.all(["a.png", "b.png", "c.png"].map((path) => instance.recognize(path)));
    expect(results.map((item) => JSON.stringify(item.pages))).toEqual(expect.arrayContaining([
      expect.stringContaining("a.png"), expect.stringContaining("b.png"), expect.stringContaining("c.png"),
    ]));
  });

  it("reports an actionable error when the bundled executable is missing", async () => {
    const instance = new LocalOcrSidecar({ executable: resolve("tests/missing/mirror-ocr.exe") });
    await expect(instance.status()).resolves.toMatchObject({ available: false, provider: "unavailable", model: "PP-OCRv6-small" });
  });
});
