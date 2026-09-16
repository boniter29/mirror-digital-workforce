import type {
  AgentConversationTurn,
  AgentSurface,
  BootstrapState,
  ChatReply,
  ConversationSample,
  DataSource,
  DingTalkConfig,
  DingTalkDraft,
  HarnessSnapshot,
  TwinBridge,
} from "../../shared/types";
import { modelProviderPreset } from "../../shared/model-providers";

const harness: HarnessSnapshot = {
  confidence: 0.82,
  updatedAt: new Date().toISOString(),
  claude: `# 运行原则\n\n你是示例主管的数字分身。回复前先检查事实、关系语境与承诺风险。\n\n## 边界\n\n高风险承诺只生成草稿，必须由本人确认。`,
  soul: `# SOUL\n\n## 核心驱动力\n\n把复杂问题讲清楚，并尽快落到能验证的行动。\n\n## 决策取向\n\n先判断长期价值，再衡量执行成本；对不可逆决定保持谨慎。`,
  memory: `当前工作聚焦 AI 产品创新、组织效率与真实业务价值。\n§\n项目决策先明确目标和验证标准，再讨论方案。\n§\n外部承诺、付款和人事评价必须由本人确认。`,
  user: `示例主管，AI 产品负责人。\n§\n偏好先结论后解释，表达直接、简洁、有判断。\n§\n决策时优先长期价值、小步验证，不做模糊承诺。`,
  style: `# STYLE\n\n## 表达特征\n\n- 开门见山，先说结论。\n- 常用「我建议」「先」「再」组织行动顺序。\n- 避免空泛鼓励和过度正式的套话。`,
  qa: `# Q&A\n\n## 项目延期\n\n先问清卡点、影响和新的明确交付时间，再决定是否调整。`,
};

