import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTwinStore } from "../src/main/store";
import type { HarnessSnapshot } from "../src/shared/types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function harness(label: string): HarnessSnapshot {
  return {
    claude: `# CLAUDE\n\n${label} runtime`,
    soul: `# SOUL\n\n${label} values`,
    memory: `${label} memory`,
    user: `${label} user`,
    style: `# STYLE\n\n${label} style`,
    qa: `# Q&A\n\n${label} answers`,
    confidence: label === "A" ? 0.71 : 0.86,
    updatedAt: new Date().toISOString(),
  };
}

describe("independent twin version branches", () => {
  it("keeps complete Harness snapshots addressable by version id", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-twin-versions-"));
    roots.push(root);
    const store = new LocalTwinStore(root);
    await store.init();

    const versionA = await store.writeHarness(harness("A"), { personaId: "primary", branchId: "conversation-a", branchName: "稳健版" });
    const versionB = await store.writeHarness(harness("B"), { personaId: "primary", branchId: "conversation-b", branchName: "直接版" });

    expect(versionA.name).toBe("conversation-a");
    expect(versionB.name).toBe("conversation-b");
    expect((await store.readTwinVersion(versionA.id))?.style).toContain("A style");
    expect((await store.readTwinVersion(versionB.id))?.style).toContain("B style");
  });

  it("pins every DingTalk generation path to the selected twin version", async () => {
    const [stream, webhook, app, main] = await Promise.all([
      readFile(join(process.cwd(), "src/main/dingtalk-stream-gateway.ts"), "utf8"),
      readFile(join(process.cwd(), "src/main/dingtalk-webhook-gateway.ts"), "utf8"),
      readFile(join(process.cwd(), "src/renderer/App.tsx"), "utf8"),
      readFile(join(process.cwd(), "src/main/main.ts"), "utf8"),
    ]);
    expect(stream).toContain("group.twinVersionId");
    expect(webhook).toContain("group.twinVersionId");
    expect(app).toContain("分身版本 × 机器人 × 群聊");
    expect(app).toContain("回复分身版本");
    expect(stream).toContain("private readonly clients = new Map<string, DWClient>()");
    expect(stream).toContain("this.acceptCallback(robotId, client, downstream)");
    expect(stream).toContain("status: \"received\"");
    const durableIntake = stream.slice(stream.indexOf("const sampleId = `stream:"));
    expect(durableIntake.indexOf("this.episodic.recordConversationSample({")).toBeLessThan(durableIntake.indexOf("client.socketCallBackResponse(downstream.headers.messageId, {})"));
    expect(main).toContain("dingTalkStreamCredentials.configure(robotId");
    expect(main).toContain("webhookTriggerRoutes");
  });
});
