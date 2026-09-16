import { describe, expect, it } from "vitest";
import { buildStreamReply, isStreamChannelReady, parseStreamRobotMessage, validateSessionWebhook } from "../src/shared/dingtalk-stream";

describe("DingTalk enterprise robot Stream", () => {
  const callback = {
    conversationId: "cid-test-group",
    chatbotCorpId: "corp",
    chatbotUserId: "bot-user",
    msgId: "message-1",
    senderNick: "同事甲",
    isAdmin: false,
    senderStaffId: "staff-1",
    sessionWebhookExpiredTime: 1_800_000_000_000,
    createAt: 1_700_000_000_000,
    senderCorpId: "corp",
    conversationType: "2",
    senderId: "sender-1",
    sessionWebhook: "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
    robotCode: "ding-test",
    msgtype: "text",
    text: { content: "  帮我看一下这个方案  " },
  };

  it("parses the official robot callback fields", () => {
    expect(parseStreamRobotMessage(JSON.stringify(callback))).toMatchObject({
      conversationId: "cid-test-group",
      messageId: "message-1",
      senderName: "同事甲",
      senderStaffId: "staff-1",
      content: "帮我看一下这个方案",
    });
  });

  it("keeps picture download codes as visual attachments for Agent-selected OCR", () => {
    const picture = {
      ...callback,
      msgId: "picture-1",
      msgtype: "picture",
      text: undefined,
      content: { pictureDownloadCode: "preview-code", downloadCode: "full-image-code" },
    };
    expect(parseStreamRobotMessage(JSON.stringify(picture))).toMatchObject({
      content: "[图片]",
      robotCode: "ding-test",
      visualAttachments: [{ downloadCode: "full-image-code", kind: "picture" }],
    });
  });

  it("collects text and pictures from rich text messages", () => {
    const richText = {
      ...callback,
      msgId: "rich-1",
      msgtype: "richText",
      text: undefined,
      content: { richText: [{ text: "帮我看看这个截图" }, { type: "picture", downloadCode: "image-code" }] },
    };
    expect(parseStreamRobotMessage(JSON.stringify(richText))).toMatchObject({
      content: "帮我看看这个截图 [图片]",
      visualAttachments: [{ downloadCode: "image-code", kind: "picture" }],
    });
  });

  it("only accepts DingTalk HTTPS session webhooks", () => {
    expect(validateSessionWebhook(callback.sessionWebhook)).toContain("api.dingtalk.com");
    expect(() => validateSessionWebhook("https://example.com/steal")).toThrow("非钉钉");
    expect(() => validateSessionWebhook("http://api.dingtalk.com/reply")).toThrow("非钉钉");
  });

  it("builds a text reply addressed to the original sender", () => {
    expect(buildStreamReply("收到，我先看一下。", "staff-1")).toEqual({
      msgtype: "text",
      text: { content: "收到，我先看一下。" },
      at: { atUserIds: ["staff-1"], isAtAll: false },
    });
  });

  it("treats an open WebSocket as ready without relying on an undocumented REGISTERED frame", () => {
    expect(isStreamChannelReady({ connected: true })).toBe(true);
    expect(isStreamChannelReady({ connected: false })).toBe(false);
    expect(isStreamChannelReady(undefined)).toBe(false);
  });
});
