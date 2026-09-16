import { safeStorage } from "electron";
import { withDwsOnPath } from "./dws-executable.js";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BootstrapState, ClaudeAuthMethod, ModelConnectionInput, ModelProvider, ModelProviderAuthMode } from "../shared/types.js";
import { modelProviderDisplayName, modelProviderPreset } from "../shared/model-providers.js";

type CredentialStorage = BootstrapState["runtime"]["claudeCredentialStorage"];
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

interface LegacyStoredCredential { version: 1; encryptedApiKey: string; }
interface StoredCredentialV2 {
  version: 2;
  provider: "anthropic" | "deepseek" | "zhipu";
  encryptedApiKey: string;
  baseUrl?: string;
  model: string;
}
interface StoredCredentialV3 {
  version: 3;
  provider: ModelProvider;
  providerName?: string;
  encryptedApiKey: string;
  baseUrl?: string;
  model: string;
  authMode: ModelProviderAuthMode;
  nativeVision: boolean;
  mapModelTiers: boolean;
  contextWindow?: number;
}
interface ManagedConnection {
  provider: ModelProvider;
  providerName?: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  authMode: ModelProviderAuthMode;
  nativeVision: boolean;
  mapModelTiers: boolean;
  contextWindow?: number;
}

export interface ClaudeCredentialStatus {
  configured: boolean;
  method: ClaudeAuthMethod;
  storage: CredentialStorage;
  provider: ModelProvider;
  providerName?: string;
  model: string;
  baseUrl?: string;
  authMode: ModelProviderAuthMode;
  nativeVision: boolean;
  mapModelTiers: boolean;
  contextWindow?: number;
}

export interface ClaudeRuntimeConnection {
  provider: ModelProvider;
  providerName?: string;
  model: string;
  nativeVision: boolean;
  env: Record<string, string | undefined>;
}

export class ClaudeCredentialManager {
  private managed?: ManagedConnection;
  private persisted = false;

  constructor(private readonly credentialPath: string, private readonly homePath: string) {}

