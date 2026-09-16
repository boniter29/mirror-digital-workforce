import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAccessLevel } from "../shared/types.js";

/** Force every tool use through canUseTool while keeping Claude Code's full tool preset visible. */
export function permissionHooks(level: AgentAccessLevel): { PreToolUse: HookCallbackMatcher[] } | undefined {
  if (level !== "askEveryTime") return undefined;
  return {
    PreToolUse: [{
      matcher: ".*",
      hooks: [async () => ({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "你已将本项目权限设置为“每次询问我”。",
        },
      })],
    }],
  };
}
