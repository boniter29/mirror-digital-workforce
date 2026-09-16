import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";

interface WebhookCredentials { url: string; secret?: string }
interface StoredRegistry { version: 1; connectors: Record<string, { url: string; secret?: string }> }

export class DingTalkWebhookCredentialRegistry {
  private readonly credentials = new Map<string, WebhookCredentials>();
  private persisted = false;
  constructor(private readonly credentialPath: string) {}

  async hydrate(): Promise<void> {
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) return;
      const stored = JSON.parse(await readFile(this.credentialPath, "utf8")) as StoredRegistry;
      for (const [id, value] of Object.entries(stored.connectors || {})) {
        const url = (await safeStorage.decryptStringAsync(Buffer.from(value.url, "base64"))).result;
        const secret = value.secret ? (await safeStorage.decryptStringAsync(Buffer.from(value.secret, "base64"))).result : undefined;
        this.credentials.set(id, { url: validateWebhook(url), secret: secret?.trim() || undefined });
      }
      this.persisted = true;
    } catch {
      this.credentials.clear();
      await this.hydrateLegacy();
    }
  }

  private async hydrateLegacy(): Promise<void> {
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) return;
      const legacyPath = `${dirname(this.credentialPath)}/dingtalk-webhook.json`;
      const legacy = JSON.parse(await readFile(legacyPath, "utf8")) as { encryptedWebhookUrl?: string; encryptedSigningSecret?: string };
      if (!legacy.encryptedWebhookUrl) return;
      const url = (await safeStorage.decryptStringAsync(Buffer.from(legacy.encryptedWebhookUrl, "base64"))).result;
      const secret = legacy.encryptedSigningSecret ? (await safeStorage.decryptStringAsync(Buffer.from(legacy.encryptedSigningSecret, "base64"))).result : undefined;
      this.credentials.set("legacy-group", { url: validateWebhook(url), secret: secret?.trim() || undefined });
    } catch {
      // No legacy Webhook configuration exists, or it belongs to another OS account.
    }
  }

  async configure(id: string, input: { url?: string; secret?: string }): Promise<void> {
    const current = this.credentials.get(id);
    const url = input.url?.trim() ? validateWebhook(input.url) : current?.url;
    const secret = input.secret?.trim() || current?.secret;
    if (!url) throw new Error("Webhook 模式必须填写自定义机器人的 Webhook 地址。");
    this.credentials.set(id, { url, secret });
    this.persisted = false;
    if (!await safeStorage.isAsyncEncryptionAvailable()) return;
    const connectors: StoredRegistry["connectors"] = {};
    for (const [connectorId, value] of this.credentials) {
      connectors[connectorId] = {
        url: (await safeStorage.encryptStringAsync(value.url)).toString("base64"),
        secret: value.secret ? (await safeStorage.encryptStringAsync(value.secret)).toString("base64") : undefined,
      };
    }
    await mkdir(dirname(this.credentialPath), { recursive: true });
    await writeFile(this.credentialPath, JSON.stringify({ version: 1, connectors } satisfies StoredRegistry), { encoding: "utf8", mode: 0o600 });
    this.persisted = true;
  }

  has(id: string): boolean { return this.credentials.has(id); }
  any(): boolean { return this.credentials.size > 0; }
  status(): { configured: boolean; storage: "encrypted_local" | "session" | "none" } {
    return { configured: this.any(), storage: this.any() ? (this.persisted ? "encrypted_local" : "session") : "none" };
  }

  async send(id: string, content: string, keyword?: string): Promise<void> {
    const credential = this.credentials.get(id);
    if (!credential) throw new Error("该群的自定义机器人 Webhook 尚未配置。");
    const timestamp = Date.now().toString();
    const target = new URL(credential.url);
    if (credential.secret) {
      const sign = createHmac("sha256", credential.secret).update(`${timestamp}\n${credential.secret}`).digest("base64");
      target.searchParams.set("timestamp", timestamp);
      target.searchParams.set("sign", sign);
    }
    const requiredKeyword = keyword?.trim();
    const text = requiredKeyword && !content.includes(requiredKeyword) ? `${requiredKeyword}\n${content}` : content;
    const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ msgtype: "text", text: { content: text }, at: { isAtAll: false } }) });
    const body = await response.text();
    if (!response.ok) throw new Error(`自定义机器人 Webhook 发送失败（HTTP ${response.status}）：${body.slice(0, 300)}`);
    if (body.trim()) {
      const parsed = JSON.parse(body) as { errcode?: number; errmsg?: string };
      if (parsed.errcode) throw new Error(`自定义机器人 Webhook 拒绝发送：${parsed.errmsg || parsed.errcode}`);
    }
  }
}

export function validateWebhook(raw: string): string {
  const target = new URL(raw.trim());
  const host = target.hostname.toLowerCase();
  if (target.protocol !== "https:" || !(host === "dingtalk.com" || host.endsWith(".dingtalk.com")) || !target.pathname.includes("/robot/send") || !target.searchParams.get("access_token")) {
    throw new Error("Webhook 必须是钉钉官方 HTTPS 自定义机器人地址，并包含 access_token。");
  }
  return target.toString();
}
