import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_PLUGINS } from "../src/main/agent-plugins";
import { BUILTIN_SKILL_NAMES } from "../src/main/builtin-skills";

describe("single Agent / Plugin / Skill architecture", () => {
  it("keeps each digital employee as a Plugin with installed Skills", () => {
    expect(AGENT_PLUGINS.map((plugin) => plugin.id)).toEqual([
      "hr-keyboard",
      "evidence-collector",
      "persona-distiller",
    ]);
    for (const plugin of AGENT_PLUGINS) {
      expect(plugin.skills.length).toBeGreaterThanOrEqual(2);
      for (const skill of plugin.skills) expect(BUILTIN_SKILL_NAMES).toContain(skill);
    }
  });

  it("exposes Skill through the complete Claude Code preset everywhere skills: all is enabled", async () => {
    for (const file of ["src/main/agent-workbench.ts", "src/main/claude-runtime.ts"]) {
      const source = await readFile(resolve(file), "utf8");
      const blocks = source.split('skills: "all"').slice(1);
      expect(blocks.length, `${file} must contain a skills-enabled SDK call`).toBeGreaterThan(0);
      for (const block of blocks) {
        const optionsTail = block.slice(0, 1800);
        expect(optionsTail, `${file}: tools must use the full Claude Code preset`).toMatch(/tools:\s*\{\s*type:\s*"preset",\s*preset:\s*"claude_code"\s*\}/s);
        expect(optionsTail, `${file}: explicit reduced tool lists would remove native SDK capabilities`).not.toMatch(/tools:\s*\[/s);
      }
    }
  });

  it("materializes the three product roles as real local SDK Plugins", async () => {
    const [store, runtime] = await Promise.all([
      readFile(resolve("src/main/store.ts"), "utf8"),
      readFile(resolve("src/main/agent-workbench.ts"), "utf8"),
    ]);
    expect(store).toContain("prepareAgentPlugins");
    expect(store).toContain('join(pluginRoot, ".claude-plugin")');
    expect(store).toContain('join(pluginRoot, "skills", skillName)');
    expect(runtime).toContain("plugins,");
    expect(runtime).toContain("hr-keyboard:adaptive-onboarding");
    expect(runtime).toContain("evidence-collector:dws-full-evidence-sync");
    expect(runtime).toContain("persona-distiller:persona-distillation");
  });

  it("does not remove native SDK capabilities through restrictive harness options", async () => {
    for (const file of ["src/main/agent-workbench.ts", "src/main/claude-runtime.ts"]) {
      const source = await readFile(resolve(file), "utf8");
      expect(source).not.toContain('settingSources: ["project"]');
      expect(source).not.toContain("strictMcpConfig: true");
      expect(source).not.toContain("Never use shell");
      expect(source).toContain('preset: "claude_code"');
      expect(source).toContain("canUseTool:");
      expect(source).toContain("pathToClaudeCodeExecutable: resolveClaudeCodeExecutable()");
    }
  });

  it("exposes bundled PP-OCRv6 and optional PaddleOCR-VL as Agent-selected MCP tools without an intent router", async () => {
    const [workbench, twin, ocr] = await Promise.all([
      readFile(resolve("src/main/agent-workbench.ts"), "utf8"),
      readFile(resolve("src/main/claude-runtime.ts"), "utf8"),
      readFile(resolve("src/main/paddle-ocr-vl.ts"), "utf8"),
    ]);
    for (const runtime of [workbench, twin]) {
      expect(runtime).toContain("visual_ocr");
      expect(runtime).toContain("this.paddleOcr.toolNames()");
    }
    expect(ocr).toMatch(/tool\(\s+"parse_document"/);
    expect(ocr).toContain("PP-OCRv6-small");
    expect(ocr).toContain('name: "visual_ocr"');
    expect(ocr).toContain("deliberately no intent router");
    expect(ocr).not.toMatch(/intentRouter|routeIntent/i);
  });

  it("keeps distillation and calibration inside the same workbench Agent turn", async () => {
    const [workbench, twinRuntime, main] = await Promise.all([
      readFile(resolve("src/main/agent-workbench.ts"), "utf8"),
      readFile(resolve("src/main/claude-runtime.ts"), "utf8"),
      readFile(resolve("src/main/main.ts"), "utf8"),
    ]);
    expect(workbench).toContain('tool("read_persona_evidence"');
    expect(workbench).toContain('tool("commit_persona_harness"');
    expect(workbench).toContain('tool("save_calibration_evidence"');
    expect(workbench).toContain('tool("record_calibration_preview"');
    expect(workbench).not.toMatch(/this\.twin\.(?:distill|learn|chat)\(/);
    expect(workbench).not.toContain('tool("run_distillation"');
    expect(twinRuntime).not.toMatch(/async\s+(?:distill|learn)\s*\(/);
    expect(main).not.toContain('ipcMain.handle("twin:distill"');
    expect(main).toContain('workbenchAgent.chat("calibration"');
  });

  it("keeps adaptive onboarding as evidence-driven cards instead of a fixed form", async () => {
    const runtime = await readFile(resolve("src/main/agent-workbench.ts"), "utf8");
    const skills = await readFile(resolve("src/main/builtin-skills.ts"), "utf8");
    expect(runtime).toContain('tool("present_onboarding_question"');
    expect(runtime).toContain("Every such question MUST be rendered by calling present_onboarding_question");
    expect(skills).toContain("evidence-conditioned item bank");
    expect(skills).toContain("behaviorally anchored situations");
  });
});
