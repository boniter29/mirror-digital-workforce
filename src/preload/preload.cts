const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
import type { AgentPermissionRequest, AgentPermissionResponse, AgentRuntimeSettings, AgentSurface, DingTalkConfig, DingTalkDraft, DingTalkGatewayInput, EvaluationInput, EvaluationSessionInput, EvaluationSessionPatch, ModelConnectionInput, PersonaVersionBranch, RuntimeEvent, TwinBridge, VisualAttachment, WorkbenchVersionContext } from "../shared/types.js";

const bridge: TwinBridge = {
  bootstrap: () => ipcRenderer.invoke("twin:bootstrap"),
  savePersonaBranches: (branches: PersonaVersionBranch[]) => ipcRenderer.invoke("twin:save-persona-branches", branches),
  renamePersonaBranch: (branchId: string, title: string) => ipcRenderer.invoke("twin:rename-persona-branch", branchId, title),
  deletePersonaBranch: (branchId: string) => ipcRenderer.invoke("twin:delete-persona-branch", branchId),
  configureClaude: (input: ModelConnectionInput) => ipcRenderer.invoke("twin:configure-claude", input),
  saveAgentRuntimeSettings: (input: Pick<AgentRuntimeSettings, "maxTurns" | "accessLevel">) => ipcRenderer.invoke("twin:save-agent-runtime-settings", input),
  importFiles: (context: WorkbenchVersionContext) => ipcRenderer.invoke("twin:import-files", context),
  importFolder: (context: WorkbenchVersionContext) => ipcRenderer.invoke("twin:import-folder", context),
  importWorkspaceFiles: (context: WorkbenchVersionContext) => ipcRenderer.invoke("twin:import-workspace-files", context),
  importWorkspaceFolder: (context: WorkbenchVersionContext) => ipcRenderer.invoke("twin:import-workspace-folder", context),
  chooseWorkspace: (context: WorkbenchVersionContext) => ipcRenderer.invoke("twin:choose-workspace", context),
  installSkill: () => ipcRenderer.invoke("twin:install-skill"),
  agentChat: (surface: AgentSurface, prompt: string, sessionId?: string, versionContext?: WorkbenchVersionContext) => ipcRenderer.invoke("twin:agent-chat", surface, prompt, sessionId, versionContext),
  loadAgentConversation: (surface: AgentSurface, context?: WorkbenchVersionContext) => ipcRenderer.invoke("twin:load-agent-conversation", surface, context),
  deleteAgentConversation: (sessionIds: string[]) => ipcRenderer.invoke("twin:delete-agent-conversation", sessionIds),
  listSkills: () => ipcRenderer.invoke("twin:list-skills"),
  readSkill: (name: string) => ipcRenderer.invoke("twin:read-skill", name),
  previewSource: (sourceId: string, context?: WorkbenchVersionContext) => ipcRenderer.invoke("twin:preview-source", sourceId, context),
  listVersions: () => ipcRenderer.invoke("twin:list-versions"),
  readTwinVersion: (versionId: string, context?: WorkbenchVersionContext) => ipcRenderer.invoke("twin:read-version", versionId, context),
  pickVisualAttachments: (context: WorkbenchVersionContext) => ipcRenderer.invoke("twin:pick-visual-attachments", context),
  stageVisualAttachments: (context, files) => ipcRenderer.invoke("twin:stage-visual-attachments", context, files),
  pasteVisualAttachment: (context) => ipcRenderer.invoke("twin:paste-visual-attachment", context),
  chat: (prompt: string, sessionId: string | undefined, context: WorkbenchVersionContext, attachments?: VisualAttachment[]) => ipcRenderer.invoke("twin:chat", prompt, sessionId, context, attachments),
  loadTwinConversation: (sessionId: string, context: WorkbenchVersionContext) => ipcRenderer.invoke("twin:load-twin-conversation", sessionId, context),
  createEvaluationSession: (input: EvaluationSessionInput) => ipcRenderer.invoke("twin:create-evaluation-session", input),
  updateEvaluationSession: (id: string, patch: EvaluationSessionPatch) => ipcRenderer.invoke("twin:update-evaluation-session", id, patch),
  saveEvaluation: (input: EvaluationInput) => ipcRenderer.invoke("twin:save-evaluation", input),
  reviewEvaluations: (context: WorkbenchVersionContext) => ipcRenderer.invoke("twin:review-evaluations", context),
  listConversationSamples: (limit?: number, twinVersionId?: string, branchId?: string) => ipcRenderer.invoke("twin:list-conversation-samples", limit, twinVersionId, branchId),
  saveDingTalkConfig: (config: DingTalkGatewayInput) => ipcRenderer.invoke("twin:save-dingtalk", config),
  saveDingTalkRobotConfig: (robotId: string, config: DingTalkGatewayInput) => ipcRenderer.invoke("twin:save-dingtalk-robot", robotId, config),
  startDingTalk: (config: DingTalkConfig) => ipcRenderer.invoke("twin:start-dingtalk", config),
  startDingTalkRobot: (robotId: string, config: DingTalkConfig) => ipcRenderer.invoke("twin:start-dingtalk-robot", robotId, config),
  getDingTalkStatus: () => ipcRenderer.invoke("twin:dingtalk-status"),
  stopDingTalkRobot: (robotId: string) => ipcRenderer.invoke("twin:stop-dingtalk-robot", robotId),
  stopDingTalk: () => ipcRenderer.invoke("twin:stop-dingtalk"),
  sendDingTalk: (draft: DingTalkDraft) => ipcRenderer.invoke("twin:send-dingtalk", draft),
  revealProfile: () => ipcRenderer.invoke("twin:reveal-profile"),
  revealPersonaWorkspace: (context?: WorkbenchVersionContext) => ipcRenderer.invoke("twin:reveal-persona-workspace", context),
  onDingTalkDraft: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, draft: DingTalkDraft) => callback(draft);
    ipcRenderer.on("dingtalk:draft", listener);
    return () => ipcRenderer.removeListener("dingtalk:draft", listener);
  },
  onRuntimeEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: RuntimeEvent) => callback(data);
    ipcRenderer.on("runtime:event", listener);
    return () => ipcRenderer.removeListener("runtime:event", listener);
  },
  onAgentPermissionRequest: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: AgentPermissionRequest) => callback(request);
    ipcRenderer.on("agent:permission-request", listener);
    return () => ipcRenderer.removeListener("agent:permission-request", listener);
  },
  resolveAgentPermission: (response: AgentPermissionResponse) => ipcRenderer.invoke("twin:resolve-agent-permission", response),
  openExternalUrl: (url: string) => ipcRenderer.invoke("twin:open-external-url", url),
};

contextBridge.exposeInMainWorld("twin", bridge);
