import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Archive,
  Bot,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronRight,
  ChevronDown,
  CircleAlert,
  Database,
  FileText,
  Files,
  FolderOpen,
  Gauge,
  Heart,
  Import,
  Image as ImageIcon,
  Pencil,
  KeyRound,
  Link2,
  ListChecks,
  LoaderCircle,
  MemoryStick,
  MessageCircleMore,
  MoreHorizontal,
  Plus,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Radio,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  UserSearch,
  UserRound,
  WandSparkles,
  X,
  RotateCcw,
  Timer,
} from "lucide-react";
import type {
  BootstrapState,
  AgentAccessLevel,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentConversationTurn,
  AgentStageCheckpoint,
  AgentStep,
  ChatTurn,
  ConversationSample,
  DingTalkConfig,
  DingTalkDraft,
  DingTalkGatewayInput,
  DingTalkRuntimeStatus,
  EvaluationInput,
  EvaluationSaveResult,
  EvaluationSession,
  ArtifactVersion,
  HarnessSnapshot,
  ModelConnectionInput,
  OnboardingProfile,
  PersonaVersionBranch,
  AgentPluginId,
  AgentSurface,
  WorkbenchAgentReply,
  WorkbenchVersionContext,
  RuntimeEvent,
  TwinBridge,
  VisualAttachment,
  VisualAttachmentBuffer,
} from "../shared/types";
import { mockBridge } from "./lib/mockBridge";
import { conversationStageStatus, markConversationStageComplete } from "./lib/conversationProgress";
import { runtimeEventMatchesScope, runtimeRunMatchesScope, runtimeStream, type ActiveRuntimeRun, type RuntimeScope } from "./lib/runtimeScope";
import { MODEL_PROVIDER_PRESETS, modelProviderDisplayName, modelProviderPreset } from "../shared/model-providers";
import hrKeyboardAvatar from "./assets/hr-keyboard.png";
import evidenceCollectorAvatar from "./assets/evidence-collector.png";
import personaDistillerAvatar from "./assets/persona-distiller.png";

type View = "identity" | "overview" | "lab" | "memory" | "dingtalk";
type HarnessTab = "soul" | "memory" | "user" | "style" | "qa" | "claude";
type EvaluationDraftInput = Omit<EvaluationInput, "personaId" | "branchId" | "twinVersionId">;

type PersonaConversation = PersonaVersionBranch;

const bridge: TwinBridge = window.twin ?? mockBridge;
const isDemo = !window.twin;

const PERMISSION_LEVELS: ReadonlyArray<{ id: AgentAccessLevel; title: string; detail: string }> = [
  { id: "full", title: "完全权限", detail: "所有工具直接执行；只用于完全可信的项目。" },
  { id: "auto", title: "自动审核", detail: "由 Claude Agent SDK 自动判断风险，无法确定时再询问。" },
  { id: "sensitive", title: "敏感操作确认", detail: "安全读取自动执行；命令、写入与外部副作用需要确认。" },
  { id: "askEveryTime", title: "每次询问我", detail: "每一次工具调用都暂停，等你明确允许或拒绝。" },
];

function permissionLevelLabel(level: AgentAccessLevel): string {
  return PERMISSION_LEVELS.find((item) => item.id === level)?.title ?? "敏感操作确认";
}

