export type SourceKind = "onboarding" | "file" | "workspace" | "dingtalk" | "agent";

export interface OnboardingProfile {
  name: string;
  role: string;
  bio: string;
  communicationStyle: string;
  decisionPrinciples: string;
  boundaries: string;
  sampleReply: string;
}

export interface DataSource {
  id: string;
  kind: SourceKind;
  name: string;
  detail: string;
  itemCount: number;
  bytes: number;
  importedAt: string;
  status: "ready" | "processing" | "error";
  personaId?: string;
  branchId?: string;
}

export interface WorkspaceSelection {
  path: string;
  name: string;
  personaId: string;
  branchId: string;
  selectedAt: string;
}

export interface PersonaProfileRecord {
  personaId: string;
  branchId: string;
  profile: OnboardingProfile;
  updatedAt: string;
}

/** Durable index for one independently built digital-twin version branch. */
export interface PersonaVersionBranch {
  id: string;
  personaId: string;
  versionBranchId: string;
  publishedVersionId?: string;
  publishedVersionNumber?: number;
  title: string;
  currentPluginId: AgentPluginId;
  stageSessionIds: Partial<Record<AgentPluginId, string>>;
  completedStages?: AgentPluginId[];
  stageCheckpoints?: Partial<Record<AgentPluginId, AgentStageCheckpoint>>;
  updatedAt: string;
  archivedAt?: string;
  includeLegacyData?: boolean;
  labSessionId?: string;
  calibrationSessionId?: string;
}

export interface SourcePreview {
  sourceId: string;
  title: string;
  logicalPath: string;
  content: string;
  truncated: boolean;
}

export interface DwsEvidenceSummary {
  profile: string;
  userName: string;
  userId: string;
  corpName: string;
  title?: string;
  departments: string[];
  supervisor?: string;
  directReports: string[];
  labels: string[];
  authoredMessages: number;
  styleSamples: number;
  contextMessages: number;
  replyPairs: number;
  mentionQuestions: number;
  privateQuestions: number;
  qaPairs: number;
  conversations: number;
  start: string;
  end: string;
  importedAt: string;
}

export interface HarnessSnapshot {
  claude: string;
  soul: string;
  memory: string;
  user: string;
  style: string;
  qa: string;
  updatedAt: string;
  confidence: number;
}

/** Provider profiles that can feed the Claude Agent SDK through the
 * Anthropic Messages protocol. `custom` is a first-class escape hatch for
 * any other compatible gateway; the Agent runtime itself never changes. */
export type ModelProvider = "anthropic" | "deepseek" | "zhipu" | "openrouter" | "kimi" | "custom";

export type ModelProviderAuthMode = "api_key" | "auth_token";

export type AgentPermissionMode = "auto" | "default" | "acceptEdits" | "bypassPermissions" | "plan";

/** User-facing permission policy. The native SDK mode is derived from this value. */
export type AgentAccessLevel = "full" | "auto" | "sensitive" | "askEveryTime";

export interface AgentRuntimeSettings {
  /** Maximum autonomous agent-loop turns for each user request. */
  maxTurns: number;
  /** Claude Agent SDK native permission mode. */
  permissionMode: AgentPermissionMode;
  /** Product-level permission policy shown in settings. */
  accessLevel: AgentAccessLevel;
  /** Use Claude Code's complete built-in tool preset instead of a reduced tool list. */
  fullToolPreset: true;
  /** Load user, project and local Claude configuration, including Skills, Plugins, hooks and MCP. */
  loadClaudeCodeSettings: true;
  /** Track file edits so an interactive session can rewind them. */
  fileCheckpointing: true;
}

export interface AgentPermissionRequest {
  id: string;
  kind?: "tool" | "mcp_form" | "mcp_url";
  toolName: string;
  input: Record<string, unknown>;
  title: string;
  description?: string;
  blockedPath?: string;
  decisionReason?: string;
  surface: AgentSurface | "twin";
  personaId?: string;
  branchId?: string;
  createdAt: string;
  canRemember: boolean;
  url?: string;
  requestedSchema?: Record<string, unknown>;
}

export interface AgentPermissionResponse {
  id: string;
  behavior: "allow_once" | "allow_always" | "deny";
  updatedInput?: Record<string, unknown>;
  formContent?: Record<string, string | number | boolean | string[]>;
  message?: string;
}

