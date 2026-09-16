import { describe, expect, it } from "vitest";
import { runtimeEventMatchesScope, runtimeRunMatchesScope, runtimeStream } from "../src/renderer/lib/runtimeScope";

describe("runtime execution scope", () => {
  it("keeps events and active runs inside their persona branch and stage", () => {
    const scopeA = { personaId: "primary", branchId: "branch-a", surface: "onboarding" as const };
    const scopeB = { personaId: "primary", branchId: "branch-b", surface: "onboarding" as const };
    const eventA = { stage: "onboarding-tool", message: "A", personaId: "primary", branchId: "branch-a", surface: "onboarding" as const };
    const runA = { id: "run-a", label: "A running", startedAt: 1, scope: scopeA };

    expect(runtimeEventMatchesScope(eventA, scopeA)).toBe(true);
    expect(runtimeEventMatchesScope(eventA, scopeB)).toBe(false);
    expect(runtimeEventMatchesScope(eventA, { ...scopeA, surface: "source" })).toBe(false);
    expect(runtimeRunMatchesScope(runA, scopeA)).toBe(true);
    expect(runtimeRunMatchesScope(runA, scopeB)).toBe(false);
    expect(runtimeRunMatchesScope(runA)).toBe(false);
  });

  it("builds stream text only from the already scoped event list", () => {
    expect(runtimeStream([
      { stage: "start", message: "start", kind: "status" },
      { stage: "stream", message: "stream", kind: "text_delta", delta: "只属于" },
      { stage: "stream", message: "stream", kind: "text_delta", delta: "当前分支" },
    ])).toBe("只属于当前分支");
  });
});
