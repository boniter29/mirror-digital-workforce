import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DingTalkContextMessage {
  id: string;
  conversationId: string;
  sender: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export class DingTalkContextStore {
  private readonly cache = new Map<string, DingTalkContextMessage[]>();

  constructor(private readonly root: string) {}

  async append(message: DingTalkContextMessage): Promise<void> {
    if (!message.conversationId || !message.content.trim()) return;
    const list = this.cache.get(message.conversationId) ?? await this.load(message.conversationId);
    if (list.some((item) => item.id === message.id)) return;
    list.push({ ...message, content: message.content.trim() });
    if (list.length > 200) list.splice(0, list.length - 200);
    this.cache.set(message.conversationId, list);
    await mkdir(this.root, { recursive: true });
    await appendFile(this.pathFor(message.conversationId), `${JSON.stringify(message)}\n`, "utf8");
  }

  async recent(conversationId: string, limit = 30): Promise<DingTalkContextMessage[]> {
    const list = this.cache.get(conversationId) ?? await this.load(conversationId);
    return list.slice(-Math.max(1, Math.min(limit, 60)));
  }

  async formatForPrompt(conversationId: string, excludeMessageId?: string): Promise<string> {
    const raw = (await this.recent(conversationId, 40)).filter((item) => item.id !== excludeMessageId);
    const messages = raw.filter((item, index) => {
      const normalized = item.content.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
      return !raw.slice(Math.max(0, index - 8), index).some((previous) => previous.senderId === item.senderId && previous.content.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "") === normalized);
    }).slice(-24);
    if (!messages.length) return "当前没有可用的群聊环境上下文。";
    return messages.map((item) => `[${item.createdAt}] ${item.sender || item.senderId}: ${item.content}`).join("\n").slice(-24_000);
  }

  private async load(conversationId: string): Promise<DingTalkContextMessage[]> {
    try {
      const content = await readFile(this.pathFor(conversationId), "utf8");
      const parsed = content.split(/\r?\n/).filter(Boolean).slice(-200).flatMap((line) => {
        try { return [JSON.parse(line) as DingTalkContextMessage]; } catch { return []; }
      });
      this.cache.set(conversationId, parsed);
      return parsed;
    } catch {
      const empty: DingTalkContextMessage[] = [];
      this.cache.set(conversationId, empty);
      return empty;
    }
  }

  private pathFor(conversationId: string): string {
    const safe = Buffer.from(conversationId).toString("base64url").slice(0, 120);
    return join(this.root, `${safe}.jsonl`);
  }
}