function PermissionControl({ level, onChange, compact = false }: { level: AgentAccessLevel; onChange: (level: AgentAccessLevel) => Promise<boolean>; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <div ref={rootRef} className={`composer-permission ${compact ? "compact" : ""}`}>
    <button type="button" className="composer-permission-trigger" onClick={() => setOpen((value) => !value)} title="切换当前项目的 Agent 权限模式"><ShieldCheck size={13} /><span>{permissionLevelLabel(level)}</span><ChevronDown size={11} /></button>
    {open && <div className="composer-permission-menu"><header><b>Agent 权限</b><small>切换后从下一次工具调用生效</small></header>{PERMISSION_LEVELS.map((item) => <button type="button" key={item.id} className={item.id === level ? "selected" : ""} onClick={async () => { if (await onChange(item.id)) setOpen(false); }}><i>{item.id === level ? <Check size={11} /> : null}</i><span><b>{item.title}</b><small>{item.detail}</small></span></button>)}</div>}
  </div>;
}

const NAV: Array<{ id: View; label: string; icon: typeof Gauge }> = [
  { id: "identity", label: "人格工作台", icon: Sparkles },
  { id: "overview", label: "分身概览", icon: Gauge },
  { id: "lab", label: "对话实验室", icon: MessageCircleMore },
  { id: "memory", label: "记忆中枢", icon: BrainCircuit },
  { id: "dingtalk", label: "钉钉接入", icon: Bot },
];

const EMPTY_PROFILE: OnboardingProfile = {
  name: "",
  role: "",
  bio: "",
  communicationStyle: "",
  decisionPrinciples: "",
  boundaries: "",
  sampleReply: "",
};

function App() {
  const [state, setState] = useState<BootstrapState | null>(null);
  const [view, setView] = useState<View>("identity");
  const [conversations, setConversations] = useState<PersonaConversation[]>(() => loadPersonaConversations());
  const [activeConversationId, setActiveConversationId] = useState(() => loadPersonaConversations().find((item) => !item.archivedAt)?.id ?? "");
  const [activePlugin, setActivePlugin] = useState<AgentPluginId>(() => loadPersonaConversations().find((item) => !item.archivedAt)?.currentPluginId ?? "hr-keyboard");
  const [toast, setToast] = useState<{ tone: "info" | "error" | "success"; text: string } | null>(null);
  const [runtimeMessage, setRuntimeMessage] = useState("正在读取本地人格档案…");
  const [drafts, setDrafts] = useState<DingTalkDraft[]>([]);
  const [showClaudeSetup, setShowClaudeSetup] = useState(false);
  const [claudeSetupTab, setClaudeSetupTab] = useState<"connection" | "runtime">("connection");
  const [permissionRequest, setPermissionRequest] = useState<AgentPermissionRequest | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEvent[]>([]);
  const [activeRuns, setActiveRuns] = useState<ActiveRuntimeRun[]>([]);
  const [activeHarness, setActiveHarness] = useState<HarnessSnapshot>();
  const [branchesReady, setBranchesReady] = useState(false);
  const [labTargetScope, setLabTargetScope] = useState<RuntimeScope>();

  const currentConversation = conversations.find((item) => item.id === activeConversationId && !item.archivedAt)
    ?? conversations.find((item) => !item.archivedAt);

  useEffect(() => {
    setActiveHarness(undefined);
    if (!currentConversation?.publishedVersionId) return;
    void bridge.readTwinVersion(currentConversation.publishedVersionId, versionContextForConversation(currentConversation)).then(setActiveHarness);
  }, [currentConversation?.id, currentConversation?.publishedVersionId, state?.versions]);

  useEffect(() => {
    void bridge.bootstrap().then(setState).catch((error) => setToast({ tone: "error", text: getError(error) }));
    void bridge.listConversationSamples(500).then((samples) => {
      setDrafts(samples.filter((sample) => ["received", "processing", "draft", "failed"].includes(sample.status)).map(conversationSampleToDraft));
    }).catch(() => undefined);
    const offRuntime = bridge.onRuntimeEvent((event) => {
      if (!event.branchId || event.surface === "dingtalk") setRuntimeMessage(event.message);
      setRuntimeEvents((items) => [...items, { ...event, at: event.at ?? new Date().toISOString() }].slice(-360));
    });
    const offDraft = bridge.onDingTalkDraft((draft) => setDrafts((items) => [draft, ...items.filter((item) => item.id !== draft.id)]));
    const offPermission = bridge.onAgentPermissionRequest((request) => setPermissionRequest(request));
    return () => {
      offRuntime();
      offDraft();
      offPermission();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("mirror-persona-conversations-v3", JSON.stringify(conversations));
    if (state && branchesReady) void bridge.savePersonaBranches(conversations).catch((error) => setToast({ tone: "error", text: getError(error) }));
  }, [conversations, Boolean(state), branchesReady]);

  useEffect(() => {
    if (!state || branchesReady) return;
    if (state.personaBranches.length) {
      const persisted = state.personaBranches.map(normalizePersonaConversation);
      setConversations(persisted);
      const nextActive = persisted.find((item) => item.id === activeConversationId && !item.archivedAt) ?? persisted.find((item) => !item.archivedAt);
      if (nextActive) {
        setActiveConversationId(nextActive.id);
        setActivePlugin(nextActive.currentPluginId);
      }
    }
    setBranchesReady(true);
  }, [state, branchesReady, activeConversationId]);

  useEffect(() => {
    if (!state?.harness || conversations.some((item) => item.publishedVersionId)) return;
    const legacyVersion = [...state.versions].filter((item) => item.kind === "twin" && item.name === "default").sort((a, b) => b.version - a.version)[0];
    const legacyConversation = conversations.filter((item) => !item.archivedAt).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
    if (!legacyVersion || !legacyConversation) return;
    setConversations((items) => items.map((item) => item.id === legacyConversation.id ? { ...item, publishedVersionId: legacyVersion.id, publishedVersionNumber: legacyVersion.version } : item));
  }, [state?.harness, state?.versions, conversations]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.querySelector<HTMLElement>(".workspace-scroll")?.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);

  async function run<T>(label: string, action: () => Promise<T>, success?: string, scope?: RuntimeScope): Promise<T | undefined> {
    const runId = globalThis.crypto.randomUUID();
    const startedAt = Date.now();
    setActiveRuns((items) => [...items, { id: runId, label, startedAt, scope }]);
    setRuntimeEvents((items) => [...items, { stage: "ui-start", message: label, at: new Date(startedAt).toISOString(), kind: "status" as const, ...scope }].slice(-360));
    if (!scope?.branchId) setRuntimeMessage(label);
    try {
      const result = await action();
      if (success) setToast({ tone: "success", text: success });
      return result;
    } catch (error) {
      const message = getError(error);
      if (isClaudeAuthError(error)) {
        setClaudeSetupTab("connection");
        setShowClaudeSetup(true);
      }
      setToast({ tone: "error", text: message });
      return undefined;
    } finally {
      setActiveRuns((items) => items.filter((item) => item.id !== runId));
    }
  }

  async function configureClaude(input: ModelConnectionInput): Promise<boolean> {
    const providerName = modelProviderDisplayName(input.provider, input.providerName);
    const next = await run(
      `正在加密保存 ${providerName} 凭证…`,
      () => bridge.configureClaude(input),
      `${providerName} 已配置，可以开始人格蒸馏`,
    );
    if (!next) return false;
    setState(next);
    setShowClaudeSetup(false);
    return true;
  }

  async function saveAgentRuntimeSettings(input: ModelConnectionInput["agentRuntime"]): Promise<boolean> {
    if (!input) return false;
    const next = await run("正在保存 Claude Agent SDK 运行设置…", () => bridge.saveAgentRuntimeSettings(input), "Agent 运行设置已保存，将从下一轮任务生效");
    if (!next) return false;
    setState(next);
    setShowClaudeSetup(false);
    return true;
  }

  async function renameConversation(id: string, title: string): Promise<boolean> {
    const target = conversations.find((item) => item.id === id);
    const normalized = title.replace(/\s+/g, " ").trim();
    if (!target || !normalized || normalized === target.title) return Boolean(normalized);
    const next = await run("正在同步分身版本名称…", () => bridge.renamePersonaBranch(target.versionBranchId, normalized), "名称已同步到工作台、实验室、钉钉绑定和历史样本");
    if (!next) return false;
    setState(next);
    setConversations((items) => items.map((item) => item.id === id ? { ...item, title: normalized, updatedAt: new Date().toISOString() } : item));
    return true;
  }

  async function resolvePermission(response: AgentPermissionResponse): Promise<void> {
    const accepted = await bridge.resolveAgentPermission(response);
    if (accepted) setPermissionRequest(null);
  }

  if (!state) return <BootScreen message={runtimeMessage} />;

  const scopedState = currentConversation ? scopeBootstrapState(state, currentConversation, activeHarness) : state;
  const currentContext = currentConversation ? versionContextForConversation(currentConversation) : undefined;
  const identityScope: RuntimeScope | undefined = currentConversation ? {
    personaId: currentConversation.personaId,
    branchId: currentConversation.versionBranchId,
    surface: surfaceForPlugin(activePlugin),
  } : undefined;
  const branchScope: RuntimeScope | undefined = currentConversation ? {
    personaId: currentConversation.personaId,
    branchId: currentConversation.versionBranchId,
  } : undefined;
  const latestRun = (scope?: RuntimeScope) => [...activeRuns].reverse().find((item) => runtimeRunMatchesScope(item, scope));
  const globalRun = latestRun();
  const identityRun = identityScope ? latestRun(identityScope) : undefined;
  const labRun = labTargetScope ? [...activeRuns].reverse().find((item) => runtimeRunMatchesScope(item, labTargetScope) && ["twin", "feedback", "evaluation", "calibration"].includes(item.scope?.surface ?? "")) : undefined;
  const dingtalkScope: RuntimeScope = { surface: "dingtalk" };
  const dingtalkRun = latestRun(dingtalkScope);
  const identityBusy = identityRun?.label ?? globalRun?.label ?? null;
  const labBusy = labRun?.label ?? globalRun?.label ?? null;
  const dingtalkBusy = dingtalkRun?.label ?? globalRun?.label ?? null;
  const identityEvents = identityScope ? runtimeEvents.filter((event) => runtimeEventMatchesScope(event, identityScope)) : [];
  const identityRuntimeMessage = [...identityEvents].reverse().find((event) => event.kind !== "text_delta")?.message ?? identityBusy ?? "等待当前阶段任务";
  const visibleRun = view === "identity" ? (identityRun ?? globalRun) : view === "lab" ? (labRun ?? globalRun) : view === "dingtalk" ? (dingtalkRun ?? globalRun) : globalRun;

  function selectPlugin(pluginId: AgentPluginId) {
    setActivePlugin(pluginId);
    if (currentConversation) updateConversation(currentConversation.id, { currentPluginId: pluginId });
    setView("identity");
    setMobileSidebarOpen(false);
  }

  function createConversation() {
    const conversation = createDraftConversation();
    setConversations((items) => [conversation, ...items]);
    setActivePlugin("hr-keyboard");
    setActiveConversationId(conversation.id);
    setView("identity");
    setMobileSidebarOpen(false);
  }

  function updateConversation(id: string, patch: Partial<PersonaConversation>) {
    setConversations((items) => items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  }

  function archiveConversation(id: string) {
    const remaining = conversations.filter((item) => !item.archivedAt && item.id !== id);
    setConversations((items) => items.map((item) => item.id === id ? { ...item, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item));
    if (activeConversationId === id) {
      if (remaining[0]) {
        setActiveConversationId(remaining[0].id);
        setActivePlugin(remaining[0].currentPluginId);
      } else {
        const replacement = createDraftConversation();
        setConversations((items) => [replacement, ...items]);
        setActiveConversationId(replacement.id);
        setActivePlugin("hr-keyboard");
      }
    }
  }

  async function permanentlyDeleteConversation(id: string) {
    const target = conversations.find((item) => item.id === id);
    if (!target || !window.confirm(`彻底删除“${target.title}”？该会话的本地执行记录也会删除，且无法恢复。`)) return;
    await bridge.deleteAgentConversation(conversationSessionIds(target));
    const next = await bridge.deletePersonaBranch(target.versionBranchId);
    setState(next);
    setConversations((items) => items.filter((item) => item.id !== id));
  }

  async function emptyTrash() {
    const archived = conversations.filter((item) => item.archivedAt);
    if (!archived.length || !window.confirm(`清空回收站中的 ${archived.length} 个会话？此操作无法恢复。`)) return;
    await bridge.deleteAgentConversation(archived.flatMap(conversationSessionIds));
    let nextState = state;
    for (const item of archived) nextState = await bridge.deletePersonaBranch(item.versionBranchId);
    setState(nextState);
    setConversations((items) => items.filter((item) => !item.archivedAt));
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} setView={(next) => { setView(next); setMobileSidebarOpen(false); }} state={state} conversations={conversations} activeConversationId={activeConversationId} mobileOpen={mobileSidebarOpen} onSelectConversation={(conversation) => { setActivePlugin(conversation.currentPluginId); setActiveConversationId(conversation.id); setView("identity"); setMobileSidebarOpen(false); }} onCreateConversation={createConversation} onRenameConversation={renameConversation} onArchiveConversation={archiveConversation} onRestoreConversation={(id) => updateConversation(id, { archivedAt: undefined })} onPermanentlyDeleteConversation={permanentlyDeleteConversation} onEmptyTrash={emptyTrash} onOpenRuntimeSettings={() => { setClaudeSetupTab("runtime"); setShowClaudeSetup(true); setMobileSidebarOpen(false); }} />
      <main className="workspace">
        <Topbar state={state} isDemo={isDemo} onConfigureClaude={() => { setClaudeSetupTab("connection"); setShowClaudeSetup(true); }} onConfigureRuntime={() => { setClaudeSetupTab("runtime"); setShowClaudeSetup(true); }} onOpenFolder={() => void bridge.revealProfile()} onToggleSidebar={() => setMobileSidebarOpen((value) => !value)} />
        <div className="workspace-scroll">
          {view === "identity" && currentConversation && (
            <IdentityStudio
              state={scopedState}
              busy={identityBusy}
              runtimeMessage={identityRuntimeMessage}
              pluginId={activePlugin}
              conversation={currentConversation}
              onSelectPlugin={selectPlugin}
              onConversationUpdate={(patch) => updateConversation(currentConversation.id, patch)}
              onCompleteStage={(stage) => updateConversation(currentConversation.id, { completedStages: markConversationStageComplete(currentConversation.completedStages, stage) })}
              onImportFiles={async (target) => {
                const importer = target === "knowledge" ? bridge.importWorkspaceFiles : bridge.importFiles;
                const files = await run(target === "knowledge" ? "正在加入知识库…" : "正在复制本地蒸馏材料…", () => importer(currentContext!), target === "knowledge" ? "文件已加入本版本知识库，不会自动蒸馏" : "资料已保存在本版本人格档案中", identityScope);
                if (files?.length) setState(await bridge.bootstrap());
              }}
              onImportFolder={async (target) => {
                const importer = target === "knowledge" ? bridge.importWorkspaceFolder : bridge.importFolder;
                const files = await run(target === "knowledge" ? "正在加入文件夹知识库…" : "正在本地解析文件夹蒸馏源…", () => importer(currentContext!), target === "knowledge" ? "文件夹已加入本版本知识库" : "文件夹蒸馏源已导入本版本", identityScope);
                if (files?.length) setState(await bridge.bootstrap());
              }}
              onAgentChat={async (surface, prompt, sessionId) => {
                const result = await run("Claude Agent SDK 正在执行 Plugin 与 Skill…", () => bridge.agentChat(surface, prompt, sessionId, {
                  personaId: currentConversation.personaId,
                  branchId: currentConversation.versionBranchId,
                  branchName: currentConversation.title,
                  twinVersionId: currentConversation.publishedVersionId,
                  includeLegacyData: currentConversation.includeLegacyData,
                }), undefined, identityScope);
                if (result?.sourcesChanged || result?.committedVersion) setState(await bridge.bootstrap());
                if (result?.committedVersion) updateConversation(currentConversation.id, {
                  publishedVersionId: result.committedVersion.id,
                  publishedVersionNumber: result.committedVersion.version,
                });
                return result;
              }}
              onChooseWorkspace={async () => { const next = await bridge.chooseWorkspace(currentContext!); setState(next); }}
              onInstallSkill={async () => { await bridge.installSkill(); setState(await bridge.bootstrap()); }}
              onRevealWorkspace={() => bridge.revealPersonaWorkspace(currentContext)}
              executionEvents={identityEvents}
              busyStartedAt={identityRun?.startedAt ?? globalRun?.startedAt}
              liveStream={runtimeStream(identityEvents)}
              accessLevel={state.runtime.agent.accessLevel}
              onAccessLevelChange={(accessLevel) => saveAgentRuntimeSettings({ maxTurns: state.runtime.agent.maxTurns, accessLevel })}
              onGoLab={() => setView("lab")}
            />
          )}
          {view === "overview" && <Overview state={scopedState} go={setView} />}
          {view === "lab" && state.versions.some((item) => item.kind === "twin") && (
            <ConversationLab
              state={state}
              conversation={currentConversation}
              conversations={conversations}
              onTargetChange={(context) => setLabTargetScope({ personaId: context.personaId, branchId: context.branchId })}
              busy={labBusy}
              archiveRevision={drafts.length}
              onChat={(prompt, sessionId, context, attachments) => run("正在模拟当前分身版本的判断与表达…", () => bridge.chat(prompt, sessionId, context, attachments), undefined, { personaId: context.personaId, branchId: context.branchId, surface: "twin" })}
              onPickVisualAttachments={(context) => bridge.pickVisualAttachments(context)}
              onStageVisualAttachments={(context, files) => bridge.stageVisualAttachments(context, files)}
              onPasteVisualAttachment={(context) => bridge.pasteVisualAttachment(context)}
              onLoadTwinConversation={(sessionId, context) => bridge.loadTwinConversation(sessionId, context)}
              onLoadConversationSamples={async (limit, context) => {
                return context.includeLegacyData
                  ? bridge.listConversationSamples(limit, context.twinVersionId)
                  : bridge.listConversationSamples(limit, undefined, context.branchId);
              }}
              onCreateEvaluationSession={async (context, title) => {
                const created = await bridge.createEvaluationSession({ personaId: context.personaId, branchId: context.branchId, twinVersionId: context.twinVersionId!, title });
                setState(await bridge.bootstrap());
                return created;
              }}
              onUpdateEvaluationSession={async (id, patch) => {
                const updated = await bridge.updateEvaluationSession(id, patch);
                setState(await bridge.bootstrap());
                return updated;
              }}
              onRenameVersion={async (context, title) => {
                const owner = conversations.find((item) => item.versionBranchId === context.branchId);
                return owner ? renameConversation(owner.id, title) : false;
              }}
              accessLevel={state.runtime.agent.accessLevel}
              onAccessLevelChange={(accessLevel) => saveAgentRuntimeSettings({ maxTurns: state.runtime.agent.maxTurns, accessLevel })}
              onSaveEvaluation={async (input, context) => {
                const scopedInput = { ...input, personaId: context.personaId, branchId: context.branchId, twinVersionId: context.twinVersionId! };
                const result = await run("正在保存评测记录并执行纠偏链路…", () => bridge.saveEvaluation(scopedInput), input.applyNow ? "评测已保存并完成版本纠偏" : "评测已保存到定期反哺队列", { personaId: context.personaId, branchId: context.branchId, surface: "evaluation" });
                if (result?.revision) {
                  const owner = conversations.find((item) => item.versionBranchId === context.branchId);
                  if (owner) updateConversation(owner.id, { publishedVersionId: result.revision.version.id, publishedVersionNumber: result.revision.version.version });
                }
                if (result?.revisionError) setToast({ tone: "error", text: `评测记录已保存，但新版本生成失败：${result.revisionError}` });
                if (result) setState(await bridge.bootstrap());
                return result;
              }}
              onReviewEvaluations={async (context) => {
                const result = await run("Claude Agent SDK 正在审查当前版本的待处理标注…", () => bridge.reviewEvaluations(context), undefined, { personaId: context.personaId, branchId: context.branchId, surface: "evaluation" });
                if (result) {
                  setToast({ tone: "success", text: result.applied ? `已反哺 ${result.applied} 条评测标注` : "当前没有待处理标注" });
                  const owner = conversations.find((item) => item.versionBranchId === context.branchId);
                  if (result.revision && owner) updateConversation(owner.id, { publishedVersionId: result.revision.version.id, publishedVersionNumber: result.revision.version.version });
                  setState(await bridge.bootstrap());
                }
              }}
              onAgentChat={async (prompt, sessionId, context) => {
                const result = await run("Claude Agent SDK 纠偏 Agent 正在介入当前版本…", () => bridge.agentChat("calibration", prompt, sessionId, context), undefined, { personaId: context.personaId, branchId: context.branchId, surface: "calibration" });
                if (result?.sourcesChanged) setState(await bridge.bootstrap());
                const owner = conversations.find((item) => item.versionBranchId === context.branchId);
                if (result?.committedVersion && owner) updateConversation(owner.id, { publishedVersionId: result.committedVersion.id, publishedVersionNumber: result.committedVersion.version });
                return result;
              }}
            />
          )}
          {view === "lab" && !state.versions.some((item) => item.kind === "twin") && <VersionRequiredEmpty title="对话实验室需要一个已发布分身版本" detail="先完成人格蒸馏并提交 Harness，再创建独立评测会话。" onGo={() => setView("identity")} />}
          {view === "memory" && <MemoryCenter state={scopedState} context={currentContext} />}
          {view === "dingtalk" && (
            <DingTalk
              state={state}
              conversations={conversations}
              drafts={drafts}
              busy={dingtalkBusy}
              runtimeMessage={runtimeMessage}
              onSave={async (config) => {
                const next = await run("正在保存钉钉接入配置…", () => bridge.saveDingTalkConfig(config), "钉钉配置已保存在本机", dingtalkScope);
                if (next) setState(next);
                return next;
              }}
              onSaveRobot={async (robotId, config) => {
                const next = await run("正在保存该机器人配置…", () => bridge.saveDingTalkRobotConfig(robotId, config), "该机器人配置已保存", dingtalkScope);
                if (next) setState(next);
                return next;
              }}
              onStart={(config) => run("正在连接钉钉 Stream / Webhook 机器人…", () => bridge.startDingTalk(config), undefined, dingtalkScope)}
              onStartRobot={(robotId, config) => run("正在启动该机器人…", () => bridge.startDingTalkRobot(robotId, config), undefined, dingtalkScope)}
              onStopRobot={(robotId) => run("正在停止该机器人…", () => bridge.stopDingTalkRobot(robotId), undefined, dingtalkScope)}
              onStop={() => run("正在停止机器人与上下文监听…", () => bridge.stopDingTalk(), undefined, dingtalkScope)}
              onSend={async (draft) => {
                const sent = await run("正在通过对应机器人通道回复…", () => bridge.sendDingTalk(draft), "机器人回复已发送", dingtalkScope);
                if (sent) setDrafts((items) => items.map((item) => (item.id === sent.id ? sent : item)));
              }}
            />
          )}
        </div>
      </main>
      {visibleRun && <BusyRail label={visibleRun.label} startedAt={visibleRun.startedAt} />}
      {toast && <Toast {...toast} close={() => setToast(null)} />}
      {showClaudeSetup && <ClaudeSetupModal state={state} initialTab={claudeSetupTab} busy={Boolean(globalRun)} close={() => setShowClaudeSetup(false)} save={configureClaude} saveRuntime={saveAgentRuntimeSettings} />}
      {permissionRequest && <AgentPermissionModal request={permissionRequest} accessLevel={state.runtime.agent.accessLevel} onResolve={resolvePermission} />}
    </div>
  );
}

function BootScreen({ message }: { message: string }) {
  return (
    <div className="boot-screen">
      <div className="boot-mark"><span>镜</span></div>
      <p>正在唤醒你的数字分身</p>
      <small>{message}</small>
    </div>
  );
}

function Onboarding({ onComplete, busy }: { onComplete: (profile: OnboardingProfile) => Promise<void>; busy: boolean }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const update = (key: keyof OnboardingProfile, value: string) => setProfile((item) => ({ ...item, [key]: value }));
  const canContinue = step === 0 ? profile.name && profile.role && profile.bio : step === 1 ? profile.communicationStyle && profile.decisionPrinciples : profile.boundaries && profile.sampleReply;

  return (
    <div className="onboarding-shell">
      <header className="onboarding-brand"><span className="mini-seal">镜</span><b>镜我</b><em>MIRROR / 个人数字分身</em></header>
      <section className="onboarding-intro">
        <div className="eyebrow"><Sparkles size={14} /> 先让它认识你</div>
        <h1>不是复制你的声音，<br /><i>而是理解你的判断。</i></h1>
        <p>回答 7 个问题。资料只在本机整理，稍后由 Claude Agent SDK 蒸馏成可审阅的人格文件。</p>
        <div className="privacy-note"><ShieldCheck size={18} /><span><b>Local first</b> 原始材料默认不离开你的设备</span></div>
      </section>
      <section className="onboarding-form paper-panel">
        <div className="step-line">
          {["你是谁", "如何判断", "怎样表达"].map((label, index) => (
            <div className={index <= step ? "step active" : "step"} key={label}><span>{index < step ? <Check size={13} /> : index + 1}</span>{label}</div>
          ))}
        </div>
        {step === 0 && (
          <div className="form-stage stage-appear">
            <span className="section-number">01 / IDENTITY</span>
            <h2>先从你的当下开始</h2>
            <div className="two-fields">
              <Field label="我该怎么称呼你" value={profile.name} onChange={(v) => update("name", v)} placeholder="例如：示例主管" />
              <Field label="你目前的角色" value={profile.role} onChange={(v) => update("role", v)} placeholder="例如：AI 产品负责人" />
            </div>
            <Field multiline label="用自己的话介绍一下你" value={profile.bio} onChange={(v) => update("bio", v)} placeholder="你在做什么、在意什么、最近关注什么……" />
          </div>
        )}
        {step === 1 && (
          <div className="form-stage stage-appear">
            <span className="section-number">02 / JUDGEMENT</span>
            <h2>你通常怎么做决定？</h2>
            <Field multiline label="别人会怎样形容你的沟通方式" value={profile.communicationStyle} onChange={(v) => update("communicationStyle", v)} placeholder="例如：先说结论，不绕弯；但在否定别人前会解释原因" />
            <Field multiline label="遇到两难选择时，你优先考虑什么" value={profile.decisionPrinciples} onChange={(v) => update("decisionPrinciples", v)} placeholder="例如：长期价值优先，但会先用低成本方式验证" />
          </div>
        )}
        {step === 2 && (
          <div className="form-stage stage-appear">
            <span className="section-number">03 / VOICE</span>
            <h2>给它一段真正的你</h2>
            <Field multiline label="哪些事情不能替你擅自决定" value={profile.boundaries} onChange={(v) => update("boundaries", v)} placeholder="例如：对外承诺、付款、人事评价都必须由我确认" />
            <Field multiline label="贴一段你觉得“很像自己”的真实回复" value={profile.sampleReply} onChange={(v) => update("sampleReply", v)} placeholder="一两句话就够，这会成为最重要的表达样本" />
          </div>
        )}
        <footer className="onboarding-actions">
          <button className="text-button" disabled={step === 0} onClick={() => setStep((n) => n - 1)}>返回</button>
          <span>预计还需 {Math.max(1, 3 - step)} 分钟</span>
          <button className="primary-button" disabled={!canContinue || busy} onClick={() => step < 2 ? setStep((n) => n + 1) : void onComplete(profile)}>
            {busy ? <LoaderCircle className="spin" size={17} /> : step === 2 ? "建立人格档案" : "继续"}<ArrowRight size={17} />
          </button>
        </footer>
      </section>
      <div className="onboarding-index">M / 001</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; multiline?: boolean; type?: "text" | "password" }) {
  return (
    <label className="field"><span>{label}</span>
      {multiline ? <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={4} /> : <input type={type} autoComplete={type === "password" ? "off" : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
    </label>
  );
}

function Sidebar({ view, setView, state, conversations, activeConversationId, mobileOpen, onSelectConversation, onCreateConversation, onRenameConversation, onArchiveConversation, onRestoreConversation, onPermanentlyDeleteConversation, onEmptyTrash, onOpenRuntimeSettings }: { view: View; setView: (view: View) => void; state: BootstrapState; conversations: PersonaConversation[]; activeConversationId: string; mobileOpen: boolean; onSelectConversation: (conversation: PersonaConversation) => void; onCreateConversation: () => void; onRenameConversation: (id: string, title: string) => Promise<boolean>; onArchiveConversation: (id: string) => void; onRestoreConversation: (id: string) => void; onPermanentlyDeleteConversation: (id: string) => Promise<void>; onEmptyTrash: () => Promise<void>; onOpenRuntimeSettings: () => void }) {
  const [trashOpen, setTrashOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string>();
  const [renameDraft, setRenameDraft] = useState("");
  async function finishRename(conversation: PersonaConversation) {
    if (await onRenameConversation(conversation.id, renameDraft)) setRenamingId(undefined);
  }
  const activeConversations = conversations.filter((item) => !item.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const trashedConversations = conversations.filter((item) => item.archivedAt).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  return (
    <aside className={mobileOpen ? "sidebar persona-sidebar mobile-open" : "sidebar persona-sidebar"}>
      <div className="drag-zone" />
      <div className="brand-lockup"><div className="brand-seal">镜</div><div><strong>镜我</strong><small>PERSONAL MIRROR</small></div></div>
      <button className="new-persona-session" onClick={onCreateConversation}><Plus size={16} />新建分身版本</button>
      <div className="persona-tree">
        <div className="persona-tree-head">
          <div className="avatar-orbit small"><div className="avatar-core">{state.profile?.name?.slice(0, 1) || "新"}</div><span /></div>
          <div><small>人格</small><b>{state.profile?.name || "待认识的你"}</b></div>
          <ChevronDown size={15} />
        </div>
        <div className="persona-conversation-list">
          {activeConversations.map((conversation) => {
            const stageIndex = ["hr-keyboard", "evidence-collector", "persona-distiller"].indexOf(conversation.currentPluginId);
            return <div className={activeConversationId === conversation.id && view === "identity" ? "persona-conversation active" : "persona-conversation"} key={conversation.id}>
              {renamingId === conversation.id ? <div className="conversation-rename"><MessageCircleMore size={14} /><input autoFocus value={renameDraft} maxLength={60} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void finishRename(conversation); if (event.key === "Escape") setRenamingId(undefined); }} onBlur={() => void finishRename(conversation)} /></div> : <button className="conversation-main" onClick={() => onSelectConversation(conversation)}>
                <MessageCircleMore size={14} /><span><b>{conversation.title}</b><small>{conversation.publishedVersionId ? `已发布 v${conversation.publishedVersionNumber ?? 1}` : `草稿 · ${stageIndex + 1}/3`} · {pluginShortName(conversation.currentPluginId)}</small></span>
              </button>}
              <button className="conversation-rename-button" title="修改会话与分身版本名称" onClick={() => { setRenamingId(conversation.id); setRenameDraft(conversation.title); }}><Pencil size={12} /></button>
              <button className="conversation-delete" title="移到回收站" onClick={() => onArchiveConversation(conversation.id)}><Trash2 size={13} /></button>
            </div>;
          })}
        </div>
        <div className="trash-zone">
          <button className={trashOpen ? "trash-toggle open" : "trash-toggle"} onClick={() => setTrashOpen((value) => !value)}><Trash2 size={14} /><span>回收站</span><em>{trashedConversations.length}</em><ChevronDown size={13} /></button>
          {trashOpen && <div className="trash-list">
            {trashedConversations.map((conversation) => <div key={conversation.id}><span><b>{conversation.title}</b><small>{conversation.archivedAt ? formatSampleTime(conversation.archivedAt) : ""}</small></span><button title="恢复" onClick={() => onRestoreConversation(conversation.id)}><RotateCcw size={12} /></button><button title="彻底删除" onClick={() => void onPermanentlyDeleteConversation(conversation.id)}><X size={12} /></button></div>)}
            {!trashedConversations.length && <p>回收站为空</p>}
            {Boolean(trashedConversations.length) && <button className="empty-trash" onClick={() => void onEmptyTrash()}>清空回收站</button>}
          </div>}
        </div>
      </div>
      <nav>
        <span className="nav-label">分身系统</span>
        {NAV.filter((item) => item.id !== "identity").map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => setView(id)}>
            <Icon size={18} strokeWidth={1.7} /><span>{label}</span>{id === "dingtalk" && <i className="nav-ping" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-badge"><ShieldCheck size={15} /><span><b>本地优先</b><small>数据存储在此设备</small></span></div>
        <button className="nav-item" onClick={onOpenRuntimeSettings}><Settings2 size={18} /><span>设置</span><small className="nav-setting-value">{permissionLevelLabel(state.runtime.agent.accessLevel)}</small></button>
      </div>
    </aside>
  );
}

function EmployeeAvatar({ pluginId, compact = false }: { pluginId: AgentPluginId; compact?: boolean }) {
  const avatar = pluginId === "hr-keyboard" ? hrKeyboardAvatar : pluginId === "evidence-collector" ? evidenceCollectorAvatar : personaDistillerAvatar;
  const label = pluginId === "hr-keyboard" ? "HR 键盘" : pluginId === "evidence-collector" ? "数据采集师探针" : "人格蒸馏师琢玉";
  const tone = pluginId === "hr-keyboard" ? "hr" : pluginId === "evidence-collector" ? "collector" : "distiller";
  return <div className={`employee-avatar ${tone} ${compact ? "compact" : ""}`}><img src={avatar} alt={label} /><i /></div>;
}

function Topbar({ state, isDemo, onConfigureClaude, onConfigureRuntime, onOpenFolder, onToggleSidebar }: { state: BootstrapState; isDemo: boolean; onConfigureClaude: () => void; onConfigureRuntime: () => void; onOpenFolder: () => void; onToggleSidebar: () => void }) {
  const claudeReady = state.runtime.sdk && state.runtime.credentials;
  const provider = `${modelProviderDisplayName(state.runtime.modelProvider, state.runtime.modelProviderName)} · Agent SDK`;
  return (
    <header className="topbar">
      <button className="icon-button sidebar-toggle" onClick={onToggleSidebar}><PanelLeft size={18} /></button>
      <div className="crumb"><span>镜我</span><ChevronRight size={13} /><b>{state.profile?.name ? `${state.profile.name}的数字分身` : "开始认识你"}</b></div>
      <div className="topbar-actions">
        {isDemo && <span className="demo-pill">网页演示数据</span>}
        <button className="permission-pill" onClick={onConfigureRuntime} title="选择四级 Agent 权限模式"><ShieldCheck size={13} />{permissionLevelLabel(state.runtime.agent.accessLevel)}</button>
        <button className={claudeReady ? "runtime-pill good" : "runtime-pill needs-auth"} onClick={onConfigureClaude} title={claudeReady ? `${provider} 凭证已配置，点击可更换` : "点击配置模型提供方"}><i /> {provider} · {claudeReady ? "已配置" : "未连接"}</button>
        <button className="icon-button" onClick={onOpenFolder} title="打开本地人格档案"><FolderOpen size={17} /></button>
        <button className="icon-button"><MoreHorizontal size={18} /></button>
      </div>
    </header>
  );
}

function IdentityStudio({ state, busy, runtimeMessage, pluginId, conversation, onSelectPlugin, onConversationUpdate, onCompleteStage, onImportFiles, onImportFolder, onAgentChat, onChooseWorkspace, onInstallSkill, onRevealWorkspace, executionEvents, busyStartedAt, liveStream, accessLevel, onAccessLevelChange, onGoLab }: {
  state: BootstrapState;
  busy: string | null;
  runtimeMessage: string;
  pluginId: AgentPluginId;
  conversation: PersonaConversation;
  onSelectPlugin: (plugin: AgentPluginId) => void;
  onConversationUpdate: (patch: Partial<PersonaConversation>) => void;
  onCompleteStage: (stage: AgentPluginId) => void;
  onImportFiles: (target: "distill" | "knowledge") => Promise<void>;
  onImportFolder: (target: "distill" | "knowledge") => Promise<void>;
  onAgentChat: (surface: AgentSurface, prompt: string, sessionId?: string) => Promise<WorkbenchAgentReply | undefined>;
  onChooseWorkspace: () => Promise<void>;
  onInstallSkill: () => Promise<void>;
  onRevealWorkspace: () => Promise<void> | void;
  executionEvents: RuntimeEvent[];
  busyStartedAt?: number;
  liveStream: string;
  accessLevel: AgentAccessLevel;
  onAccessLevelChange: (accessLevel: AgentAccessLevel) => Promise<boolean>;
  onGoLab: () => void;
}) {
  const plugin = state.plugins.find((item) => item.id === pluginId) ?? state.plugins[0];
  const surface = plugin?.surface ?? "onboarding";
  const [turns, setTurns] = useState<AgentConversationTurn[]>([]);
  const [composer, setComposer] = useState("");
  const [sideOpen, setSideOpen] = useState(() => window.innerWidth > 1180);
  const [sideTab, setSideTab] = useState<"status" | "files">("status");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<{ title: string; content: string; kind: string } | null>(null);
  const [versionHarness, setVersionHarness] = useState<HarnessSnapshot>();
  const feedRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const uploadTriggerRef = useRef<HTMLButtonElement>(null);
  const onboardingPreflightStarted = useRef<string | undefined>(undefined);
  const loadedConversationId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const syncInspectorToViewport = () => {
      if (window.innerWidth <= 1180) setSideOpen(false);
    };
    syncInspectorToViewport();
    window.addEventListener("resize", syncInspectorToViewport);
    return () => window.removeEventListener("resize", syncInspectorToViewport);
  }, []);

  useEffect(() => {
    if (!uploadOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || uploadMenuRef.current?.contains(target) || uploadTriggerRef.current?.contains(target)) return;
      setUploadOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setUploadOpen(false);
      uploadTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [uploadOpen]);

  useEffect(() => {
    setUploadOpen(false);
  }, [conversation.id, pluginId]);

  useEffect(() => {
    let cancelled = false;
    if (loadedConversationId.current !== conversation.id) {
      loadedConversationId.current = conversation.id;
      setTurns([]);
    }
    void Promise.all((["hr-keyboard", "evidence-collector", "persona-distiller"] as AgentPluginId[]).map(async (stagePlugin) => {
      const stageSessionId = conversation.stageSessionIds[stagePlugin];
      const stageSurface = surfaceForPlugin(stagePlugin);
      const scoped = await bridge.loadAgentConversation(stageSurface, versionContextForConversation(conversation));
      if (scoped.length || !conversation.includeLegacyData || !stageSessionId) return scoped;
      return turnsForSdkSession(await bridge.loadAgentConversation(stageSurface), stageSessionId);
    })).then((groups) => {
      if (cancelled) return;
      const restored = groups.flat().filter((turn, index, all) => all.findIndex((item) => item.id === turn.id) === index).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setTurns(restored);

      const recoveredSessions = { ...conversation.stageSessionIds };
      let sessionsChanged = false;
      for (const stagePlugin of ["hr-keyboard", "evidence-collector", "persona-distiller"] as AgentPluginId[]) {
        if (recoveredSessions[stagePlugin]) continue;
        const stageSurface = surfaceForPlugin(stagePlugin);
        const recovered = [...restored].reverse().find((turn) => turn.surface === stageSurface && turn.sessionId)?.sessionId;
        if (!recovered) continue;
        recoveredSessions[stagePlugin] = recovered;
        sessionsChanged = true;
      }
      if (sessionsChanged) onConversationUpdate({ stageSessionIds: recoveredSessions });
    });
    return () => { cancelled = true; };
  }, [conversation.id, conversation.stageSessionIds, conversation.includeLegacyData, executionEvents.filter((event) => event.kind === "complete" || event.kind === "error").at(-1)?.at]);

  useEffect(() => {
    setVersionHarness(undefined);
    if (!conversation.publishedVersionId) return;
    void bridge.readTwinVersion(conversation.publishedVersionId, versionContextForConversation(conversation)).then(setVersionHarness);
  }, [conversation.id, conversation.publishedVersionId, state.versions]);

  useEffect(() => {
    if (!feedRef.current) return;
    if (!turns.length && !busy) {
      feedRef.current.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    feedRef.current.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (state.initialized || !state.runtime.credentials || pluginId !== "hr-keyboard" || onboardingPreflightStarted.current === conversation.id || conversation.stageSessionIds["hr-keyboard"]) return;
    onboardingPreflightStarted.current = conversation.id;
    void send("这是首次认识我。请先加载 HR 预检 Skill，只读盘点已有本地资料、选中的工作区、当前 DWS 身份和组织关系；先告诉我已经核验了什么，再只问一个信息增益最高的问题。不要使用固定问卷。");
  }, [state.initialized, state.runtime.credentials, pluginId, conversation.id]);

  const knowledgeSources = state.sources.filter((source) => source.kind === "workspace");
  const distillSources = state.sources.filter((source) => ["onboarding", "file", "dingtalk"].includes(source.kind));
  const pendingSources = distillSources.filter((source) => !versionHarness || new Date(source.importedAt) > new Date(versionHarness.updatedAt));
  const currentTwinVersion = state.versions.find((item) => item.id === conversation.publishedVersionId);
  const recoveredStageSessionId = [...turns].reverse().find((turn) => turn.surface === surface && turn.sessionId)?.sessionId;
  const stageSessionId = conversation.stageSessionIds[pluginId] ?? recoveredStageSessionId;
  const latestStageTurn = [...turns].reverse().find((turn) => turn.surface === surface);
  const persistedRunning = latestStageTurn?.role === "user" && latestStageTurn.executionStatus === "running";
  const interruptedTurn = latestStageTurn?.role === "user" && latestStageTurn.executionStatus === "interrupted" ? latestStageTurn : undefined;
  const stageRunning = Boolean(busy || persistedRunning);
  const quickPrompts: Record<AgentPluginId, string[]> = {
    "hr-keyboard": [
      "先盘点本地资料和当前 DWS 身份，告诉我你已经知道什么、还缺什么",
      "根据已有证据开始认识我，每次只问一个最值得问的问题",
      "检查我的基础画像里有哪些推断或冲突需要我确认",
    ],
    "evidence-collector": [
      "加载全量同步 Skill，一键盘点并同步我可访问的全部钉钉证据",
      "检查当前数据清单的完整性，列出缺口、失败范围和最优补充顺序",
      "把 @我、私聊问题和我的真实回复配对，保留上下文并输出清洗清单",
    ],
    "persona-distiller": [
      "先审计证据覆盖，再按多条件语言模型开始新一版人格蒸馏",
      "打开蒸馏 Skill，说明它如何从关系、语境、判断与符号习惯建模",
      "对当前人格版本做安全与不像本人风险审计，并给出回归测试",
    ],
  };
  const focusTask = pluginId === "hr-keyboard"
    ? { step: "01 · 认识本人", owner: "HR 键盘", title: "补齐一条最有信息增益的人格证据", detail: "键盘会先核验已有资料，再用题目卡片只问当前最值得确认的问题。", metric: `${state.profiles.length || (state.profile ? 1 : 0)} 份基础画像`, action: stageSessionId ? "继续动态访谈" : "开始证据预检" }
    : pluginId === "evidence-collector"
      ? { step: "02 · 建立证据", owner: "数据采集师 · 探针", title: state.workspace ? "盘点完整证据并补齐覆盖缺口" : "先选择本版本的独立工作区", detail: state.workspace ? "探针会自主读取本地工作区与 DWS，只保留可追溯、说话人明确的证据。" : "工作区决定本版本的本地采集范围与产物落盘位置，不会与其他分身串联。", metric: `${distillSources.length} 份蒸馏证据`, action: state.workspace ? "开始全量盘点" : "选择工作区" }
      : { step: "03 · 生成分身", owner: "人格蒸馏师 · 琢玉", title: pendingSources.length ? `把 ${pendingSources.length} 个新来源提炼进人格版本` : "审计证据并生成可发布的人格版本", detail: "琢玉会对关系、语境、表达、判断与拒绝边界分别建模，并生成可审阅的 Harness。", metric: versionHarness ? `可信度 ${Math.round(versionHarness.confidence * 100)}%` : `${distillSources.length} 份证据待建模`, action: versionHarness ? "审计并生成新版本" : "开始人格蒸馏" };

  async function send(text = composer) {
    const prompt = text.trim();
    if (!prompt || stageRunning) return;
    const optimistic: AgentConversationTurn = { id: crypto.randomUUID(), surface, sessionId: stageSessionId, operationId: crypto.randomUUID(), executionStatus: "running", role: "user", content: prompt, createdAt: new Date().toISOString() };
    setTurns((items) => [...items, optimistic]);
    setComposer("");
    const result = await onAgentChat(surface, prompt, stageSessionId);
    if (!result) return;
    const failed = result.content.startsWith("本轮没有完成：");
    const reply: AgentConversationTurn = { id: crypto.randomUUID(), surface, sessionId: result.sessionId, operationId: optimistic.operationId, executionStatus: failed ? "failed" : "completed", role: "agent", content: result.content, createdAt: new Date().toISOString(), steps: result.steps, questionCard: result.questionCard, durationMs: result.durationMs, stageCheckpoint: result.stageCheckpoint };
    setTurns((items) => [...items.map((item) => item.id === optimistic.id ? { ...item, executionStatus: failed ? "failed" as const : "completed" as const } : item), reply]);
    onConversationUpdate({
      stageSessionIds: { ...conversation.stageSessionIds, [pluginId]: result.sessionId },
      currentPluginId: pluginId,
      stageCheckpoints: result.stageCheckpoint ? { ...conversation.stageCheckpoints, [pluginId]: result.stageCheckpoint } : conversation.stageCheckpoints,
      title: ["新建人格会话", "新建分身版本"].includes(conversation.title) ? compactTitle(prompt) : conversation.title,
    });
  }

  function fillPrompt(prompt: string) {
    setComposer(prompt);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function openHarness(key: HarnessTab) {
    if (!versionHarness) return;
    const labels: Record<HarnessTab, string> = { claude: "CLAUDE.md", soul: "SOUL.md", memory: "MEMORY.md", user: "USER.md", style: "STYLE.md", qa: "Q&A.md" };
    setPreview({ title: labels[key], content: versionHarness[key], kind: `分身版本 v${currentTwinVersion?.version ?? 1}` });
  }

  async function openSkill(name: string) {
    const skill = await bridge.readSkill(name);
    setPreview({ title: `${name}/SKILL.md`, content: skill.content ?? skill.description, kind: `Skill v${skill.version}` });
  }

  async function openSource(sourceId: string) {
    try {
      const source = await bridge.previewSource(sourceId, versionContextForConversation(conversation));
      setPreview({ title: source.title, content: `${source.logicalPath}\n\n${source.content}${source.truncated ? "\n\n（预览已截断；原文件仍完整保存在本地。）" : ""}`, kind: "本地资料预览" });
    } catch (error) {
      setPreview({ title: "暂时无法预览", content: error instanceof Error ? error.message : String(error), kind: "本地资料" });
    }
  }

  return <div className={`identity-studio ${sideOpen ? "side-open" : "side-closed"}`}>
    <header className="studio-statusbar">
      <div className="studio-title"><span>人格构建工作台</span><b>{state.profile?.name || "待认识的你"}</b><em>/</em><strong>{conversation.title}</strong></div>
      <div className="distill-live">
        <span className={pendingSources.length ? "pulse hot" : "pulse"} />
        <div><small>{pendingSources.length ? "发现新证据" : versionHarness ? `分身版本 v${currentTwinVersion?.version ?? 1}` : "版本草稿"}</small><b>{pendingSources.length ? `${pendingSources.length} 个来源尚未进入本版本` : versionHarness ? `可信度 ${Math.round(versionHarness.confidence * 100)}% · 已发布` : "从 HR 键盘开始构建"}</b></div>
      </div>
      <button className="icon-button" onClick={() => setSideOpen((value) => !value)} aria-label="切换资料侧栏">{sideOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>
    </header>

    <div className="studio-rolebar">
      {state.plugins.map((item, index) => {
        const status = conversationStageStatus(item.id, conversation.stageSessionIds, conversation.completedStages);
        const stageLabel = status === "done" ? "已交接" : conversation.stageSessionIds[item.id] ? "进行中" : "待开始";
        const unlocked = item.id === "hr-keyboard"
          || (item.id === "evidence-collector" && conversation.completedStages?.includes("hr-keyboard"))
          || (item.id === "persona-distiller" && conversation.completedStages?.includes("evidence-collector"));
        return <button key={item.id} disabled={!unlocked} title={unlocked ? undefined : "请先完成前一阶段的验收与交接"} className={pluginId === item.id ? `role-chip ${item.accent} active ${status}` : `role-chip ${item.accent} ${status} ${unlocked ? "" : "locked"}`} onClick={() => onSelectPlugin(item.id)}><span className="stage-order">0{index + 1}</span><EmployeeAvatar pluginId={item.id} compact /><span><b>{item.name}</b><small>{unlocked ? stageLabel : "前置阶段未交接"}</small></span>{status === "done" ? <Check size={13} /> : pluginId === item.id && <i />}</button>;
      })}
      <div className="runtime-capabilities"><span><Sparkles size={13} />Claude Agent SDK</span><span><BookOpen size={13} />{plugin?.skills.length ?? 0} Skills</span><span><Link2 size={13} />MCP</span><span><Radio size={13} />DWS CLI</span></div>
    </div>

    <section className="studio-conversation">
      <div className="conversation-feed" ref={feedRef}>
        <section className={`stage-focus-card ${pluginId}`}>
          <div className="stage-focus-person"><EmployeeAvatar pluginId={pluginId} /><span><small>{focusTask.step}</small><b>{focusTask.owner}</b></span></div>
          <div className="stage-focus-copy"><span>当前核心任务</span><h2>{focusTask.title}</h2><p>{focusTask.detail}</p><div><em>{focusTask.metric}</em><em>{stageSessionId ? "阶段已启动" : "等待开始"}</em></div></div>
          <button onClick={() => pluginId === "evidence-collector" && !state.workspace ? void onChooseWorkspace() : fillPrompt(quickPrompts[pluginId][0])}>{focusTask.action}<ArrowRight size={16} /></button>
        </section>
        {turns.length === 0 && <div className="employee-welcome">
          <EmployeeAvatar pluginId={pluginId} />
          <span className="welcome-kicker">{plugin?.role}</span>
          <h1>{plugin?.name}，已经到岗。</h1>
          <p>{plugin?.description}</p>
          {!stageSessionId && <div className="conversation-scope-note"><span>当前版本分支</span><b>本阶段尚未执行</b><small>新建分支从空白开始；资料、知识库、工作区、阶段进度与 Harness 都只属于这个分身版本。</small></div>}
          <div className="plugin-contract"><span>PLUGIN</span><b>{plugin?.name}</b><i />{plugin?.skills.map((skill) => <button key={skill} onClick={() => void openSkill(skill)}>{skill}</button>)}</div>
          <div className="suggestion-grid">{quickPrompts[pluginId].map((prompt, index) => <button key={prompt} onClick={() => fillPrompt(prompt)}><span>0{index + 1}</span><p>{prompt}</p><ArrowRight size={15} /></button>)}</div>
        </div>}
        {turns.map((turn, index) => <StudioTurn key={turn.id} turn={turn} answered={Boolean(turn.questionCard && turns.slice(index + 1).some((item) => item.role === "user"))} onAnswer={(answer) => void send(answer)} />)}
        {interruptedTurn && <div className="execution-recovery"><CircleAlert size={17} /><span><b>上一次任务没有正常结束，但没有丢失</b><small>请求和已写入本版本工作区的产物仍保留在本机。可能是应用重启、页面刷新或 SDK 进程中断；你可以继续原任务，Agent 会先盘点已有检查点再补做。</small></span><button onClick={() => fillPrompt(`继续上一次未完成的数据采集任务。原请求是：${interruptedTurn.content}\n请先检查已经落盘的产物和清单，从最后一个可靠检查点继续，不要重复已经完成的部分。`)}>从检查点继续</button></div>}
        {turns.length > 0 && !stageSessionId && <div className="stage-entry-card"><EmployeeAvatar pluginId={pluginId} compact /><span><b>进入{plugin?.name}</b><small>{plugin?.description}</small></span><div>{quickPrompts[pluginId].map((prompt) => <button key={prompt} onClick={() => fillPrompt(prompt)}>{prompt}<ArrowRight size={13} /></button>)}</div></div>}
        {stageRunning && <LiveAgentExecution pluginId={pluginId} runtimeMessage={busy ? runtimeMessage : "已从本机恢复正在执行的任务；等待 Agent 返回终态"} events={executionEvents} startedAt={busyStartedAt ?? (latestStageTurn ? new Date(latestStageTurn.createdAt).getTime() : undefined)} streamText={liveStream} />}
        {!stageRunning && <StageHandoff pluginId={pluginId} stageSessionId={stageSessionId} checkpoint={conversation.stageCheckpoints?.[pluginId]} stageCompleted={Boolean(conversation.completedStages?.includes(pluginId))} onRequestCheck={() => fillPrompt("请检查本阶段的数据、证据和产物是否满足交接标准；逐项说明通过与缺口，并调用 mark_stage_checkpoint 记录正式检查点。")} onCompleteStage={onCompleteStage} onSelectPlugin={onSelectPlugin} onGoLab={onGoLab} />}
      </div>

      <div className="studio-composer-wrap">
        {pluginId === "evidence-collector" && <div className={state.workspace ? "workspace-scope-card selected" : "workspace-scope-card"}><FolderOpen size={15} /><span><b>{state.workspace ? `本版本工作区：${state.workspace.name}` : "本版本尚未选择工作区"}</b><small>{state.workspace ? state.workspace.path : "先选择一个稳定目录，数据采集师会在该范围内只读盘点本地资料，并把本版本产物分开保存。"}</small></span>{state.workspace ? <button onClick={() => void onRevealWorkspace()}>打开</button> : <button onClick={() => void onChooseWorkspace()}>选择工作区</button>}</div>}
        <div className="floating-assets">
          <button onClick={() => { setSideOpen(true); setSideTab("files"); }}><Archive size={14} /><span>{distillSources.length} 份蒸馏源</span></button>
          <button onClick={() => { setSideOpen(true); setSideTab("files"); }}><BookOpen size={14} /><span>{knowledgeSources.length} 份知识</span></button>
          <button onClick={() => void onRevealWorkspace()}><FolderOpen size={14} /><span>{state.workspace?.name || "人格工作区"}</span></button>
        </div>
        {uploadOpen && <div className="upload-menu" id="studio-upload-menu" ref={uploadMenuRef} role="menu" aria-label="本地上传">
          <header><b>本地上传</b><small>先选择用途，再选择文件或文件夹</small></header>
          <div className="upload-purpose"><span><WandSparkles size={16} /><b>加入蒸馏资料</b><small>用于身份、风格与判断建模</small></span><div><button onClick={() => { setUploadOpen(false); void onImportFiles("distill"); }}><Upload size={14} />选择文件</button><button onClick={() => { setUploadOpen(false); void onImportFolder("distill"); }}><FolderOpen size={14} />选择文件夹</button></div></div>
          <div className="upload-purpose"><span><BookOpen size={16} /><b>加入知识库</b><small>按需读取，不自动改变人格</small></span><div><button onClick={() => { setUploadOpen(false); void onImportFiles("knowledge"); }}><Files size={14} />选择文件</button><button onClick={() => { setUploadOpen(false); void onImportFolder("knowledge"); }}><FolderOpen size={14} />选择文件夹</button></div></div>
        </div>}
        <div className="studio-composer">
          <textarea ref={composerRef} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={stageRunning ? `${plugin?.name}正在执行，任务记录已落盘…` : `交给${plugin?.name}：描述目标，它会自行加载 Skill、使用 MCP / DWS / 本地工作区…`} disabled={stageRunning} rows={3} />
          <footer><div><button ref={uploadTriggerRef} className="composer-plus" onClick={() => setUploadOpen((value) => !value)} aria-label="添加本地资料" aria-haspopup="menu" aria-controls="studio-upload-menu" aria-expanded={uploadOpen}><Plus size={18} /></button><button onClick={() => void onChooseWorkspace()}><FolderOpen size={15} />选择工作区</button><button onClick={() => void onInstallSkill()}><Sparkles size={15} />安装 Skill</button><PermissionControl level={accessLevel} onChange={onAccessLevelChange} compact /></div><button className="composer-send" onClick={() => void send()} disabled={!composer.trim() || stageRunning}>{stageRunning ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={18} />}</button></footer>
        </div>
        <small className="composer-disclaimer">Agent 会展示真实工具与 Skill 调用结果；高影响写入前仍需确认。</small>
      </div>
    </section>

    {sideOpen && <aside className="studio-inspector">
      <header><div><button className={sideTab === "status" ? "active" : ""} onClick={() => setSideTab("status")}>状态</button><button className={sideTab === "files" ? "active" : ""} onClick={() => setSideTab("files")}>资料</button></div><button onClick={() => setSideOpen(false)}><X size={16} /></button></header>
        {preview ? <div className="artifact-preview"><div className="preview-head"><button onClick={() => setPreview(null)}>← 返回</button><span>{preview.kind}</span></div><h3>{preview.title}</h3><pre>{preview.content}</pre></div> : sideTab === "status" ? <StudioStatus state={state} plugin={plugin} pendingSources={pendingSources.length} harness={versionHarness} version={currentTwinVersion} onOpenHarness={openHarness} onOpenSkill={openSkill} /> : <StudioFiles state={state} harness={versionHarness} onOpenHarness={openHarness} onOpenSource={openSource} onRevealWorkspace={onRevealWorkspace} />}
    </aside>}
  </div>;
}

function StudioTurn({ turn, answered, onAnswer }: { turn: AgentConversationTurn; answered: boolean; onAnswer: (answer: string) => void }) {
  const [showSteps, setShowSteps] = useState(false);
  const turnPlugin = pluginForSurface(turn.surface);
  if (turn.role === "user") return <article className={`studio-turn user ${turn.executionStatus ?? ""}`}><div><small>你{turn.executionStatus === "running" ? " · 任务执行中" : turn.executionStatus === "interrupted" ? " · 任务已中断，输入已保留" : ""}</small><p>{turn.content}</p></div></article>;
  return <article className="studio-turn agent"><EmployeeAvatar pluginId={turnPlugin} compact /><div><small>{pluginShortName(turnPlugin)} · {formatClock(turn.createdAt)}{turn.durationMs ? ` · ${formatDuration(turn.durationMs)}` : ""}</small><p>{turn.content}</p>{turn.questionCard && <OnboardingQuestionCardView card={turn.questionCard} answered={answered} onAnswer={onAnswer} />}{turn.steps?.length ? <div className="turn-trace"><button onClick={() => setShowSteps((value) => !value)}><ListChecks size={14} />完整执行记录 · {turn.steps.length} 项<ChevronDown size={13} /></button>{showSteps && <div>{turn.steps.map((step) => <span key={step.id} className={step.status}><i />{step.title}<small>{formatClock(step.createdAt)}{step.durationMs !== undefined ? ` · ${formatDuration(step.durationMs)}` : ""}{step.detail ? ` · ${step.detail}` : ""}</small></span>)}</div>}</div> : null}</div></article>;
}

function OnboardingQuestionCardView({ card, answered, onAnswer }: { card: NonNullable<AgentConversationTurn["questionCard"]>; answered: boolean; onAnswer: (answer: string) => void }) {
  const [selected, setSelected] = useState<string[]>(() => card.options.filter((option) => option.suggested).map((option) => option.id));
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const toggle = (id: string) => setSelected((items) => card.multiSelect ? (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]) : [id]);
  const submit = () => {
    const labels = card.options.filter((item) => selected.includes(item.id)).map((item) => item.label);
    const answer = [labels.join("；"), custom.trim()].filter(Boolean).join("；补充：");
    if (!answer) return;
    onAnswer(`针对题目「${card.question}」，我的回答是：${answer}`);
  };
  return <section className={answered ? "onboarding-question-card answered" : "onboarding-question-card"}>
    <header><span>ADAPTIVE QUESTION{card.module ? ` · ${onboardingModuleName(card.module)}` : ""}</span><em>{card.multiSelect ? "可多选" : "单选"}</em></header>
    <h3>{card.question}</h3>
    {card.context && <p>{card.context}</p>}
    {card.sourceNote && <div className="question-source-note"><Sparkles size={13} /><span><b>已有证据提示</b>{card.sourceNote}</span></div>}
    <div className="question-options">{card.options.map((option, index) => <button key={option.id} className={selected.includes(option.id) ? "selected" : ""} disabled={answered} onClick={() => toggle(option.id)}><i>{String.fromCharCode(65 + index)}</i><span><b>{option.label}{option.suggested && <em>预选</em>}</b>{option.description && <small>{option.description}</small>}</span><em>{selected.includes(option.id) ? <Check size={13} /> : null}</em></button>)}</div>
    {card.allowFreeText && <div className="question-custom">{customOpen ? <textarea value={custom} disabled={answered} onChange={(event) => setCustom(event.target.value)} placeholder="用你自己的方式补充，或写一个选项里没有的答案…" rows={2} /> : <button disabled={answered} onClick={() => setCustomOpen(true)}>都不完全符合，我自己补充</button>}</div>}
    <footer><span>{answered ? "已回答 · HR 会基于新证据继续动态出题" : "选项来自本轮证据缺口，不是固定问卷"}</span><button disabled={answered || (!selected.length && !custom.trim())} onClick={submit}>{answered ? "已提交" : "提交回答"}<ArrowRight size={14} /></button></footer>
  </section>;
}

function onboardingModuleName(module: NonNullable<AgentConversationTurn["questionCard"]>["module"]) {
  return ({ work_context: "工作情境", collaboration: "协作偏好", energy: "能量与阻力", response: "回答方式", decision: "决策习惯", relationship: "关系语境", boundary: "边界与拒绝", language: "真实表达" } as const)[module ?? "work_context"];
}

function LiveAgentExecution({ pluginId, runtimeMessage, events, startedAt, streamText }: { pluginId: AgentPluginId; runtimeMessage: string; events: RuntimeEvent[]; startedAt?: number; streamText: string }) {
  const elapsed = useElapsed(startedAt);
  return <div className="live-agent-execution"><header><EmployeeAvatar pluginId={pluginId} compact /><div><b>{pluginShortName(pluginId)}正在执行</b><span><Timer size={12} />{formatDuration(elapsed)}</span></div><i className="live-pulse" /></header>{streamText && <p className="stream-preview">{streamText}</p>}<div className="live-log">{events.filter((event) => event.kind !== "text_delta").slice(-6).map((event, index) => <span key={`${event.at}-${index}`}><small>{formatClock(event.at)}</small><i /><b>{event.message}</b></span>)}</div><footer><LoaderCircle className="spin" size={13} />{runtimeMessage}</footer></div>;
}

function StageHandoff({ pluginId, stageSessionId, checkpoint, stageCompleted, onRequestCheck, onCompleteStage, onSelectPlugin, onGoLab }: { pluginId: AgentPluginId; stageSessionId?: string; checkpoint?: AgentStageCheckpoint; stageCompleted: boolean; onRequestCheck: () => void; onCompleteStage: (stage: AgentPluginId) => void; onSelectPlugin: (plugin: AgentPluginId) => void; onGoLab: () => void }) {
  if (!stageSessionId || stageCompleted) return null;
  if (!checkpoint || checkpoint.status !== "ready") return <div className="stage-handoff waiting"><CircleAlert size={16} /><span><b>{checkpoint ? "阶段检查发现缺口" : "尚未完成阶段验收"}</b><small>{checkpoint?.summary || "有对话结果不等于阶段完成。让当前 Agent 检查真实产物并写入正式检查点后，才会开放交接。"}</small>{checkpoint?.checks.filter((item) => item.status !== "pass").slice(0, 3).map((item) => <em key={item.label}>{item.label}{item.detail ? `：${item.detail}` : ""}</em>)}</span><button onClick={onRequestCheck}>检查是否可交接<ArrowRight size={14} /></button></div>;
  if (pluginId === "hr-keyboard") return <div className="stage-handoff"><Check size={16} /><span><b>HR 阶段验收通过</b><small>{checkpoint.summary}</small></span><button onClick={() => { onCompleteStage(pluginId); onSelectPlugin("evidence-collector"); }}>交给探针采集证据<ArrowRight size={14} /></button></div>;
  if (pluginId === "evidence-collector") return <div className="stage-handoff"><Check size={16} /><span><b>数据采集阶段验收通过</b><small>{checkpoint.summary}</small></span><button onClick={() => { onCompleteStage(pluginId); onSelectPlugin("persona-distiller"); }}>交给琢玉蒸馏人格<ArrowRight size={14} /></button></div>;
  if (pluginId === "persona-distiller") return <div className="stage-handoff complete"><Check size={16} /><span><b>人格版本已提交并通过检查</b><small>{checkpoint.summary}</small></span><button onClick={() => { onCompleteStage(pluginId); onGoLab(); }}>进入对话实验室<ArrowRight size={14} /></button></div>;
  return null;
}

function StudioStatus({ state, plugin, pendingSources, harness, version, onOpenHarness, onOpenSkill }: { state: BootstrapState; plugin: BootstrapState["plugins"][number] | undefined; pendingSources: number; harness?: HarnessSnapshot; version?: BootstrapState["versions"][number]; onOpenHarness: (key: HarnessTab) => void; onOpenSkill: (name: string) => void }) {
  const pluginSkills = state.skills.filter((skill) => plugin?.skills.includes(skill.name));
  return <div className="inspector-content">
    <section className="status-card feature"><span>TWIN VERSION · {harness ? `v${version?.version ?? 1}` : "DRAFT"}</span><h3>{harness ? `当前分身版本 · ${pendingSources ? "有新证据" : "已发布"}` : state.initialized ? "独立版本正在构建" : "等待认识你"}</h3><p>{harness ? `${pendingSources ? `${pendingSources} 个新来源尚未进入本版本。` : "本版本已形成独立 Harness。"}共享证据不会覆盖已发布快照。` : "HR、采集和蒸馏进度都归属于当前版本；完成蒸馏后才能绑定到钉钉机器人。"}</p><div className="coverage-meter"><i style={{ width: `${harness ? Math.max(12, harness.confidence * 100) : 8}%` }} /></div></section>
    <section><div className="inspector-section-title"><b>本版本人格落档</b><span>{harness ? "6 / 6" : "0 / 6"}</span></div><div className="file-grid">{(["claude", "soul", "user", "memory", "style", "qa"] as HarnessTab[]).map((key) => <button key={key} disabled={!harness} onClick={() => onOpenHarness(key)}><FileText size={15} /><span>{key === "qa" ? "Q&A" : key.toUpperCase()}.md</span><i className={harness ? "ready" : ""} /></button>)}</div></section>
    <section><div className="inspector-section-title"><b>当前 Plugin Skills</b><span>{pluginSkills.length} / {plugin?.skills.length ?? 0} 已安装</span></div><div className="skill-stack">{pluginSkills.map((skill) => <button key={skill.name} onClick={() => void onOpenSkill(skill.name)}><Sparkles size={14} /><span><b>{skill.name}</b><small>v{skill.version} · {skill.builtin ? "内置" : "已安装"}</small></span><ChevronRight size={14} /></button>)}{!pluginSkills.length && <p className="empty-copy">重启应用后会安装该 Plugin 的内置 Skills。</p>}</div></section>
  </div>;
}

function StudioFiles({ state, harness, onOpenHarness, onOpenSource, onRevealWorkspace }: { state: BootstrapState; harness?: HarnessSnapshot; onOpenHarness: (key: HarnessTab) => void; onOpenSource: (sourceId: string) => Promise<void>; onRevealWorkspace: () => Promise<void> | void }) {
  const evidence = state.sources.filter((source) => ["onboarding", "file", "dingtalk"].includes(source.kind));
  const knowledge = state.sources.filter((source) => source.kind === "workspace");
  const evidenceItems = evidence.reduce((sum, source) => sum + source.itemCount, 0);
  const knowledgeItems = knowledge.reduce((sum, source) => sum + source.itemCount, 0);
  const totalBytes = state.sources.reduce((sum, source) => sum + source.bytes, 0);
  const latestImport = [...state.sources].sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];
  return <div className="inspector-content file-browser">
    <section className="library-overview"><div><span>全部内容</span><b>{(evidenceItems + knowledgeItems).toLocaleString()}</b><small>{state.sources.length} 个来源</small></div><div><span>蒸馏证据</span><b>{evidenceItems.toLocaleString()}</b><small>{evidence.length} 个来源</small></div><div><span>按需知识</span><b>{knowledgeItems.toLocaleString()}</b><small>{knowledge.length} 个来源</small></div><footer><span>{formatBytes(totalBytes)} 本地占用</span><span>最近更新 {latestImport ? formatSampleTime(latestImport.importedAt) : "—"}</span></footer></section>
    {state.dwsEvidence && <section className="dws-library-detail"><div className="inspector-section-title"><b>DWS 证据覆盖</b><span>{state.dwsEvidence.conversations} 个会话</span></div><div><span><b>{state.dwsEvidence.authoredMessages.toLocaleString()}</b><small>本人原话</small></span><span><b>{state.dwsEvidence.qaPairs.toLocaleString()}</b><small>问答配对</small></span><span><b>{state.dwsEvidence.contextMessages.toLocaleString()}</b><small>上下文</small></span></div><p>{state.dwsEvidence.start} — {state.dwsEvidence.end}</p></section>}
    <section><div className="inspector-section-title"><b>本地资料库 · 蒸馏源</b><span>{evidence.length} 个来源 / {evidenceItems.toLocaleString()} 项</span></div>{evidence.length ? evidence.map((source) => <button className="source-row detailed" key={source.id} onClick={() => void onOpenSource(source.id)}><Archive size={15} /><span><b>{source.name}</b><small>{source.detail || "本地证据"}</small><em>{source.itemCount.toLocaleString()} 项 · {formatBytes(source.bytes)} · {formatSampleTime(source.importedAt)}</em></span><i className={source.status} /></button>) : <p className="empty-copy">还没有蒸馏证据。</p>}</section>
    <section><div className="inspector-section-title"><b>知识库 · 按需参考</b><button onClick={() => void onRevealWorkspace()}>打开目录</button></div>{knowledge.length ? knowledge.map((source) => <button className="source-row detailed" key={source.id} onClick={() => void onOpenSource(source.id)}><BookOpen size={15} /><span><b>{source.name}</b><small>{source.detail || "Claude Agent SDK 按需读取"}</small><em>{source.itemCount.toLocaleString()} 项 · {formatBytes(source.bytes)} · 不参与自动蒸馏</em></span><i className="ready" /></button>) : <p className="empty-copy">知识库独立于人格文件，回答相关问题时按需读取。</p>}</section>
    {harness && <section><div className="inspector-section-title"><b>本版本快速预览</b><span>Markdown</span></div><div className="preview-links"><button onClick={() => onOpenHarness("claude")}>CLAUDE.md</button><button onClick={() => onOpenHarness("style")}>STYLE.md</button><button onClick={() => onOpenHarness("qa")}>Q&A.md</button></div></section>}
  </div>;
}

function turnsForSdkSession(turns: AgentConversationTurn[], sdkSessionId: string): AgentConversationTurn[] {
  const selected: AgentConversationTurn[] = [];
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const next = turns[index + 1];
    if (turn.sessionId === sdkSessionId || (turn.role === "user" && next?.role === "agent" && next.sessionId === sdkSessionId)) selected.push(turn);
  }
  return selected;
}

function compactTitle(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 18 ? `${clean.slice(0, 18)}…` : clean;
}

function compactIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 22) return normalized;
  return `${normalized.slice(0, 10)}…${normalized.slice(-8)}`;
}

function dingTalkRobotIdUi(group: DingTalkConfig["groups"][number]): string {
  return group.robotId || (group.gatewayType === "webhook" ? `webhook:${group.id}` : "enterprise-stream-primary");
}

function createDraftConversation(): PersonaConversation {
  const id = crypto.randomUUID();
  return { id, personaId: "primary", versionBranchId: id, currentPluginId: "hr-keyboard", stageSessionIds: {}, completedStages: [], title: "新建分身版本", updatedAt: new Date().toISOString(), includeLegacyData: false };
}

function loadPersonaConversations(): PersonaConversation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("mirror-persona-conversations-v3") ?? "[]") as PersonaConversation[];
    if (Array.isArray(parsed) && parsed.length) return parsed.map(normalizePersonaConversation);
  } catch { /* use defaults */ }
  try {
    const legacy = JSON.parse(localStorage.getItem("mirror-persona-sessions-v2") ?? "[]") as Array<{ pluginId: AgentPluginId; sdkSessionId?: string; updatedAt: string }>;
    if (Array.isArray(legacy) && legacy.length) {
      const latest = (pluginId: AgentPluginId) => legacy.filter((item) => item.pluginId === pluginId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.sdkSessionId;
      return [{
        id: crypto.randomUUID(), personaId: "primary", versionBranchId: crypto.randomUUID(), title: "我的数字分身构建", currentPluginId: "hr-keyboard",
        stageSessionIds: { "hr-keyboard": latest("hr-keyboard"), "evidence-collector": latest("evidence-collector"), "persona-distiller": latest("persona-distiller") }, completedStages: [],
        updatedAt: new Date().toISOString(), includeLegacyData: true,
      }];
    }
  } catch { /* use defaults */ }
  const now = new Date().toISOString();
  return [{ id: "persona-build-welcome", personaId: "primary", versionBranchId: "persona-build-welcome", title: "我的第一版数字分身", currentPluginId: "hr-keyboard", stageSessionIds: {}, completedStages: [], updatedAt: now, includeLegacyData: true }];
}

function normalizePersonaConversation(conversation: PersonaConversation): PersonaConversation {
  return {
    ...conversation,
    versionBranchId: conversation.versionBranchId || conversation.id,
    stageSessionIds: conversation.stageSessionIds ?? {},
    completedStages: Array.isArray(conversation.completedStages) ? conversation.completedStages : [],
    stageCheckpoints: conversation.stageCheckpoints ?? {},
    includeLegacyData: conversation.includeLegacyData ?? true,
  };
}

function conversationSessionIds(conversation: PersonaConversation): string[] {
  return [...new Set([...Object.values(conversation.stageSessionIds), conversation.labSessionId, conversation.calibrationSessionId].filter((value): value is string => Boolean(value)))];
}

function versionContextForConversation(conversation: PersonaConversation): WorkbenchVersionContext {
  return {
    personaId: conversation.personaId,
    branchId: conversation.versionBranchId,
    branchName: conversation.title,
    twinVersionId: conversation.publishedVersionId,
    includeLegacyData: conversation.includeLegacyData,
  };
}

function versionContextForArtifact(version: ArtifactVersion, conversations: PersonaConversation[]): WorkbenchVersionContext {
  const owner = conversations.find((item) => item.versionBranchId === version.branchId)
    ?? conversations.find((item) => item.publishedVersionId === version.id);
  return {
    personaId: version.personaId || owner?.personaId || "primary",
    branchId: version.branchId || owner?.versionBranchId || "legacy",
    branchName: owner?.title || version.note?.split(" · ")[0] || version.name,
    twinVersionId: version.id,
    includeLegacyData: !version.branchId || owner?.includeLegacyData,
  };
}

function versionLabel(version: ArtifactVersion, conversations: PersonaConversation[]): string {
  const owner = conversations.find((item) => item.versionBranchId === version.branchId)
    ?? conversations.find((item) => item.publishedVersionId === version.id);
  return `${owner?.title || version.note?.split(" · ")[0] || version.name} · v${version.version}`;
}

function scopeBootstrapState(state: BootstrapState, conversation: PersonaConversation, harness?: HarnessSnapshot): BootstrapState {
  const sources = state.sources.filter((source) => (source.personaId === conversation.personaId && source.branchId === conversation.versionBranchId)
    || Boolean(conversation.includeLegacyData && !source.branchId));
  const selectedWorkspace = state.workspaces.find((item) => item.personaId === conversation.personaId && item.branchId === conversation.versionBranchId);
  const selectedProfile = state.profiles.find((item) => item.personaId === conversation.personaId && item.branchId === conversation.versionBranchId)?.profile;
  const evaluationStats = conversation.publishedVersionId ? state.evaluationStatsByTwinVersion[conversation.publishedVersionId] : undefined;
  const episodicStats = conversation.publishedVersionId ? state.episodicStatsByTwinVersion[conversation.publishedVersionId] : undefined;
  const memoryUsage = memoryUsageFromContent(harness?.memory ?? "", 2_200);
  const userUsage = memoryUsageFromContent(harness?.user ?? "", 1_375);
  return {
    ...state,
    sources,
    profiles: selectedProfile ? state.profiles.filter((item) => item.personaId === conversation.personaId && item.branchId === conversation.versionBranchId) : [],
    workspaces: selectedWorkspace ? [selectedWorkspace] : [],
    versions: state.versions.filter((version) => version.kind !== "twin" || (version.personaId === conversation.personaId && version.branchId === conversation.versionBranchId) || Boolean(conversation.includeLegacyData && !version.branchId)),
    profile: selectedProfile ?? (conversation.includeLegacyData ? state.profile : undefined),
    initialized: Boolean(selectedProfile || (conversation.includeLegacyData && state.profile)),
    harness,
    memoryCount: memoryUsage.entries + userUsage.entries,
    memoryCore: {
      ...state.memoryCore,
      memory: memoryUsage,
      user: userUsage,
      episodicSessions: conversation.includeLegacyData ? state.memoryCore.episodicSessions : episodicStats?.episodicSessions ?? 0,
      episodicMessages: conversation.includeLegacyData ? state.memoryCore.episodicMessages : episodicStats?.episodicMessages ?? 0,
    },
    workspace: selectedWorkspace ? { path: selectedWorkspace.path, name: selectedWorkspace.name } : conversation.includeLegacyData ? state.workspace : undefined,
    evaluationCount: evaluationStats?.total ?? 0,
    pendingEvaluationCount: evaluationStats?.pending ?? 0,
    feedbackCount: conversation.includeLegacyData ? state.feedbackCount : state.feedbackStatsByBranch[conversation.versionBranchId] ?? 0,
    dwsEvidence: conversation.includeLegacyData ? state.dwsEvidence : undefined,
  };
}

function memoryUsageFromContent(content: string, limit: number) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  return {
    used: normalized.length,
    limit,
    percent: Math.min(100, Math.round((normalized.length / limit) * 100)),
    entries: normalized ? normalized.split(/\n\s*§\s*\n/g).filter(Boolean).length : 0,
  };
}

