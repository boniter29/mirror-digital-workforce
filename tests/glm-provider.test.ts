import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value, "utf8")),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: value.toString("utf8"), wasEncrypted: true })),
  },
}));

import { ClaudeCredentialManager } from "../src/main/claude-credentials";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Zhipu GLM provider", () => {
  it("configures GLM-5.3-Flash through the official Anthropic-compatible endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-glm-"));
    roots.push(root);
    const credentialPath = join(root, "claude-credentials.json");
    const manager = new ClaudeCredentialManager(credentialPath, root);
    await manager.configure({ provider: "zhipu", apiKey: "zhipu-test-key-1234567890", model: "glm-5.3-flash[1m]" });

    const connection = manager.runtimeConnection();
    expect(connection.provider).toBe("zhipu");
    expect(connection.nativeVision).toBe(true);
    expect(connection.model).toBe("glm-5.3-flash[1m]");
    expect(connection.env.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(connection.env.ANTHROPIC_AUTH_TOKEN).toBe("zhipu-test-key-1234567890");
    expect(connection.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(connection.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-5.3-flash[1m]");
    expect(connection.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("glm-5.3-flash[1m]");
    expect(connection.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-5.3-flash[1m]");
    expect(connection.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("1000000");
  });

  it("hydrates encrypted GLM settings and clears them when switching provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-glm-hydrate-"));
    roots.push(root);
    const credentialPath = join(root, "claude-credentials.json");
    const first = new ClaudeCredentialManager(credentialPath, root);
    await first.configure({ provider: "zhipu", apiKey: "zhipu-test-key-1234567890", model: "glm-5.3-flash" });

    const restored = new ClaudeCredentialManager(credentialPath, root);
    await restored.hydrate();
    expect(restored.status()).toMatchObject({ provider: "zhipu", model: "glm-5.3-flash", baseUrl: "https://api.z.ai/api/anthropic" });

    await restored.configure({ provider: "deepseek", apiKey: "deepseek-test-key-123456789", model: "deepseek-v4-flash" });
    const switched = restored.runtimeConnection();
    expect(switched.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(switched.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(switched.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
  });

  it("keeps a custom Anthropic-compatible provider as first-class configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-provider-custom-"));
    roots.push(root);
    const manager = new ClaudeCredentialManager(join(root, "claude-credentials.json"), root);
    await manager.configure({ provider: "custom", providerName: "企业模型网关", apiKey: "gateway-token", baseUrl: "https://models.example.com/anthropic", model: "company-vision-1", authMode: "auth_token", nativeVision: true, mapModelTiers: true, contextWindow: 131072 });
    expect(manager.status()).toMatchObject({ provider: "custom", providerName: "企业模型网关", nativeVision: true, contextWindow: 131072 });
    const connection = manager.runtimeConnection();
    expect(connection.env.ANTHROPIC_BASE_URL).toBe("https://models.example.com/anthropic");
    expect(connection.env.ANTHROPIC_AUTH_TOKEN).toBe("gateway-token");
    expect(connection.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("company-vision-1");
  });
});
