import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTwinStore } from "../src/main/store";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("version-scoped evaluation sessions", () => {
  it("keeps multiple independent sessions and binds evaluations to one session", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-evaluation-session-"));
    roots.push(root);
    const store = new LocalTwinStore(root);
    await store.init();
    const first = await store.createEvaluationSession({ personaId: "p1", branchId: "b1", twinVersionId: "v1" });
    const second = await store.createEvaluationSession({ personaId: "p1", branchId: "b1", twinVersionId: "v1" });
    await store.updateEvaluationSession(first.id, { sdkSessionId: "sdk-one", title: "边界测试" });
    await store.addEvaluation({ prompt: "能承诺吗", reply: "可以", labels: ["boundary"], score: 1, personaId: "p1", branchId: "b1", twinVersionId: "v1", evaluationSessionId: first.id });
    const state = await store.bootstrap({ sdk: true, credentials: false, claudeAuthMethod: "none", claudeCredentialStorage: "none", modelProvider: "anthropic", model: "test", dws: false }, { memory: { used: 0, limit: 2200, percent: 0, entries: 0 }, user: { used: 0, limit: 1375, percent: 0, entries: 0 }, episodicSessions: 0, episodicMessages: 0, externalProvider: null });
    expect(state.evaluationSessions).toHaveLength(2);
    expect(state.evaluationSessions.find((item) => item.id === first.id)).toMatchObject({ title: "边界测试", sdkSessionId: "sdk-one" });
    expect(state.evaluationSessions.find((item) => item.id === second.id)?.sdkSessionId).toBeUndefined();
    expect(state.evaluationRecords[0].evaluationSessionId).toBe(first.id);
  });
});