function pluginForSurface(surface: AgentSurface): AgentPluginId {
  return surface === "source" ? "evidence-collector" : surface === "distill" ? "persona-distiller" : "hr-keyboard";
}

function surfaceForPlugin(pluginId: AgentPluginId): Exclude<AgentSurface, "calibration"> {
  return pluginId === "evidence-collector" ? "source" : pluginId === "persona-distiller" ? "distill" : "onboarding";
}

function pluginShortName(pluginId: AgentPluginId): string {
  return pluginId === "hr-keyboard" ? "HR 键盘" : pluginId === "evidence-collector" ? "探针 · 数据采集师" : "琢玉 · 人格蒸馏师";
}

function formatClock(value?: string): string {
  if (!value) return "--:--:--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDuration(value: number): string {
  if (value < 1000) return `${Math.max(0.1, value / 1000).toFixed(1)} 秒`;
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(value: number): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function fileToVisualBuffer(file: File): Promise<VisualAttachmentBuffer> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return { name: file.name || `clipboard-${Date.now()}.png`, mimeType: file.type || "image/png", base64: btoa(binary) };
}

function useElapsed(startedAt?: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt ? Math.max(0, now - startedAt) : 0;
}

function Overview({ state, go }: { state: BootstrapState; go: (view: View) => void }) {
  const score = Math.round((state.harness?.confidence ?? 0.18) * 100);
  const dws = state.dwsEvidence;
  return (
    <div className="page overview-page page-enter">
      <PageTitle eyebrow="DIGITAL SELF / 001" title={state.profile?.name ? `早上好，${state.profile.name}` : "先让它认识你"} subtitle={state.initialized ? "你的数字分身正在形成稳定的判断与表达模式。" : "HR 键盘会先读取已有证据，再通过自然对话补齐关键画像。"} action={<button className="outline-button" onClick={() => go(state.initialized ? "lab" : "identity")}><Play size={15} fill="currentColor" />{state.initialized ? "开始对话测试" : "开始 Onboarding"}</button>} />
      <section className="hero-grid">
        <div className="portrait-panel">
          <div className="portrait-grid" />
          <div className="portrait-person"><span>{state.profile?.name.slice(0, 1) || "新"}</span></div>
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="portrait-caption"><small>YOUR DIGITAL SELF</small><b>{state.profile?.name || "待认识的你"}</b><span>{state.profile?.role || "证据预检尚未完成"}</span></div>
          <div className="version-stamp">v0.3<br />LEARNING</div>
        </div>
        <div className="readiness-panel">
          <div className="score-head"><span><small>分身成熟度</small><b>{score}<em>%</em></b></span><span className="score-status"><i /> 可测试</span></div>
          <div className="score-track"><i style={{ width: `${score}%` }} /></div>
          <p>已经能复现你的基础语气和决策倾向。再完成 <b>8–12 次</b>真实场景纠偏，稳定性会明显提升。</p>
          <div className="metric-row">
            <Metric value={state.sources.reduce((sum, source) => sum + source.itemCount, 0).toLocaleString()} label="证据片段" />
            <Metric value={String(state.memoryCount)} label="长期记忆" />
            <Metric value={String(state.feedbackCount)} label="人工纠偏" />
          </div>
          <button className="ink-link" onClick={() => go("identity")}>进入人格工作台 <ArrowRight size={14} /></button>
        </div>
      </section>
      <section className="overview-lower">
        <div className="section-block">
          <div className="section-heading"><div><span>PERSONALITY SIGNALS</span><h2>它现在如何理解你</h2></div><button className="icon-button"><MoreHorizontal size={17} /></button></div>
          <div className="signal-list">
            <Signal icon={MessageCircleMore} index="01" title={`${dws?.styleSamples ?? 0} 条本人真实原话`} text={dws ? `来自 ${dws.conversations} 个钉钉会话，只把你本人发送的内容作为语气证据。` : "尚未采集本人钉钉消息，当前风格主要来自 Onboarding。"} level={Math.min(100, Math.round((dws?.styleSamples ?? 0) / 3))} />
            <Signal icon={BrainCircuit} index="02" title={`${dws?.replyPairs ?? 0} 组真实回复模式`} text={dws ? "结合对方上一条消息与你的真实回复，学习你在具体语境下如何判断和表达。" : "尚未建立钉钉回复上下文。"} level={Math.min(100, (dws?.replyPairs ?? 0) * 2)} />
            <Signal icon={Heart} index="03" title={dws ? "组织关系已同步" : "组织关系未同步"} text={dws ? `${dws.departments.join(" / ")}；上级 ${dws.supervisor ?? "未知"}；直属下属 ${dws.directReports.length} 人。` : "导入钉钉个人证据后，将使用部门、上级、角色与直属下属信息。"} level={dws ? 100 : 0} />
          </div>
        </div>
        <div className="section-block next-action">
          <div className="section-heading"><div><span>NEXT BEST ACTION</span><h2>让它再像你一点</h2></div></div>
          <div className="action-illustration"><MessageCircleMore size={28} /><span /><span /></div>
          <h3>做一次真实场景对话测试</h3>
          <p>选择一条你今天本来就要回复的消息，看看分身会怎么说。</p>
          <button className="primary-button full" onClick={() => go("lab")}>去测试 <ArrowRight size={16} /></button>
        </div>
      </section>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) { return <div className="metric"><b>{value}</b><span>{label}</span></div>; }
function Signal({ icon: Icon, index, title, text, level }: { icon: typeof Gauge; index: string; title: string; text: string; level: number }) {
  return <div className="signal"><div className="signal-icon"><Icon size={19} /></div><span className="signal-index">{index}</span><div><b>{title}</b><p>{text}</p></div><div className="mini-level"><i style={{ width: `${level}%` }} /><em>{level}%</em></div></div>;
}

function AgentConsole({ surface, busy, welcome, quickActions, onChat, compact = false, initialSessionId, scopeKey, versionContext, onSessionChange, accessLevel, onAccessLevelChange }: { surface: "distill" | "calibration"; busy: string | null; welcome: string; quickActions: string[]; onChat: (prompt: string, sessionId?: string) => Promise<WorkbenchAgentReply | undefined>; compact?: boolean; initialSessionId?: string; scopeKey?: string; versionContext?: WorkbenchVersionContext; onSessionChange?: (sessionId: string) => void; accessLevel: AgentAccessLevel; onAccessLevelChange: (accessLevel: AgentAccessLevel) => Promise<boolean> }) {
  const [turns, setTurns] = useState<Array<Pick<AgentConversationTurn, "role" | "content" | "steps">>>([{ role: "agent", content: welcome }]);
  const [sessionId, setSessionId] = useState<string>();
  const [input, setInput] = useState("");
  useEffect(() => {
    setSessionId(initialSessionId);
    setTurns([{ role: "agent", content: welcome }]);
    if (!initialSessionId) return;
    void bridge.loadAgentConversation(surface, versionContext).then((saved) => {
      const scoped = turnsForSdkSession(saved, initialSessionId);
      if (scoped.length) setTurns(scoped);
    });
  }, [surface, initialSessionId, scopeKey, welcome, versionContext?.personaId, versionContext?.branchId]);
  async function send(prefill?: string) {
    const prompt = (prefill ?? input).trim();
    if (!prompt || busy) return;
    setTurns((items) => [...items, { role: "user", content: prompt }]); setInput("");
    const result = await onChat(prompt, sessionId);
    if (result) { setTurns((items) => [...items, { role: "agent", content: result.content, steps: result.steps }, ...(result.previewReply ? [{ role: "agent" as const, content: `最新版本复测：\n${result.previewReply}` }] : [])]); setSessionId(result.sessionId); if (result.sessionId) onSessionChange?.(result.sessionId); }
  }
  return <div className={`agent-console ${compact ? "compact" : ""}`}><header><Sparkles size={16} /><span><b>Claude Agent SDK</b><small>Skills · MCP · Web · DWS · Workspace</small></span></header><div className="agent-console-turns">{turns.map((turn, index) => <div className={turn.role} key={`${turn.role}-${index}`}><p>{turn.content}</p>{turn.steps?.length ? <AgentTrace steps={turn.steps} /> : null}</div>)}</div><div className="agent-quick-actions">{quickActions.map((action, index) => <button key={index} onClick={() => void send(action)}>{action.length > 48 ? `${action.slice(0, 48)}…` : action}</button>)}</div><div className="agent-console-composer-shell"><div className="source-agent-composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="对 Agent 提要求；可让它查网络、读工作区、调用 DWS、MCP 或 Skill…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><button onClick={() => void send()} disabled={!input.trim() || Boolean(busy)}><Send size={16} /></button></div><PermissionControl level={accessLevel} onChange={onAccessLevelChange} compact /></div></div>;
}

function AgentTrace({ steps }: { steps: AgentStep[] }) {
  return <details className="agent-trace"><summary><BrainCircuit size={12} />执行记录 · {steps.length} 步（不展示私密思维链）</summary>{steps.map((item) => <div className={item.status} key={item.id}><i /> <span><b>{item.title}</b>{item.detail && <small>{item.detail}</small>}</span></div>)}</details>;
}

function ConversationLab({ state, conversation, conversations, busy, archiveRevision, onTargetChange, onChat, onPickVisualAttachments, onStageVisualAttachments, onPasteVisualAttachment, onLoadTwinConversation, onSaveEvaluation, onReviewEvaluations, onAgentChat, onLoadConversationSamples, onCreateEvaluationSession, onUpdateEvaluationSession, onRenameVersion, accessLevel, onAccessLevelChange }: {
  state: BootstrapState;
  conversation?: PersonaConversation;
  conversations: PersonaConversation[];
  busy: string | null;
  archiveRevision: number;
  onTargetChange: (context: WorkbenchVersionContext) => void;
  onChat: (prompt: string, sessionId: string | undefined, context: WorkbenchVersionContext, attachments?: VisualAttachment[]) => Promise<{ turn: ChatTurn; sessionId?: string } | undefined>;
  onPickVisualAttachments: (context: WorkbenchVersionContext) => Promise<VisualAttachment[]>;
  onStageVisualAttachments: (context: WorkbenchVersionContext, files: VisualAttachmentBuffer[]) => Promise<VisualAttachment[]>;
  onPasteVisualAttachment: (context: WorkbenchVersionContext) => Promise<VisualAttachment[]>;
  onLoadTwinConversation: (sessionId: string, context: WorkbenchVersionContext) => Promise<ChatTurn[]>;
  onSaveEvaluation: (input: EvaluationDraftInput, context: WorkbenchVersionContext) => Promise<EvaluationSaveResult | undefined>;
  onReviewEvaluations: (context: WorkbenchVersionContext) => Promise<void>;
  onAgentChat: (prompt: string, sessionId: string | undefined, context: WorkbenchVersionContext) => Promise<WorkbenchAgentReply | undefined>;
  onLoadConversationSamples: (limit: number | undefined, context: WorkbenchVersionContext) => Promise<ConversationSample[]>;
  onCreateEvaluationSession: (context: WorkbenchVersionContext, title?: string) => Promise<EvaluationSession>;
  onUpdateEvaluationSession: (id: string, patch: { title?: string; sdkSessionId?: string; calibrationSdkSessionId?: string }) => Promise<EvaluationSession>;
  onRenameVersion: (context: WorkbenchVersionContext, title: string) => Promise<boolean>;
  accessLevel: AgentAccessLevel;
  onAccessLevelChange: (accessLevel: AgentAccessLevel) => Promise<boolean>;
}) {
  const twinVersions = useMemo(() => state.versions.filter((item) => item.kind === "twin").sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.versions]);
  const initialVersionId = conversation?.publishedVersionId && twinVersions.some((item) => item.id === conversation.publishedVersionId)
    ? conversation.publishedVersionId
    : twinVersions[0]?.id ?? "";
  const [selectedVersionId, setSelectedVersionId] = useState(initialVersionId);
  const selectedVersion = twinVersions.find((item) => item.id === selectedVersionId) ?? twinVersions[0];
  const selectedContext = selectedVersion ? versionContextForArtifact(selectedVersion, conversations) : undefined;
  const versionSessions = useMemo(() => state.evaluationSessions.filter((item) => item.twinVersionId === selectedVersion?.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [state.evaluationSessions, selectedVersion?.id]);
  const [evaluationSessionId, setEvaluationSessionId] = useState(() => versionSessions[0]?.id ?? "");
  const evaluationSession = versionSessions.find((item) => item.id === evaluationSessionId) ?? versionSessions[0];
  const [labMode, setLabMode] = useState<"test" | "archive">("test");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<VisualAttachment[]>([]);
  const [renamingVersion, setRenamingVersion] = useState(false);
  const [versionNameDraft, setVersionNameDraft] = useState("");
  const [renamingSession, setRenamingSession] = useState(false);
  const [sessionNameDraft, setSessionNameDraft] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([
    { id: "welcome", role: "twin", content: "发一条真实消息，直接看我会怎么回。", createdAt: new Date().toISOString(), confidence: state.harness?.confidence, evidence: ["SOUL.md", "STYLE.md", "Q&A.md"] },
  ]);
  const [feedbackTurn, setFeedbackTurn] = useState<{ turn: ChatTurn; prompt: string } | null>(null);
  const [correction, setCorrection] = useState("");
  const [score, setScore] = useState(3);
  const [labels, setLabels] = useState<EvaluationInput["labels"]>(["voice"]);
  const [expectedReply, setExpectedReply] = useState("");
  const [evaluationNotes, setEvaluationNotes] = useState("");
  const [samples, setSamples] = useState<ConversationSample[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string>();
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [receipt, setReceipt] = useState<{
    recordId: string;
    sourceVersion: ArtifactVersion;
    result: EvaluationSaveResult;
    retestSessionId?: string;
  }>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestTestPrompt = [...turns].reverse().find((turn) => turn.role === "user")?.content ?? "";
  const latestTestReply = [...turns].reverse().find((turn) => turn.role === "twin" && turn.id !== "welcome")?.content ?? "";
  const selectedSample = samples.find((sample) => sample.id === selectedSampleId) ?? samples[0];
  const activePrompt = labMode === "archive" ? selectedSample?.prompt ?? "" : latestTestPrompt;
  const activeReply = labMode === "archive" ? selectedSample?.reply ?? "" : latestTestReply;
  const evaluationLabels: Array<{ id: EvaluationInput["labels"][number]; name: string }> = [
    { id: "voice", name: "语气不像" }, { id: "facts", name: "事实不准" }, { id: "judgment", name: "判断不像" },
    { id: "boundary", name: "边界问题" }, { id: "length", name: "长度不对" }, { id: "other", name: "其他" },
  ];

  const selectedRecords = state.evaluationRecords.filter((item) => item.twinVersionId === selectedVersion?.id);
  const selectedProfile = selectedContext ? state.profiles.find((item) => item.personaId === selectedContext.personaId && item.branchId === selectedContext.branchId)?.profile ?? state.profile : state.profile;

  useEffect(() => { if (selectedContext) onTargetChange(selectedContext); }, [selectedContext?.personaId, selectedContext?.branchId]);

  async function refreshSamples() {
    if (!selectedContext) return;
    setSamplesLoading(true);
    try {
      const next = await onLoadConversationSamples(200, selectedContext);
      setSamples(next);
      setSelectedSampleId((current) => current && next.some((sample) => sample.id === current) ? current : next[0]?.id);
    } finally {
      setSamplesLoading(false);
    }
  }

  useEffect(() => { void refreshSamples(); }, [archiveRevision, selectedVersion?.id]);
  useEffect(() => {
    const next = versionSessions[0];
    setEvaluationSessionId(next?.id ?? "");
  }, [selectedVersion?.id]);
  useEffect(() => {
    setTurns([{ id: "welcome", role: "twin", content: `当前测试：${selectedVersion ? `v${selectedVersion.version}` : "未选择版本"} · ${evaluationSession?.title ?? "新评测会话"}。发一条真实消息，直接看这个版本会怎么回。`, createdAt: new Date().toISOString(), confidence: state.harness?.confidence, evidence: ["SOUL.md", "STYLE.md", "Q&A.md"] }]);
    setFeedbackTurn(null);
    setReceipt(undefined);
    setAttachments([]);
  }, [selectedVersion?.id, evaluationSession?.id]);
  useEffect(() => {
    let active = true;
    if (!evaluationSession?.sdkSessionId || !selectedContext) return () => { active = false; };
    void onLoadTwinConversation(evaluationSession.sdkSessionId, selectedContext).then((savedTurns) => {
      if (active && savedTurns.length) setTurns(savedTurns);
    });
    return () => { active = false; };
  }, [selectedVersion?.id, evaluationSession?.id, evaluationSession?.sdkSessionId]);
  useEffect(() => {
    if (labMode !== "archive" || !selectedSample) return;
    setScore(selectedSample.evaluation?.score ?? 3);
    setLabels(selectedSample.evaluation?.labels.length ? selectedSample.evaluation.labels : ["voice"]);
    setExpectedReply(selectedSample.evaluation?.expectedReply ?? "");
    setEvaluationNotes(selectedSample.evaluation?.notes ?? "");
  }, [labMode, selectedSample?.id, selectedSample?.evaluation?.id]);

  async function send() {
    const prompt = input.trim() || (attachments.length ? "[请查看本条消息附带的图片或 PDF]" : "");
    if (!prompt || busy || !selectedContext) return;
    let targetSession = evaluationSession;
    if (!targetSession) {
      targetSession = await onCreateEvaluationSession(selectedContext);
      setEvaluationSessionId(targetSession.id);
    }
    const sentAttachments = attachments;
    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: "user", content: prompt, createdAt: new Date().toISOString(), attachments: sentAttachments };
    setTurns((items) => [...items, userTurn]); setInput("");
    setAttachments([]);
    const result = await onChat(prompt, targetSession.sdkSessionId, selectedContext, sentAttachments);
    if (result) {
      setTurns((items) => [...items, result.turn]);
      if (result.sessionId && result.sessionId !== targetSession.sdkSessionId) await onUpdateEvaluationSession(targetSession.id, { sdkSessionId: result.sessionId, title: targetSession.title.startsWith("评测会话 ") ? compactTitle(prompt) : undefined });
      setTimeout(() => scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 50);
    }
  }

  async function pickVisualAttachments() {
    if (!selectedContext || busy) return;
    const picked = await onPickVisualAttachments(selectedContext);
    setAttachments((current) => [...current, ...picked].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index));
  }

  function appendAttachments(picked: VisualAttachment[]) {
    setAttachments((current) => [...current, ...picked].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index));
  }

  async function pasteVisualAttachments(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!selectedContext || busy) return;
    const directFiles = [...event.clipboardData.files];
    const itemFiles = [...event.clipboardData.items].map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => Boolean(file));
    const files = [...directFiles, ...itemFiles].filter((file, index, all) => (file.type.startsWith("image/") || file.type === "application/pdf") && all.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size) === index);
    if (files.length) {
      event.preventDefault();
      const buffers = await Promise.all(files.map(fileToVisualBuffer));
      appendAttachments(await onStageVisualAttachments(selectedContext, buffers));
      return;
    }
    if (!event.clipboardData.getData("text/plain")) appendAttachments(await onPasteVisualAttachment(selectedContext));
  }

  async function renameSelectedVersion() {
    if (!selectedContext || !versionNameDraft.trim()) return;
    if (await onRenameVersion(selectedContext, versionNameDraft)) setRenamingVersion(false);
  }

  async function renameSelectedSession() {
    if (!evaluationSession || !sessionNameDraft.trim()) return;
    await onUpdateEvaluationSession(evaluationSession.id, { title: sessionNameDraft });
    setRenamingSession(false);
  }

  async function saveActiveEvaluation(applyNow: boolean, quick?: { score: number; labels: EvaluationInput["labels"]; expectedReply?: string; notes?: string }, target?: { prompt: string; reply: string }) {
    const prompt = target?.prompt ?? activePrompt;
    const reply = target?.reply ?? activeReply;
    if (!prompt || !reply || !selectedContext || !selectedVersion) return;
    let targetSession = evaluationSession;
    if (!targetSession) {
      targetSession = await onCreateEvaluationSession(selectedContext, compactTitle(prompt));
      setEvaluationSessionId(targetSession.id);
    }
    const result = await onSaveEvaluation({
      sampleId: labMode === "archive" ? selectedSample?.id : undefined,
      prompt,
      reply,
      expectedReply: quick?.expectedReply ?? expectedReply,
      labels: quick?.labels ?? labels,
      score: quick?.score ?? score,
      notes: quick?.notes ?? evaluationNotes,
      applyNow,
      evaluationSessionId: targetSession.id,
    }, selectedContext);
    if (result) setReceipt({ recordId: result.record.id, sourceVersion: selectedVersion, result });
    if (labMode === "archive") await refreshSamples();
    else { setExpectedReply(""); setEvaluationNotes(""); }
    return result;
  }

  async function createSessionForVersion(version = selectedVersion) {
    if (!version) return;
    const context = versionContextForArtifact(version, conversations);
    const created = await onCreateEvaluationSession(context);
    setSelectedVersionId(version.id);
    setEvaluationSessionId(created.id);
  }

  async function startRetest() {
    const nextVersion = receipt?.result.revision?.version;
    if (!nextVersion) return;
    const context = versionContextForArtifact(nextVersion, conversations);
    const created = await onCreateEvaluationSession(context, `复测 · ${receipt.sourceVersion.version} → ${nextVersion.version}`);
    setSelectedVersionId(nextVersion.id);
    setEvaluationSessionId(created.id);
    setReceipt((current) => current ? { ...current, retestSessionId: created.id } : current);
    setLabMode("test");
  }

  return (
    <div className="page lab-page page-enter">
      <PageTitle eyebrow="CONVERSATION LAB" title="它说得像你吗？" subtitle="每个分身版本拥有独立的评测会话与纠偏记录；切换版本不会丢失历史。" />
      <section className="lab-targetbar">
        <label><span>人格 / 分身版本</span><div className="editable-select">{renamingVersion ? <input autoFocus value={versionNameDraft} maxLength={60} onChange={(event) => setVersionNameDraft(event.target.value)} onBlur={() => void renameSelectedVersion()} onKeyDown={(event) => { if (event.key === "Enter") void renameSelectedVersion(); if (event.key === "Escape") setRenamingVersion(false); }} /> : <select value={selectedVersion?.id ?? ""} onChange={(event) => setSelectedVersionId(event.target.value)}>{twinVersions.map((version) => <option value={version.id} key={version.id}>{versionLabel(version, conversations)}</option>)}</select>}<button title="修改分身版本名称" disabled={!selectedVersion} onClick={() => { setVersionNameDraft(selectedContext?.branchName ?? ""); setRenamingVersion(true); }}><Pencil size={12} /></button></div></label>
        <label><span>评测会话</span><div className="editable-select">{renamingSession ? <input autoFocus value={sessionNameDraft} maxLength={60} onChange={(event) => setSessionNameDraft(event.target.value)} onBlur={() => void renameSelectedSession()} onKeyDown={(event) => { if (event.key === "Enter") void renameSelectedSession(); if (event.key === "Escape") setRenamingSession(false); }} /> : <select value={evaluationSession?.id ?? ""} onChange={(event) => setEvaluationSessionId(event.target.value)}><option value="">尚未新建会话</option>{versionSessions.map((session) => <option value={session.id} key={session.id}>{session.title}</option>)}</select>}<button title="修改评测会话名称" disabled={!evaluationSession} onClick={() => { setSessionNameDraft(evaluationSession?.title ?? ""); setRenamingSession(true); }}><Pencil size={12} /></button></div></label>
        <button className="new-evaluation-session" onClick={() => void createSessionForVersion()}><Plus size={15} />新建评测会话</button>
        <details className="lab-session-history"><summary><Timer size={14} />当前版本与会话历史 <ChevronDown size={13} /></summary><div><header><b>{selectedVersion ? versionLabel(selectedVersion, conversations) : "未选择版本"}</b><small>{versionSessions.length} 个独立评测会话 · {selectedRecords.length} 条标注</small></header>{versionSessions.length ? versionSessions.map((session) => <button key={session.id} className={session.id === evaluationSession?.id ? "active" : ""} onClick={() => setEvaluationSessionId(session.id)}><MessageCircleMore size={13} /><span><b>{session.title}</b><small>{formatSampleTime(session.updatedAt)} · {state.evaluationRecords.filter((item) => item.evaluationSessionId === session.id).length} 条标注</small></span></button>) : <p>这个版本还没有评测会话。</p>}</div></details>
      </section>
      <div className="lab-mode-tabs">
        <button className={labMode === "test" ? "active" : ""} onClick={() => setLabMode("test")}><MessageCircleMore size={15} /><span><b>实时测试</b><small>主动模拟场景</small></span></button>
        <button className={labMode === "archive" ? "active" : ""} onClick={() => setLabMode("archive")}><Database size={15} /><span><b>真实会话样本</b><small>{samples.length} 条 · 本地留档</small></span></button>
        <em><ShieldCheck size={13} />仅保存在本机</em>
      </div>
      <section className="lab-shell">
        <div className="chat-panel">
          <header><div className="chat-avatar">{selectedProfile?.name?.slice(0, 1)}<i /></div><div><b>{labMode === "archive" ? "钉钉真实会话档案" : `${selectedProfile?.name || "数字分身"} · ${evaluationSession?.title ?? "新评测"}`}</b><span>{labMode === "archive" ? "Stream 与 Webhook 收发完成后自动归档，可逐条标注" : `Claude Agent SDK · ${selectedVersion ? `v${selectedVersion.version}` : "未选择版本"} · 独立会话`}</span></div><em><i /> {labMode === "archive" ? "REAL DATA" : "SDK TEST MODE"}</em></header>
          {labMode === "test" ? <>
            <div className="chat-scroll" ref={scrollRef}>
              <div className="scenario-chips"><span>试试这些场景</span><button onClick={() => setInput("项目比原计划晚了两周，团队来问我能不能继续延期，我会怎么回复？")}>项目延期</button><button onClick={() => setInput("同事给了一个我不认可的方案，帮我回复。")}>否定方案</button><button onClick={() => setInput("合作方希望我今天就做一个重大承诺。")}>高风险承诺</button></div>
              {turns.map((turn, turnIndex) => (
                <div className={`chat-turn ${turn.role}`} key={turn.id}>
                  <div className="turn-label">{turn.role === "twin" ? <><span>{selectedProfile?.name?.slice(0, 1)}</span>数字分身</> : <>你 · 测试者</>}</div>
                  <div className="bubble"><p>{turn.content}</p>{turn.attachments?.length ? <div className="turn-attachments">{turn.attachments.map((item) => <span key={item.id}><ImageIcon size={13} /><b>{item.name}</b><small>{formatBytes(item.size)}</small></span>)}</div> : null}{turn.role === "twin" && turn.id !== "welcome" && <div className="bubble-meta"><span><ShieldCheck size={13} />Claude Agent SDK · 会话记忆快照</span><div><button title="像我" onClick={() => { const prompt = [...turns.slice(0, turnIndex)].reverse().find((item) => item.role === "user")?.content ?? ""; void saveActiveEvaluation(false, { score: 5, labels: [], notes: "快速反馈：符合本人表达与判断" }, { prompt, reply: turn.content }); }}><ThumbsUp size={14} /></button><button title="不像我" onClick={() => { const prompt = [...turns.slice(0, turnIndex)].reverse().find((item) => item.role === "user")?.content ?? ""; setFeedbackTurn({ turn, prompt }); }}><ThumbsDown size={14} /></button></div></div>}</div>
                </div>
              ))}
              {busy && <div className="typing"><i /><i /><i /><span>Claude Agent SDK 正在调用人格、记忆与按需知识</span></div>}
            </div>
            <div className="composer visual-composer">{attachments.length ? <div className="visual-attachment-queue">{attachments.map((item) => <span key={item.id}><ImageIcon size={13} /><b>{item.name}</b><small>{formatBytes(item.size)}</small><button title="移除附件" onClick={() => setAttachments((items) => items.filter((candidate) => candidate.id !== item.id))}><X size={12} /></button></span>)}</div> : null}<textarea value={input} onChange={(e) => setInput(e.target.value)} onPaste={(event) => void pasteVisualAttachments(event)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="输入测试消息；可直接 Ctrl+V 粘贴截图，或选择图片 / PDF…" /><button className="composer-send-button" onClick={() => void send()} disabled={(!input.trim() && !attachments.length) || Boolean(busy)}><Send size={17} /></button><div className="lab-composer-tools"><button className="attach-visual-button" onClick={() => void pickVisualAttachments()} disabled={Boolean(busy)}><ImageIcon size={13} />添加图片 / PDF</button><button className="attach-visual-button paste-visual-button" onClick={() => selectedContext && void onPasteVisualAttachment(selectedContext).then(appendAttachments)} disabled={Boolean(busy)}><Files size={13} />粘贴截图</button><span>Claude 按需调用内置 PP-OCRv6</span><PermissionControl level={accessLevel} onChange={onAccessLevelChange} compact /></div></div>
          </> : <ConversationArchive samples={samples} selectedId={selectedSample?.id} loading={samplesLoading} onSelect={setSelectedSampleId} onRefresh={() => void refreshSamples()} />}
        </div>
        <aside className="evidence-panel calibration-panel">
          <span className="panel-kicker">CALIBRATION COACH</span><h3>改进建议与数据集标注</h3>
          <p className="calibration-copy">{labMode === "archive" ? "当前标注会与这条真实会话绑定，既能进入定期审查队列，也能立即生成新的分身版本。" : "纠偏 Agent 可以实时分析左侧效果、调用 Skill 创建新分身版本，并在新会话里立即复测。"}</p>
          {selectedContext && <AgentConsole surface="calibration" busy={busy} compact initialSessionId={evaluationSession?.calibrationSdkSessionId} scopeKey={evaluationSession?.id || selectedVersion?.id} versionContext={selectedContext} accessLevel={accessLevel} onAccessLevelChange={onAccessLevelChange} welcome={`当前只纠偏 ${selectedVersion ? `v${selectedVersion.version}` : "所选版本"}。把左侧哪里不像告诉我，我会创建新版本并引导你开启独立复测会话。`} quickActions={activeReply ? [`分析这组${labMode === "archive" ? "真实钉钉会话" : "测试"}为什么不像我。问题：${activePrompt}\n当前回答：${activeReply}`, `把我的改进意见应用为新版本。问题：${activePrompt}\n当前回答：${activeReply}\n我的意见：${evaluationNotes || expectedReply || "请先向我确认"}`] : ["先说明你能如何介入左侧测试、创建版本并复测"]} onChat={(prompt, sdkSessionId) => onAgentChat(prompt, sdkSessionId, selectedContext)} onSessionChange={(sdkSessionId) => { if (evaluationSession) void onUpdateEvaluationSession(evaluationSession.id, { calibrationSdkSessionId: sdkSessionId }); }} />}
          {labMode === "archive" && selectedSample && <div className="sample-binding"><Database size={14} /><span><b>已绑定真实样本</b><small>{selectedSample.groupName} · {selectedSample.senderName} · {formatSampleTime(selectedSample.createdAt)}</small></span>{selectedSample.evaluation && <em className={selectedSample.evaluation.status}>{selectedSample.evaluation.status === "applied" ? "已反哺" : "待反哺"}</em>}</div>}
          <label className="evaluation-field"><span>整体像本人程度</span><div className="score-row">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={score === value ? "selected" : ""} onClick={() => setScore(value)}>{value}</button>)}</div></label>
          <div className="evaluation-field"><span>问题标签</span><div className="label-grid">{evaluationLabels.map((label) => <button key={label.id} className={labels.includes(label.id) ? "selected" : ""} onClick={() => setLabels((items) => items.includes(label.id) ? items.filter((item) => item !== label.id) : [...items, label.id])}>{label.name}</button>)}</div></div>
          <label className="evaluation-field"><span>本人真正会怎么回</span><textarea value={expectedReply} onChange={(event) => setExpectedReply(event.target.value)} placeholder="建议直接写一版你会发送的原话，这是最强纠偏信号。" rows={4} /></label>
          <label className="evaluation-field"><span>改进意见</span><textarea value={evaluationNotes} onChange={(event) => setEvaluationNotes(event.target.value)} placeholder="例如：不要解释自己是分身；先给结论，减少列表。" rows={3} /></label>
          <div className="evaluation-actions"><button className="outline-button" disabled={!activeReply || Boolean(busy)} onClick={() => void saveActiveEvaluation(false)}>保存评测记录</button><button className="primary-button" disabled={!activeReply || (!expectedReply.trim() && !evaluationNotes.trim()) || Boolean(busy)} onClick={() => void saveActiveEvaluation(true)}>保存并生成新版本</button></div>
          {receipt && <EvaluationReceipt receipt={receipt} onRetest={() => void startRetest()} />}
          <div className="evaluation-queue"><div><b>{selectedVersion ? state.evaluationStatsByTwinVersion[selectedVersion.id]?.pending ?? 0 : 0}</b><span>条待反哺标注</span></div><button onClick={() => selectedContext && void onReviewEvaluations(selectedContext)} disabled={!selectedVersion || !(state.evaluationStatsByTwinVersion[selectedVersion.id]?.pending) || Boolean(busy)}><RefreshCw size={14} />批量审查并应用</button></div>
        </aside>
      </section>
      {feedbackTurn && <FeedbackModal turn={feedbackTurn.turn} correction={correction} setCorrection={setCorrection} busy={Boolean(busy)} close={() => { setFeedbackTurn(null); setCorrection(""); }} submit={async () => { const result = await saveActiveEvaluation(true, { score: 1, labels: ["voice"], expectedReply: correction, notes: "快速反馈：不像本人" }, { prompt: feedbackTurn.prompt, reply: feedbackTurn.turn.content }); if (result) { setFeedbackTurn(null); setCorrection(""); } }} />}
    </div>
  );
}

