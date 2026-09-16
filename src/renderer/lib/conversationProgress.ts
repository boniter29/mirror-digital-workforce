import type { AgentPluginId } from "../../shared/types";

export type ConversationStageStatus = "done" | "active" | "ready";

export function conversationStageStatus(
  pluginId: AgentPluginId,
  sessions: Partial<Record<AgentPluginId, string>>,
  completedStages: AgentPluginId[] = [],
): ConversationStageStatus {
  if (completedStages.includes(pluginId)) return "done";
  if (sessions[pluginId]) return "active";
  return "ready";
}

export function markConversationStageComplete(completedStages: AgentPluginId[] = [], pluginId: AgentPluginId): AgentPluginId[] {
  return completedStages.includes(pluginId) ? completedStages : [...completedStages, pluginId];
}
