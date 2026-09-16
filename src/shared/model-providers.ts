import type { ModelProvider, ModelProviderAuthMode } from "./types.js";

export interface ModelProviderPreset {
  id: ModelProvider;
  name: string;
  description: string;
  baseUrl: string;
  model: string;
  authMode: ModelProviderAuthMode;
  nativeVision: boolean;
  mapModelTiers: boolean;
  contextWindow?: number;
  models?: Array<{ id: string; label: string }>;
  note: string;
}

/**
 * Provider catalog for Anthropic Messages-compatible routes. This follows the
 * Hermes/OpenClaw pattern: presets are convenience metadata, while Custom is
 * a first-class provider rather than a hidden special case. The selected
 * route still runs exclusively through Claude Agent SDK.
 */
export const MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 原生 API",
    baseUrl: "",
    model: "claude-sonnet-4-6",
    authMode: "api_key",
    nativeVision: true,
    mapModelTiers: false,
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    ],
    note: "直接连接 Anthropic；原生支持图片输入。",
  },
  {
    id: "zhipu",
    name: "Z.AI / GLM",
    description: "GLM Coding Plan",
    baseUrl: "https://api.z.ai/api/anthropic",
    model: "glm-5.3-flash[1m]",
    authMode: "auth_token",
    nativeVision: true,
    mapModelTiers: true,
    contextWindow: 1_000_000,
    models: [
      { id: "glm-5.3-flash[1m]", label: "GLM-5.3-Flash · 1M（多模态）" },
      { id: "glm-5.3-flash", label: "GLM-5.3-Flash（多模态）" },
      { id: "glm-5.3[1m]", label: "GLM-5.3 · 1M" },
    ],
    note: "官方 Anthropic 兼容端点；GLM-5.3-Flash 的图片会作为原生多模态内容发送。",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "Anthropic 兼容协议",
    baseUrl: "https://api.deepseek.com/anthropic",
    model: "deepseek-v4-flash",
    authMode: "api_key",
    nativeVision: false,
    mapModelTiers: false,
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    ],
    note: "当前预设按文本模型处理；图片由内置 PP-OCRv6 读取。",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "多模型聚合网关",
    baseUrl: "https://openrouter.ai/api",
    model: "~anthropic/claude-sonnet-latest",
    authMode: "auth_token",
    nativeVision: true,
    mapModelTiers: true,
    models: [
      { id: "~anthropic/claude-sonnet-latest", label: "Claude Sonnet Latest" },
      { id: "~anthropic/claude-opus-latest", label: "Claude Opus Latest" },
    ],
    note: "可填写任意 OpenRouter 模型 slug；请按所选模型实际能力设置图片输入。",
  },
  {
    id: "kimi",
    name: "Kimi Code",
    description: "Kimi Coding Plan",
    baseUrl: "https://api.kimi.com/coding/",
    model: "k3[1m]",
    authMode: "auth_token",
    nativeVision: false,
    mapModelTiers: true,
    contextWindow: 1_048_576,
    models: [
      { id: "k3[1m]", label: "Kimi K3 · 1M" },
      { id: "k3-256k", label: "Kimi K3 · 256K" },
    ],
    note: "Kimi Code Anthropic 兼容端点；能力开关可按具体模型和套餐调整。",
  },
  {
    id: "custom",
    name: "自定义 Provider",
    description: "任意 Anthropic 兼容端点",
    baseUrl: "http://127.0.0.1:4000",
    model: "your-model-id",
    authMode: "auth_token",
    nativeVision: false,
    mapModelTiers: true,
    note: "适用于企业网关、LiteLLM 或自托管服务；必须实现 Anthropic Messages 协议。",
  },
] as const;

export function modelProviderPreset(id: ModelProvider): ModelProviderPreset {
  return MODEL_PROVIDER_PRESETS.find((item) => item.id === id) ?? MODEL_PROVIDER_PRESETS[MODEL_PROVIDER_PRESETS.length - 1];
}

export function modelProviderDisplayName(id: ModelProvider, customName?: string): string {
  return id === "custom" && customName?.trim() ? customName.trim() : modelProviderPreset(id).name;
}