function EvaluationReceipt({ receipt, onRetest }: { receipt: { recordId: string; sourceVersion: ArtifactVersion; result: EvaluationSaveResult; retestSessionId?: string }; onRetest: () => void }) {
  const next = receipt.result.revision?.version;
  return <div className="evaluation-receipt"><span className="panel-kicker">CORRECTION RECEIPT</span><h4>这次反馈去了哪里</h4><ol><li className="done"><Check size={13} /><span><b>保存记录</b><small>{compactIdentifier(receipt.recordId)}</small></span></li><li className={next ? "done" : receipt.result.revisionError ? "error" : "waiting"}><span>{next ? <Check size={13} /> : "2"}</span><span><b>生成版本</b><small>{next ? `v${receipt.sourceVersion.version} → v${next.version}` : receipt.result.revisionError || "已进入定期反哺队列"}</small></span></li><li className={next ? "done" : "waiting"}><span>{next ? <Check size={13} /> : "3"}</span><span><b>修改文件</b><small>{receipt.result.changedFiles.length ? receipt.result.changedFiles.join(" · ") : next ? "没有检测到 Harness 字段变化" : "等待生成版本"}</small></span></li><li className={receipt.retestSessionId ? "done" : next ? "action" : "waiting"}><span>{receipt.retestSessionId ? <Check size={13} /> : "4"}</span><span><b>新建会话复测</b><small>{receipt.retestSessionId ? "独立复测会话已创建" : "使用新 Frozen Snapshot，避免旧会话污染"}</small></span>{next && !receipt.retestSessionId && <button onClick={onRetest}>开始复测 <ArrowRight size={13} /></button>}</li></ol></div>;
}