let state: BootstrapState = {
  initialized: true,
  profiles: [],
  profile: {
    name: "示例主管",
    role: "AI 产品负责人",
    bio: "负责 AI 产品创新与落地，关注组织效率和真实业务价值。",
    communicationStyle: "直接、简洁、有判断；通常先给结论。",
    decisionPrinciples: "优先长期价值，小步验证，不做模糊承诺。",
    boundaries: "人事评价、付款、对外承诺必须本人确认。",
    sampleReply: "可以先跑一个最小闭环，周五前拿到真实反馈，再决定要不要扩大。",
  },
  sources: [
    { id: "1", kind: "dingtalk", name: "钉钉聊天记录", detail: "最近 90 天 · 1,284 条", itemCount: 1284, bytes: 2_400_000, importedAt: new Date().toISOString(), status: "ready" },
    { id: "2", kind: "file", name: "个人复盘与项目记录", detail: "12 份 Markdown", itemCount: 12, bytes: 860_000, importedAt: new Date().toISOString(), status: "ready" },
    { id: "onboarding", kind: "onboarding", name: "深度 Onboarding", detail: "示例主管 · AI 产品负责人", itemCount: 7, bytes: 3400, importedAt: new Date().toISOString(), status: "ready" },
  ],
  harness,
  memoryCount: 27,
  feedbackCount: 6,
  evaluationCount: 12,
  pendingEvaluationCount: 3,
  evaluationStatsByTwinVersion: { "twin-v1": { total: 12, pending: 3 } },
  evaluationRecords: [],
  evaluationSessions: [],
  feedbackStatsByBranch: {},
  episodicStatsByTwinVersion: { "twin-v1": { episodicSessions: 14, episodicMessages: 128 } },
  memoryCore: {
    memory: { used: 642, limit: 2200, percent: 29, entries: 8 },
    user: { used: 487, limit: 1375, percent: 35, entries: 6 },
    episodicSessions: 14,
    episodicMessages: 128,
    externalProvider: null,
  },
  runtime: { sdk: true, credentials: true, claudeAuthMethod: "api_key", claudeCredentialStorage: "session", modelProvider: "anthropic", model: "claude-sonnet-4-6", dws: true, dwsVersion: "本地演示", dwsCurrentProfile: { profile: "corp:user", corpName: "演示组织", userName: "示例主管", status: "active" }, agent: { maxTurns: 200, permissionMode: "default", accessLevel: "sensitive", fullToolPreset: true, loadClaudeCodeSettings: true, fileCheckpointing: true } },
  dwsEvidence: { profile: "corp:user", userName: "示例主管", userId: "user", corpName: "演示组织", title: "AI 产品负责人", departments: ["数字化中心 / AI 产品部"], supervisor: "负责人", directReports: ["成员甲", "成员乙"], labels: ["主管"], authoredMessages: 1284, styleSamples: 420, contextMessages: 360, replyPairs: 96, mentionQuestions: 74, privateQuestions: 53, qaPairs: 102, conversations: 38, start: "2026-05-01 00:00:00", end: "2026-08-01 23:59:59", importedAt: new Date().toISOString() },
  versions: [{ id: "twin-v1", kind: "twin", name: "default", version: 1, createdAt: new Date().toISOString(), active: true }],
  skills: [{ name: "persona-distillation", description: "默认人格蒸馏 Skill", builtin: true, version: 1 }],
  plugins: [
    { id: "hr-keyboard", surface: "onboarding", name: "HR 键盘", role: "人格访谈官", description: "先盘点证据，再围绕缺口认识你。", skills: ["hr-evidence-preflight", "adaptive-onboarding"], accent: "peach" },
    { id: "evidence-collector", surface: "source", name: "数据采集师 · 探针", role: "证据工程师", description: "同步、清洗并盘点个人证据。", skills: ["dws-full-evidence-sync", "evidence-normalization", "evidence-manifest-audit"], accent: "sage" },
    { id: "persona-distiller", surface: "distill", name: "人格蒸馏师 · 琢玉", role: "人格建模师", description: "生成安全、可审阅、可版本化的人格。", skills: ["persona-distillation", "persona-safety-audit"], accent: "ink" },
  ],
  workspace: { path: "D:\\Demo Workspace", name: "Demo Workspace" },
  workspaces: [{ path: "D:\\Demo Workspace", name: "Demo Workspace", personaId: "primary", branchId: "legacy", selectedAt: new Date().toISOString() }],
  personaBranches: [],
  dingTalk: { targetType: "group", targetId: "cid-demo", profile: "corp:user", mode: "draft", streamConfigured: true, groups: [{ id: "demo", name: "AI 分身测试群", openConversationId: "cid-demo", personaId: "primary", personaName: "示例主管的数字分身", twinVersionId: "twin-v1", twinVersionName: "现有默认分身", robotName: "示例主管 · 企业应用机器人", enabled: true, contextEnabled: true, replyMode: "draft", triggerMode: "all", triggerWords: [] }] },
};

const wait = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

let conversationSamples: ConversationSample[] = [
  {
    id: "sample-demo-1",
    sessionId: "dingtalk-demo-1",
    channel: "dingtalk_stream",
    conversationId: "cid-demo",
    groupName: "AI 分身测试群",
    senderId: "colleague-1",
    senderName: "同事甲",
    prompt: "这个项目今天能不能直接对外承诺上线时间？",
    reply: "先别承诺。把当前阻塞项、负责人和最晚验证时间发我，确认能闭环以后我再给对外口径。",
    status: "sent",
    createdAt: new Date(Date.now() - 38 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 37 * 60_000).toISOString(),
    sentAt: new Date(Date.now() - 37 * 60_000).toISOString(),
  },
];

let workbenchTurns: AgentConversationTurn[] = [];

