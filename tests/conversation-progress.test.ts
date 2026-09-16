import { describe, expect, it } from "vitest";
import { conversationStageStatus, markConversationStageComplete } from "../src/renderer/lib/conversationProgress";

describe("persona conversation progress", () => {
  it("does not inherit completion from persona-global assets", () => {
    expect(conversationStageStatus("hr-keyboard", {}, [])).toBe("ready");
    expect(conversationStageStatus("evidence-collector", {}, [])).toBe("ready");
    expect(conversationStageStatus("persona-distiller", {}, [])).toBe("ready");
  });

  it("tracks execution and explicit handoff inside this conversation only", () => {
    const sessions = { "hr-keyboard": "hr-session" };
    expect(conversationStageStatus("hr-keyboard", sessions, [])).toBe("active");
    const completed = markConversationStageComplete([], "hr-keyboard");
    expect(conversationStageStatus("hr-keyboard", sessions, completed)).toBe("done");
    expect(conversationStageStatus("evidence-collector", sessions, completed)).toBe("ready");
  });
});