function ConversationArchive({ samples, selectedId, loading, onSelect, onRefresh }: { samples: ConversationSample[]; selectedId?: string; loading: boolean; onSelect: (id: string) => void; onRefresh: () => void }) {
  const selected = samples.find((sample) => sample.id === selectedId) ?? samples[0];
  if (!samples.length) return <div className="archive-empty"><div><Database size={23} /><i /></div><h3>{loading ? "正在读取真实会话…" : "等待第一条真实会话"}</h3><p>企业应用机器人 Stream 或自定义 Webhook 生成回复后，会把提问、回答、群和发送状态保存在本地。</p><button className="outline-button" onClick={onRefresh} disabled={loading}><RefreshCw size={13} />刷新</button></div>;
  return <div className="conversation-archive">
    <div className="archive-toolbar"><span><b>{samples.length}</b> 条最近会话</span><span>{samples.filter((sample) => sample.evaluation).length} 条已标注</span><button onClick={onRefresh} disabled={loading}><RefreshCw size={13} className={loading ? "spin" : ""} />刷新</button></div>
    <div className="archive-body">
      <nav className="archive-list">{samples.map((sample) => <button key={sample.id} className={sample.id === selected?.id ? "active" : ""} onClick={() => onSelect(sample.id)}><span><i className={`sample-channel ${sample.channel}`} />{sample.groupName}</span><p>{sample.prompt}</p><small>{sample.senderName} · {formatSampleTime(sample.createdAt)}</small>{sample.evaluation && <em className={sample.evaluation.status}>{sample.evaluation.status === "applied" ? "已反哺" : "待反哺"}</em>}</button>)}</nav>
      {selected && <article className="archive-detail"><header><div><span>{selected.robotName || (selected.channel === "dingtalk_stream" ? "企业应用机器人" : "自定义机器人")} · {selected.channel === "dingtalk_stream" ? "Stream" : "Webhook"}</span><h3>{selected.groupName}</h3><p>{selected.senderName} · {formatSampleTime(selected.createdAt)}</p></div><em className={`sample-status ${selected.status}`}>{sampleStatusLabel(selected.status)}</em></header><div className="sample-route-lineage"><span>分身版本 <b>{selected.twinVersionName || compactIdentifier(selected.twinVersionId || "未记录")}</b></span><span>绑定 <b>{compactIdentifier(selected.bindingId || "历史记录")}</b></span><span>机器人 <b>{compactIdentifier(selected.robotId || "未记录")}</b></span><span>群 <b>{compactIdentifier(selected.groupId || selected.conversationId)}</b></span></div><section><small>对方的问题</small><p>{selected.prompt}</p>{selected.attachments?.length ? <div className="turn-attachments">{selected.attachments.map((item) => <span key={item.id}><ImageIcon size={13} /><b>{item.name}</b><small>{formatBytes(item.size)}</small></span>)}</div> : null}</section>{selected.deliveryError && <section className="sample-delivery-error"><small>处理异常 / 降级说明</small><p>{selected.deliveryError}</p></section>}<section className="archived-reply"><small>数字分身的回答</small><p>{selected.reply || "（本轮未生成回答；原始消息已保留，可据此排查或人工处理。）"}</p></section>{selected.processingLog?.length ? <details className="sample-processing-log" open={selected.status === "failed"}><summary>处理轨迹 · {selected.processingLog.length} 步 <span>{selected.processingStage || selected.processingLog.at(-1)?.stage}</span></summary><ol>{selected.processingLog.map((event, index) => <li key={`${event.at}-${event.stage}-${index}`} className={event.status}><time>{new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false })}</time><b>{processingStageLabel(event.stage)}</b><p>{event.message}</p></li>)}</ol></details> : null}<footer><ShieldCheck size={13} /><span>原始样本、视觉附件、完整处理轨迹及分身/机器人/群路由保存在本地；标注不会覆盖原始对话。</span></footer></article>}
    </div>
  </div>;
}

