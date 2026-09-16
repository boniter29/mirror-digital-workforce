import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentPermissionResponse, AgentRuntimeSettings, AgentSurface, BootstrapState, DingTalkConfig, DingTalkDraft, DingTalkGatewayInput, EvaluationInput, EvaluationSessionInput, EvaluationSessionPatch, FeedbackInput, HarnessRevisionResult, ModelConnectionInput, PersonaVersionBranch, RuntimeEvent, VisualAttachment, VisualAttachmentBuffer, WorkbenchVersionContext } from "../shared/types.js";
import { LocalTwinStore } from "./store.js";
import { ClaudeTwinRuntime } from "./claude-runtime.js";
import { ClaudeCredentialManager } from "./claude-credentials.js";
import { DwsRuntime } from "./dws-runtime.js";
import { MemoryStore } from "./memory-store.js";
import { EpisodicStore } from "./episodic-store.js";
import { ExternalMemorySlot } from "./memory-provider.js";
import { DwsLiveReader } from "./dws-live.js";
import { DingTalkContextStore } from "./dingtalk-context.js";
import { DingTalkStreamCredentialManager } from "./dingtalk-stream-credentials.js";
import { DingTalkStreamGateway } from "./dingtalk-stream-gateway.js";
import { DingTalkWebhookCredentialRegistry } from "./dingtalk-webhook-credentials.js";
import { DingTalkWebhookGateway } from "./dingtalk-webhook-gateway.js";
import { AgentWorkbenchRuntime } from "./agent-workbench.js";
import { McpConnectionRegistry } from "./mcp-registry.js";
import { runLiveStaging } from "./live-staging.js";
import { AgentPermissionBroker } from "./agent-permission-broker.js";
import { PaddleOcrVlService } from "./paddle-ocr-vl.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let store: LocalTwinStore;
let twin: ClaudeTwinRuntime;
let dws: DwsRuntime;
let claudeCredentials: ClaudeCredentialManager;
let memory: MemoryStore;
let episodic: EpisodicStore;
let externalMemory: ExternalMemorySlot;
let dwsLive: DwsLiveReader;
let dingTalkContext: DingTalkContextStore;
let dingTalkStreamCredentials: DingTalkStreamCredentialManager;
let dingTalkGateway: DingTalkStreamGateway;
let dingTalkWebhookCredentials: DingTalkWebhookCredentialRegistry;
let dingTalkWebhookGateway: DingTalkWebhookGateway;
let workbenchAgent: AgentWorkbenchRuntime;
let agentPermissions: AgentPermissionBroker;
let paddleOcr: PaddleOcrVlService;
const liveStagingDrafts: DingTalkDraft[] = [];
const liveStagingEvents: RuntimeEvent[] = [];

function emitRuntime(event: RuntimeEvent): void {
  const enriched = { at: new Date().toISOString(), kind: "status" as const, ...event };
  if (process.env.MIRROR_LIVE_STAGING) liveStagingEvents.push(enriched);
  mainWindow?.webContents.send("runtime:event", enriched);
}

function emitDingTalkDraft(draft: DingTalkDraft): void {
  if (process.env.MIRROR_LIVE_STAGING) liveStagingDrafts.push(draft);
  mainWindow?.webContents.send("dingtalk:draft", draft);
}

async function bootstrapState(): Promise<BootstrapState> {
  const dwsStatus = await dws.detect();
  const auth = claudeCredentials.status();
  const memoryCore = await memory.health(episodic.stats(), externalMemory.activeId);
  const agent = await store.agentRuntimeSettings();
  const state = await store.bootstrap({
    sdk: true,
    credentials: auth.configured,
    claudeAuthMethod: auth.method,
    claudeCredentialStorage: auth.storage,
    modelProvider: auth.provider,
    modelProviderName: auth.providerName,
    model: auth.model,
    baseUrl: auth.baseUrl,
    modelAuthMode: auth.authMode,
    nativeVision: auth.nativeVision,
    mapModelTiers: auth.mapModelTiers,
    contextWindow: auth.contextWindow,
    dws: dwsStatus.available,
    dwsVersion: dwsStatus.version,
    dwsCurrentProfile: dwsStatus.currentProfile,
    agent,
  }, memoryCore);
  state.episodicStatsByTwinVersion = Object.fromEntries(state.versions.filter((version) => version.kind === "twin").map((version) => [version.id, episodic.stats(`twin:${version.id}`)]));
  if (state.dingTalk && dingTalkWebhookCredentials?.any()) {
    state.dingTalk = {
      ...state.dingTalk,
      webhookConfigured: true,
      groups: state.dingTalk.groups.map((group) => dingTalkWebhookCredentials.has(group.id) ? {
        ...group,
        gatewayType: state.dingTalk!.streamConfigured ? (group.gatewayType ?? "stream") : "webhook",
        webhookConfigured: true,
      } : group),
    };
  }
  if (state.dingTalk && dingTalkStreamCredentials?.any()) {
    state.dingTalk = {
      ...state.dingTalk,
      streamConfigured: true,
      groups: state.dingTalk.groups.map((group) => (group.gatewayType ?? "stream") === "stream"
        ? { ...group, streamConfigured: dingTalkStreamCredentials.has(group.robotId || "enterprise-stream-primary") }
        : group),
    };
  }
  return state;
}