export interface ModelConnectionInput {
  provider: ModelProvider;
  /** Human-readable name for a custom provider profile. */
  providerName?: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  authMode?: ModelProviderAuthMode;
  /** Declare verified native image input support for this exact route. */
  nativeVision?: boolean;
  /** Map all Claude Code task tiers and subagents to the selected model. */
  mapModelTiers?: boolean;
  /** Optional provider context window used by compatible Coding Plan routes. */
  contextWindow?: number;
  agentRuntime?: Pick<AgentRuntimeSettings, "maxTurns" | "accessLevel">;
}

export interface DingTalkConfig {
  targetType: "group";
  targetId: string;
  profile?: string;
  mode: "draft" | "auto";
  streamConfigured: boolean;
  webhookConfigured?: boolean;
  /** Robot ids that should be restored as running after an application restart. */
  activeRobotIds?: string[];
  groups: DingTalkGroupConfig[];
}

export interface DingTalkGroupConfig {
  id: string;
  robotId?: string;
  groupId?: string;
  name: string;
  openConversationId: string;
  personaId?: string;
  branchId?: string;
  personaName?: string;
  twinVersionId?: string;
  twinVersionName?: string;
  robotName?: string;
  gatewayType?: "stream" | "webhook";
  streamConfigured?: boolean;
  webhookConfigured?: boolean;
  webhookKeyword?: string;
  enabled: boolean;
  contextEnabled: boolean;
  replyMode: "draft" | "auto";
  triggerMode: "keyword" | "all";
  triggerWords: string[];
}