  async hydrate(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.credentialPath, "utf8")) as StoredCredentialV3 | StoredCredentialV2 | LegacyStoredCredential;
      if (!stored.encryptedApiKey || !await safeStorage.isAsyncEncryptionAvailable()) return;
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(stored.encryptedApiKey, "base64"));
      const apiKey = decrypted.result.trim();
      if (!apiKey) return;
      if (stored.version === 3) {
        const preset = modelProviderPreset(stored.provider);
        this.managed = {
          provider: stored.provider,
          providerName: cleanProviderName(stored.providerName),
          apiKey,
          baseUrl: stored.provider === "anthropic" && !stored.baseUrl ? undefined : normalizeBaseUrl(stored.baseUrl, stored.provider),
          model: stored.model || preset.model,
          authMode: stored.authMode || preset.authMode,
          nativeVision: stored.nativeVision ?? preset.nativeVision,
          mapModelTiers: stored.mapModelTiers ?? preset.mapModelTiers,
          contextWindow: normalizeContextWindow(stored.contextWindow),
        };
      } else if (stored.version === 2) {
        this.managed = migrateV2(stored, apiKey);
      } else {
        this.managed = connectionFromInput({ provider: "anthropic", apiKey, model: DEFAULT_ANTHROPIC_MODEL });
      }
      this.persisted = true;
    } catch {
      // First launch, damaged credentials, or an unavailable OS keychain:
      // continue with environment/subscription authentication.
    }
  }

  async configure(input: ModelConnectionInput): Promise<ClaudeCredentialStatus> {
    const apiKey = input.apiKey.trim();
    const localCustom = input.provider === "custom" && isLocalBaseUrl(input.baseUrl);
    if (!apiKey || (!localCustom && apiKey.length < 8)) {
      throw new Error(`请输入有效的 ${modelProviderDisplayName(input.provider, input.providerName)} API Key；本地兼容端点可填写服务要求的占位凭证。`);
    }
    const connection = connectionFromInput({ ...input, apiKey });
    this.managed = connection;
    this.persisted = false;
    if (await safeStorage.isAsyncEncryptionAvailable()) {
      const stored: StoredCredentialV3 = {
        version: 3,
        provider: connection.provider,
        providerName: connection.providerName,
        encryptedApiKey: (await safeStorage.encryptStringAsync(apiKey)).toString("base64"),
        baseUrl: connection.baseUrl,
        model: connection.model,
        authMode: connection.authMode,
        nativeVision: connection.nativeVision,
        mapModelTiers: connection.mapModelTiers,
        contextWindow: connection.contextWindow,
      };
      await writeFile(this.credentialPath, JSON.stringify(stored), { encoding: "utf8", mode: 0o600 });
      this.persisted = true;
    }
    return this.status();
  }

  status(): ClaudeCredentialStatus {
    if (this.managed) return {
      configured: true,
      method: this.managed.authMode,
      storage: this.persisted ? "encrypted_local" : "session",
      provider: this.managed.provider,
      providerName: this.managed.providerName,
      model: this.managed.model,
      baseUrl: this.managed.baseUrl,
      authMode: this.managed.authMode,
      nativeVision: this.managed.nativeVision,
      mapModelTiers: this.managed.mapModelTiers,
      contextWindow: this.managed.contextWindow,
    };

    const external = this.externalStatus();
    if (external) return external;
    const configRoot = process.env.CLAUDE_CONFIG_DIR || join(this.homePath, ".claude");
    if (existsSync(join(configRoot, ".credentials.json"))) return {
      configured: true,
      method: "subscription",
      storage: "encrypted_local",
      provider: "anthropic",
      model: process.env.CLAUDE_MODEL || DEFAULT_ANTHROPIC_MODEL,
      authMode: "api_key",
      nativeVision: true,
      mapModelTiers: false,
    };
    return {
      configured: false,
      method: "none",
      storage: "none",
      provider: "anthropic",
      model: DEFAULT_ANTHROPIC_MODEL,
      authMode: "api_key",
      nativeVision: true,
      mapModelTiers: false,
    };
  }

  runtimeConnection(): ClaudeRuntimeConnection {
    const status = this.status();
    const env: Record<string, string | undefined> = withDwsOnPath(process.env);
    if (this.managed) {
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
      delete env.CLAUDE_CODE_USE_BEDROCK;
      delete env.CLAUDE_CODE_USE_VERTEX;
      delete env.CLAUDE_CODE_USE_FOUNDRY;
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
      clearProviderModelMapping(env);
      if (this.managed.authMode === "auth_token") env.ANTHROPIC_AUTH_TOKEN = this.managed.apiKey;
      else env.ANTHROPIC_API_KEY = this.managed.apiKey;
      if (this.managed.baseUrl) env.ANTHROPIC_BASE_URL = this.managed.baseUrl;
      else delete env.ANTHROPIC_BASE_URL;
      if (this.managed.mapModelTiers) {
        env.ANTHROPIC_MODEL = this.managed.model;
        env.ANTHROPIC_DEFAULT_FABLE_MODEL = this.managed.model;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = this.managed.model;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = this.managed.model;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = this.managed.model;
        env.CLAUDE_CODE_SUBAGENT_MODEL = this.managed.model;
      }
      if (this.managed.contextWindow) {
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(this.managed.contextWindow);
        env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(this.managed.contextWindow);
      }
      if (this.managed.provider !== "anthropic") env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    }
    env.CLAUDE_AGENT_SDK_CLIENT_APP = "mirror-digital-twin/0.8.0";
    return { provider: status.provider, providerName: status.providerName, model: status.model, nativeVision: status.nativeVision, env };
  }

  private externalStatus(): ClaudeCredentialStatus | undefined {
    const baseUrl = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, "");
    const provider = providerForBaseUrl(baseUrl);
    const preset = modelProviderPreset(provider);
    const model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || preset.model;
    const common = {
      provider,
      providerName: provider === "custom" ? hostLabel(baseUrl) : undefined,
      model,
      baseUrl,
      authMode: process.env.ANTHROPIC_AUTH_TOKEN ? "auth_token" as const : "api_key" as const,
      nativeVision: provider === "zhipu" ? /glm-5\.3-flash/i.test(model) : preset.nativeVision,
      mapModelTiers: Boolean(process.env.ANTHROPIC_DEFAULT_SONNET_MODEL),
      contextWindow: normalizeContextWindow(Number(process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS || process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)),
    };
    if (enabled(process.env.CLAUDE_CODE_USE_BEDROCK)) return environmentStatus("bedrock", common);
    if (enabled(process.env.CLAUDE_CODE_USE_VERTEX)) return environmentStatus("vertex", common);
    if (enabled(process.env.CLAUDE_CODE_USE_FOUNDRY)) return environmentStatus("foundry", common);
    if (process.env.ANTHROPIC_AUTH_TOKEN) return environmentStatus("auth_token", common);
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return environmentStatus("oauth_token", common);
    if (process.env.ANTHROPIC_API_KEY) return environmentStatus("api_key", common);
    return undefined;
  }
}

