import { describe, expect, it } from "vitest";
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { isUnattendedSafeTool, persistentPermissionSuggestions } from "../src/main/agent-permission-broker";

describe("project-persistent Agent permissions", () => {
  it("offers a project-local rule for an exact read-only MCP tool", () => {
    expect(persistentPermissionSuggestions("mcp__yunxiao-local__list_branches", { repositoryId: "6705867" }, [])).toEqual([{
      type: "addRules",
      rules: [{ toolName: "mcp__yunxiao-local__list_branches" }],
      behavior: "allow",
      destination: "localSettings",
    }]);
  });

  it("does not promote an unscoped mutating MCP tool to a permanent rule", () => {
    expect(persistentPermissionSuggestions("mcp__yunxiao-local__delete_branch", { repositoryId: "6705867" }, [])).toEqual([]);
  });

  it("preserves a safe SDK-scoped suggestion but stores it in project-local settings", () => {
    const suggestion: PermissionUpdate = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "git status" }],
      behavior: "allow",
      destination: "session",
    };
    expect(persistentPermissionSuggestions("Bash", { command: "git status" }, [suggestion])).toEqual([{
      ...suggestion,
      destination: "localSettings",
    }]);
  });

  it("rejects unscoped Bash and inputs that contain credentials", () => {
    const unsafe: PermissionUpdate = {
      type: "addRules",
      rules: [{ toolName: "Bash" }],
      behavior: "allow",
      destination: "session",
    };
    expect(persistentPermissionSuggestions("Bash", { command: "git status" }, [unsafe])).toEqual([]);
    expect(persistentPermissionSuggestions("mcp__yunxiao-local__list_branches", { accessToken: "secret" }, [])).toEqual([]);
  });

  it("allows only the scoped first-party OCR tools in unattended robot turns", () => {
    expect(isUnattendedSafeTool("mcp__visual_ocr__parse_document")).toBe(true);
    expect(isUnattendedSafeTool("mcp__visual_ocr__parse_complex_document")).toBe(false);
    expect(isUnattendedSafeTool("Bash")).toBe(false);
    expect(isUnattendedSafeTool("mcp__external__parse_document")).toBe(false);
  });
});
