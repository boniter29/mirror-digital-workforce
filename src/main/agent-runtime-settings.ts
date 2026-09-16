import type { AgentAccessLevel, AgentPermissionMode, AgentRuntimeSettings } from "../shared/types.js";

export const DEFAULT_AGENT_RUNTIME_SETTINGS: AgentRuntimeSettings = {
  maxTurns: 200,
  permissionMode: "default",
  accessLevel: "sensitive",
  fullToolPreset: true,
  loadClaudeCodeSettings: true,
  fileCheckpointing: true,
};

export function normalizeAgentRuntimeSettings(input?: Partial<AgentRuntimeSettings>): AgentRuntimeSettings {
  const supportedModes: AgentPermissionMode[] = ["auto", "default", "acceptEdits", "bypassPermissions", "plan"];
  const supportedLevels: AgentAccessLevel[] = ["full", "auto", "sensitive", "askEveryTime"];
  const requestedTurns = Number(input?.maxTurns ?? DEFAULT_AGENT_RUNTIME_SETTINGS.maxTurns);
  const legacyMode = supportedModes.includes(input?.permissionMode as AgentPermissionMode) ? input!.permissionMode as AgentPermissionMode : undefined;
  const accessLevel = supportedLevels.includes(input?.accessLevel as AgentAccessLevel)
    ? input!.accessLevel as AgentAccessLevel
    : accessLevelFromLegacyMode(legacyMode);
  return {
    ...DEFAULT_AGENT_RUNTIME_SETTINGS,
    maxTurns: Number.isFinite(requestedTurns) ? Math.min(1000, Math.max(20, Math.round(requestedTurns))) : DEFAULT_AGENT_RUNTIME_SETTINGS.maxTurns,
    accessLevel,
    permissionMode: permissionModeForAccessLevel(accessLevel),
  };
}

export function permissionModeForAccessLevel(level: AgentAccessLevel): AgentPermissionMode {
  if (level === "full") return "bypassPermissions";
  if (level === "auto") return "auto";
  return "default";
}

function accessLevelFromLegacyMode(mode?: AgentPermissionMode): AgentAccessLevel {
  if (mode === "bypassPermissions") return "full";
  if (mode === "auto" || mode === "acceptEdits") return "auto";
  return "sensitive";
}
