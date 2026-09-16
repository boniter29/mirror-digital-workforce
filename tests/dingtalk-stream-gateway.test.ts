import { afterEach, describe, expect, it, vi } from "vitest";
import { DingTalkStreamGateway, normalizeDingTalkMediaUrl } from "../src/main/dingtalk-stream-gateway";
import type { ConversationProcessingEvent, ConversationSample, DingTalkConfig, DingTalkDraft } from "../src/shared/types";

interface FakeSampleStore {
  samples: Map<string, ConversationSample>;
  recordConversationSample: (sample: Omit<ConversationSample, "updatedAt" | "evaluation">) => ConversationSample;
  getConversationSample: (id: string) => ConversationSample | undefined;
  appendConversationSampleEvent: (id: string, event: ConversationProcessingEvent) => void;
  updateConversationSampleStatus: (id: string, status: ConversationSample["status"], deliveryError?: string) => void;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DingTalk Stream durable intake", () => {
  it("persists the original message and group context before acknowledging DingTalk", async () => {
    const order: string[] = [];
    const episodic = fakeSampleStore(order);
    const context = {
      append: vi.fn(async () => { order.push("context"); }),
      formatForPrompt: vi.fn(async () => "recent context"),
    };
    const twin = { chat: vi.fn(async () => { order.push("chat"); return { sessionId: "sdk-a", turn: { content: "收到，我看下。" } }; }) };
    const drafts: DingTalkDraft[] = [];
    const gateway = new DingTalkStreamGateway({} as never, twin as never, context as never, episodic as never, {} as never, (draft) => drafts.push(draft), () => undefined);
    (gateway as unknown as { config: DingTalkConfig }).config = streamConfig();
    const client = {
      socketCallBackResponse: vi.fn(() => { order.push("ack"); }),
      getAccessToken: vi.fn(async () => "token"),
    };

    await (gateway as unknown as { acceptCallback: (robotId: string, client: unknown, downstream: unknown) => Promise<void> }).acceptCallback(
      "robot-a",
      client,
      textCallback(),
    );

    expect(order.slice(0, 4)).toEqual(["persist", "context", "ack", "chat"]);
    expect(client.socketCallBackResponse).toHaveBeenCalledOnce();
    expect(episodic.samples.get("stream:robot-a:message-a")).toMatchObject({
      prompt: "请看这个问题",
      status: "draft",
      conversationId: "cid-a",
      robotId: "robot-a",
      groupId: "cid-a",
    });
    expect(drafts[0]).toMatchObject({ id: "stream:robot-a:message-a", status: "processing", reply: "" });
    expect(drafts.at(-1)).toMatchObject({ id: "stream:robot-a:message-a", status: "draft", reply: "收到，我看下。" });
    clearGatewayTimers(gateway);
  });

  it("keeps the message visible and continues with text when DingTalk image download fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"code":"Forbidden"}', { status: 403, headers: { "content-type": "application/json" } })));
    const order: string[] = [];
    const episodic = fakeSampleStore(order);
    const context = { append: vi.fn(async () => { order.push("context"); }), formatForPrompt: vi.fn(async () => "recent context") };
    const twin = { chat: vi.fn(async (...args: unknown[]) => { order.push("chat"); expect(args.at(-1)).toEqual([]); return { sessionId: "sdk-b", turn: { content: "图片我暂时读不到，你把报错文字贴一下。" } }; }) };
    const drafts: DingTalkDraft[] = [];
    const runtimeEvents: Array<{ stage: string; message: string }> = [];
    const gateway = new DingTalkStreamGateway({} as never, twin as never, context as never, episodic as never, {} as never, (draft) => drafts.push(draft), (event) => runtimeEvents.push(event));
    (gateway as unknown as { config: DingTalkConfig }).config = streamConfig();
    const client = { socketCallBackResponse: vi.fn(() => { order.push("ack"); }), getAccessToken: vi.fn(async () => "token") };
    (gateway as unknown as { clients: Map<string, unknown> }).clients.set("robot-a", client);

    await (gateway as unknown as { acceptCallback: (robotId: string, client: unknown, downstream: unknown) => Promise<void> }).acceptCallback(
      "robot-a",
      client,
      richTextCallback(),
    );

    const saved = episodic.samples.get("stream:robot-a:message-image");
    expect(saved).toMatchObject({ status: "draft", prompt: "安装时出现这个提示 [图片]" });
    expect(saved?.deliveryError).toContain("HTTP 403");
    expect(saved?.processingLog).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "visual-download", status: "warning", message: expect.stringContaining("HTTP 403") }),
      expect.objectContaining({ stage: "draft", status: "complete" }),
    ]));
    expect(drafts[0]).toMatchObject({ status: "processing" });
    expect(drafts.at(-1)).toMatchObject({ status: "draft", deliveryError: expect.stringContaining("HTTP 403") });
    expect(runtimeEvents.some((event) => event.stage === "dingtalk-visual-fallback")).toBe(true);
    expect(order.indexOf("ack")).toBeLessThan(order.indexOf("chat"));
    clearGatewayTimers(gateway);
  });

  it("securely upgrades DingTalk temporary HTTP media URLs and forwards the downloaded image", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("messageFiles/download")) return new Response(JSON.stringify({ downloadUrl: "http://download.dingtalk.com/temp/a.png?sig=1" }), { status: 200, headers: { "content-type": "application/json" } });
      expect(url).toBe("https://download.dingtalk.com/temp/a.png?sig=1");
      return new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "content-type": "image/png" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const order: string[] = [];
    const episodic = fakeSampleStore(order);
    const context = { append: vi.fn(async () => undefined), formatForPrompt: vi.fn(async () => "") };
    const attachment = { id: "visual-a", name: "a.png", path: "D:/safe/a.png", mimeType: "image/png", size: 4, source: "dingtalk" as const };
    const paddle = { attachmentsRoot: "D:/safe", stageDingTalkDownload: vi.fn(async () => attachment) };
    const twin = { chat: vi.fn(async (...args: unknown[]) => { expect(args.at(-1)).toEqual([attachment]); return { sessionId: "sdk-image", turn: { content: "我看到了安装错误截图。" } }; }) };
    const gateway = new DingTalkStreamGateway({} as never, twin as never, context as never, episodic as never, paddle as never, () => undefined, () => undefined);
    (gateway as unknown as { config: DingTalkConfig }).config = streamConfig();
    const client = { socketCallBackResponse: vi.fn(), getAccessToken: vi.fn(async () => "token") };
    (gateway as unknown as { clients: Map<string, unknown> }).clients.set("robot-a", client);
    await (gateway as unknown as { acceptCallback: (robotId: string, client: unknown, downstream: unknown) => Promise<void> }).acceptCallback("robot-a", client, richTextCallback());
    expect(paddle.stageDingTalkDownload).toHaveBeenCalledOnce();
    expect(twin.chat).toHaveBeenCalledOnce();
    clearGatewayTimers(gateway);
  });

  it("rejects private-network media targets", () => {
    expect(normalizeDingTalkMediaUrl("http://download.dingtalk.com/a").toString()).toBe("https://download.dingtalk.com/a");
    expect(() => normalizeDingTalkMediaUrl("http://127.0.0.1/a")).toThrow(/私有网络/);
  });
});

