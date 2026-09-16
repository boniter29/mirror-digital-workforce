import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";

interface StoredStreamCredentialEntry { encryptedClientId: string; encryptedClientSecret: string }
interface StoredStreamCredentials { version: 2; robots: Record<string, StoredStreamCredentialEntry> }
interface LegacyStoredStreamCredentials { version: 1; encryptedClientId: string; encryptedClientSecret: string }

interface StreamCredentials {
  clientId: string;
  clientSecret: string;
}

export class DingTalkStreamCredentialManager {
  private readonly credentials = new Map<string, StreamCredentials>();
  private readonly persisted = new Set<string>();

  constructor(private readonly credentialPath: string) {}

  async hydrate(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.credentialPath, "utf8")) as StoredStreamCredentials | LegacyStoredStreamCredentials;
      if (!await safeStorage.isAsyncEncryptionAvailable()) return;
      const entries = stored.version === 1
        ? [["enterprise-stream-primary", { encryptedClientId: stored.encryptedClientId, encryptedClientSecret: stored.encryptedClientSecret }]] as const
        : Object.entries(stored.robots ?? {});
      for (const [robotId, encrypted] of entries) {
        if (!encrypted.encryptedClientId || !encrypted.encryptedClientSecret) continue;
        const clientId = (await safeStorage.decryptStringAsync(Buffer.from(encrypted.encryptedClientId, "base64"))).result.trim();
        const clientSecret = (await safeStorage.decryptStringAsync(Buffer.from(encrypted.encryptedClientSecret, "base64"))).result.trim();
        if (!clientId || !clientSecret) continue;
        this.credentials.set(robotId, { clientId, clientSecret });
        this.persisted.add(robotId);
      }
    } catch {
      // First run, deleted file, or credentials encrypted by another OS account.
    }
  }

  async configure(robotId: string, input: { clientId?: string; clientSecret?: string }): Promise<void> {
    const key = normalizeRobotId(robotId);
    const current = this.credentials.get(key);
    const clientId = input.clientId?.trim() || current?.clientId;
    const clientSecret = input.clientSecret?.trim() || current?.clientSecret;
    if (!clientId || !clientSecret) throw new Error("请填写企业内部应用的 Client ID（AppKey）和 Client Secret（AppSecret）。");
    if (!/^ding[a-zA-Z0-9_-]+$/.test(clientId)) throw new Error("Client ID 格式不正确，应为钉钉开发者后台显示的 ding… AppKey。");

    this.credentials.set(key, { clientId, clientSecret });
    this.persisted.delete(key);
    if (!await safeStorage.isAsyncEncryptionAvailable()) return;
    await mkdir(dirname(this.credentialPath), { recursive: true });
    const robots: Record<string, StoredStreamCredentialEntry> = {};
    for (const [id, credentials] of this.credentials) {
      robots[id] = {
        encryptedClientId: (await safeStorage.encryptStringAsync(credentials.clientId)).toString("base64"),
        encryptedClientSecret: (await safeStorage.encryptStringAsync(credentials.clientSecret)).toString("base64"),
      };
    }
    const stored: StoredStreamCredentials = {
      version: 2,
      robots,
    };
    await writeFile(this.credentialPath, JSON.stringify(stored), { encoding: "utf8", mode: 0o600 });
    this.persisted.clear();
    for (const id of this.credentials.keys()) this.persisted.add(id);
  }

  require(robotId = "enterprise-stream-primary"): StreamCredentials {
    const credentials = this.credentials.get(normalizeRobotId(robotId));
    if (!credentials) throw new Error(`机器人“${robotId}”尚未配置 Client ID 与 Client Secret。`);
    return { ...credentials };
  }

  has(robotId: string): boolean { return this.credentials.has(normalizeRobotId(robotId)); }
  any(): boolean { return this.credentials.size > 0; }
  count(): number { return this.credentials.size; }

  status(robotId = "enterprise-stream-primary"): { configured: boolean; storage: "encrypted_local" | "session" | "none"; clientIdHint?: string } {
    const key = normalizeRobotId(robotId);
    const id = this.credentials.get(key)?.clientId;
    return {
      configured: Boolean(id),
      storage: id ? (this.persisted.has(key) ? "encrypted_local" : "session") : "none",
      clientIdHint: id ? `${id.slice(0, 6)}…${id.slice(-4)}` : undefined,
    };
  }
}

function normalizeRobotId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(normalized)) throw new Error("机器人 ID 只能使用字母、数字、点、下划线、冒号和连字符。");
  return normalized;
}