async function invokeClaude<T>(action: () => Promise<T>): Promise<T> {
  if (!claudeCredentials.status().configured) {
    throw new Error("CLAUDE_AUTH_REQUIRED：尚未配置模型 Provider，请先选择预设或自定义 Anthropic Messages 兼容端点并填写凭证。");
  }
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not logged in|please run \/login|authentication|unauthorized|invalid.*api.?key|api.?key.*invalid|status(?: code)?[: ]+(?:401|403)/i.test(message)) {
      throw new Error("CLAUDE_AUTH_REQUIRED：模型 API 凭证无效或已过期，请重新配置连接。", { cause: error });
    }
    throw error;
  }
}

async function createWindow(): Promise<void> {
  const smokeTest = process.argv.includes("--smoke-test");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f3f0e8", symbolColor: "#283029", height: 44 },
    backgroundColor: "#f3f0e8",
    show: false,
    webPreferences: {
      preload: join(currentDir, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!smokeTest) mainWindow?.show();
  });
  if (smokeTest) mainWindow.webContents.once("did-finish-load", () => setTimeout(() => app.quit(), 250));
  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(join(currentDir, "../../dist/index.html"));
  }
}

function dingTalkRobotId(group: DingTalkConfig["groups"][number]): string {
  return group.robotId || (group.gatewayType === "webhook" ? `webhook:${group.id}` : "enterprise-stream-primary");
}

function allEnabledRobotIds(config: DingTalkConfig): string[] {
  return [...new Set(config.groups.filter((group) => group.enabled).map(dingTalkRobotId))];
}

