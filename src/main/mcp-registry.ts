import { readFile, writeFile } from "node:fs/promises";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export interface ExternalMcpConnection {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  createdAt: string;
}

export class McpConnectionRegistry {
  constructor(private readonly path: string) {}

  async list(): Promise<ExternalMcpConnection[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      return Array.isArray(parsed) ? parsed as ExternalMcpConnection[] : [];
    } catch {
      return [];
    }
  }

  async add(name: string, rawUrl: string): Promise<ExternalMcpConnection> {
    if (!/^[a-z0-9_-]{1,48}$/i.test(name)) throw new Error("MCP 名称只能使用字母、数字、下划线或连字符。");
    const url = new URL(rawUrl.trim());
    const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("远程 MCP 必须使用 HTTPS；本机 localhost 可以使用 HTTP。");
    const records = await this.list();
    const record: ExternalMcpConnection = { id: name.toLowerCase(), name, url: url.toString(), enabled: true, createdAt: new Date().toISOString() };
    await writeFile(this.path, JSON.stringify([record, ...records.filter((item) => item.id !== record.id)], null, 2), "utf8");
    return record;
  }

  async sdkServers(): Promise<Record<string, McpServerConfig>> {
    const result: Record<string, McpServerConfig> = {};
    for (const item of (await this.list()).filter((entry) => entry.enabled)) result[item.id] = { type: "http", url: item.url, timeout: 30_000 };
    return result;
  }
}
