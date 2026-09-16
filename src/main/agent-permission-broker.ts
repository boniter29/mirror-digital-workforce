import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import type { CanUseTool, ElicitationRequest, ElicitationResult, OnElicitation, PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAccessLevel, AgentPermissionRequest, AgentPermissionResponse, AgentSurface } from "../shared/types.js";

interface PendingPermission {
  kind: "tool";
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[];
  resolve: (result: PermissionResult) => void;
}

interface PendingElicitation {
  kind: "elicitation";
  resolve: (result: ElicitationResult) => void;
}

export class AgentPermissionBroker {
  private readonly pending = new Map<string, PendingPermission | PendingElicitation>();

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  canUseTool(context: { surface: AgentSurface | "twin"; personaId?: string; branchId?: string; unattended?: boolean; accessLevel?: AgentAccessLevel }): CanUseTool {
    return async (toolName, input, options) => {
      if (context.unattended) {
        if (isUnattendedSafeTool(toolName)) {
          return { behavior: "allow", updatedInput: input };
        }
        return {
          behavior: "deny",
          message: "This request came from an unattended external channel. System commands and local writes require the owner to approve them in the desktop app.",
        };
      }
      const window = this.getWindow();
      if (!window || window.isDestroyed()) {
        return { behavior: "deny", message: "The desktop approval surface is unavailable." };
      }
      const id = randomUUID();
      const safeSuggestions = persistentPermissionSuggestions(toolName, input, options.suggestions ?? []);
      const request: AgentPermissionRequest = {
        id,
        toolName,
        input,
        title: options.title || (toolName === "AskUserQuestion" ? "Agent 需要你的补充信息" : `允许 Agent 使用 ${options.displayName || toolName}？`),
        description: options.description,
        blockedPath: options.blockedPath,
        decisionReason: options.decisionReason,
        surface: context.surface,
        personaId: context.personaId,
        branchId: context.branchId,
        createdAt: new Date().toISOString(),
        canRemember: context.accessLevel !== "askEveryTime" && safeSuggestions.length > 0,
      };
      return await new Promise<PermissionResult>((resolve) => {
        const abort = () => {
          this.pending.delete(id);
          resolve({ behavior: "deny", message: "Permission request was cancelled." });
        };
        options.signal.addEventListener("abort", abort, { once: true });
        this.pending.set(id, {
          kind: "tool",
          input,
          suggestions: safeSuggestions,
          resolve: (result) => {
            options.signal.removeEventListener("abort", abort);
            resolve(result);
          },
        });
        window.webContents.send("agent:permission-request", request);
      });
    };
  }

  onElicitation(context: { surface: AgentSurface | "twin"; personaId?: string; branchId?: string; unattended?: boolean }): OnElicitation {
    return async (elicitation: ElicitationRequest, options) => {
      if (context.unattended) return { action: "decline" };
      const window = this.getWindow();
      if (!window || window.isDestroyed()) return { action: "decline" };
      const id = randomUUID();
      const request: AgentPermissionRequest = {
        id,
        kind: elicitation.mode === "url" ? "mcp_url" : "mcp_form",
        toolName: `MCP · ${elicitation.serverName}`,
        input: {},
        title: elicitation.title || elicitation.displayName || "MCP 需要你的输入",
        description: elicitation.description || elicitation.message,
        surface: context.surface,
        personaId: context.personaId,
        branchId: context.branchId,
        createdAt: new Date().toISOString(),
        canRemember: false,
        url: elicitation.url,
        requestedSchema: elicitation.requestedSchema,
      };
      return await new Promise<ElicitationResult>((resolve) => {
        const abort = () => {
          this.pending.delete(id);
          resolve({ action: "cancel" });
        };
        options.signal.addEventListener("abort", abort, { once: true });
        this.pending.set(id, {
          kind: "elicitation",
          resolve: (result) => {
            options.signal.removeEventListener("abort", abort);
            resolve(result);
          },
        });
        window.webContents.send("agent:permission-request", request);
      });
    };
  }

  resolve(response: AgentPermissionResponse): boolean {
    const pending = this.pending.get(response.id);
    if (!pending) return false;
    this.pending.delete(response.id);
    if (pending.kind === "elicitation") {
      pending.resolve(response.behavior === "deny"
        ? { action: "decline" }
        : { action: "accept", content: response.formContent });
      return true;
    }
    if (response.behavior === "deny") {
      pending.resolve({ behavior: "deny", message: response.message || "User denied this action.", decisionClassification: "user_reject" });
      return true;
    }
    pending.resolve({
      behavior: "allow",
      updatedInput: response.updatedInput ?? pending.input,
      updatedPermissions: response.behavior === "allow_always" ? pending.suggestions : undefined,
      decisionClassification: response.behavior === "allow_always" ? "user_permanent" : "user_temporary",
    });
    return true;
  }

  cancelAll(): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      if (pending.kind === "tool") pending.resolve({ behavior: "deny", message: "Desktop window closed before approval." });
      else pending.resolve({ action: "cancel" });
    }
  }
}

export function isUnattendedSafeTool(toolName: string): boolean {
  return ["mcp__visual_ocr__status", "mcp__visual_ocr__parse_document"].includes(toolName);
}

export function persistentPermissionSuggestions(toolName: string, input: Record<string, unknown>, suggestions: PermissionUpdate[]): PermissionUpdate[] {
  const safe = suggestions.filter(isSafePersistentPermission).map((update) => ({ ...update, destination: "localSettings" as const }));
  if (safe.length) return safe;
  if (!isSafeExactToolPermission(toolName, input)) return [];
  return [{
    type: "addRules",
    rules: [{ toolName }],
    behavior: "allow",
    destination: "localSettings",
  }];
}

function isSafePersistentPermission(update: PermissionUpdate): boolean {
  if (update.destination === "cliArg") return false;
  if (update.type !== "addRules" && update.type !== "addDirectories") return false;
  if (update.type === "addRules" && (update.behavior !== "allow" || update.rules.some((rule) => rule.toolName === "Bash" && !rule.ruleContent))) return false;
  const serialized = JSON.stringify(update);
  return !/(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|bearer|password)\s*[=:]\s*[^\s"']+/i.test(serialized)
    && !/(?:sk|pt)-[a-z0-9_-]{16,}/i.test(serialized);
}

function isSafeExactToolPermission(toolName: string, input: Record<string, unknown>): boolean {
  if (/(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)/i.test(JSON.stringify(input))) return false;
  if (["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Skill"].includes(toolName)) return true;
  if (["mcp__visual_ocr__status", "mcp__visual_ocr__parse_document"].includes(toolName)) return true;
  return toolName.startsWith("mcp__") && /(?:^|__)(?:list|get|read|search|find|query|fetch|show|describe|inspect|check|view|lookup|status|info)(?:_|$)/i.test(toolName);
}
