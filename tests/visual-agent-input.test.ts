import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentVisualPrompt } from "../src/main/visual-agent-input";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("native image transport", () => {
  it("sends supported image bytes as a Claude Agent SDK image block", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-vision-"));
    roots.push(root);
    const path = join(root, "sample.png");
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await buildAgentVisualPrompt("这张图是什么？", [{ id: "a", name: "sample.png", path, mimeType: "image/png", size: 4, source: "lab" }], true);
    expect(result.nativeImageCount).toBe(1);
    expect(typeof result.prompt).not.toBe("string");
    const messages = [];
    if (typeof result.prompt !== "string") for await (const message of result.prompt) messages.push(message);
    expect(messages).toHaveLength(1);
    expect(messages[0].message.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", source: expect.objectContaining({ type: "base64", media_type: "image/png", data: "iVBORw==" }) }),
    ]));
  });

  it("keeps a path manifest and OCR fallback when native vision is disabled", async () => {
    const result = await buildAgentVisualPrompt("读取附件", [{ id: "a", name: "scan.pdf", path: "D:/safe/scan.pdf", mimeType: "application/pdf", size: 10, source: "lab" }], false);
    expect(result.nativeImageCount).toBe(0);
    expect(result.prompt).toContain("visual_ocr.parse_document");
    expect(result.prompt).toContain("D:/safe/scan.pdf");
  });
});