function connectionFromInput(input: ModelConnectionInput & { apiKey: string }): ManagedConnection {
  const preset = modelProviderPreset(input.provider);
  const model = input.model?.trim() || preset.model;
  return {
    provider: input.provider,
    providerName: input.provider === "custom" ? cleanProviderName(input.providerName) || "自定义 Provider" : undefined,
    apiKey: input.apiKey,
    baseUrl: input.provider === "anthropic" && !input.baseUrl?.trim() ? undefined : normalizeBaseUrl(input.baseUrl, input.provider),
    model,
    authMode: input.authMode ?? preset.authMode,
    nativeVision: input.nativeVision ?? preset.nativeVision,
    mapModelTiers: input.mapModelTiers ?? preset.mapModelTiers,
    contextWindow: normalizeContextWindow(input.contextWindow ?? contextWindowFromModel(input.provider, model)),
  };
}

function migrateV2(stored: StoredCredentialV2, apiKey: string): ManagedConnection {
  const preset = modelProviderPreset(stored.provider);
  const model = stored.model || preset.model;
  return {
    provider: stored.provider,
    apiKey,
    baseUrl: stored.provider === "anthropic" ? undefined : normalizeBaseUrl(stored.baseUrl, stored.provider),
    model,
    authMode: preset.authMode,
    nativeVision: stored.provider === "zhipu" ? /glm-5\.3-flash/i.test(model) : preset.nativeVision,
    mapModelTiers: preset.mapModelTiers,
    contextWindow: contextWindowFromModel(stored.provider, model),
  };
}

function normalizeBaseUrl(raw: string | undefined, provider: ModelProvider): string {
  const fallback = modelProviderPreset(provider).baseUrl || "https://api.anthropic.com";
  const value = (raw?.trim() || fallback).replace(/\/$/, "");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("模型 API Base URL 格式无效。"); }
  if (parsed.protocol !== "https:" && !(isLocalHostname(parsed.hostname) && parsed.protocol === "http:")) {
    throw new Error("模型 API Base URL 必须使用 HTTPS；仅本机地址允许 HTTP。");
  }
  return value;
}

function providerForBaseUrl(baseUrl: string | undefined): ModelProvider {
  if (!baseUrl) return "anthropic";
  if (/deepseek/i.test(baseUrl)) return "deepseek";
  if (/z\.ai|bigmodel/i.test(baseUrl)) return "zhipu";
  if (/openrouter/i.test(baseUrl)) return "openrouter";
  if (/kimi\.com\/coding/i.test(baseUrl)) return "kimi";
  if (/api\.anthropic\.com/i.test(baseUrl)) return "anthropic";
  return "custom";
}

function contextWindowFromModel(provider: ModelProvider, model: string): number | undefined {
  if (provider === "zhipu" && model.includes("[1m]")) return 1_000_000;
  if (provider === "kimi" && model.includes("[1m]")) return 1_048_576;
  if (provider === "kimi" && /256k/i.test(model)) return 262_144;
  return modelProviderPreset(provider).contextWindow;
}
function normalizeContextWindow(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || !value || value < 16_000) return undefined;
  return Math.min(4_000_000, Math.floor(value));
}
function clearProviderModelMapping(env: Record<string, string | undefined>): void {
  delete env.ANTHROPIC_MODEL;
  delete env.ANTHROPIC_DEFAULT_FABLE_MODEL;
  delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  delete env.CLAUDE_CODE_SUBAGENT_MODEL;
  delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  delete env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
  delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
}
function cleanProviderName(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return cleaned || undefined;
}
function isLocalBaseUrl(value: string | undefined): boolean {
  try { return isLocalHostname(new URL(value || "").hostname); } catch { return false; }
}
function isLocalHostname(hostname: string): boolean { return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"; }
function hostLabel(baseUrl: string | undefined): string | undefined { try { return new URL(baseUrl || "").hostname; } catch { return undefined; } }
function enabled(value: string | undefined): boolean { return value === "1" || value?.toLowerCase() === "true"; }
function environmentStatus(
  method: ClaudeAuthMethod,
  connection: Pick<ClaudeCredentialStatus, "provider" | "providerName" | "model" | "baseUrl" | "authMode" | "nativeVision" | "mapModelTiers" | "contextWindow">,
): ClaudeCredentialStatus {
  return { configured: true, method, storage: "environment", ...connection };
}