function fakeSampleStore(order: string[]): FakeSampleStore {
  const samples = new Map<string, ConversationSample>();
  return {
    samples,
    recordConversationSample(input) {
      if (!samples.has(input.id)) order.push("persist");
      const previous = samples.get(input.id);
      const sample = {
        ...previous,
        ...input,
        processingLog: input.processingLog ?? previous?.processingLog,
        updatedAt: new Date().toISOString(),
      } as ConversationSample;
      samples.set(input.id, sample);
      return sample;
    },
    getConversationSample: (id) => samples.get(id),
    appendConversationSampleEvent(id, event) {
      const current = samples.get(id);
      if (!current) return;
      samples.set(id, { ...current, processingStage: event.stage, processingLog: [...(current.processingLog ?? []), event], updatedAt: event.at });
    },
    updateConversationSampleStatus(id, status, deliveryError) {
      const current = samples.get(id);
      if (!current) return;
      samples.set(id, { ...current, status, deliveryError: deliveryError ?? current.deliveryError, updatedAt: new Date().toISOString() });
    },
  };
}

function streamConfig(): DingTalkConfig {
  return {
    targetType: "group",
    targetId: "cid-a",
    mode: "draft",
    streamConfigured: true,
    groups: [{
      id: "binding-a",
      robotId: "robot-a",
      robotName: "示例主管分身机器人",
      groupId: "cid-a",
      name: "产品测试群",
      openConversationId: "cid-a",
      personaId: "primary",
      branchId: "branch-a",
      twinVersionId: "version-a",
      twinVersionName: "示例主管 v1",
      gatewayType: "stream",
      enabled: true,
      contextEnabled: true,
      replyMode: "draft",
      triggerMode: "all",
      triggerWords: [],
    }],
  };
}

function textCallback() {
  return {
    headers: { messageId: "callback-a" },
    data: JSON.stringify({
      conversationId: "cid-a",
      msgId: "message-a",
      msgtype: "text",
      text: { content: "请看这个问题" },
      senderId: "user-a",
      senderStaffId: "staff-a",
      senderNick: "同事甲",
      createAt: 1_776_640_140_000,
      sessionWebhook: "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
      sessionWebhookExpiredTime: 1_776_646_140_000,
      robotCode: "robot-code-a",
    }),
  };
}

function richTextCallback() {
  return {
    headers: { messageId: "callback-image" },
    data: JSON.stringify({
      conversationId: "cid-a",
      msgId: "message-image",
      msgtype: "richText",
      content: { richText: [{ type: "text", text: "安装时出现这个提示" }, { type: "picture", downloadCode: "download-code-a" }] },
      senderId: "user-a",
      senderStaffId: "staff-a",
      senderNick: "同事甲",
      createAt: 1_776_640_140_000,
      sessionWebhook: "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
      sessionWebhookExpiredTime: 1_776_646_140_000,
      robotCode: "robot-code-a",
    }),
  };
}

function clearGatewayTimers(gateway: DingTalkStreamGateway): void {
  (gateway as unknown as { processing: Set<string> }).processing.clear();
}
