import type { AgentPluginDescriptor, AgentSurface } from "../shared/types.js";

/**
 * Product architecture invariant:
 * one Claude Agent SDK runtime, multiple role Plugins, multiple load-on-demand Skills.
 * A Plugin supplies role context and a Skill portfolio; it is never a separate routed agent.
 */
export const AGENT_PLUGINS: AgentPluginDescriptor[] = [
  {
    id: "hr-keyboard",
    surface: "onboarding",
    name: "HR 键盘",
    role: "人格访谈官",
    description: "先盘点本地资料与钉钉身份，再围绕证据缺口追问，建立第一版可核验画像。",
    skills: ["hr-evidence-preflight", "adaptive-onboarding"],
    accent: "peach",
  },
  {
    id: "evidence-collector",
    surface: "source",
    name: "数据采集师 · 探针",
    role: "证据工程师",
    description: "自主连接数据源、同步钉钉全量证据、清洗说话人并检查覆盖完整性。",
    skills: ["dws-full-evidence-sync", "evidence-normalization", "evidence-manifest-audit", "local-knowledge-intake"],
    accent: "sage",
  },
  {
    id: "persona-distiller",
    surface: "distill",
    name: "人格蒸馏师 · 琢玉",
    role: "人格建模师",
    description: "从条件化语言、关系、判断和边界中生成安全、可审阅、可版本化的人格 Harness。",
    skills: ["persona-distillation", "persona-safety-audit"],
    accent: "ink",
  },
];

export function pluginForSurface(surface: AgentSurface): AgentPluginDescriptor | undefined {
  return AGENT_PLUGINS.find((plugin) => plugin.surface === surface);
}
