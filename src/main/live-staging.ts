import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentStep, AgentSurface, DingTalkConfig, DingTalkDraft } from "../shared/types.js";
import { AgentWorkbenchRuntime } from "./agent-workbench.js";
import { dwsProcessEnvironment } from "./dws-agent-cli.js";
import { DingTalkStreamGateway } from "./dingtalk-stream-gateway.js";
import { LocalTwinStore } from "./store.js";
import { resolveDwsExecutable } from "./dws-executable.js";

const execFileAsync = promisify(execFile);

interface StagingDependencies {
  store: LocalTwinStore;
  workbench: AgentWorkbenchRuntime;
  stream: DingTalkStreamGateway;
  drafts: DingTalkDraft[];
  runtimeEvents: Array<{ stage: string; message: string }>;
}

interface AgentCheck {
  surface: AgentSurface;
  expectedSkill: string;
  prompt: string;
}

export async function runLiveStaging(deps: StagingDependencies, mode: string): Promise<string> {
  const startedAt = new Date().toISOString();
  const report: Record<string, unknown> = { startedAt, mode, agentChecks: [], streamChecks: [] };
  const directory = join(deps.store.root, "staging");
  await mkdir(directory, { recursive: true });
  const file = join(directory, `live-${startedAt.replace(/[:.]/g, "-")}.json`);
  try {
    if (mode === "all" || mode === "agents") report.agentChecks = await runAgentChecks(deps.workbench);
    if (mode === "all" || mode === "stream") report.streamChecks = await runStreamChecks(deps);
  } catch (error) {
    report.failure = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    report.finishedAt = new Date().toISOString();
    report.runtimeEvents = deps.runtimeEvents;
    await writeFile(file, JSON.stringify(report, null, 2), "utf8");
  }
  if (report.failure) throw new Error(`Live staging failed; report preserved at ${file}: ${String(report.failure)}`);
  return file;
}

async function runAgentChecks(workbench: AgentWorkbenchRuntime): Promise<Record<string, unknown>[]> {
  const checks: AgentCheck[] = [
    {
      surface: "onboarding",
      expectedSkill: "hr-evidence-preflight",
      prompt: "这是上线前真实 staging 预检。必须先用 Skill 工具加载 hr-evidence-preflight，再用 list_sources、workspace_info 和只读 DWS get-self 核对现有身份与组织证据。不要覆盖已经正确的画像，不要提泛化问卷；只报告证据、缺口与本轮实际工具结果。",
    },
    {
      surface: "source",
      expectedSkill: "dws-full-evidence-sync",
      prompt: "这是上线前真实的小范围 DWS 同步。必须先用 Skill 工具加载 dws-full-evidence-sync，并加载 evidence-normalization。只读取当前用户身份、组织信息，以及已配置测试群最近一页消息（不要在本轮展开全历史）。把原始结果和真实条数保存到 staging/dws-small-sync/，再把已确认 owner 的身份/组织证据保存为可蒸馏证据。不得发送钉钉消息。最后报告实际命令、数量、owner 解析与保存结果。",
    },
    {
      surface: "distill",
      expectedSkill: "persona-distillation",
      prompt: "执行一次真实人格蒸馏 staging。必须先用 Skill 工具加载 persona-distillation，读取完整可蒸馏证据，按条件化语言、符号学、安全清洗和拒绝边界进行分析；策展 USER.md/MEMORY.md，并提交一个完整的新 CLAUDE/SOUL/STYLE/Q&A Harness 版本。不得委托另一个 Agent 或嵌套模型。最后报告真实证据量、版本、置信度和矛盾项。",
    },
  ];
  const results: Record<string, unknown>[] = [];
  for (const check of checks) {
    const reply = await workbench.chat(check.surface, check.prompt);
    results.push({
      surface: check.surface,
      expectedSkill: check.expectedSkill,
      skillObserved: skillWasObserved(reply.steps, check.expectedSkill),
      atomicTools: reply.steps.filter((item) => item.kind === "tool" || item.kind === "result").map(compactStep),
      skillSteps: reply.steps.filter((item) => item.kind === "skill").map(compactStep),
      sessionId: reply.sessionId,
      sourcesChanged: reply.sourcesChanged,
      response: reply.content,
    });
  }
  return results;
}