function sampleStatusLabel(status: ConversationSample["status"]): string {
  return ({ received: "已接收", processing: "处理中", generated: "已生成", draft: "草稿", sent: "已发送", suppressed: "已拦截", failed: "失败" })[status];
}

function processingStageLabel(stage: string): string {
  return ({
    received: "原始消息落盘",
    acknowledged: "钉钉 ACK",
    processing: "开始处理",
    "visual-download": "视觉附件",
    draft: "生成草稿",
    "send-retry": "发送重试",
    sent: "发送成功",
    "send-failed": "发送失败",
    "processing-failed": "处理失败",
    recovery: "异常恢复",
    deduplicated: "消息去重",
    "reply-deduplicated": "回复去重",
  } as Record<string, string>)[stage] || stage;
}

function formatSampleTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function conversationSampleToDraft(sample: ConversationSample): DingTalkDraft {
  return {
    id: sample.id,
    conversationId: sample.conversationId,
    senderId: sample.senderId,
    incoming: sample.prompt,
    reply: sample.reply,
    createdAt: sample.createdAt,
    status: sample.status === "failed" ? "failed" : ["received", "processing"].includes(sample.status) ? "processing" : "draft",
    deliveryError: sample.deliveryError,
    bindingId: sample.bindingId,
    branchId: sample.branchId,
    personaId: sample.personaId,
    twinVersionId: sample.twinVersionId,
    twinVersionName: sample.twinVersionName,
    robotId: sample.robotId,
    robotName: sample.robotName,
    groupId: sample.groupId,
    groupName: sample.groupName,
  };
}

function FeedbackModal({ turn, correction, setCorrection, busy, close, submit }: { turn: ChatTurn; correction: string; setCorrection: (value: string) => void; busy: boolean; close: () => void; submit: () => Promise<void> }) {
  return <div className="modal-backdrop"><div className="feedback-modal"><button className="modal-close" onClick={close} disabled={busy}><X size={18} /></button><span className="section-number">EVALUATION & CORRECTION</span><h2>哪里不像你？</h2><blockquote>{turn.content}</blockquote><label className="field"><span>告诉它你真正会怎么想或怎么说</span><textarea rows={4} value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="例如：我不会直接同意延期，会先让对方说明卡点和新的明确时间。" /></label><div className="modal-actions"><button className="text-button" onClick={close} disabled={busy}>取消</button><button className="primary-button" disabled={!correction.trim() || busy} onClick={() => void submit()}>{busy ? <LoaderCircle size={15} className="spin" /> : <MemoryStick size={16} />}保存并生成新版本</button></div></div></div>;
}

function ClaudeSetupModal({ state, initialTab, busy, close, save, saveRuntime }: { state: BootstrapState; initialTab: "connection" | "runtime"; busy: boolean; close: () => void; save: (input: ModelConnectionInput) => Promise<boolean>; saveRuntime: (input: ModelConnectionInput["agentRuntime"]) => Promise<boolean> }) {
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<ModelConnectionInput["provider"]>(state.runtime.modelProvider || "anthropic");
  const initialPreset = modelProviderPreset(state.runtime.modelProvider || "anthropic");
  const [providerName, setProviderName] = useState(state.runtime.modelProviderName || "");
  const [baseUrl, setBaseUrl] = useState(state.runtime.baseUrl || initialPreset.baseUrl);
  const [model, setModel] = useState(state.runtime.model || initialPreset.model);
  const [authMode, setAuthMode] = useState<ModelConnectionInput["authMode"]>(state.runtime.modelAuthMode || initialPreset.authMode);
  const [nativeVision, setNativeVision] = useState(state.runtime.nativeVision ?? initialPreset.nativeVision);
  const [mapModelTiers, setMapModelTiers] = useState(state.runtime.mapModelTiers ?? initialPreset.mapModelTiers);
  const [contextWindow, setContextWindow] = useState<number | undefined>(state.runtime.contextWindow ?? initialPreset.contextWindow);
  const [maxTurns, setMaxTurns] = useState(state.runtime.agent.maxTurns);
  const [accessLevel, setAccessLevel] = useState(state.runtime.agent.accessLevel);
  const [tab, setTab] = useState<"connection" | "runtime">(initialTab);
  const configured = state.runtime.credentials;
  const selectedPreset = modelProviderPreset(provider);
  const submit = () => save({ provider, providerName: provider === "custom" ? providerName : undefined, apiKey, baseUrl: provider === "anthropic" && !baseUrl.trim() ? undefined : baseUrl, model, authMode, nativeVision, mapModelTiers, contextWindow, agentRuntime: { maxTurns, accessLevel } });
  const switchProvider = (next: ModelConnectionInput["provider"]) => {
    const defaults = modelProviderPreset(next);
    setProvider(next);
    setBaseUrl(defaults.baseUrl);
    setModel(defaults.model);
    setProviderName(next === "custom" ? "自定义 Provider" : "");
    setAuthMode(defaults.authMode);
    setNativeVision(defaults.nativeVision);
    setMapModelTiers(defaults.mapModelTiers);
    setContextWindow(defaults.contextWindow);
  };
  return (
    <div className="modal-backdrop">
      <div className="feedback-modal claude-setup-modal">
        <button className="modal-close" onClick={close} disabled={busy}><X size={18} /></button>
        <span className="section-number">CLAUDE AGENT SDK</span>
        <h2>{tab === "connection" ? (configured ? "更换模型连接" : "配置模型连接") : "完整 Agent 运行能力"}</h2>
        <div className="runtime-tabs"><button className={tab === "connection" ? "active" : ""} onClick={() => setTab("connection")}>模型连接</button><button className={tab === "runtime" ? "active" : ""} onClick={() => setTab("runtime")}>Agent Runtime</button></div>
        {tab === "connection" ? <>
        <div className="provider-switch">{MODEL_PROVIDER_PRESETS.map((item) => <button type="button" key={item.id} className={provider === item.id ? "active" : ""} onClick={() => switchProvider(item.id)}><b>{item.name}</b><small>{item.description}</small></button>)}</div>
        <div className="credential-explainer"><ShieldCheck size={22} /><div><b>Provider 可更换，Claude Agent SDK 不更换</b><p>预设只负责端点、鉴权、模型与能力声明；Skills、Plugins、MCP、Bash、记忆和权限系统仍由同一个 Claude Agent SDK Runtime 驱动。自定义端点必须兼容 Anthropic Messages 协议。</p></div></div>
        {provider === "custom" && <label className="field"><span>Provider 名称</span><input value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="例如：公司模型网关" /></label>}
        <label className="field credential-field"><span>{modelProviderDisplayName(provider, providerName)} 凭证</span><input autoFocus type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && apiKey.trim() && !busy) void submit(); }} placeholder={provider === "anthropic" ? "sk-ant-…" : "API Key / Auth Token"} /></label>
        <div className="connection-grid">
          <label className="field"><span>Anthropic API Base URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} placeholder={provider === "anthropic" ? "留空使用 Anthropic 默认端点" : "https://…/anthropic"} /></label>
          <label className="field"><span>模型 ID</span><input list={`model-options-${provider}`} value={model} onChange={(event) => setModel(event.target.value)} spellCheck={false} /><datalist id={`model-options-${provider}`}>{selectedPreset.models?.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</datalist></label>
          <label className="field"><span>鉴权字段</span><select value={authMode} onChange={(event) => setAuthMode(event.target.value as ModelConnectionInput["authMode"])}><option value="api_key">ANTHROPIC_API_KEY</option><option value="auth_token">ANTHROPIC_AUTH_TOKEN / Bearer</option></select></label>
          <label className="field"><span>上下文窗口（tokens，可选）</span><input type="number" min={16000} max={4000000} value={contextWindow ?? ""} onChange={(event) => setContextWindow(event.target.value ? Number(event.target.value) : undefined)} placeholder="由 Provider 默认决定" /></label>
        </div>
        <div className="provider-capability-grid"><label><input type="checkbox" checked={nativeVision} onChange={(event) => setNativeVision(event.target.checked)} /><span><b>原生图片输入</b><small>把 PNG/JPEG/GIF/WebP 像素直接交给模型；OCR 继续作为兜底。</small></span></label><label><input type="checkbox" checked={mapModelTiers} onChange={(event) => setMapModelTiers(event.target.checked)} /><span><b>映射全部 Claude 模型层级</b><small>主 Agent、子 Agent 与不同 tier 都使用当前模型 ID。</small></span></label></div>
        <p className="provider-note">{selectedPreset.note} 自定义 Provider 是一等配置项，不会被重置成预设；能力开关应与端点和模型的真实能力一致。</p>
        <p className="credential-help">密钥使用 Electron safeStorage（Windows DPAPI）加密保存，不会进入 CLAUDE.md、SOUL.md、STYLE.md、Q&A.md、MEMORY.md、USER.md 或情节数据库。也支持启动前设置环境变量。</p>
        <div className="modal-actions"><button className="text-button" onClick={close} disabled={busy}>暂不配置</button><button className="primary-button" disabled={!apiKey.trim() || busy || !model.trim() || (provider === "custom" && (!providerName.trim() || !baseUrl.trim()))} onClick={() => void submit()}>{busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}安全保存并连接</button></div>
        </> : <>
          <div className="runtime-capability-note"><Sparkles size={21} /><div><b>Claude Code 完整工具预设已启用</b><p>Bash / PowerShell、Read / Write / Edit、网络检索、Skills、Plugins、MCP、子代理、任务工具、Hooks 与文件检查点都保留。敏感动作通过 SDK 权限请求授权，不再删除工具。</p></div></div>
          <label className="field"><span>单次任务最大自主轮次</span><input type="number" min={20} max={1000} value={maxTurns} onChange={(event) => setMaxTurns(Math.max(20, Math.min(1000, Number(event.target.value) || 200)))} /><small>默认 200。轮次是“模型判断 → 调工具 → 读取结果”的循环，不是聊天消息数。</small></label>
          <div className="field"><span>权限模式 · 四选一</span><div className="permission-levels">{PERMISSION_LEVELS.map(({ id, title, detail }) => <button type="button" key={id} className={accessLevel === id ? "selected" : ""} aria-pressed={accessLevel === id} onClick={() => setAccessLevel(id)}><i>{accessLevel === id ? <Check size={12} /> : null}</i><span><b>{title}</b><small>{detail}</small></span></button>)}</div><small>这是项目的全局运行策略。即时授权窗口里的“仅允许这一次”只处理当前动作，不是第五种模式。</small></div>
          <div className="runtime-feature-grid"><span><Check size={13} /> 用户 / 项目 / 本地设置</span><span><Check size={13} /> .claude Skills 与 Plugins</span><span><Check size={13} /> 项目与用户 MCP</span><span><Check size={13} /> 文件变更检查点</span></div>
          <div className="modal-actions"><button className="text-button" onClick={close} disabled={busy}>取消</button><button className="primary-button" disabled={busy} onClick={() => void saveRuntime({ maxTurns, accessLevel })}>{busy ? <LoaderCircle size={16} className="spin" /> : <Settings2 size={16} />}保存运行设置</button></div>
        </>}
      </div>
    </div>
  );
}

