import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_RUNTIME_SETTINGS, normalizeAgentRuntimeSettings } from "../src/main/agent-runtime-settings";
import { permissionHooks } from "../src/main/agent-permission-policy";

describe("Claude Agent SDK runtime settings", () => {
  it("defaults autonomous tasks to 200 turns and the complete SDK surface", () => {
    expect(DEFAULT_AGENT_RUNTIME_SETTINGS).toEqual({
      maxTurns: 200,
      permissionMode: "default",
      accessLevel: "sensitive",
      fullToolPreset: true,
      loadClaudeCodeSettings: true,
      fileCheckpointing: true,
    });
  });

  it("maps the four product policies to native SDK modes", () => {
    expect(normalizeAgentRuntimeSettings({ accessLevel: "full" }).permissionMode).toBe("bypassPermissions");
    expect(normalizeAgentRuntimeSettings({ accessLevel: "auto" }).permissionMode).toBe("auto");
    expect(normalizeAgentRuntimeSettings({ accessLevel: "sensitive" }).permissionMode).toBe("default");
    expect(normalizeAgentRuntimeSettings({ accessLevel: "askEveryTime" }).permissionMode).toBe("default");
  });

  it("forces every tool through the SDK permission broker only in ask-every-time mode", async () => {
    expect(permissionHooks("sensitive")).toBeUndefined();
    const hooks = permissionHooks("askEveryTime")!;
    expect(hooks.PreToolUse[0].matcher).toBe(".*");
    const decision = await hooks.PreToolUse[0].hooks[0]({} as never, undefined, { signal: new AbortController().signal });
    expect(decision).toMatchObject({ hookSpecificOutput: { permissionDecision: "ask" } });
  });

  it("bounds user-configurable turns without silently falling back to 40", () => {
    expect(normalizeAgentRuntimeSettings({ maxTurns: 3 }).maxTurns).toBe(20);
    expect(normalizeAgentRuntimeSettings({ maxTurns: 450 }).maxTurns).toBe(450);
    expect(normalizeAgentRuntimeSettings({ maxTurns: 5000 }).maxTurns).toBe(1000);
    expect(normalizeAgentRuntimeSettings({ maxTurns: Number.NaN }).maxTurns).toBe(200);
  });
});