export interface DingTalkGroupGatewayInput extends DingTalkGroupConfig {
  streamClientId?: string;
  streamClientSecret?: string;
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface DingTalkGatewayInput extends Omit<DingTalkConfig, "groups"> {
  clientId?: string;
  clientSecret?: string;
  groups: DingTalkGroupGatewayInput[];
}

export type ClaudeAuthMethod =
  | "api_key"
  | "auth_token"
  | "oauth_token"
  | "subscription"
  | "bedrock"
  | "vertex"
  | "foundry"
  | "none";

export interface MemoryUsage {
  used: number;
  limit: number;
  percent: number;
  entries: number;
}

export interface MemoryCoreState {
  memory: MemoryUsage;
  user: MemoryUsage;
  episodicSessions: number;
  episodicMessages: number;
  externalProvider: string | null;
}

export interface BootstrapState {
  initialized: boolean;
  profile?: OnboardingProfile;
  profiles: PersonaProfileRecord[];
  sources: DataSource[];
  harness?: HarnessSnapshot;
  memoryCount: number;
  feedbackCount: number;
  evaluationCount: number;
  pendingEvaluationCount: number;
  evaluationStatsByTwinVersion: Record<string, { total: number; pending: number }>;
  evaluationRecords: EvaluationRecord[];
  evaluationSessions: EvaluationSession[];
  feedbackStatsByBranch: Record<string, number>;
  episodicStatsByTwinVersion: Record<string, { episodicSessions: number; episodicMessages: number }>;
  memoryCore: MemoryCoreState;
  runtime: {
    sdk: boolean;
    credentials: boolean;
    claudeAuthMethod: ClaudeAuthMethod;
    claudeCredentialStorage: "environment" | "encrypted_local" | "session" | "none";
    modelProvider: ModelProvider;
    modelProviderName?: string;
    model: string;
    baseUrl?: string;
    modelAuthMode?: ModelProviderAuthMode;
    nativeVision?: boolean;
    mapModelTiers?: boolean;
    contextWindow?: number;
    dws: boolean;
    dwsVersion?: string;
    dwsCurrentProfile?: {
      profile: string;
      corpName: string;
      userName: string;
      status: string;
    };
    agent: AgentRuntimeSettings;
  };
  dingTalk?: DingTalkConfig;
  dwsEvidence?: DwsEvidenceSummary;
  versions: ArtifactVersion[];
  skills: SkillDescriptor[];
  plugins: AgentPluginDescriptor[];
  workspace?: { path: string; name: string };
  workspaces: WorkspaceSelection[];
  personaBranches: PersonaVersionBranch[];
}

export interface ChatTurn {
  id: string;
  role: "user" | "twin";
  content: string;
  createdAt: string;
  confidence?: number;
  evidence?: string[];
  attachments?: VisualAttachment[];
}

export interface VisualAttachment {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  source: "lab" | "dingtalk" | "workspace";
}

export interface VisualAttachmentBuffer {
  name: string;
  mimeType: string;
  base64: string;
}

export interface ChatReply {
  turn: ChatTurn;
  sessionId?: string;
}

export interface HarnessRevisionResult {
  harness: HarnessSnapshot;
  version: ArtifactVersion;
}

export interface FeedbackInput {
  prompt: string;
  reply: string;
  verdict: "like" | "unlike";
  correction?: string;
  personaId?: string;
  branchId?: string;
  twinVersionId?: string;
}

export type EvaluationLabel = "voice" | "facts" | "judgment" | "boundary" | "length" | "other";

export interface EvaluationInput {
  sampleId?: string;
  prompt: string;
  reply: string;
  expectedReply?: string;
  labels: EvaluationLabel[];
  score: number;
  notes?: string;
  applyNow?: boolean;
  personaId?: string;
  branchId?: string;
  twinVersionId?: string;
  evaluationSessionId?: string;
}

export interface EvaluationRecord extends Omit<EvaluationInput, "applyNow"> {
  id: string;
  createdAt: string;
  status: "pending" | "applied";
  appliedAt?: string;
}

/** One independent evaluation conversation bound to one immutable twin version. */
export interface EvaluationSession {
  id: string;
  personaId: string;
  branchId: string;
  twinVersionId: string;
  title: string;
  sdkSessionId?: string;
  calibrationSdkSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationSessionInput {
  personaId: string;
  branchId: string;
  twinVersionId: string;
  title?: string;
}

export interface EvaluationSessionPatch {
  title?: string;
  sdkSessionId?: string;
  calibrationSdkSessionId?: string;
}

export interface EvaluationSaveResult {
  record: EvaluationRecord;
  revision?: HarnessRevisionResult;
  changedFiles: string[];
  revisionError?: string;
}

export interface DwsImportInput {
  start: string;
  end: string;
  profile?: string;
}

export interface DwsImportResult {
  sources: DataSource[];
  summary: DwsEvidenceSummary;
}

export interface DwsDocumentImportInput {
  queryOrNode: string;
  profile?: string;
}

export interface AutonomousDwsImportInput {
  days: number;
  profile?: string;
  includeMessages: boolean;
  includeKnowledge: boolean;
  includeMinutes: boolean;
  minutesSummaryLimit?: number;
}

export interface AutonomousDwsImportResult {
  sources: DataSource[];
  failures: Array<{ scope: "messages" | "knowledge" | "minutes"; error: string }>;
}

export interface DwsMinutesImportInput {
  start: string;
  end: string;
  profile?: string;
  scope?: "all" | "mine" | "shared";
  summaryLimit?: number;
}

export interface DwsMinutesImportResult {
  sources: DataSource[];
  total: number;
  summariesImported: number;
  pages: number;
  failures: number;
}

export type AgentSurface = "onboarding" | "source" | "distill" | "calibration";

export type AgentPluginId = "hr-keyboard" | "evidence-collector" | "persona-distiller";

export interface AgentPluginDescriptor {
  id: AgentPluginId;
  surface: Exclude<AgentSurface, "calibration">;
  name: string;
  role: string;
  description: string;
  skills: string[];
  accent: "peach" | "sage" | "ink";
}

export interface AgentStep {
  id: string;
  kind: "intent" | "skill" | "tool" | "result" | "warning";
  title: string;
  detail?: string;
  status: "running" | "done" | "error";
  createdAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface OnboardingQuestionOption {
  id: string;
  label: string;
  description?: string;
  suggested?: boolean;
}

export interface OnboardingQuestionCard {
  id: string;
  module?: "work_context" | "collaboration" | "energy" | "response" | "decision" | "relationship" | "boundary" | "language";
  question: string;
  context?: string;
  sourceNote?: string;
  options: OnboardingQuestionOption[];
  allowFreeText: boolean;
  multiSelect: boolean;
  createdAt: string;
}

export interface AgentConversationTurn {
  id: string;
  surface: AgentSurface;
  sessionId?: string;
  operationId?: string;
  executionStatus?: "running" | "completed" | "failed" | "interrupted";
  role: "user" | "agent";
  content: string;
  createdAt: string;
  steps?: AgentStep[];
  questionCard?: OnboardingQuestionCard;
  durationMs?: number;
  personaId?: string;
  branchId?: string;
  twinVersionId?: string;
  stageCheckpoint?: AgentStageCheckpoint;
}

export interface AgentStageCheckpoint {
  pluginId: AgentPluginId;
  status: "ready" | "blocked";
  summary: string;
  checks: Array<{ label: string; status: "pass" | "warn" | "fail"; detail?: string }>;
  createdAt: string;
}

export interface ArtifactVersion {
  id: string;
  kind: "knowledge" | "skill" | "twin";
  name: string;
  version: number;
  parentId?: string;
  note?: string;
  createdAt: string;
  active: boolean;
  personaId?: string;
  branchId?: string;
}

export interface WorkbenchVersionContext {
  personaId: string;
  branchId: string;
  branchName: string;
  twinVersionId?: string;
  includeLegacyData?: boolean;
}

export interface SkillDescriptor {
  name: string;
  description: string;
  builtin: boolean;
  content?: string;
  version: number;
}

export interface SourceAgentReply {
  content: string;
  sessionId?: string;
  sourcesChanged: boolean;
  steps: AgentStep[];
  previewReply?: string;
  questionCard?: OnboardingQuestionCard;
  durationMs?: number;
  committedVersion?: ArtifactVersion;
  stageCheckpoint?: AgentStageCheckpoint;
}

export type WorkbenchAgentReply = SourceAgentReply;

export interface RuntimeEvent {
  stage: string;
  message: string;
  at?: string;
  kind?: "status" | "tool" | "text_delta" | "complete" | "error";
  delta?: string;
  operationId?: string;
  surface?: AgentSurface | "twin" | "feedback" | "evaluation" | "dingtalk" | "global";
  personaId?: string;
  branchId?: string;
  twinVersionId?: string;
  sessionId?: string;
}

export interface DingTalkDraft {
  id: string;
  conversationId: string;
  senderId: string;
  incoming: string;
  reply: string;
  createdAt: string;
  status: "processing" | "draft" | "sent" | "dismissed" | "failed";
  deliveryError?: string;
  bindingId?: string;
  branchId?: string;
  personaId?: string;
  twinVersionId?: string;
  twinVersionName?: string;
  robotId?: string;
  robotName?: string;
  groupId?: string;
  groupName?: string;
}

export type ConversationSampleChannel = "dingtalk_stream" | "dingtalk_webhook";
export type ConversationSampleStatus = "received" | "processing" | "generated" | "draft" | "sent" | "suppressed" | "failed";

export interface ConversationProcessingEvent {
  stage: string;
  status: "info" | "warning" | "error" | "complete";
  at: string;
  message: string;
}

export interface ConversationSampleEvaluation {
  id: string;
  status: "pending" | "applied";
  score: number;
  labels: EvaluationLabel[];
  expectedReply?: string;
  notes?: string;
}

export interface ConversationSample {
  id: string;
  sessionId?: string;
  channel: ConversationSampleChannel;
  conversationId: string;
  groupName: string;
  senderId: string;
  senderName: string;
  prompt: string;
  reply: string;
  status: ConversationSampleStatus;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  deliveryError?: string;
  processingStage?: string;
  processingLog?: ConversationProcessingEvent[];
  evaluation?: ConversationSampleEvaluation;
  bindingId?: string;
  branchId?: string;
  personaId?: string;
  twinVersionId?: string;
  twinVersionName?: string;
  robotId?: string;
  robotName?: string;
  groupId?: string;
  attachments?: VisualAttachment[];
}

export interface TwinBridge {
  bootstrap(): Promise<BootstrapState>;
  savePersonaBranches(branches: PersonaVersionBranch[]): Promise<BootstrapState>;
  renamePersonaBranch(branchId: string, title: string): Promise<BootstrapState>;
  deletePersonaBranch(branchId: string): Promise<BootstrapState>;
  configureClaude(input: ModelConnectionInput): Promise<BootstrapState>;
  saveAgentRuntimeSettings(input: Pick<AgentRuntimeSettings, "maxTurns" | "accessLevel">): Promise<BootstrapState>;
  importFiles(context: WorkbenchVersionContext): Promise<DataSource[]>;
  importFolder(context: WorkbenchVersionContext): Promise<DataSource[]>;
  importWorkspaceFiles(context: WorkbenchVersionContext): Promise<DataSource[]>;
  importWorkspaceFolder(context: WorkbenchVersionContext): Promise<DataSource[]>;
  chooseWorkspace(context: WorkbenchVersionContext): Promise<BootstrapState>;
  installSkill(): Promise<SkillDescriptor[]>;
  agentChat(surface: AgentSurface, prompt: string, sessionId?: string, versionContext?: WorkbenchVersionContext): Promise<WorkbenchAgentReply>;
  loadAgentConversation(surface: AgentSurface, context?: WorkbenchVersionContext): Promise<AgentConversationTurn[]>;
  deleteAgentConversation(sessionIds: string[]): Promise<{ deletedTurns: number }>;
  listSkills(): Promise<SkillDescriptor[]>;
  readSkill(name: string): Promise<SkillDescriptor>;
  previewSource(sourceId: string, context?: WorkbenchVersionContext): Promise<SourcePreview>;
  listVersions(): Promise<ArtifactVersion[]>;
  readTwinVersion(versionId: string, context?: WorkbenchVersionContext): Promise<HarnessSnapshot | undefined>;
  pickVisualAttachments(context: WorkbenchVersionContext): Promise<VisualAttachment[]>;
  stageVisualAttachments(context: WorkbenchVersionContext, files: VisualAttachmentBuffer[]): Promise<VisualAttachment[]>;
  pasteVisualAttachment(context: WorkbenchVersionContext): Promise<VisualAttachment[]>;
  chat(prompt: string, sessionId: string | undefined, context: WorkbenchVersionContext, attachments?: VisualAttachment[]): Promise<ChatReply>;
  loadTwinConversation(sessionId: string, context: WorkbenchVersionContext): Promise<ChatTurn[]>;
  createEvaluationSession(input: EvaluationSessionInput): Promise<EvaluationSession>;
  updateEvaluationSession(id: string, patch: EvaluationSessionPatch): Promise<EvaluationSession>;
  saveEvaluation(input: EvaluationInput): Promise<EvaluationSaveResult>;
  reviewEvaluations(context: WorkbenchVersionContext): Promise<{ applied: number; revision?: HarnessRevisionResult }>;
  listConversationSamples(limit?: number, twinVersionId?: string, branchId?: string): Promise<ConversationSample[]>;
  saveDingTalkConfig(config: DingTalkGatewayInput): Promise<BootstrapState>;
  saveDingTalkRobotConfig(robotId: string, config: DingTalkGatewayInput): Promise<BootstrapState>;
  startDingTalk(config: DingTalkConfig): Promise<DingTalkRuntimeStatus>;
  startDingTalkRobot(robotId: string, config: DingTalkConfig): Promise<DingTalkRuntimeStatus>;
  getDingTalkStatus(): Promise<DingTalkRuntimeStatus>;
  stopDingTalkRobot(robotId: string): Promise<DingTalkRuntimeStatus>;
  stopDingTalk(): Promise<DingTalkRuntimeStatus>;
  sendDingTalk(draft: DingTalkDraft): Promise<DingTalkDraft>;
  revealProfile(): Promise<void>;
  revealPersonaWorkspace(context?: WorkbenchVersionContext): Promise<void>;
  onDingTalkDraft(callback: (draft: DingTalkDraft) => void): () => void;
  onRuntimeEvent(callback: (event: RuntimeEvent) => void): () => void;
  onAgentPermissionRequest(callback: (request: AgentPermissionRequest) => void): () => void;
  resolveAgentPermission(response: AgentPermissionResponse): Promise<boolean>;
  openExternalUrl(url: string): Promise<boolean>;
}

export interface DingTalkRuntimeStatus {
  running: boolean;
  streamConnected: boolean;
  streamConfigured: boolean;
  webhookConnected: boolean;
  webhookConfigured: boolean;
  webhookGroups: number;
  busConnected: boolean;
  robotGroups: number;
  streamRobots?: number;
  contextGroups: number;
  groupIds: string[];
  activeRobotIds: string[];
}