function AgentPermissionModal({ request, accessLevel, onResolve }: { request: AgentPermissionRequest; accessLevel: AgentAccessLevel; onResolve: (response: AgentPermissionResponse) => Promise<void> }) {
  const inputPreview = JSON.stringify(request.input, null, 2);
  const isQuestion = request.toolName === "AskUserQuestion";
  const isMcpForm = request.kind === "mcp_form";
  const isMcpUrl = request.kind === "mcp_url";
  const questions = isQuestion && Array.isArray(request.input.questions) ? request.input.questions as Array<{ question: string; header?: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }> : [];
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [mcpValues, setMcpValues] = useState<Record<string, string | boolean | number>>({});
  const schema = request.requestedSchema as { properties?: Record<string, { type?: string; title?: string; description?: string; enum?: Array<string | number> }>; required?: string[] } | undefined;
  const mcpFields = Object.entries(schema?.properties ?? {});
  const answerQuestion = (question: string, label: string, multiSelect = false) => setAnswers((current) => {
    if (!multiSelect) return { ...current, [question]: label };
    const selected = Array.isArray(current[question]) ? current[question] as string[] : [];
    return { ...current, [question]: selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label] };
  });
  const questionsAnswered = !isQuestion || questions.every((item) => {
    const answer = answers[item.question];
    return Array.isArray(answer) ? answer.length > 0 : Boolean(answer?.trim());
  });
  const mcpFormComplete = !isMcpForm || (schema?.required ?? []).every((name) => mcpValues[name] !== undefined && mcpValues[name] !== "");
  const allow = (behavior: "allow_once" | "allow_always" = "allow_once") => onResolve({
    id: request.id,
    behavior,
    updatedInput: isQuestion ? { ...request.input, questions: request.input.questions, answers } : undefined,
    formContent: isMcpForm ? mcpValues : undefined,
  });
  return <div className="modal-backdrop permission-backdrop"><div className="feedback-modal permission-modal">
    <span className="section-number">CLAUDE AGENT SDK · {isMcpForm || isMcpUrl ? "MCP ELICITATION" : "PERMISSION"}</span>
    <h2>{request.title}</h2>
    <div className="permission-summary"><ShieldCheck size={22} /><div><b>{request.toolName}</b><p>{request.description || request.decisionReason || (isQuestion ? "Agent 需要你的回答后继续当前任务。" : "Agent 已暂停，等待你决定是否执行这个工具。")}</p></div></div>
    {request.blockedPath && <p className="permission-path"><FolderOpen size={14} />{request.blockedPath}</p>}
    {isQuestion ? <div className="agent-question-list">{questions.map((item) => <section key={item.question}><span>{item.header || "Agent 提问"}</span><b>{item.question}</b><div>{item.options?.map((option) => { const selected = Array.isArray(answers[item.question]) ? (answers[item.question] as string[]).includes(option.label) : answers[item.question] === option.label; return <button className={selected ? "selected" : ""} key={option.label} onClick={() => answerQuestion(item.question, option.label, item.multiSelect)}><i>{selected ? <Check size={13} /> : null}</i><em><strong>{option.label}</strong><small>{option.description}</small></em></button>; })}</div><input placeholder="也可以输入自己的答案" value={typeof answers[item.question] === "string" && !item.options?.some((option) => option.label === answers[item.question]) ? answers[item.question] as string : ""} onChange={(event) => setAnswers((current) => ({ ...current, [item.question]: event.target.value }))} /></section>)}</div>
      : isMcpForm ? <div className="mcp-elicitation-form">{mcpFields.map(([name, field]) => <label key={name}><span>{field.title || name}{schema?.required?.includes(name) ? " *" : ""}</span><small>{field.description}</small>{field.enum?.length ? <select value={String(mcpValues[name] ?? "")} onChange={(event) => setMcpValues((current) => ({ ...current, [name]: event.target.value }))}><option value="">请选择</option>{field.enum.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select> : field.type === "boolean" ? <input type="checkbox" checked={Boolean(mcpValues[name])} onChange={(event) => setMcpValues((current) => ({ ...current, [name]: event.target.checked }))} /> : <input type={field.type === "number" || field.type === "integer" ? "number" : "text"} value={String(mcpValues[name] ?? "")} onChange={(event) => setMcpValues((current) => ({ ...current, [name]: field.type === "number" || field.type === "integer" ? Number(event.target.value) : event.target.value }))} />}</label>)}</div>
      : isMcpUrl ? <div className="mcp-url-request"><Link2 size={20} /><div><b>在浏览器完成授权</b><p>授权页面不会把你的凭证展示给 Agent。完成后回到这里继续。</p><button className="outline-button" disabled={!request.url} onClick={() => request.url && void bridge.openExternalUrl(request.url)}>打开 HTTPS 授权页</button></div></div>
      : <pre className="permission-input">{inputPreview.length > 5000 ? `${inputPreview.slice(0, 5000)}\n…` : inputPreview}</pre>}
    <p className="credential-help">允许后，任务会从暂停处继续，不会重新开始。当前项目模式：{permissionLevelLabel(accessLevel)}。{accessLevel === "askEveryTime" && !isQuestion && !isMcpForm && !isMcpUrl ? "该模式不会记住单项工具授权；如需减少询问，请在对话框旁切换模式。" : "拒绝原因会返回给 Agent，Agent 可以换一种方法完成。"}</p>
    <div className="modal-actions permission-actions"><button className="text-button" onClick={() => void onResolve({ id: request.id, behavior: "deny", message: "用户拒绝了这个操作，请换一种安全方法或说明为什么无法继续。" })}>{isQuestion ? "跳过" : "拒绝"}</button>{request.canRemember && !isQuestion && !isMcpForm && !isMcpUrl && <button className="outline-button remember-permission" disabled={!questionsAnswered || !mcpFormComplete} onClick={() => void allow("allow_always")}><ShieldCheck size={14} />本项目始终允许</button>}<button className="primary-button" disabled={!questionsAnswered || !mcpFormComplete} onClick={() => void allow()}>{isQuestion ? "提交回答" : isMcpUrl ? "我已完成授权" : isMcpForm ? "提交给 MCP" : "仅允许这一次"} <ArrowRight size={15} /></button></div>
  </div></div>;
}

function MemoryCenter({ state, context }: { state: BootstrapState; context?: WorkbenchVersionContext }) {
  const [tab, setTab] = useState<HarnessTab>("memory");
  const harness = state.harness;
  const content = harness?.[tab] || (tab === "memory" || tab === "user" ? "（当前核心记忆为空）" : "还没有生成这份人格文件。");
  const coreUsage = Math.max(state.memoryCore.memory.percent, state.memoryCore.user.percent);
  const knowledge = state.sources.filter((source) => source.kind === "workspace");
  const tabs: Array<{ id: HarnessTab; label: string; desc: string }> = [
    { id: "memory", label: "MEMORY.md", desc: "Agent 笔记 · 2200" },
    { id: "user", label: "USER.md", desc: "用户画像 · 1375" },
    { id: "soul", label: "SOUL.md", desc: "价值与决策内核" },
    { id: "style", label: "STYLE.md", desc: "表达指纹" },
    { id: "qa", label: "Q&A.md", desc: "常见问答惯例" },
    { id: "claude", label: "CLAUDE.md", desc: "运行规则" },
  ];
  return (
    <div className="page page-enter">
      <PageTitle eyebrow="MEMORY AS IDENTITY" title="记忆是大脑，不是仓库" subtitle={context?.twinVersionId ? `当前查看分支 ${context.branchName} 的冻结 Harness；不会混入其他分身版本。` : "当前分支尚未发布 Harness；先完成人格蒸馏。"} />
      <section className="human-persona-grid">
        <div><span>IDENTITY</span><b>{state.profile?.name || "未知"}</b><p>{state.profile?.role || "角色尚未核验"}<br />{state.profile?.bio || "等待 HR 键盘补全"}</p></div>
        <div><span>EXPRESSION</span><b>表达画像</b><p>{state.profile?.communicationStyle || "等待从本人真实语言中建模"}</p></div>
        <div><span>DECISION</span><b>判断与边界</b><p>{state.profile?.decisionPrinciples || "决策证据不足"}<br />{state.profile?.boundaries || "边界尚未确认"}</p></div>
        <div><span>RELATION & CONTEXT</span><b>{state.dwsEvidence?.departments.join(" / ") || "组织关系待同步"}</b><p>{state.dwsEvidence ? `上级 ${state.dwsEvidence.supervisor ?? "未知"} · 直属关系 ${state.dwsEvidence.directReports.length} 人` : "通过数据采集师读取 DWS 后生成"}</p></div>
      </section>
      <section className="memory-shell">
        <aside className="memory-tabs"><div className="memory-summary"><BrainCircuit size={25} /><div><b>{state.memoryCount}</b><span>条策展核心记忆</span></div></div>{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><FileText size={17} /><span><b>{item.label}</b><small>{item.desc}</small></span><ChevronRight size={15} /></button>)}</aside>
        <article className="markdown-paper"><header><span><FileText size={17} />{tabs.find((item) => item.id === tab)?.label}</span><em>{context?.twinVersionId ? `FROZEN VERSION · 更新于 ${harness ? new Date(harness.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}` : "尚未发布"}</em><button className="outline-button small" onClick={() => void bridge.revealProfile()}>本地档案</button></header><MarkdownLite content={content} /></article>
        <aside className="memory-inspector"><span className="panel-kicker">BOUNDED CORE</span><h3>核心占用</h3><div className="health-ring" style={{ background: `conic-gradient(var(--moss) 0 ${coreUsage}%, #d6d5cd ${coreUsage}%)` }}><span>{coreUsage}<small>%</small></span></div><div className="memory-capacity"><CoreUsage label="MEMORY" usage={state.memoryCore.memory} /><CoreUsage label="USER" usage={state.memoryCore.user} /></div><ul><li><i className="high" /><span><b>情节会话</b> {state.memoryCore.episodicSessions} 个</span></li><li><i className="medium" /><span><b>可检索消息</b> {state.memoryCore.episodicMessages} 条</span></li><li><i className="low" /><span><b>外部 Provider</b> {state.memoryCore.externalProvider ?? "未启用"}</span></li></ul><div className="memory-rule"><CircleAlert size={17} /><p><b>会话记忆快照（Frozen Snapshot）</b>：一次对话开始时固定读取 USER.md 与 MEMORY.md。中途学到的新内容会立即落盘，但从下一次新对话才参与回答，避免同一会话里人格规则突然改变。</p></div></aside>
      </section>
      <section className="knowledge-memory-zone">
        <div><span className="panel-kicker">ON-DEMAND KNOWLEDGE</span><h2>本版本知识库</h2><p>这里只显示当前分支加入的资料。新建分身版本默认从空白知识库开始，不会自动继承其他版本。</p><button className="outline-button small" onClick={() => void bridge.revealPersonaWorkspace(context)}><FolderOpen size={14} />打开本版本目录</button></div>
        <div className="knowledge-memory-list">{knowledge.length ? knowledge.slice(0, 8).map((source) => <article key={source.id}><BookOpen size={16} /><span><b>{source.name}</b><small>{source.itemCount} 项 · {source.detail}</small></span><em>按需</em></article>) : <div className="empty-knowledge"><Archive size={22} /><span>还没有知识库材料</span></div>}</div>
      </section>
    </div>
  );
}

function CoreUsage({ label, usage }: { label: string; usage: BootstrapState["memoryCore"]["memory"] }) {
  return <div><span><b>{label}</b><em>{usage.used}/{usage.limit}</em></span><i><u style={{ width: `${usage.percent}%` }} /></i><small>{usage.entries} 条 · {usage.percent}%</small></div>;
}

function MarkdownLite({ content }: { content: string }) {
  return <div className="markdown-content">{content.split("\n").map((line, index) => line.trim() === "§" ? <div className="memory-delimiter" key={index}><span>§</span></div> : line.startsWith("# ") ? <h1 key={index}>{line.slice(2)}</h1> : line.startsWith("## ") ? <h2 key={index}>{line.slice(3)}</h2> : line.startsWith("- ") ? <p className="md-list" key={index}><span>—</span>{line.slice(2)}</p> : line.trim() ? <p key={index}>{line}</p> : <br key={index} />)}</div>;
}


