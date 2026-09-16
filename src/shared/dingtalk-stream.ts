export interface StreamRobotVisualAttachment {
  downloadCode: string;
  name?: string;
  kind: "picture" | "file";
}

export interface StreamRobotEnvelope {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  senderStaffId: string;
  content: string;
  createdAt: string;
  sessionWebhook: string;
  sessionWebhookExpiredTime: number;
  robotCode: string;
  visualAttachments: StreamRobotVisualAttachment[];
}

/**
 * DingTalk's public Stream protocol considers the subscription channel ready
 * once the WebSocket handshake succeeds. `registered` is an SDK-internal flag
 * and the server does not guarantee a REGISTERED system frame.
 */
export function isStreamChannelReady(client: { connected: boolean } | undefined): boolean {
  return Boolean(client?.connected);
}

export function parseStreamRobotMessage(data: string): StreamRobotEnvelope {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    throw new Error("钉钉 Stream 回调不是有效 JSON。");
  }
  const msgtype = String(parsed.msgtype || "unknown");
  const text = asRecord(parsed.text);
  const messageContent = asRecord(parsed.content);
  const visuals = extractVisualAttachments(msgtype, messageContent);
  const content = msgtype === "text"
    ? String(text.content || "").trim()
    : msgtype === "richText"
      ? extractRichText(messageContent)
      : msgtype === "picture"
        ? "[图片]"
        : msgtype === "file"
          ? `[文件：${String(messageContent.fileName || "未命名")}]`
          : "";
  if (!content && !visuals.length) throw new Error(`暂不支持 ${msgtype} 类型的机器人消息。`);
  if (!parsed.conversationId || !parsed.msgId || !parsed.sessionWebhook || !parsed.robotCode) {
    throw new Error("钉钉 Stream 回调缺少 conversationId、msgId、robotCode 或 sessionWebhook。");
  }

  return {
    conversationId: String(parsed.conversationId),
    messageId: String(parsed.msgId),
    senderId: String(parsed.senderId || parsed.senderStaffId || "unknown"),
    senderName: String(parsed.senderNick || parsed.senderStaffId || "群成员"),
    senderStaffId: String(parsed.senderStaffId || ""),
    content,
    createdAt: normalizeDingTalkTime(Number(parsed.createAt)),
    sessionWebhook: validateSessionWebhook(String(parsed.sessionWebhook)),
    sessionWebhookExpiredTime: Number(parsed.sessionWebhookExpiredTime) || 0,
    robotCode: String(parsed.robotCode),
    visualAttachments: visuals,
  };
}

function extractVisualAttachments(msgtype: string, content: Record<string, unknown>): StreamRobotVisualAttachment[] {
  if (msgtype === "picture") {
    const code = String(content.downloadCode || content.pictureDownloadCode || "").trim();
    return code ? [{ downloadCode: code, kind: "picture" }] : [];
  }
  if (msgtype === "file") {
    const code = String(content.downloadCode || "").trim();
    const name = String(content.fileName || "").trim() || undefined;
    return code ? [{ downloadCode: code, kind: "file", name }] : [];
  }
  if (msgtype !== "richText" || !Array.isArray(content.richText)) return [];
  return content.richText.flatMap((raw) => {
    const item = asRecord(raw);
    if (item.type !== "picture") return [];
    const code = String(item.downloadCode || item.pictureDownloadCode || "").trim();
    return code ? [{ downloadCode: code, kind: "picture" as const }] : [];
  });
}

function extractRichText(content: Record<string, unknown>): string {
  if (!Array.isArray(content.richText)) return "[富文本消息]";
  const text = content.richText.map((raw) => {
    const item = asRecord(raw);
    if (typeof item.text === "string") return item.text.trim();
    return item.type === "picture" ? "[图片]" : "";
  }).filter(Boolean).join(" ");
  return text || "[富文本消息]";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function validateSessionWebhook(raw: string): string {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("钉钉返回的 sessionWebhook 地址无效。");
  }
  const hostname = target.hostname.toLowerCase();
  if (target.protocol !== "https:" || (hostname !== "dingtalk.com" && !hostname.endsWith(".dingtalk.com"))) {
    throw new Error("拒绝向非钉钉 HTTPS 地址发送机器人回复。");
  }
  return target.toString();
}

export function buildStreamReply(reply: string, senderStaffId?: string): Record<string, unknown> {
  const content = reply.trim();
  if (!content) throw new Error("机器人回复不能为空。");
  return {
    msgtype: "text",
    text: { content },
    at: {
      atUserIds: senderStaffId ? [senderStaffId] : [],
      isAtAll: false,
    },
  };
}

function normalizeDingTalkTime(value: number): string {
  const numeric = Number(value);
  const milliseconds = numeric > 0 && numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  const date = new Date(milliseconds || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
