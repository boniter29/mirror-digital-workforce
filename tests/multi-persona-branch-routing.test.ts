import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTwinStore } from "../src/main/store";
import { MemoryStore } from "../src/main/memory-store";
import type { PersonaVersionBranch, WorkbenchVersionContext } from "../src/shared/types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryStore(): Promise<LocalTwinStore> {
  const root = await mkdtemp(join(tmpdir(), "mirror-multi-branch-"));
  roots.push(root);
  const store = new LocalTwinStore(root);
  await store.init();
  return store;
}

const context = (branchId: string): WorkbenchVersionContext => ({
  personaId: "primary",
  branchId,
  branchName: branchId,
  includeLegacyData: false,
});

const branch = (id: string): PersonaVersionBranch => ({
  id,
  personaId: "primary",
  versionBranchId: id,
  title: `分身 ${id}`,
  currentPluginId: "hr-keyboard",
  stageSessionIds: {},
  completedStages: [],
  stageCheckpoints: {},
  updatedAt: new Date().toISOString(),
  includeLegacyData: false,
});

describe("multi persona/version branch ownership", () => {
  it("propagates a branch rename to version labels and DingTalk bindings", async () => {
    const store = await temporaryStore();
    await store.savePersonaBranches([branch("branch-a")]);
    const written = await store.writeHarness({ claude: "# A\n" + "A".repeat(120), soul: "# Soul\n" + "A".repeat(120), memory: "", user: "A", style: "# Style\n" + "A".repeat(120), qa: "# QA\n" + "A".repeat(120), confidence: 0.8, updatedAt: new Date().toISOString() }, { branchId: "branch-a", branchName: "旧名称", personaId: "primary" });
    await store.saveDingTalkConfig({ targetType: "group", targetId: "cid", mode: "draft", streamConfigured: true, activeRobotIds: ["robot-a"], groups: [{ id: "g", robotId: "robot-a", name: "测试群", openConversationId: "cid", branchId: "branch-a", twinVersionId: written.id, twinVersionName: "旧名称", enabled: true, contextEnabled: true, replyMode: "draft", triggerMode: "all", triggerWords: [] }] });
    await store.renamePersonaBranch("branch-a", "新版名称");
    expect((await store.readState()).personaBranches?.[0].title).toBe("新版名称");
    expect((await store.readState()).dingTalk?.groups[0].twinVersionName).toBe("新版名称");
    expect((await store.listVersions()).find((item) => item.id === written.id)?.note).toContain("新版名称");
  });

  it("keeps blank branches isolated across evidence, knowledge and workspace", async () => {
    const store = await temporaryStore();
    await store.savePersonaBranches([branch("branch-a"), branch("branch-b")]);
    await store.saveOnboarding({ name: "A", role: "A 角色", bio: "", communicationStyle: "", decisionPrinciples: "", boundaries: "", sampleReply: "" }, context("branch-a"));
    await store.saveWorkspace("D:\\workspace-a", context("branch-a"));
    await store.saveAgentWorkspaceFile("notes/context.md", "A 的知识", 1, "knowledge", context("branch-a"));
    await store.saveAgentDistillationEvidence({
      relativePath: "verified/voice.md",
      content: "A 的真实说法",
      evidenceType: "style",
      origin: "user-verified",
      provenance: "用户在 branch-a 明确确认",
      ownerId: "primary",
    }, context("branch-a"));

    expect(await store.workspacePath(context("branch-a"))).toBe("D:\\workspace-a");
    expect(await store.workspacePath(context("branch-b"))).toBeUndefined();
    expect((await store.profileForContext(context("branch-a")))?.name).toBe("A");
    expect(await store.profileForContext(context("branch-b"))).toBeUndefined();
    expect(await store.collectEvidence(100_000, context("branch-a"))).toContain("A 的真实说法");
    expect(await store.collectEvidence(100_000, context("branch-b"))).not.toContain("A 的真实说法");
    expect((await store.scopedSources(context("branch-a"))).length).toBe(3);
    expect(await store.scopedSources(context("branch-b"))).toEqual([]);

    await store.writeHarness({ claude: "# A\n\n" + "A".repeat(120), soul: "# Soul A\n" + "A".repeat(120), memory: "", user: "A", style: "# Style A\n" + "A".repeat(120), qa: "# Q&A A\n" + "A".repeat(120), confidence: 0.8, updatedAt: new Date().toISOString() }, { branchId: "branch-a", branchName: "A", personaId: "primary" });
    await store.writeHarness({ claude: "# B\n\n" + "B".repeat(120), soul: "# Soul B\n" + "B".repeat(120), memory: "", user: "B", style: "# Style B\n" + "B".repeat(120), qa: "# Q&A B\n" + "B".repeat(120), confidence: 0.7, updatedAt: new Date().toISOString() }, { branchId: "branch-b", branchName: "B", personaId: "primary" });
    const harnessA = await store.prepareHarnessContext(context("branch-a"));
    const harnessB = await store.prepareHarnessContext(context("branch-b"));
    expect(await readFile(join(harnessA, "CLAUDE.md"), "utf8")).toContain("# A");
    expect(await readFile(join(harnessB, "CLAUDE.md"), "utf8")).toContain("# B");
    const memoryA = new MemoryStore(harnessA);
    const memoryB = new MemoryStore(harnessB);
    await memoryA.mutate({ action: "add", target: "memory", content: "只属于 A 分支的长期事实" });
    expect((await memoryA.snapshot()).memory).toContain("只属于 A 分支");
    expect((await memoryB.snapshot()).memory).not.toContain("只属于 A 分支");
    await store.appendAgentTurn({ id: "turn-a", surface: "onboarding", role: "agent", content: "A 会话", createdAt: new Date().toISOString(), personaId: "primary", branchId: "branch-a" });
    await store.appendAgentTurn({ id: "turn-b", surface: "onboarding", role: "agent", content: "B 会话", createdAt: new Date().toISOString(), personaId: "primary", branchId: "branch-b" });
    await store.appendFeedback({ verdict: "like" }, context("branch-a"));
    expect((await store.readAgentConversation("onboarding", 500, context("branch-a"))).map((turn) => turn.content)).toEqual(["A 会话"]);
    expect((await store.readAgentConversation("onboarding", 500, context("branch-b"))).map((turn) => turn.content)).toEqual(["B 会话"]);

    const bootstrap = await store.bootstrap({ sdk: true, credentials: false, claudeAuthMethod: "none", claudeCredentialStorage: "none", modelProvider: "anthropic", model: "test", dws: false }, {
      memory: { used: 0, limit: 2200, percent: 0, entries: 0 },
      user: { used: 0, limit: 1375, percent: 0, entries: 0 },
      episodicSessions: 0,
      episodicMessages: 0,
      externalProvider: null,
    });
    expect(bootstrap.personaBranches.map((item) => item.versionBranchId)).toEqual(["branch-a", "branch-b"]);
    expect(bootstrap.feedbackStatsByBranch).toEqual({ "branch-a": 1, "branch-b": 0 });
  });

  it("migrates a legacy Agent session only when one persisted branch uniquely claims it", async () => {
    const store = await temporaryStore();
    const branchA = branch("branch-a");
    branchA.stageSessionIds = { "hr-keyboard": "legacy-session" };
    await store.savePersonaBranches([branchA, branch("branch-b")]);
    await store.appendAgentTurn({ id: "legacy-user", surface: "onboarding", role: "user", content: "旧问题", createdAt: new Date().toISOString() });
    await store.appendAgentTurn({ id: "legacy-agent", surface: "onboarding", sessionId: "legacy-session", role: "agent", content: "旧回答", createdAt: new Date().toISOString() });

    expect(await store.agentSessionBelongsToContext("onboarding", "legacy-session", context("branch-b"))).toBe(false);
    expect(await store.agentSessionBelongsToContext("onboarding", "legacy-session", context("branch-a"))).toBe(true);
    const migrated = await store.readAgentConversation("onboarding", 500, context("branch-a"));
    expect(migrated.map((turn) => turn.id)).toEqual(["legacy-user", "legacy-agent"]);
    expect(migrated.every((turn) => turn.personaId === "primary" && turn.branchId === "branch-a")).toBe(true);
  });

  it("does not adopt an ambiguous unscoped Agent session", async () => {
    const store = await temporaryStore();
    const branchA = branch("branch-a");
    const branchB = branch("branch-b");
    branchA.stageSessionIds = { "hr-keyboard": "shared-session" };
    branchB.stageSessionIds = { "hr-keyboard": "shared-session" };
    await store.savePersonaBranches([branchA, branchB]);
    await store.appendAgentTurn({ id: "legacy-agent", surface: "onboarding", sessionId: "shared-session", role: "agent", content: "无法证明归属", createdAt: new Date().toISOString() });

    expect(await store.agentSessionBelongsToContext("onboarding", "shared-session", context("branch-a"))).toBe(false);
    expect(await store.readAgentConversation("onboarding", 500, context("branch-a"))).toEqual([]);
  });

  it("deletes only the requested branch and removes its DingTalk version binding", async () => {
    const store = await temporaryStore();
    await store.savePersonaBranches([branch("branch-a"), branch("branch-b")]);
    await store.saveAgentWorkspaceFile("same/name.md", "A", 1, "A", context("branch-a"));
    await store.saveAgentWorkspaceFile("same/name.md", "B", 1, "B", context("branch-b"));
    await store.appendAgentTurn({ id: "orphan-a", surface: "calibration", role: "agent", content: "A", createdAt: new Date().toISOString(), personaId: "primary", branchId: "branch-a" });
    await store.appendAgentTurn({ id: "orphan-b", surface: "calibration", role: "agent", content: "B", createdAt: new Date().toISOString(), personaId: "primary", branchId: "branch-b" });
    const baseHarness = { claude: "# CLAUDE\n" + "规则".repeat(80), soul: "# SOUL\n" + "价值".repeat(80), memory: "", user: "用户", style: "# STYLE\n" + "表达".repeat(80), qa: "# Q&A\n" + "问答".repeat(80), confidence: 0.8, updatedAt: new Date().toISOString() };
    const versionA = await store.writeHarness(baseHarness, { personaId: "primary", branchId: "branch-a", branchName: "A" });
    const versionB = await store.writeHarness({ ...baseHarness, confidence: 0.7 }, { personaId: "primary", branchId: "branch-b", branchName: "B" });
    await store.saveDingTalkConfig({ targetType: "group", targetId: "cid-a", mode: "draft", streamConfigured: true, groups: [
      { id: "route-a", robotId: "robot-a", name: "A 群", openConversationId: "cid-a", twinVersionId: versionA.id, enabled: true, contextEnabled: true, replyMode: "draft", triggerMode: "all", triggerWords: [] },
      { id: "route-b", robotId: "robot-b", name: "B 群", openConversationId: "cid-b", twinVersionId: versionB.id, enabled: true, contextEnabled: true, replyMode: "draft", triggerMode: "all", triggerWords: [] },
    ] });

    await store.deletePersonaBranch("branch-a");
    const state = await store.readState();
    expect(state.personaBranches?.map((item) => item.versionBranchId)).toEqual(["branch-b"]);
    expect(state.sources.every((item) => item.branchId !== "branch-a")).toBe(true);
    expect(state.sources.some((item) => item.branchId === "branch-b")).toBe(true);
    expect(state.dingTalk?.groups.map((group) => group.id)).toEqual(["route-b"]);
    expect((await store.readAgentConversation("calibration", 500, context("branch-a")))).toEqual([]);
    expect((await store.readAgentConversation("calibration", 500, context("branch-b"))).map((turn) => turn.id)).toEqual(["orphan-b"]);
    expect(await store.readTwinVersion(versionA.id)).toBeUndefined();
    expect(await store.readTwinVersion(versionB.id)).toBeDefined();
  });
});