function DingTalk({ state, conversations, drafts, busy, runtimeMessage, onSave, onSaveRobot, onStart, onStartRobot, onStopRobot, onStop, onSend }: { state: BootstrapState; conversations: PersonaConversation[]; drafts: DingTalkDraft[]; busy: string | null; runtimeMessage: string; onSave: (config: DingTalkGatewayInput) => Promise<BootstrapState | undefined>; onSaveRobot: (robotId: string, config: DingTalkGatewayInput) => Promise<BootstrapState | undefined>; onStart: (config: DingTalkConfig) => Promise<unknown>; onStartRobot: (robotId: string, config: DingTalkConfig) => Promise<unknown>; onStopRobot: (robotId: string) => Promise<unknown>; onStop: () => Promise<unknown>; onSend: (draft: DingTalkDraft) => void }) {
  const personaName = `${state.profile?.name || "当前用户"}的数字分身`;
  const publishedConversations = conversations.filter((item) => item.publishedVersionId);
  const conversationBranchIds = new Set(publishedConversations.map((item) => item.versionBranchId));
  const conversationVersionIds = new Set(publishedConversations.map((item) => item.publishedVersionId));
  const latestLegacyVersions = [...state.versions.filter((item) => item.kind === "twin" && !(item.branchId && conversationBranchIds.has(item.branchId)) && !conversationVersionIds.has(item.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((item, index, all) => all.findIndex((candidate) => candidate.name === item.name) === index);
  const personaOptions = [
    ...publishedConversations.map((item) => {
      const profile = state.profiles.find((entry) => entry.personaId === item.personaId && entry.branchId === item.versionBranchId)?.profile;
      const optionPersonaName = `${profile?.name || state.profile?.name || "当前用户"}的数字分身`;
      return { id: item.publishedVersionId!, personaId: item.personaId, branchId: item.versionBranchId, personaName: optionPersonaName, name: item.title, detail: `${optionPersonaName} · 已发布 v${item.publishedVersionNumber ?? 1}${item.archivedAt ? " · 回收站" : ""}` };
    }),
    ...latestLegacyVersions.map((item) => ({ id: item.id, personaId: item.personaId || "primary", branchId: item.branchId, personaName, name: item.note?.split(" · ")[0] || (item.name === "default" ? "现有默认分身" : item.name), detail: `${personaName} · 已发布 v${item.version}` })),
  ];
  const defaultTwin = personaOptions[0];
  const emptyGroup = (): DingTalkGatewayInput["groups"][number] => { const id = crypto.randomUUID(); return { id, robotId: "enterprise-stream-primary", groupId: "", name: "未命名群聊", openConversationId: "", personaId: defaultTwin?.personaId || "primary", branchId: defaultTwin?.branchId, personaName: defaultTwin?.personaName || personaName, twinVersionId: defaultTwin?.id, twinVersionName: defaultTwin?.name, robotName: "企业应用机器人", gatewayType: "stream", enabled: true, contextEnabled: true, replyMode: "draft", triggerMode: "all", triggerWords: [] }; };
  const emptyConfig: DingTalkGatewayInput = { targetType: "group", targetId: "", profile: state.runtime.dwsCurrentProfile?.profile ?? "", mode: "draft", streamConfigured: false, webhookConfigured: false, clientId: "", clientSecret: "", groups: [emptyGroup()] };
  const [config, setConfig] = useState<DingTalkGatewayInput>(() => state.dingTalk ? { ...state.dingTalk, groups: state.dingTalk.groups.map((group) => ({ ...group })) } : emptyConfig);
  const [selectedGroupId, setSelectedGroupId] = useState(() => (state.dingTalk?.groups[0]?.id ?? emptyConfig.groups[0].id));
  const [running, setRunning] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<DingTalkRuntimeStatus>({ running: false, streamConnected: false, streamConfigured: Boolean(state.dingTalk?.streamConfigured), webhookConnected: false, webhookConfigured: Boolean(state.dingTalk?.webhookConfigured), webhookGroups: 0, busConnected: false, robotGroups: 0, contextGroups: 0, groupIds: [], activeRobotIds: state.dingTalk?.activeRobotIds ?? [] });
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);
  const [pendingRobotId, setPendingRobotId] = useState<string | null>(null);
  const preserveDraftForRobot = useRef<string | null>(null);
  const updateGroup = (id: string, patch: Partial<DingTalkGatewayInput["groups"][number]>) => setConfig((item) => ({ ...item, groups: item.groups.map((group) => group.id === id ? { ...group, ...patch } : group) }));
  useEffect(() => {
    if (!state.dingTalk) return;
    if (preserveDraftForRobot.current) {
      const robotId = preserveDraftForRobot.current;
      preserveDraftForRobot.current = null;
      setConfig((current) => ({ ...current, activeRobotIds: state.dingTalk?.activeRobotIds, groups: current.groups.map((group) => {
        if (dingTalkRobotIdUi(group) !== robotId) return group;
        return state.dingTalk?.groups.find((saved) => saved.id === group.id) ?? group;
      }) }));
      return;
    }
    const next = { ...state.dingTalk, groups: state.dingTalk.groups.map((group) => {
      const selectedTwin = personaOptions.find((item) => item.id === group.twinVersionId);
      return { ...group, robotId: group.robotId || ((group.gatewayType ?? "stream") === "stream" ? "enterprise-stream-primary" : `webhook:${group.id}`), groupId: group.groupId || group.openConversationId, personaId: group.personaId || selectedTwin?.personaId || "primary", branchId: group.branchId || selectedTwin?.branchId, personaName: group.personaName || selectedTwin?.personaName || personaName, twinVersionId: group.twinVersionId || selectedTwin?.id, twinVersionName: selectedTwin?.name || group.twinVersionName, robotName: group.robotName || ((group.gatewayType ?? "stream") === "stream" ? "企业应用机器人" : `${group.name || "未命名群聊"} · 自定义机器人`) };
    }) };
    setConfig(next);
    if (!next.groups.some((group) => group.id === selectedGroupId)) setSelectedGroupId(next.groups[0]?.id ?? "");
  }, [state.dingTalk, state.versions, conversations]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const status = await bridge.getDingTalkStatus();
        if (!active) return;
        setRunning(status.running);
        setRuntimeStatus(status);
      } catch {
        if (!active) return;
        setRunning(false);
        setRuntimeStatus({ running: false, streamConnected: false, streamConfigured: Boolean(state.dingTalk?.streamConfigured), webhookConnected: false, webhookConfigured: Boolean(state.dingTalk?.webhookConfigured), webhookGroups: 0, busConnected: false, robotGroups: 0, contextGroups: 0, groupIds: [], activeRobotIds: [] });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const enabledGroups = config.groups.filter((group) => group.enabled);
  const selectedGroup = config.groups.find((group) => group.id === selectedGroupId) ?? config.groups[0];
  const streamGroups = config.groups.filter((group) => (group.gatewayType ?? "stream") === "stream");
  const webhookGroups = config.groups.filter((group) => group.gatewayType === "webhook");
  const streamRobotGroups = [...new Map(streamGroups.map((group) => [group.robotId || "enterprise-stream-primary", group])).values()];
  const groupCount = new Set(config.groups.map((group) => group.openConversationId.trim()).filter(Boolean)).size;
  const robotCount = streamRobotGroups.length + new Set(webhookGroups.map((group) => group.robotId || group.id)).size;
  const streamRobotReady = (group: DingTalkGatewayInput["groups"][number]) => group.streamConfigured || streamGroups.some((candidate) => (candidate.robotId || "enterprise-stream-primary") === (group.robotId || "enterprise-stream-primary") && candidate.streamClientId?.trim() && candidate.streamClientSecret?.trim()) || ((group.robotId || "enterprise-stream-primary") === "enterprise-stream-primary" && Boolean(config.clientId?.trim() && config.clientSecret?.trim()));
  const canSave = enabledGroups.some((group) => group.openConversationId.trim()) && enabledGroups.every((group) => Boolean(group.twinVersionId) && ((group.gatewayType ?? "stream") === "stream" ? Boolean(streamRobotReady(group)) : Boolean((group.webhookConfigured || group.webhookUrl?.trim()) && group.triggerWords.some((word) => word.trim()))));
  const addBinding = () => {
    const group = emptyGroup();
    setConfig((item) => ({ ...item, groups: [...item.groups, group] }));
    setSelectedGroupId(group.id);
  };
  async function save() {
    const first = config.groups.find((group) => group.openConversationId.trim());
    const next = await onSave({ ...config, targetId: first?.openConversationId ?? "", mode: first?.replyMode ?? "draft" });
    if (next?.dingTalk) setConfig({ ...next.dingTalk, groups: next.dingTalk.groups.map((group) => ({ ...group })) });
    return next;
  }
  async function saveRobot(robotId: string) {
    const first = config.groups.find((group) => dingTalkRobotIdUi(group) === robotId && group.openConversationId.trim());
    preserveDraftForRobot.current = robotId;
    const next = await onSaveRobot(robotId, { ...config, targetId: first?.openConversationId ?? "", mode: first?.replyMode ?? "draft" });
    if (!next) preserveDraftForRobot.current = null;
    if (next?.dingTalk) setConfig((current) => ({ ...current, activeRobotIds: next.dingTalk?.activeRobotIds, groups: current.groups.map((group) => {
      if (dingTalkRobotIdUi(group) !== robotId) return group;
      return next.dingTalk?.groups.find((saved) => saved.id === group.id) ?? group;
    }) }));
  }
  async function toggleRobot(robotId: string) {
    if (runtimeStatus.activeRobotIds.includes(robotId)) {
      const result = await onStopRobot(robotId) as DingTalkRuntimeStatus | undefined;
      if (result) { setRuntimeStatus(result); setRunning(result.running); }
      return;
    }
    const auto = config.groups.some((group) => dingTalkRobotIdUi(group) === robotId && group.enabled && group.replyMode === "auto");
    if (auto && !showAutoConfirm) { setPendingRobotId(robotId); setShowAutoConfirm(true); return; }
    await saveRobot(robotId);
    const result = await onStartRobot(robotId, config) as DingTalkRuntimeStatus | undefined;
    if (result) { setRuntimeStatus(result); setRunning(result.running); }
    setShowAutoConfirm(false);
  }
  async function start() {
    if (config.groups.some((group) => group.enabled && group.replyMode === "auto") && !showAutoConfirm) { setPendingRobotId(null); setShowAutoConfirm(true); return; }
    const saved = await save();
    if (!saved?.dingTalk) return;
    const result = await onStart(saved.dingTalk) as DingTalkRuntimeStatus | undefined;
    if (result) { setRunning(result.running); setRuntimeStatus(result); }
    setShowAutoConfirm(false); setPendingRobotId(null);
  }
  return <div className="page page-enter">
    <PageTitle eyebrow="DINGTALK ROUTING" title="把分身版本接到正确的机器人和群" subtitle="每条路由明确选择一个已发布分身版本、一个机器人和一个群聊。版本 Harness 由 Claude Agent SDK 按绑定加载。" action={<div className={running ? "live-badge" : "live-badge off"}><i />{running ? "接入运行中" : "全部已停止"}</div>} />
    <section className="dingtalk-layout">
      <div className="connection-panel">
        <div className="section-heading"><div><span>CONNECTION</span><h2>接入设置</h2></div><div className={state.runtime.dws ? "cli-state good" : "cli-state"}><i />DWS CLI {state.runtime.dws ? "可用" : "未安装"}</div></div>
        <div className="routing-overview">
          <div className="routing-persona"><span className="routing-index">01 · 可绑定的分身版本</span><div><div className="avatar-orbit tiny"><div className="avatar-core">{state.profile?.name?.slice(0, 1) || "分"}</div></div><span><b>{personaName}</b><small>{personaOptions.length ? `${personaOptions.length} 个已发布版本` : "还没有可接入的已发布版本"}</small></span></div><p>每个构建会话是一条独立版本分支；只有完成蒸馏并发布的版本才能绑定机器人。</p></div>
          <div className="routing-metrics"><article><Bot size={17} /><span><b>{robotCount}</b><small>机器人</small></span></article><article><MessageCircleMore size={17} /><span><b>{groupCount}</b><small>已识别群聊</small></span></article><article><Link2 size={17} /><span><b>{enabledGroups.length}</b><small>启用绑定</small></span></article></div>
        </div>
        {!personaOptions.length && <div className="gateway-health"><i /><div><b>暂无可绑定的分身版本</b><p>先在人格工作台完成任一版本的 HR、采集与人格蒸馏，提交 Harness 后再回来接入。</p></div><span>BLOCKED</span></div>}
        <div className={`gateway-health ${running ? "ready" : ""}`}><i /><div><b>{running ? `Stream ${runtimeStatus.robotGroups} 个 · Webhook ${runtimeStatus.webhookGroups} 个正在服务` : "当前没有机器人在自动接收消息"}</b><p>{runtimeMessage || (runtimeStatus.contextGroups ? `DWS 正在监听 ${runtimeStatus.contextGroups} 个群。` : "先完成下方绑定，建议从草稿审阅开始验证。")}</p></div><span>DWS 上下文 {runtimeStatus.contextGroups} 群</span></div>
        <details className="gateway-section">
          <summary><span><KeyRound size={15} /></span><div><b>DWS 群上下文身份</b><small>机器人凭证按机器人保存；这里仅配置可选的旁路上下文身份</small></div><ChevronDown size={15} /></summary>
          <div className="gateway-section-body"><Field label="DWS 身份（可选）" value={config.profile ?? ""} onChange={(profile) => setConfig((item) => ({ ...item, profile }))} placeholder="自动使用当前登录身份" /><p className="profile-inline-help">DWS 身份只用于补全群上下文，不是机器人参数。{state.runtime.dwsCurrentProfile ? `当前：${state.runtime.dwsCurrentProfile.corpName} / ${state.runtime.dwsCurrentProfile.userName}` : "未检测到活动身份"}</p></div>
        </details>
        <details className="gateway-section help-section"><summary><span><CircleAlert size={15} /></span><div><b>钉钉后台怎么配置？</b><small>Stream 与 Webhook 的差异、安全设置和官方文档</small></div><ChevronDown size={15} /></summary><div className="gateway-section-body"><div className="robot-setup-note"><CircleAlert size={17} /><p><b>Stream：</b>在当前应用“机器人”能力页选择 Stream、保存并发布版本。<b>Webhook：</b>在群自定义机器人中设置关键词 / 加签 / IP，由 DWS 接收入站群消息。两类可以同时运行。<a href="https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs" target="_blank" rel="noreferrer">Stream SDK</a><a href="https://open.dingtalk.com/document/robots/customize-robot-security-settings" target="_blank" rel="noreferrer">Webhook 安全设置</a></p></div></div></details>
        <section className="robot-registry">
          <div className="binding-section-title"><span><Bot size={16} /><b>机器人清单</b><small>先确认有哪些出入口，再把群聊绑定上去</small></span><em>{robotCount} 个</em></div>
          <div className="robot-registry-grid">
            {streamRobotGroups.map((robot) => { const robotId = robot.robotId || "enterprise-stream-primary"; const robotBindings = streamGroups.filter((group) => (group.robotId || "enterprise-stream-primary") === robotId); return <RobotRegistryCard key={robotId} robotId={robotId} gateway="stream" groups={robotBindings} configured={streamRobotReady(robot)} running={runtimeStatus.activeRobotIds.includes(robotId)} busy={Boolean(busy)} onSelect={() => setSelectedGroupId(robot.id)} onSave={() => void saveRobot(robotId)} onToggle={() => void toggleRobot(robotId)} />; })}
            {webhookGroups.map((group) => { const robotId = group.robotId || `webhook:${group.id}`; return <RobotRegistryCard key={group.id} robotId={robotId} gateway="webhook" groups={[group]} configured={Boolean(group.webhookConfigured || group.webhookUrl?.trim())} running={runtimeStatus.activeRobotIds.includes(robotId)} busy={Boolean(busy)} onSelect={() => setSelectedGroupId(group.id)} onSave={() => void saveRobot(robotId)} onToggle={() => void toggleRobot(robotId)} />; })}
          </div>
        </section>

        <section className="binding-workbench">
          <div className="binding-section-title"><span><Link2 size={16} /><b>分身版本 × 机器人 × 群聊</b><small>一行就是一条清晰、可独立启停的回复路由</small></span><button onClick={addBinding}>+ 新建绑定</button></div>
          <div className="binding-layout">
            <div className="binding-list">
              {config.groups.map((group) => <button className={selectedGroup?.id === group.id ? "binding-row selected" : "binding-row"} key={group.id} onClick={() => setSelectedGroupId(group.id)}>
                <span className="binding-enabled"><i className={group.enabled ? "on" : ""} /></span>
                <span className="binding-persona"><b>{group.twinVersionName || "未选择版本"}</b><small>{group.personaName || personaName}</small></span>
                <ChevronRight size={13} />
                <span className="binding-robot"><b>{group.robotName || ((group.gatewayType ?? "stream") === "stream" ? "企业应用机器人" : "自定义机器人")}</b><small>{(group.gatewayType ?? "stream") === "stream" ? "Stream" : "Webhook"}</small></span>
                <ChevronRight size={13} />
                <span className="binding-group"><b>{group.name || "未命名群聊"}</b><small>{group.openConversationId ? compactIdentifier(group.openConversationId) : "等待 openConversationId"}</small></span>
                <em className={group.replyMode}>{group.replyMode === "auto" ? "自动" : "草稿"}</em>
              </button>)}
            </div>

            {selectedGroup && <div className="binding-editor">
              <header><div><span>编辑绑定</span><h3>{selectedGroup.name || "未命名群聊"}</h3></div><label><input type="checkbox" checked={selectedGroup.enabled} onChange={(event) => updateGroup(selectedGroup.id, { enabled: event.target.checked })} />{selectedGroup.enabled ? "已启用" : "已停用"}</label></header>
              <div className="binding-editor-grid">
                <label><span>回复分身版本</span><select value={selectedGroup.twinVersionId || ""} disabled={!personaOptions.length} onChange={(event) => { const persona = personaOptions.find((item) => item.id === event.target.value); if (persona) updateGroup(selectedGroup.id, { personaId: persona.personaId, branchId: persona.branchId, personaName: persona.personaName, twinVersionId: persona.id, twinVersionName: persona.name }); }}><option value="" disabled>请选择已发布版本</option>{personaOptions.map((persona) => <option value={persona.id} key={persona.id}>{persona.name} · {persona.detail}</option>)}</select><small>切换后，该群后续新消息会加载这个版本冻结的 Harness 与核心记忆。</small></label>
                <label><span>机器人类型</span><select value={selectedGroup.gatewayType ?? "stream"} onChange={(event) => updateGroup(selectedGroup.id, { gatewayType: event.target.value as "stream" | "webhook", robotName: event.target.value === "stream" ? "企业应用机器人" : `${selectedGroup.name || "未命名群聊"} · 自定义机器人`, triggerMode: event.target.value === "webhook" ? "keyword" : "all" })}><option value="stream">企业应用机器人 · Stream</option><option value="webhook">自定义机器人 · Webhook</option></select><small>{(selectedGroup.gatewayType ?? "stream") === "stream" ? "同一个应用机器人可加入多个群" : "自定义机器人 Webhook 与当前群一对一"}</small></label>
                <label><span>机器人显示名</span><input value={selectedGroup.robotName ?? ""} onChange={(event) => updateGroup(selectedGroup.id, { robotName: event.target.value })} placeholder="例如：示例主管数字分身" /></label>
                <label><span>群聊名称</span><input value={selectedGroup.name} onChange={(event) => updateGroup(selectedGroup.id, { name: event.target.value })} placeholder="仅本地备注，用于识别群聊" /></label>
                <label className="wide"><span>群 openConversationId</span><input className="mono" value={selectedGroup.openConversationId} onChange={(event) => updateGroup(selectedGroup.id, { openConversationId: event.target.value, groupId: event.target.value })} placeholder="cid…" /></label>
              </div>
              {(selectedGroup.gatewayType ?? "stream") === "stream" && <div className="binding-webhook stream-credentials"><span>Stream 企业应用机器人</span><input value={selectedGroup.robotId ?? "enterprise-stream-primary"} onChange={(event) => updateGroup(selectedGroup.id, { robotId: event.target.value, streamConfigured: false })} placeholder="本地机器人 ID，例如 enterprise-stream-primary" /><input value={selectedGroup.streamClientId ?? ""} onChange={(event) => updateGroup(selectedGroup.id, { streamClientId: event.target.value })} placeholder={selectedGroup.streamConfigured ? "Client ID 已加密保存；留空保持不变" : "Client ID（原 AppKey，ding…）"} /><input type="password" value={selectedGroup.streamClientSecret ?? ""} onChange={(event) => updateGroup(selectedGroup.id, { streamClientSecret: event.target.value })} placeholder={selectedGroup.streamConfigured ? "Client Secret 已加密保存；留空保持不变" : "Client Secret（原 AppSecret）"} /><small>同一个机器人 ID 可绑定多个群，并共用一份加密凭证；不同机器人 ID 会建立各自独立的 Stream 连接。</small></div>}
              {selectedGroup.gatewayType === "webhook" && <div className="binding-webhook"><span>Webhook 机器人凭证</span><input type="password" value={selectedGroup.webhookUrl ?? ""} onChange={(event) => updateGroup(selectedGroup.id, { webhookUrl: event.target.value })} placeholder={selectedGroup.webhookConfigured ? "Webhook 已加密保存；留空保持不变" : "https://oapi.dingtalk.com/robot/send?access_token=…"} /><input type="password" value={selectedGroup.webhookSecret ?? ""} onChange={(event) => updateGroup(selectedGroup.id, { webhookSecret: event.target.value })} placeholder="加签 Secret（可选）" /><div><input value={selectedGroup.webhookKeyword ?? ""} onChange={(event) => updateGroup(selectedGroup.id, { webhookKeyword: event.target.value })} placeholder="出站安全关键词" /><input value={selectedGroup.triggerWords.join(", ")} onChange={(event) => updateGroup(selectedGroup.id, { triggerWords: event.target.value.split(/[,，]/).map((word) => word.trim()).filter(Boolean) })} placeholder="入站触发词，例如 @示例主管" /></div></div>}
              <div className="binding-policy"><label><input type="checkbox" checked={selectedGroup.contextEnabled} onChange={(event) => updateGroup(selectedGroup.id, { contextEnabled: event.target.checked })} /><span><b>DWS 群上下文</b><small>回复前读取该群近期上下文</small></span></label><label><span><b>回复模式</b><small>首次接入建议草稿审阅</small></span><select value={selectedGroup.replyMode} onChange={(event) => updateGroup(selectedGroup.id, { replyMode: event.target.value as "draft" | "auto" })}><option value="draft">草稿审阅</option><option value="auto">自动回复</option></select></label></div>
              {config.groups.length > 1 && <button className="remove-binding" onClick={() => { const remaining = config.groups.filter((entry) => entry.id !== selectedGroup.id); setConfig((item) => ({ ...item, groups: remaining })); setSelectedGroupId(remaining[0]?.id ?? ""); }}><Trash2 size={13} />删除这条绑定</button>}
            </div>}
          </div>
        </section>
        <p className="profile-inline-help">Stream 对任何成员的 @机器人消息直接回调；Webhook 本身没有入站能力，由 DWS 监听其他成员的群消息并按触发词交给分身。两者都可以用 DWS 补全上下文。</p>
        <div className="connection-actions global-robot-actions"><span><b>全局控制</b><small>联动所有已启用机器人；单个机器人也可在上方独立控制</small></span><button className="outline-button" onClick={() => void save()} disabled={!canSave || Boolean(busy)}>保存全部配置</button>{running ? <button className="stop-button" onClick={() => { void onStop().then((result) => { setRunning(false); if (result) setRuntimeStatus(result as DingTalkRuntimeStatus); }); }}><Square size={14} fill="currentColor" />停止全部</button> : <button className="primary-button" onClick={() => void start()} disabled={!config.groups.some((group) => group.enabled && group.twinVersionId && group.openConversationId.trim() && ((group.gatewayType ?? "stream") === "stream" ? streamRobotReady(group) : group.webhookConfigured)) || Boolean(busy)}><Play size={15} fill="currentColor" />启动全部已启用机器人</button>}</div>
        <details className="gateway-section routing-help"><summary><span><Radio size={15} /></span><div><b>消息怎么流转？</b><small>接收消息 → 加载所选分身版本 → 生成草稿或自动回复</small></div><ChevronDown size={15} /></summary><div className="gateway-section-body"><p className="profile-inline-help">Stream 直接接收群成员的 @机器人消息；Webhook 由 DWS 识别入站群消息。两条链路都会先找到当前群绑定的版本 Harness，再交给 Claude Agent SDK 回复，最后回到原群。</p></div></details>
      </div>
      <div className="draft-panel"><div className="section-heading"><div><span>REVIEW QUEUE</span><h2>待审回复</h2></div><em>{drafts.filter((item) => ["processing", "draft", "failed"].includes(item.status)).length} 条待处理</em></div>{drafts.length === 0 ? <div className="empty-drafts"><div><MessageCircleMore size={27} /><span /></div><h3>等待第一条 @机器人消息</h3><p>让任意群成员 @已发布并加入该群的企业应用机器人。Stream 收到并安全落盘后会立即出现在这里；自动模式仍会显示处理状态并直接回复原群。</p></div> : <div className="draft-list">{drafts.map((draft) => <DraftCard key={draft.id} draft={draft} onSend={onSend} />)}</div>}</div>
    </section>
    {showAutoConfirm && <div className="modal-backdrop"><div className="feedback-modal danger-modal"><button className="modal-close" onClick={() => { setShowAutoConfirm(false); setPendingRobotId(null); }}><X size={18} /></button><span className="section-number">HIGH IMPACT MODE</span><h2>确认开启机器人自动回复？</h2><div className="danger-copy"><CircleAlert size={22} /><p>配置为自动回复的机器人会在对应群中真实发言。请确认群成员知情，并先在草稿模式验证人格、事实与边界。</p></div><div className="modal-actions"><button className="text-button" onClick={() => { setShowAutoConfirm(false); setPendingRobotId(null); }}>取消</button><button className="danger-button" onClick={() => void (pendingRobotId ? toggleRobot(pendingRobotId) : start())}>我已确认{pendingRobotId ? "该机器人" : "全部群范围"}，开启</button></div></div></div>}
  </div>;
}

function RobotRegistryCard({ robotId, gateway, groups, configured, running, busy, onSelect, onSave, onToggle }: { robotId: string; gateway: "stream" | "webhook"; groups: DingTalkGatewayInput["groups"]; configured: boolean; running: boolean; busy: boolean; onSelect: () => void; onSave: () => void; onToggle: () => void }) {
  const first = groups[0];
  const robotName = first?.robotName || (gateway === "stream" ? "企业应用机器人" : `${first?.name || "未命名群聊"} · 自定义机器人`);
  return <article className={`robot-registry-card ${gateway} ${configured ? "configured" : ""} ${running ? "running" : ""}`} onClick={onSelect}>
    <header>
      <div className="robot-avatar">{gateway === "stream" ? <Bot size={22} /> : <Send size={21} />}<i /></div>
      <span><small>{gateway === "stream" ? "企业应用 · Stream" : "群自定义 · Webhook"}</small><b>{robotName}</b><em>{compactIdentifier(robotId)}</em></span>
      <strong className={running ? "online" : "offline"}>{running ? "运行中" : "已停止"}</strong>
    </header>
    <div className="robot-route-stack">
      {groups.slice(0, 3).map((group) => <div className="robot-route" key={group.id}>
        <span><MessageCircleMore size={14} /><small>群聊</small><b>{group.name || "未命名群聊"}</b></span>
        <ChevronRight size={13} />
        <span><UserRound size={14} /><small>回复分身</small><b>{group.twinVersionName || "尚未选择分身版本"}</b><em>{group.personaName || "待绑定人格"}</em></span>
      </div>)}
      {groups.length > 3 && <button className="robot-more-routes">另有 {groups.length - 3} 条群聊路由</button>}
    </div>
    <footer><span>{groups.length} 个群聊绑定 · {configured ? "凭证已保存" : "等待配置凭证"}</span><div className="robot-card-actions"><button onClick={(event) => { event.stopPropagation(); onSave(); }} disabled={!configured || busy}>保存</button><button className={running ? "stop" : "start"} onClick={(event) => { event.stopPropagation(); onToggle(); }} disabled={!configured || busy}>{running ? <><Square size={13} />停止</> : <><Play size={13} />启动</>}</button></div></footer>
  </article>;
}

function DraftCard({ draft, onSend }: { draft: DingTalkDraft; onSend: (draft: DingTalkDraft) => void }) {
  const [reply, setReply] = useState(draft.reply);
  useEffect(() => setReply(draft.reply), [draft.id, draft.reply]);
  const retryable = draft.status === "draft" || draft.status === "failed";
  return <div className={`draft-card ${draft.status}`}><header><span><i />{draft.senderId}</span><em>{new Date(draft.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</em></header><div className="incoming"><small>收到</small><p>{draft.incoming}</p></div><div className="reply-draft"><small>{draft.status === "processing" ? "分身正在生成" : "分身草稿"}</small><textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={4} disabled={draft.status === "processing"} placeholder={draft.status === "processing" ? "原始消息已保存，正在读取附件与上下文…" : undefined} /></div>{draft.deliveryError && <p className="draft-delivery-error"><CircleAlert size={14} />{draft.deliveryError}</p>}<footer><span>{draft.status === "processing" ? "已接收并落盘，正在处理" : draft.status === "sent" ? <><Check size={14} />已发送</> : draft.status === "failed" ? "处理或发送失败，原始消息已保留" : "发送前请核对对象与内容"}</span>{retryable && <button className="primary-button small" onClick={() => onSend({ ...draft, reply })} disabled={!reply.trim()}><Send size={14} />{draft.status === "failed" ? "重新发送" : "确认发送"}</button>}</footer></div>;
}

function PageTitle({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <header className="page-title"><div><span>{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>;
}

function VersionRequiredEmpty({ title, detail, onGo }: { title: string; detail: string; onGo: () => void }) {
  return <div className="page version-required page-enter"><div><WandSparkles size={28} /><span /></div><small>VERSION REQUIRED</small><h1>{title}</h1><p>{detail}</p><button className="primary-button" onClick={onGo}>回到人格工作台 <ArrowRight size={15} /></button></div>;
}

function BusyRail({ label, startedAt }: { label: string; startedAt?: number }) {
  const elapsed = useElapsed(startedAt);
  return <div className="busy-rail"><LoaderCircle size={16} className="spin" /><span>{label}</span><b><Timer size={12} />{formatDuration(elapsed)}</b></div>;
}
function Toast({ tone, text, close }: { tone: "info" | "error" | "success"; text: string; close: () => void }) { return <div className={`toast ${tone}`}>{tone === "error" ? <CircleAlert size={17} /> : tone === "success" ? <Check size={17} /> : <Sparkles size={17} />}<span>{text}</span><button onClick={close}><X size={15} /></button></div>; }

function isClaudeAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /CLAUDE_AUTH_REQUIRED|not logged in|please run \/login|authentication|unauthorized|invalid.*api.?key/i.test(message);
}
function getError(error: unknown): string {
  if (isClaudeAuthError(error)) return "模型尚未连接，或 API 凭证已经失效。请重新配置 Anthropic / DeepSeek 连接。";
  return error instanceof Error ? error.message : typeof error === "string" ? error : "操作没有完成，请查看运行环境。";
}
export default App;
