import type { AgentSurface, RuntimeEvent } from "../../shared/types";

export type RuntimeSurface = AgentSurface | "twin" | "feedback" | "evaluation" | "dingtalk" | "global";

export interface RuntimeScope {
  personaId?: string;
  branchId?: string;
  surface?: RuntimeSurface;
}

export interface ActiveRuntimeRun {
  id: string;
  label: string;
  startedAt: number;
  scope?: RuntimeScope;
}

export function runtimeEventMatchesScope(event: RuntimeEvent, scope?: RuntimeScope): boolean {
  if (!scope) return !event.branchId;
  if (scope.personaId && event.personaId !== scope.personaId) return false;
  if (scope.branchId && event.branchId !== scope.branchId) return false;
  if (scope.surface && event.surface !== scope.surface) return false;
  return true;
}

export function runtimeRunMatchesScope(run: ActiveRuntimeRun, scope?: RuntimeScope): boolean {
  if (!scope) return !run.scope;
  if (!run.scope) return false;
  if (scope.personaId && run.scope.personaId !== scope.personaId) return false;
  if (scope.branchId && run.scope.branchId !== scope.branchId) return false;
  if (scope.surface && run.scope.surface !== scope.surface) return false;
  return true;
}

export function runtimeStream(events: RuntimeEvent[]): string {
  return events.reduce((text, event) => event.kind === "text_delta" && event.delta ? `${text}${event.delta}`.slice(-6000) : text, "");
}