export const mockBridge: TwinBridge = {
  bootstrap: async () => state,
  savePersonaBranches: async (branches) => {
    state = { ...state, personaBranches: branches };
    return state;
  },
  renamePersonaBranch: async (branchId, title) => {
    state = { ...state, personaBranches: state.personaBranches.map((item) => item.versionBranchId === branchId ? { ...item, title, updatedAt: new Date().toISOString() } : item) };
    return state;
  },
  deletePersonaBranch: async (branchId) => {
    state = {
      ...state,
      personaBranches: state.personaBranches.filter((item) => item.versionBranchId !== branchId),
      sources: state.sources.filter((item) => item.branchId !== branchId),
      workspaces: state.workspaces.filter((item) => item.branchId !== branchId),
    };
    return state;
  },
  configureClaude: async (input) => {
    const preset = modelProviderPreset(input.provider);
    state = { ...state, runtime: { ...state.runtime, credentials: true, modelProvider: input.provider, modelProviderName: input.providerName, model: input.model || preset.model, baseUrl: input.baseUrl, modelAuthMode: input.authMode ?? preset.authMode, nativeVision: input.nativeVision ?? preset.nativeVision, mapModelTiers: input.mapModelTiers ?? preset.mapModelTiers, contextWindow: input.contextWindow ?? preset.contextWindow, agent: { ...state.runtime.agent, ...input.agentRuntime } } };
    return state;
  },
  saveAgentRuntimeSettings: async (input) => {
    state = { ...state, runtime: { ...state.runtime, agent: { ...state.runtime.agent, ...input } } };
    return state;
  },
  importFiles: async (): Promise<DataSource[]> => {
    await wait();
    return [];
  },
  importFolder: async (): Promise<DataSource[]> => {
    await wait();
    return [];
  },
  importWorkspaceFiles: async (): Promise<DataSource[]> => {
    await wait();
    return [];
  },
  importWorkspaceFolder: async (): Promise<DataSource[]> => {
    await wait();
    return [];
  },
  chooseWorkspace: async () => state,
  installSkill: async () => state.skills,
  agentChat: async (surface, prompt, sessionId) => {
    await wait(760);
    const resolvedSessionId = sessionId || `agent-demo-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const isFollowup = prompt.includes("针对题目");
    const questionCard = surface === "onboarding" ? {
      id: crypto.randomUUID(),
      module: isFollowup ? "relationship" as const : "decision" as const,
      question: isFollowup ? "面对熟悉同事和第一次合作的人，你的追问方式会一样吗？" : "同事临近截止时间告诉你任务可能延期，你通常先怎么回应？",
      context: isFollowup ? "同一句话对不同关系的人可能有不同力度，分身需要学会这个条件差异。" : "这能帮助分身区分你是先追问事实、先稳定对方，还是直接推动新计划。",
      sourceNote: isFollowup ? "刚才已确认你先问卡点；现在还缺少关系远近对表达力度的影响。" : "从现有项目复盘中看到你多次先确认卡点与影响，再决定是否调整时间。",
      options: isFollowup ? [
        { id: "same", label: "基本一样，直接问事实", description: "关系远近不改变问题本身" },
        { id: "familiar", label: "熟人更直接，陌生人多一点铺垫", description: "先建立安全感，再进入卡点" },
        { id: "context", label: "主要看事情风险，不看熟悉程度", description: "风险越高，表达越明确" },
      ] : [
        { id: "facts", label: "先问清卡点和影响", description: "确认原因、影响范围和最晚可交付时间", suggested: true },
        { id: "plan", label: "先让对方给新计划", description: "要求明确负责人、动作与新的节点" },
        { id: "support", label: "先判断是否需要支持", description: "先解决资源或协作阻塞，再谈承诺" },
      ],
      allowFreeText: true,
      multiSelect: false,
      createdAt,
    } : undefined;
    const content = surface === "onboarding" ? "我先核对一个会直接影响分身替你回应方式的区别。" : "已通过 Claude Agent SDK 完成本轮。";
    workbenchTurns.push(
      { id: crypto.randomUUID(), surface, sessionId: resolvedSessionId, role: "user", content: prompt, createdAt: new Date(Date.now() - 760).toISOString() },
      { id: crypto.randomUUID(), surface, sessionId: resolvedSessionId, role: "agent", content, createdAt, durationMs: 760, questionCard },
    );
    return {
      content,
      sessionId: resolvedSessionId,
      sourcesChanged: false,
      durationMs: 760,
      steps: [],
      questionCard,
    };
  },
  loadAgentConversation: async (surface: AgentSurface, context) => workbenchTurns.filter((turn) => turn.surface === surface && (!context || (turn.personaId === context.personaId && turn.branchId === context.branchId))),
  deleteAgentConversation: async (sessionIds) => {
    const before = workbenchTurns.length;
    workbenchTurns = workbenchTurns.filter((turn) => !turn.sessionId || !sessionIds.includes(turn.sessionId));
    return { deletedTurns: before - workbenchTurns.length };
  },
  listSkills: async () => state.skills,
  readSkill: async (name) => ({ ...state.skills.find((item) => item.name === name)!, content: `---\nname: ${name}\ndescription: demo\n---\n` }),
  previewSource: async (sourceId) => ({ sourceId, title: "示例资料", logicalPath: "evidence/example.md", content: "# 示例资料\n\n本地文本预览。", truncated: false }),
  listVersions: async () => state.versions,
  readTwinVersion: async () => state.harness,
  pickVisualAttachments: async () => [],
  stageVisualAttachments: async () => [],
  pasteVisualAttachment: async () => [],
  chat: async (prompt: string): Promise<ChatReply> => {
    await wait(700);
    const reply = prompt.includes("延期")
      ? "可以延期，但先把影响讲清楚：现在卡点是什么、会影响谁、最晚哪天能交。你今天下班前给我一个新的里程碑，我按那个时间看结果。"
      : "我建议先做一个最小版本，不急着把范围铺开。拿两三个真实场景跑一轮，有数据后我们再决定下一步。";
    return { turn: { id: crypto.randomUUID(), role: "twin", content: reply, createdAt: new Date().toISOString(), confidence: 0.84, evidence: ["SOUL.md", "MEMORY.md", "STYLE.md"] }, sessionId: "demo-session" };
  },
  loadTwinConversation: async () => [],
  createEvaluationSession: async (input) => {
    const now = new Date().toISOString();
    const session = { ...input, id: crypto.randomUUID(), title: input.title || `评测会话 ${state.evaluationSessions.filter((item) => item.twinVersionId === input.twinVersionId).length + 1}`, createdAt: now, updatedAt: now };
    state = { ...state, evaluationSessions: [session, ...state.evaluationSessions] };
    return session;
  },
  updateEvaluationSession: async (id, patch) => {
    const current = state.evaluationSessions.find((item) => item.id === id)!;
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    state = { ...state, evaluationSessions: state.evaluationSessions.map((item) => item.id === id ? updated : item) };
    return updated;
  },
  saveEvaluation: async (input) => {
    state = { ...state, evaluationCount: state.evaluationCount + 1, pendingEvaluationCount: state.pendingEvaluationCount + (input.applyNow ? 0 : 1) };
    const record = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: input.applyNow ? "applied" as const : "pending" as const };
    if (input.sampleId) conversationSamples = conversationSamples.map((sample) => sample.id === input.sampleId ? { ...sample, evaluation: { id: record.id, status: record.status, score: input.score, labels: input.labels, expectedReply: input.expectedReply, notes: input.notes } } : sample);
    state = { ...state, evaluationRecords: [record, ...state.evaluationRecords] };
    return { record, changedFiles: [] };
  },
  reviewEvaluations: async () => {
    const applied = state.pendingEvaluationCount;
    state = { ...state, pendingEvaluationCount: 0 };
    return { applied, harness };
  },
  listConversationSamples: async (limit = 100, twinVersionId, branchId) => conversationSamples.filter((sample) => !twinVersionId || sample.twinVersionId === twinVersionId).filter((sample) => !branchId || sample.branchId === branchId).slice(0, limit),
  saveDingTalkConfig: async (config) => {
    const groups = config.groups.map((group) => ({ ...group, triggerMode: "all" as const, triggerWords: [] }));
    state = { ...state, dingTalk: { targetType: "group", targetId: config.targetId, profile: config.profile, mode: config.mode, streamConfigured: true, webhookConfigured: true, groups } };
    return state;
  },
  saveDingTalkRobotConfig: async (_robotId, config) => {
    const groups = config.groups.map((group) => ({ ...group }));
    state = { ...state, dingTalk: { targetType: "group", targetId: config.targetId, profile: config.profile, mode: config.mode, streamConfigured: true, webhookConfigured: true, activeRobotIds: config.activeRobotIds, groups } };
    return state;
  },
  startDingTalk: async (config) => ({ running: true, streamConnected: true, streamConfigured: true, webhookConnected: true, webhookConfigured: true, webhookGroups: config.groups.filter((group) => group.enabled && group.gatewayType === "webhook").length, busConnected: true, robotGroups: config.groups.filter((group) => group.enabled && group.gatewayType !== "webhook").length, contextGroups: config.groups.filter((group) => group.contextEnabled).length, groupIds: config.groups.filter((group) => group.contextEnabled).map((group) => group.openConversationId), activeRobotIds: [...new Set(config.groups.filter((group) => group.enabled).map((group) => group.robotId || (group.gatewayType === "webhook" ? `webhook:${group.id}` : "enterprise-stream-primary")))] }),
  startDingTalkRobot: async (robotId, config) => ({ running: true, streamConnected: true, streamConfigured: true, webhookConnected: true, webhookConfigured: true, webhookGroups: config.groups.filter((group) => group.gatewayType === "webhook" && (group.robotId || `webhook:${group.id}`) === robotId).length, busConnected: true, robotGroups: config.groups.filter((group) => group.gatewayType !== "webhook" && (group.robotId || "enterprise-stream-primary") === robotId).length, contextGroups: config.groups.filter((group) => group.contextEnabled && (group.robotId || (group.gatewayType === "webhook" ? `webhook:${group.id}` : "enterprise-stream-primary")) === robotId).length, groupIds: config.groups.filter((group) => group.contextEnabled && (group.robotId || (group.gatewayType === "webhook" ? `webhook:${group.id}` : "enterprise-stream-primary")) === robotId).map((group) => group.openConversationId), activeRobotIds: [robotId] }),
  getDingTalkStatus: async () => ({ running: false, streamConnected: false, streamConfigured: true, webhookConnected: false, webhookConfigured: true, webhookGroups: 0, busConnected: false, robotGroups: 0, contextGroups: 0, groupIds: [], activeRobotIds: [] }),
  stopDingTalkRobot: async () => ({ running: false, streamConnected: false, streamConfigured: true, webhookConnected: false, webhookConfigured: true, webhookGroups: 0, busConnected: false, robotGroups: 0, contextGroups: 0, groupIds: [], activeRobotIds: [] }),
  stopDingTalk: async () => ({ running: false, streamConnected: false, streamConfigured: true, webhookConnected: false, webhookConfigured: true, webhookGroups: 0, busConnected: false, robotGroups: 0, contextGroups: 0, groupIds: [], activeRobotIds: [] }),
  sendDingTalk: async (draft: DingTalkDraft) => ({ ...draft, status: "sent" }),
  revealProfile: async () => undefined,
  revealPersonaWorkspace: async () => undefined,
  onDingTalkDraft: () => () => undefined,
  onRuntimeEvent: () => () => undefined,
  onAgentPermissionRequest: () => () => undefined,
  resolveAgentPermission: async () => true,
  openExternalUrl: async () => true,
};
