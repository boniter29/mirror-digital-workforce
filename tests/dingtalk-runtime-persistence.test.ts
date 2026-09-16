import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTwinStore } from "../src/main/store";
import type { DingTalkConfig } from "../src/shared/types";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function temporaryStore(): Promise<LocalTwinStore> {
  const root = await mkdtemp(join(tmpdir(), "mirror-dingtalk-runtime-"));
  roots.push(root);
  const store = new LocalTwinStore(root);
  await store.init();
  return store;
}

function config(activeRobotIds: string[]): DingTalkConfig {
  return {
    targetType: "group", targetId: "cid-a", mode: "draft", streamConfigured: true, activeRobotIds,
    groups: [
      { id: "a", robotId: "robot-a", name: "A 群", openConversationId: "cid-a", gatewayType: "stream", enabled: true, contextEnabled: true, replyMode: "draft", triggerMode: "all", triggerWords: [] },
      { id: "b", robotId: "robot-b", name: "B 群", openConversationId: "cid-b", gatewayType: "stream", enabled: true, contextEnabled: true, replyMode: "draft", triggerMode: "all", triggerWords: [] },
    ],
  };
}

describe("DingTalk desired runtime persistence", () => {
  it("preserves the exact active robot set across restarts", async () => {
    const store = await temporaryStore();
    await store.saveDingTalkConfig(config(["robot-b"]));
    expect((await store.readState()).dingTalk?.activeRobotIds).toEqual(["robot-b"]);
  });

  it("migrates a legacy running configuration to enabled robots and filters stale ids", async () => {
    const store = await temporaryStore();
    const statePath = join(store.root, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.dingTalk = config([]);
    delete state.dingTalk.activeRobotIds;
    await writeFile(statePath, JSON.stringify(state), "utf8");
    expect((await store.readState()).dingTalk?.activeRobotIds).toEqual(["robot-a", "robot-b"]);
    await store.saveDingTalkConfig({ ...config(["robot-a", "removed"]), groups: config([]).groups.slice(0, 1) });
    expect((await store.readState()).dingTalk?.activeRobotIds).toEqual(["robot-a"]);
  });
});
