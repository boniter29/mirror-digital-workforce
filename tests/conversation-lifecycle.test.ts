import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTwinStore } from "../src/main/store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("persona conversation recycle-bin lifecycle", () => {
  it("permanently removes all stage turns while preserving other conversations", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-conversation-lifecycle-"));
    roots.push(root);
    const store = new LocalTwinStore(root);
    await store.init();
    await store.appendAgentTurn({ id: "u1", surface: "onboarding", role: "user", content: "first prompt", createdAt: "2026-08-13T00:00:00.000Z" });
    await store.appendAgentTurn({ id: "a1", surface: "onboarding", sessionId: "session-delete", role: "agent", content: "reply", createdAt: "2026-08-13T00:00:01.000Z" });
    await store.appendAgentTurn({ id: "u2", surface: "source", sessionId: "session-keep", role: "user", content: "keep prompt", createdAt: "2026-08-13T00:00:02.000Z" });
    await store.appendAgentTurn({ id: "a2", surface: "source", sessionId: "session-keep", role: "agent", content: "keep reply", createdAt: "2026-08-13T00:00:03.000Z" });

    expect(await store.deleteAgentConversation(["session-delete"])).toEqual({ deletedTurns: 2 });
    expect(await store.readAgentConversation("onboarding")).toEqual([]);
    expect((await store.readAgentConversation("source")).map((turn) => turn.id)).toEqual(["u2", "a2"]);
  });

  it("keeps an interrupted long-running request visible and binds the SDK session before the final reply", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-conversation-recovery-"));
    roots.push(root);
    const store = new LocalTwinStore(root);
    await store.init();
    await store.appendAgentTurn({
      id: "pending-user",
      operationId: "operation-1",
      executionStatus: "running",
      surface: "source",
      role: "user",
      content: "同步全部钉钉证据",
      createdAt: "2026-08-13T00:00:00.000Z",
      personaId: "primary",
      branchId: "branch-a",
    });

    await store.bindAgentOperationSession("source", "operation-1", "sdk-session-1");
    expect((await store.readAgentConversation("source", 500, { personaId: "primary", branchId: "branch-a", branchName: "A" }))[0]).toMatchObject({
      id: "pending-user",
      sessionId: "sdk-session-1",
      executionStatus: "running",
    });

    await store.finishAgentOperation("source", "operation-1", "completed", "sdk-session-1");
    expect((await store.readAgentConversation("source", 500, { personaId: "primary", branchId: "branch-a", branchName: "A" }))[0].executionStatus).toBe("completed");

    await store.appendAgentTurn({
      id: "pending-user-2",
      operationId: "operation-2",
      executionStatus: "running",
      surface: "source",
      role: "user",
      content: "继续同步",
      createdAt: "2026-08-13T00:00:02.000Z",
      personaId: "primary",
      branchId: "branch-a",
    });
    expect(await store.recoverInterruptedAgentRuns()).toEqual({ recovered: 1 });
    expect((await store.readAgentConversation("source", 500, { personaId: "primary", branchId: "branch-a", branchName: "A" })).at(-1)).toMatchObject({
      id: "pending-user-2",
      executionStatus: "interrupted",
    });
  });

  it("pairs legacy user and agent turns while marking only orphan requests interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-conversation-migration-"));
    roots.push(root);
    const store = new LocalTwinStore(root);
    await store.init();
    await store.appendAgentTurn({ id: "u-complete", surface: "source", role: "user", content: "first", createdAt: "2026-08-13T00:00:00.000Z", personaId: "primary", branchId: "branch-a" });
    await store.appendAgentTurn({ id: "a-complete", surface: "source", sessionId: "session-a", role: "agent", content: "done", createdAt: "2026-08-13T00:00:01.000Z", personaId: "primary", branchId: "branch-a" });
    await store.appendAgentTurn({ id: "u-orphan", surface: "source", role: "user", content: "second", createdAt: "2026-08-13T00:00:02.000Z", personaId: "primary", branchId: "branch-a" });

    expect(await store.recoverInterruptedAgentRuns()).toEqual({ recovered: 1 });
    const turns = await store.readAgentConversation("source", 500, { personaId: "primary", branchId: "branch-a", branchName: "A" });
    expect(turns.map((turn) => [turn.id, turn.executionStatus])).toEqual([
      ["u-complete", "completed"],
      ["a-complete", "completed"],
      ["u-orphan", "interrupted"],
    ]);
    expect(turns[0].operationId).toBe(turns[1].operationId);
  });
});