async function persistDingTalkConfig(input: DingTalkGatewayInput): Promise<BootstrapState> {
  const versionById = new Map((await store.listVersions()).filter((item) => item.kind === "twin").map((item) => [item.id, item]));
  const routeKeys = new Set<string>();
  const webhookTriggerRoutes = new Set<string>();
  for (const group of input.groups.filter((item) => item.enabled)) {
    if (!group.twinVersionId || !versionById.has(group.twinVersionId) || !await store.readTwinVersion(group.twinVersionId)) throw new Error(`接入“${group.name || "未命名群"}”前，请先选择一个已发布的分身版本。`);
    const gateway = group.gatewayType ?? "stream";
    const robotId = group.robotId || (gateway === "stream" ? "enterprise-stream-primary" : `webhook:${group.id}`);
    const routeKey = `${gateway}:${robotId}:${group.openConversationId.trim()}`;
    if (routeKeys.has(routeKey)) throw new Error(`“${group.name || "未命名群"}”存在重复机器人路由；同一机器人在同一群只能绑定一个分身版本。`);
    routeKeys.add(routeKey);
    if (gateway === "webhook") {
      for (const trigger of group.triggerWords.map((word) => word.trim().toLocaleLowerCase("zh-CN")).filter(Boolean)) {
        const triggerKey = `${group.openConversationId.trim()}:${trigger}`;
        if (webhookTriggerRoutes.has(triggerKey)) throw new Error(`群“${group.name || "未命名群"}”的多个 Webhook 机器人使用了相同入站触发词“${trigger}”，消息路由会产生歧义。`);
        webhookTriggerRoutes.add(triggerKey);
      }
    }
  }
  const streamInputs = input.groups.filter((group) => (group.gatewayType ?? "stream") === "stream");
  if (streamInputs.length && (input.clientId?.trim() || input.clientSecret?.trim())) {
    await dingTalkStreamCredentials.configure("enterprise-stream-primary", { clientId: input.clientId, clientSecret: input.clientSecret });
  }
  for (const group of streamInputs) {
    const robotId = group.robotId || "enterprise-stream-primary";
    if (group.streamClientId?.trim() || group.streamClientSecret?.trim() || !dingTalkStreamCredentials.has(robotId)) {
      await dingTalkStreamCredentials.configure(robotId, { clientId: group.streamClientId, clientSecret: group.streamClientSecret });
    }
  }
  for (const group of input.groups.filter((item) => (item.gatewayType ?? "stream") === "webhook")) {
    if (group.triggerMode === "keyword" && !group.triggerWords.some((word) => word.trim())) throw new Error(`Webhook 接入“${group.name || "未命名群"}”需要至少一个入站触发词，例如机器人在群里的 @显示名。`);
    await dingTalkWebhookCredentials.configure(group.id, { url: group.webhookUrl, secret: group.webhookSecret });
  }
  const groups = input.groups
    .filter((group) => group.openConversationId.trim())
    .map((raw) => ({
      id: raw.id || randomUUID(),
      robotId: raw.robotId || ((raw.gatewayType ?? "stream") === "stream" ? "enterprise-stream-primary" : `webhook:${raw.id}`),
      groupId: raw.groupId || raw.openConversationId.trim(),
      name: raw.name.trim() || "未命名测试群",
      openConversationId: raw.openConversationId.trim(),
      personaId: versionById.get(raw.twinVersionId ?? "")?.personaId || raw.personaId || "primary",
      branchId: versionById.get(raw.twinVersionId ?? "")?.branchId || raw.branchId,
      personaName: raw.personaName?.trim() || undefined,
      twinVersionId: raw.twinVersionId,
      twinVersionName: raw.twinVersionName?.trim() || undefined,
      robotName: raw.robotName?.trim() || undefined,
      gatewayType: raw.gatewayType ?? "stream",
      streamConfigured: (raw.gatewayType ?? "stream") === "stream" ? dingTalkStreamCredentials.has(raw.robotId || "enterprise-stream-primary") : undefined,
      webhookConfigured: (raw.gatewayType ?? "stream") === "webhook" ? dingTalkWebhookCredentials.has(raw.id) : undefined,
      webhookKeyword: raw.webhookKeyword?.trim() || undefined,
      enabled: raw.enabled,
      contextEnabled: raw.contextEnabled,
      replyMode: raw.replyMode,
      triggerMode: raw.gatewayType === "webhook" ? raw.triggerMode : "all" as const,
      triggerWords: raw.gatewayType === "webhook" ? raw.triggerWords.map((word) => word.trim()).filter(Boolean) : [],
    }));
  if (!groups.length) throw new Error("请至少配置一个机器人测试群的 openConversationId。");
  const configuredIds = new Set(groups.map(dingTalkRobotId));
  const previous = (await store.readState()).dingTalk;
  const activeRobotIds = (input.activeRobotIds ?? previous?.activeRobotIds ?? [])
    .filter((id) => configuredIds.has(id));
  const config: DingTalkConfig = {
    targetType: "group",
    targetId: groups[0].openConversationId,
    profile: input.profile?.trim() || undefined,
    mode: groups[0].replyMode,
    streamConfigured: dingTalkStreamCredentials.any(),
    webhookConfigured: dingTalkWebhookCredentials.any(),
    activeRobotIds,
    groups,
  };
  await store.saveDingTalkConfig(config);
  return bootstrapState();
}

async function reconcileDingTalk(config: DingTalkConfig): Promise<import("../shared/types.js").DingTalkRuntimeStatus> {
  const activeIds = new Set(config.activeRobotIds ?? []);
  const activeGroups = config.groups.filter((group) => group.enabled && activeIds.has(dingTalkRobotId(group)));
  for (const group of activeGroups) {
    if (!group.twinVersionId || !await store.readTwinVersion(group.twinVersionId)) throw new Error(`“${group.name || "未命名群"}”尚未绑定有效的已发布分身版本。`);
  }
  const scoped = { ...config, groups: activeGroups };
  const streamGroups = activeGroups.filter((group) => (group.gatewayType ?? "stream") === "stream");
  const webhookGroups = activeGroups.filter((group) => group.gatewayType === "webhook");
  const stream = await dingTalkGateway.start({ ...scoped, groups: streamGroups });
  const webhookCount = webhookGroups.length ? dingTalkWebhookGateway.start({ ...scoped, groups: webhookGroups }) : (dingTalkWebhookGateway.stop(), 0);
  try {
    const dwsConfig = { ...scoped, groups: activeGroups.map((group) => group.gatewayType === "webhook" ? { ...group, contextEnabled: true } : group) };
    const context = activeGroups.length ? await dws.start(dwsConfig) : await dws.stop();
    return {
      ...stream,
      running: stream.streamConnected || webhookCount > 0,
      webhookConnected: webhookCount > 0 && context.contextGroups > 0,
      webhookConfigured: dingTalkWebhookCredentials.any(),
      webhookGroups: webhookCount,
      busConnected: context.contextGroups > 0,
      contextGroups: context.contextGroups,
      groupIds: activeGroups.filter((group) => group.contextEnabled).map((group) => group.openConversationId),
      activeRobotIds: [...new Set([...dingTalkGateway.activeRobotIds(), ...dingTalkWebhookGateway.activeRobotIds()])],
    };
  } catch (error) {
    if (webhookCount) dingTalkWebhookGateway.stop();
    emitRuntime({ stage: "warning", message: `${stream.streamConnected ? "企业应用机器人 Stream 已在线；" : ""}DWS 群事件监听未启动：${error instanceof Error ? error.message : String(error)}` });
    if (!stream.streamConnected && !webhookCount) throw error;
    return { ...stream, webhookConnected: false, webhookConfigured: dingTalkWebhookCredentials.any(), webhookGroups: webhookCount, activeRobotIds: [...new Set([...dingTalkGateway.activeRobotIds(), ...dingTalkWebhookGateway.activeRobotIds()])] };
  }
}

