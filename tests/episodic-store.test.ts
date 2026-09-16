import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EpisodicStore } from "../src/main/episodic-store";
import type { FrozenMemorySnapshot } from "../src/main/memory-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local episodic session search", () => {
  it("persists frozen snapshots and finds actual messages through FTS5", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-episodic-"));
    temporaryDirectories.push(root);
    const store = new EpisodicStore(join(root, "sessions.sqlite"));
    const snapshot: FrozenMemorySnapshot = Object.freeze({
      memory: "项目使用本地优先架构。",
      user: "用户偏好简洁回复。",
      capturedAt: "2026-08-07T08:00:00.000Z",
      memoryUsage: { used: 11, limit: 2200, percent: 1, entries: 1 },
      userUsage: { used: 9, limit: 1375, percent: 1, entries: 1 },
    });

    store.recordTurn("session-1", "desktop", "数据库性能怎么优化？", "先定位慢查询，再检查索引与执行计划。", snapshot);
    const result = store.search({ query: "数据库", limit: 3 });

    expect(result.mode).toBe("discover");
    expect(result.sessions[0].messages.some((message) => message.content.includes("数据库性能"))).toBe(true);
    expect(store.getSnapshot("session-1")).toEqual({ memory: snapshot.memory, user: snapshot.user, capturedAt: snapshot.capturedAt });
    expect(store.loadSessionMessages("session-1", "desktop").map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(store.loadSessionMessages("session-1", "twin:another-version")).toEqual([]);
    expect(store.stats()).toEqual({ episodicSessions: 1, episodicMessages: 2 });
    store.close();
  });

  it("persists visual attachment metadata with the user turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-episodic-visual-"));
    temporaryDirectories.push(root);
    const store = new EpisodicStore(join(root, "sessions.sqlite"));
    const snapshot: FrozenMemorySnapshot = Object.freeze({
      memory: "m", user: "u", capturedAt: new Date().toISOString(),
      memoryUsage: { used: 1, limit: 2200, percent: 1, entries: 1 },
      userUsage: { used: 1, limit: 1375, percent: 1, entries: 1 },
    });
    store.recordTurn("visual-session", "twin:v1", "看看这张图", "可以。", snapshot, [{
      id: "img-1", name: "screen.png", path: join(root, "screen.png"), mimeType: "image/png", size: 42, source: "lab",
    }]);
    expect(store.loadSessionMessages("visual-session", "twin:v1")[0].attachments).toMatchObject([{ id: "img-1", name: "screen.png" }]);
    store.close();
  });

  it("archives real DingTalk conversations and keeps their evaluation linkage", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-conversation-samples-"));
    temporaryDirectories.push(root);
    const store = new EpisodicStore(join(root, "sessions.sqlite"));
    store.recordConversationSample({
      id: "draft-1",
      sessionId: "sdk-session-1",
      channel: "dingtalk_stream",
      conversationId: "cid-project",
      groupName: "项目群",
      senderId: "user-1",
      senderName: "同事甲",
      prompt: "今天能承诺上线吗？",
      reply: "先别承诺，把阻塞项和验证时间发我。",
      status: "draft",
      createdAt: "2026-08-08T09:00:00.000Z",
      personaId: "primary",
      branchId: "branch-a",
      twinVersionId: "twin-a-v1",
      twinVersionName: "稳健版",
      bindingId: "route-a",
      robotId: "robot-a",
      groupId: "cid-project",
    });
    store.recordConversationSample({ id: "draft-2", channel: "dingtalk_stream", conversationId: "cid-other", groupName: "其他群", senderId: "user-2", senderName: "同事乙", prompt: "另一个版本？", reply: "B", status: "sent", createdAt: "2026-08-08T10:00:00.000Z", personaId: "primary", branchId: "branch-b", twinVersionId: "twin-b-v1", bindingId: "route-b", robotId: "robot-b", groupId: "cid-other" });
    store.updateConversationSampleStatus("draft-1", "sent");
    store.markConversationSampleEvaluated({
      id: "evaluation-1",
      sampleId: "draft-1",
      prompt: "今天能承诺上线吗？",
      reply: "先别承诺，把阻塞项和验证时间发我。",
      expectedReply: "先确认风险，今天不对外承诺。",
      labels: ["boundary", "voice"],
      score: 4,
      notes: "再短一点",
      createdAt: "2026-08-08T09:05:00.000Z",
      status: "pending",
    });

    expect(store.listConversationSamples(100, "twin-a-v1")).toHaveLength(1);
    expect(store.listConversationSamples(100, "twin-b-v1")).toHaveLength(1);
    expect(store.listConversationSamples(100, undefined, "branch-a").map((sample) => sample.id)).toEqual(["draft-1"]);
    const scopedSample = store.listConversationSamples(100, "twin-a-v1")[0];
    expect(scopedSample).toMatchObject({ id: "draft-1", status: "sent", groupName: "项目群", senderName: "同事甲", branchId: "branch-a", twinVersionId: "twin-a-v1", robotId: "robot-a" });
    expect(scopedSample.sentAt).toBeTruthy();
    expect(scopedSample.evaluation).toMatchObject({ id: "evaluation-1", status: "pending", score: 4, labels: ["boundary", "voice"] });

    store.updateConversationSampleStatus("draft-1", "failed", "sessionWebhook HTTP 503");
    expect(store.listConversationSamples(100, "twin-a-v1")[0]).toMatchObject({ status: "failed", deliveryError: "sessionWebhook HTTP 503" });

    store.markConversationSampleEvaluationsApplied(["evaluation-1"]);
    expect(store.listConversationSamples(100, "twin-a-v1")[0].evaluation?.status).toBe("applied");
    store.close();
  });

  it("persists DingTalk processing events and recovers messages interrupted before completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-conversation-recovery-"));
    temporaryDirectories.push(root);
    const store = new EpisodicStore(join(root, "sessions.sqlite"));
    store.recordConversationSample({
      id: "stream:robot-a:message-a",
      channel: "dingtalk_stream",
      conversationId: "cid-a",
      groupName: "测试群",
      senderId: "user-a",
      senderName: "同事甲",
      prompt: "请看这张安装报错截图",
      reply: "",
      status: "received",
      createdAt: "2026-08-18T01:49:00.000Z",
      robotId: "robot-a",
      groupId: "cid-a",
      processingStage: "received",
      processingLog: [{ stage: "received", status: "info", at: "2026-08-18T01:49:00.000Z", message: "原始消息已落盘" }],
    });
    store.appendConversationSampleEvent("stream:robot-a:message-a", {
      stage: "acknowledged",
      status: "complete",
      at: "2026-08-18T01:49:00.100Z",
      message: "落盘后才向钉钉 ACK",
    });

    expect(store.getConversationSample("stream:robot-a:message-a")).toMatchObject({
      status: "received",
      processingStage: "acknowledged",
      processingLog: [
        { stage: "received", message: "原始消息已落盘" },
        { stage: "acknowledged", message: "落盘后才向钉钉 ACK" },
      ],
    });

    expect(store.recoverInterruptedConversationSamples()).toBe(1);
    const recovered = store.getConversationSample("stream:robot-a:message-a");
    expect(recovered).toMatchObject({ status: "failed", processingStage: "recovery" });
    expect(recovered?.deliveryError).toContain("应用在消息处理完成前退出");
    expect(recovered?.processingLog?.at(-1)).toMatchObject({ stage: "recovery", status: "error" });
    expect(store.recoverInterruptedConversationSamples()).toBe(0);
    store.close();
  });
});