async function runStreamChecks(deps: StagingDependencies): Promise<Record<string, unknown>[]> {
  const state = await deps.store.readState();
  const base = state.dingTalk;
  if (!base) throw new Error("尚未保存钉钉接入配置，无法进行 Stream staging。");
  const group = base.groups.find((item) => item.enabled && (item.gatewayType ?? "stream") === "stream");
  if (!group) throw new Error("没有启用的企业应用机器人 Stream 测试群。");
  const bot = await findDigitalTwinBot(group.openConversationId);
  const checks: Record<string, unknown>[] = [];

  const draftConfig = oneGroupConfig(base, group.id, "draft");
  await deps.stream.start(draftConfig);
  const draftMarker = `STAGING-DRAFT-${Date.now()}`;
  const draftStart = deps.drafts.length;
  const draftSend = await sendAtBot(group.openConversationId, bot.botOpenDingTalkId, draftMarker, "请只回复：草稿链路已收到");
  const generated = await waitForDraft(deps.drafts, draftStart, draftMarker, "draft", 180_000);
  const delivered = await deps.stream.sendDraft(generated);
  checks.push({ mode: "draft", marker: draftMarker, group: group.name, bot: bot.name, inboundReceived: true, generatedStatus: generated.status, deliveredStatus: delivered.status, dwsSend: draftSend });

  deps.stream.stop();
  const autoConfig = oneGroupConfig(base, group.id, "auto");
  await deps.stream.start(autoConfig);
  const autoMarker = `STAGING-AUTO-${Date.now()}`;
  const autoStart = deps.drafts.length;
  const autoSend = await sendAtBot(group.openConversationId, bot.botOpenDingTalkId, autoMarker, "请只回复：自动回复链路已收到");
  const autoDelivered = await waitForDraft(deps.drafts, autoStart, autoMarker, "sent", 180_000);
  checks.push({ mode: "auto", marker: autoMarker, group: group.name, bot: bot.name, inboundReceived: true, deliveredStatus: autoDelivered.status, dwsSend: autoSend });
  deps.stream.stop();
  return checks;
}

function oneGroupConfig(base: DingTalkConfig, groupId: string, replyMode: "draft" | "auto"): DingTalkConfig {
  return {
    ...base,
    mode: replyMode,
    groups: base.groups.map((item) => ({ ...item, enabled: item.id === groupId, replyMode })),
  };
}

async function findDigitalTwinBot(group: string): Promise<{ name: string; botOpenDingTalkId: string }> {
  const result = await runDws(["chat", "group", "bots", "--group", group, "--format", "json"]);
  const parsed = JSON.parse(result) as { result?: { bots?: Array<{ name?: string; botOpenDingTalkId?: string; status?: number }> } };
  const bots = parsed.result?.bots ?? [];
  const bot = bots.find((item) => item.status === 1 && /数字分身|分身.*sit|sit.*分身/i.test(item.name ?? ""));
  if (!bot?.botOpenDingTalkId) throw new Error("测试群中未找到已启用的数字分身企业应用机器人。");
  return { name: bot.name ?? "数字分身", botOpenDingTalkId: bot.botOpenDingTalkId };
}

async function sendAtBot(group: string, botId: string, marker: string, instruction: string): Promise<Record<string, unknown>> {
  const text = `<@${botId}> 【镜我真实 staging ${marker}】${instruction}`;
  const stdout = await runDws(["chat", "message", "send", "--group", group, "--at-open-dingtalk-ids", botId, "--text", text, "--uuid", randomUUID(), "--format", "json"]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function runDws(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(resolveDwsExecutable(), args, { encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: dwsProcessEnvironment() });
  return stdout;
}

async function waitForDraft(drafts: DingTalkDraft[], start: number, marker: string, status: DingTalkDraft["status"], timeoutMs: number): Promise<DingTalkDraft> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = drafts.slice(start).find((draft) => draft.incoming.includes(marker) && draft.status === status);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`等待 Stream ${status} 超时：${marker}`);
}

function skillWasObserved(steps: AgentStep[], expected: string): boolean {
  return steps.some((item) => item.kind === "skill" && `${item.title} ${item.detail ?? ""}`.includes(expected));
}

function compactStep(item: AgentStep): Pick<AgentStep, "kind" | "title" | "detail" | "status" | "createdAt"> {
  return { kind: item.kind, title: item.title, detail: item.detail, status: item.status, createdAt: item.createdAt };
}