function registerIpc(): void {
  ipcMain.handle("twin:bootstrap", () => bootstrapState());
  ipcMain.handle("twin:configure-claude", async (_event, input: ModelConnectionInput) => {
    await claudeCredentials.configure(input);
    if (input.agentRuntime) await store.saveAgentRuntimeSettings(input.agentRuntime);
    return bootstrapState();
  });
  ipcMain.handle("twin:save-agent-runtime-settings", async (_event, input: Pick<AgentRuntimeSettings, "maxTurns" | "accessLevel">) => {
    await store.saveAgentRuntimeSettings(input);
    return bootstrapState();
  });
  ipcMain.handle("twin:resolve-agent-permission", (_event, response: AgentPermissionResponse) => agentPermissions.resolve(response));
  ipcMain.handle("twin:open-external-url", async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("仅允许打开 HTTPS 授权链接。");
    await shell.openExternal(parsed.toString());
    return true;
  });
  ipcMain.handle("twin:save-persona-branches", async (_event, branches: PersonaVersionBranch[]) => {
    await store.savePersonaBranches(branches);
    return bootstrapState();
  });
  ipcMain.handle("twin:rename-persona-branch", async (_event, branchId: string, title: string) => {
    await store.renamePersonaBranch(branchId, title);
    episodic.renameConversationSamplesForBranch(branchId, title.trim());
    return bootstrapState();
  });
  ipcMain.handle("twin:delete-persona-branch", async (_event, branchId: string) => {
    const versionIds = await store.deletePersonaBranch(branchId);
    episodic.deleteConversationSamplesForBranch(branchId);
    episodic.deleteTwinVersionSessions(versionIds);
    return bootstrapState();
  });
  ipcMain.handle("twin:import-files", async (_event, context: WorkbenchVersionContext) => {
    const result = await dialog.showOpenDialog({
      title: "选择个人资料",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "知识文件", extensions: ["txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "yaml", "yml", "pdf", "png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "docx", "xlsx", "html", "htm", "xml", "log", "sql", "js", "jsx", "ts", "tsx", "py", "java", "go", "rs", "toml", "ini", "conf"] }],
    });
    return result.canceled ? [] : store.importFiles(result.filePaths, context);
  });
  ipcMain.handle("twin:import-folder", async (_event, context: WorkbenchVersionContext) => {
    const result = await dialog.showOpenDialog({ title: "选择本地知识库文件夹", properties: ["openDirectory"] });
    return result.canceled || !result.filePaths[0] ? [] : store.importFolder(result.filePaths[0], context);
  });
  ipcMain.handle("twin:import-workspace-files", async (_event, context: WorkbenchVersionContext) => {
    const result = await dialog.showOpenDialog({
      title: "选择要加入人格知识工作区的原始文件（不自动蒸馏）",
      properties: ["openFile", "multiSelections"],
    });
    return result.canceled ? [] : store.importWorkspaceFiles(result.filePaths, context);
  });
  ipcMain.handle("twin:import-workspace-folder", async (_event, context: WorkbenchVersionContext) => {
    const result = await dialog.showOpenDialog({ title: "选择要复制到人格知识工作区的文件夹（不自动蒸馏）", properties: ["openDirectory"] });
    return result.canceled || !result.filePaths[0] ? [] : store.importWorkspaceFolder(result.filePaths[0], context);
  });
  ipcMain.handle("twin:choose-workspace", async (_event, context: WorkbenchVersionContext) => {
    const result = await dialog.showOpenDialog({ title: "选择三个 Agent 可只读访问的本地工作区", properties: ["openDirectory"] });
    if (!result.canceled && result.filePaths[0]) await store.saveWorkspace(result.filePaths[0], context);
    return bootstrapState();
  });
  ipcMain.handle("twin:install-skill", async () => {
    const result = await dialog.showOpenDialog({ title: "选择要安装的 SKILL.md", properties: ["openFile"], filters: [{ name: "Claude Agent Skill", extensions: ["md"] }] });
    if (!result.canceled && result.filePaths[0]) {
      if (!/[\\/]SKILL\.md$/i.test(result.filePaths[0])) throw new Error("请选择名称为 SKILL.md 的技能说明文件。");
      await store.importFiles([result.filePaths[0]]);
    }
    return store.listSkills();
  });
  ipcMain.handle("twin:agent-chat", (_event, surface: AgentSurface, prompt: string, sessionId?: string, versionContext?: WorkbenchVersionContext) => invokeClaude(() => workbenchAgent.chat(surface, prompt, sessionId, versionContext)));
  ipcMain.handle("twin:load-agent-conversation", (_event, surface: AgentSurface, context?: WorkbenchVersionContext) => store.readAgentConversation(surface, 500, context));
  ipcMain.handle("twin:delete-agent-conversation", (_event, sessionIds: string[]) => store.deleteAgentConversation(sessionIds));
  ipcMain.handle("twin:list-skills", () => store.listSkills());
  ipcMain.handle("twin:read-skill", (_event, name: string) => store.readSkill(name));
  ipcMain.handle("twin:preview-source", (_event, sourceId: string, context?: WorkbenchVersionContext) => store.previewSource(sourceId, 500_000, context));
  ipcMain.handle("twin:list-versions", () => store.listVersions());
  ipcMain.handle("twin:read-version", (_event, versionId: string, context?: WorkbenchVersionContext) => store.readTwinVersion(versionId, context));
  ipcMain.handle("twin:pick-visual-attachments", async (_event, context: WorkbenchVersionContext) => {
    const options: Electron.OpenDialogOptions = {
      title: "选择要交给当前评测会话的图片或 PDF",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片与 PDF", extensions: ["pdf", "png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    const target = join(paddleOcr.attachmentsRoot, "lab", context.branchId);
    return paddleOcr.stageFiles(result.filePaths, target, "lab");
  });
  ipcMain.handle("twin:stage-visual-attachments", async (_event, context: WorkbenchVersionContext, files: VisualAttachmentBuffer[]) => {
    if (!context?.branchId || !Array.isArray(files)) return [];
    return paddleOcr.stageBuffers(files, join(paddleOcr.attachmentsRoot, "lab", context.branchId), "lab");
  });
  ipcMain.handle("twin:paste-visual-attachment", async (_event, context: WorkbenchVersionContext) => {
    if (!context?.branchId) return [];
    const image = clipboard.readImage();
    if (image.isEmpty()) return [];
    return paddleOcr.stageBuffers([{
      name: `clipboard-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
      mimeType: "image/png",
      base64: image.toPNG().toString("base64"),
    }], join(paddleOcr.attachmentsRoot, "lab", context.branchId), "lab");
  });
  ipcMain.handle("twin:chat", async (_event, prompt: string, sessionId: string | undefined, context: WorkbenchVersionContext, attachments: VisualAttachment[] = []) => {
    if (!context?.twinVersionId) throw new Error("对话实验室必须选择一个已发布的分身版本。");
    if (!await store.readTwinVersion(context.twinVersionId, context)) throw new Error("当前对话实验室选择的版本不属于该分身分支。");
    return invokeClaude(() => twin.chat(prompt, sessionId, "conversation_lab", undefined, context.twinVersionId, attachments));
  });
  ipcMain.handle("twin:load-twin-conversation", async (_event, sessionId: string, context: WorkbenchVersionContext) => {
    if (!sessionId?.trim() || !context?.twinVersionId) return [];
    const harness = await store.readTwinVersion(context.twinVersionId, context);
    if (!harness) throw new Error("当前对话不属于这个分身版本，已拒绝跨版本读取。");
    return episodic.loadSessionMessages(sessionId.trim(), `twin:${context.twinVersionId}`).map((message) => ({
      id: `episodic-${message.id}`,
      role: message.role === "assistant" ? "twin" as const : "user" as const,
      content: message.content,
      createdAt: message.createdAt,
      attachments: message.attachments,
    }));
  });
  ipcMain.handle("twin:create-evaluation-session", (_event, input: EvaluationSessionInput) => store.createEvaluationSession(input));
  ipcMain.handle("twin:update-evaluation-session", (_event, id: string, patch: EvaluationSessionPatch) => store.updateEvaluationSession(id, patch));
  ipcMain.handle("twin:save-evaluation", async (_event, input: EvaluationInput) => {
    const record = await store.addEvaluation(input);
    episodic.markConversationSampleEvaluated(record);
    if (!input.applyNow) return { record, changedFiles: [] };
    const before = input.twinVersionId ? await store.readTwinVersion(input.twinVersionId) : undefined;
    try {
      const revision = await invokeClaude(() => calibrateWithWorkbench({
        prompt: input.prompt,
        reply: input.reply,
        verdict: "unlike",
        correction: formatEvaluationCorrection(input),
        personaId: input.personaId,
        branchId: input.branchId,
        twinVersionId: input.twinVersionId,
      }));
      await store.markEvaluationsApplied([record.id]);
      const appliedRecord = { ...record, status: "applied" as const, appliedAt: new Date().toISOString() };
      episodic.markConversationSampleEvaluated(appliedRecord);
      return { record: appliedRecord, revision, changedFiles: changedHarnessFiles(before, revision.harness) };
    } catch (error) {
      return { record, changedFiles: [], revisionError: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("twin:review-evaluations", async (_event, context: WorkbenchVersionContext) => {
    if (!context?.twinVersionId) throw new Error("请先选择要反哺的已发布分身版本。");
    const pending = (await store.readEvaluations()).filter((record) => record.status === "pending" && record.twinVersionId === context.twinVersionId).slice(0, 30);
    if (!pending.length) return { applied: 0 };
    const revision = await invokeClaude(() => calibrateWithWorkbench({
      prompt: "批量对话评测数据集",
      reply: pending.map((item) => item.reply).join("\n---\n"),
      verdict: "unlike",
      correction: pending.map(formatEvaluationCorrection).join("\n\n---\n\n"),
      personaId: context.personaId,
      branchId: context.branchId,
      twinVersionId: context.twinVersionId,
    }));
    await store.markEvaluationsApplied(pending.map((record) => record.id));
    episodic.markConversationSampleEvaluationsApplied(pending.map((record) => record.id));
    return { applied: pending.length, revision };
  });
  ipcMain.handle("twin:list-conversation-samples", (_event, limit?: number, twinVersionId?: string, branchId?: string) => episodic.listConversationSamples(limit, twinVersionId, branchId));
  ipcMain.handle("twin:save-dingtalk", (_event, input: DingTalkGatewayInput) => persistDingTalkConfig(input));
  ipcMain.handle("twin:save-dingtalk-robot", async (_event, robotId: string, input: DingTalkGatewayInput) => {
    const current = (await store.readState()).dingTalk;
    const target = input.groups.filter((group) => dingTalkRobotId(group) === robotId);
    if (!target.length) throw new Error("没有找到要保存的机器人配置。");
    const others = current?.groups.filter((group) => dingTalkRobotId(group) !== robotId) ?? [];
    return persistDingTalkConfig({ ...input, activeRobotIds: current?.activeRobotIds ?? input.activeRobotIds, groups: [...others, ...target] });
  });
  ipcMain.handle("twin:start-dingtalk", async (_event, config: DingTalkConfig) => {
    const current = (await store.readState()).dingTalk;
    if (!current) throw new Error("请先保存全部机器人配置，再启动。");
    const next = { ...current, activeRobotIds: allEnabledRobotIds(current) };
    await store.saveDingTalkConfig(next);
    return reconcileDingTalk(next);
  });
  ipcMain.handle("twin:start-dingtalk-robot", async (_event, robotId: string, config: DingTalkConfig) => {
    const current = (await store.readState()).dingTalk;
    if (!current) throw new Error("请先保存该机器人配置，再启动。");
    const configured = new Set(current.groups.map(dingTalkRobotId));
    if (!configured.has(robotId)) throw new Error("该机器人尚未保存配置。");
    const next = { ...current, activeRobotIds: [...new Set([...(current.activeRobotIds ?? config.activeRobotIds ?? []), robotId])] };
    await store.saveDingTalkConfig(next);
    return reconcileDingTalk(next);
  });
  ipcMain.handle("twin:dingtalk-status", async () => {
    const [context, stream] = await Promise.all([
      dws.status(),
      Promise.resolve(dingTalkGateway.status()),
    ]);
    return {
      running: stream.streamConnected || (dingTalkWebhookGateway.count() > 0 && context.running),
      streamConnected: stream.streamConnected,
      streamConfigured: stream.streamConfigured,
      webhookConnected: dingTalkWebhookGateway.count() > 0 && context.running,
      webhookConfigured: dingTalkWebhookCredentials.any(),
      webhookGroups: dingTalkWebhookGateway.count(),
      busConnected: context.busConnected,
        robotGroups: stream.robotGroups,
        streamRobots: stream.streamRobots,
      contextGroups: context.contextGroups,
      groupIds: context.groupIds,
      activeRobotIds: [...new Set([...dingTalkGateway.activeRobotIds(), ...dingTalkWebhookGateway.activeRobotIds()])],
    };
  });
  ipcMain.handle("twin:stop-dingtalk-robot", async (_event, robotId: string) => {
    const current = (await store.readState()).dingTalk;
    if (!current) throw new Error("尚未保存钉钉机器人配置。");
    const next = { ...current, activeRobotIds: (current.activeRobotIds ?? []).filter((id) => id !== robotId) };
    await store.saveDingTalkConfig(next);
    return reconcileDingTalk(next);
  });
  ipcMain.handle("twin:stop-dingtalk", async () => {
    const current = (await store.readState()).dingTalk;
    if (current) await store.saveDingTalkConfig({ ...current, activeRobotIds: [] });
    const stream = dingTalkGateway.stop();
    dingTalkWebhookGateway.stop();
    const context = await dws.stop();
    return { ...stream, webhookConnected: false, webhookConfigured: dingTalkWebhookCredentials.any(), webhookGroups: 0, contextGroups: context.contextGroups, activeRobotIds: [] };
  });
  ipcMain.handle("twin:send-dingtalk", (_event, draft: DingTalkDraft) => dingTalkWebhookGateway.hasDraft(draft.id) ? dingTalkWebhookGateway.sendDraft(draft) : dingTalkGateway.sendDraft(draft));
  ipcMain.handle("twin:reveal-profile", () => shell.openPath(store.root));
  ipcMain.handle("twin:reveal-persona-workspace", (_event, context?: WorkbenchVersionContext) => shell.openPath(store.knowledgePath(context)));
}

app.whenReady().then(async () => {
  store = new LocalTwinStore();
  await store.init();
  await store.recoverInterruptedAgentRuns();
  memory = new MemoryStore(store.harnessDir);
  await memory.init();
  episodic = new EpisodicStore(join(store.root, "episodic.sqlite"));
  const recoveredDingTalkSamples = episodic.recoverInterruptedConversationSamples();
  externalMemory = new ExternalMemorySlot();
  claudeCredentials = new ClaudeCredentialManager(join(store.root, "claude-credentials.json"), app.getPath("home"));
  await claudeCredentials.hydrate();
  dwsLive = new DwsLiveReader(store);
  agentPermissions = new AgentPermissionBroker(() => mainWindow);
  paddleOcr = new PaddleOcrVlService(store.root);
  void paddleOcr.start().then((status) => emitRuntime({
    stage: "vision-runtime",
    kind: status.available ? "complete" : "error",
    message: status.available
      ? `本地视觉已就绪：${status.model}（离线、随应用启动）`
      : `本地视觉自检未通过：${status.error || "未找到 OCR Sidecar"}`,
  }));
  twin = new ClaudeTwinRuntime(store, memory, episodic, externalMemory, () => claudeCredentials.runtimeConnection(), emitRuntime, agentPermissions, paddleOcr);
  dingTalkContext = new DingTalkContextStore(join(store.root, "dingtalk-context"));
  dingTalkStreamCredentials = new DingTalkStreamCredentialManager(join(store.root, "dingtalk-stream-credentials.json"));
  await dingTalkStreamCredentials.hydrate();
  dingTalkWebhookCredentials = new DingTalkWebhookCredentialRegistry(join(store.root, "dingtalk-webhook-credentials.json"));
  await dingTalkWebhookCredentials.hydrate();
  dingTalkGateway = new DingTalkStreamGateway(dingTalkStreamCredentials, twin, dingTalkContext, episodic, paddleOcr, emitDingTalkDraft, emitRuntime);
  dingTalkWebhookGateway = new DingTalkWebhookGateway(dingTalkWebhookCredentials, twin, dingTalkContext, episodic, emitDingTalkDraft, emitRuntime);
  dws = new DwsRuntime(store, dwsLive, dingTalkContext, emitRuntime, (message) => dingTalkWebhookGateway.handleDwsMessage(message));
  const mcpRegistry = new McpConnectionRegistry(join(store.root, "mcp-connections.json"));
  workbenchAgent = new AgentWorkbenchRuntime(store, memory, mcpRegistry, () => claudeCredentials.runtimeConnection(), emitRuntime, agentPermissions, paddleOcr);
  if (process.env.MIRROR_LIVE_STAGING) {
    try {
      const report = await runLiveStaging({ store, workbench: workbenchAgent, stream: dingTalkGateway, drafts: liveStagingDrafts, runtimeEvents: liveStagingEvents }, process.env.MIRROR_LIVE_STAGING);
      console.log(`MIRROR_LIVE_STAGING_REPORT=${report}`);
      process.exitCode = 0;
    } catch (error) {
      console.error(`MIRROR_LIVE_STAGING_FAILED=${error instanceof Error ? error.stack || error.message : String(error)}`);
      process.exitCode = 1;
    } finally {
      app.quit();
    }
    return;
  }
  registerIpc();
  await createWindow();
  if (recoveredDingTalkSamples) emitRuntime({
    stage: "dingtalk-recovery",
    surface: "dingtalk",
    kind: "error",
    message: `已恢复 ${recoveredDingTalkSamples} 条处理过程中断的钉钉消息；原始内容已保留在待回复列表。`,
  });
  if (!process.argv.includes("--smoke-test")) {
    const savedDingTalk = (await store.readState()).dingTalk;
    if (savedDingTalk?.activeRobotIds?.length) {
      await store.saveDingTalkConfig(savedDingTalk);
      void reconcileDingTalk(savedDingTalk).catch((error) => emitRuntime({ stage: "warning", message: `已保留机器人开启状态，但本次自动恢复未完成：${error instanceof Error ? error.message : String(error)}` }));
    }
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  agentPermissions?.cancelAll();
  void dws?.stop();
  dingTalkGateway?.stop();
  dingTalkWebhookGateway?.stop();
  episodic?.close();
  void externalMemory?.close();
  void paddleOcr?.stop();
});

async function calibrateWithWorkbench(input: FeedbackInput): Promise<HarnessRevisionResult> {
  if (!input.personaId || !input.branchId || !input.twinVersionId) {
    throw new Error("纠偏必须绑定到明确的人格、版本分支和已发布分身版本。");
  }
  const version = (await store.listVersions()).find((item) => item.id === input.twinVersionId && item.kind === "twin");
  if (!version) throw new Error("找不到要纠偏的已发布分身版本。");
  if (version.personaId && version.personaId !== input.personaId) throw new Error("纠偏目标与已发布版本的人格不一致。");
  if (version.branchId && version.branchId !== input.branchId) throw new Error("纠偏目标与已发布版本分支不一致。");
  const state = await store.readState();
  const branch = (state.personaBranches ?? []).find((item) => item.versionBranchId === input.branchId);
  const context: WorkbenchVersionContext = {
    personaId: version.personaId || input.personaId,
    branchId: version.branchId || input.branchId,
    branchName: branch?.title || version.note?.split(" · ")[0] || "实验室纠偏",
    twinVersionId: version.id,
    includeLegacyData: !version.branchId,
  };
  const current = await store.readTwinVersion(version.id);
  if (!current) throw new Error("已发布分身版本文件不可读，无法纠偏。");
  if (input.verdict === "like") {
    await store.appendFeedback({ ...input, createdAt: new Date().toISOString(), source: "conversation-lab-positive" }, context);
    return { harness: current, version };
  }
  if (!input.correction?.trim()) throw new Error("请先写出本人真正会怎么回，或说明具体哪里不像。");
  const task = [
    "请使用 persona-calibration Skill 完成一次当前分身版本纠偏。",
    "必须保存纠偏证据、读取当前 Harness、做最小且可复用的修改、提交同一分支的新版本，并给出纠偏后复测预览。",
    `测试问题：${input.prompt}`,
    `当前回答：${input.reply}`,
    `人工结论：${input.correction}`,
  ].join("\n\n");
  const result = await workbenchAgent.chat("calibration", task, undefined, context);
  if (!result.committedVersion) throw new Error("纠偏 Agent 没有提交新分身版本；原版本保持不变，请查看执行记录后重试。");
  const harness = await store.readTwinVersion(result.committedVersion.id);
  if (!harness) throw new Error("纠偏 Agent 已提交版本元数据，但版本文件不可读。");
  return { harness, version: result.committedVersion };
}

function formatEvaluationCorrection(input: Pick<EvaluationInput, "prompt" | "reply" | "expectedReply" | "labels" | "score" | "notes">): string {
  return [
    `测试问题：${input.prompt}`,
    `当前回答：${input.reply}`,
    `评分：${input.score}/5`,
    `问题标签：${input.labels.join("、") || "未标注"}`,
    input.expectedReply ? `本人会这样回答：${input.expectedReply}` : "",
    input.notes ? `标注说明：${input.notes}` : "",
  ].filter(Boolean).join("\n");
}

function changedHarnessFiles(before: BootstrapState["harness"] | undefined, after: BootstrapState["harness"]): string[] {
  if (!after) return [];
  const fields = [
    ["claude", "CLAUDE.md"], ["soul", "SOUL.md"], ["user", "USER.md"],
    ["memory", "MEMORY.md"], ["style", "STYLE.md"], ["qa", "Q&A.md"],
  ] as const;
  return fields.filter(([key]) => before?.[key] !== after[key]).map(([, file]) => file);
}
