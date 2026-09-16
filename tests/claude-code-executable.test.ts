import { describe, expect, it } from "vitest";
import { unpackedAsarPath } from "../src/main/claude-code-executable";

describe("Claude Code executable resolution", () => {
  it("maps an Electron ASAR virtual executable to its physical unpacked path", () => {
    const virtualPath = process.platform === "win32"
      ? "C:\\Mirror\\resources\\app.asar\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe"
      : "/opt/Mirror/resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude";
    const mapped = unpackedAsarPath(virtualPath);

    expect(mapped).toContain("app.asar.unpacked");
    expect(mapped).not.toMatch(/[\\/]app\.asar[\\/]/);
  });
});
