import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ensureBuiltinSkills } from "../src/main/builtin-skills";
import { LocalTwinStore } from "../src/main/store";
import { DingTalkContextStore } from "../src/main/dingtalk-context";
import { extractKnowledgeFolder } from "../src/main/knowledge-import";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "mirror-twin-"));
  roots.push(root);
  return root;
}

describe("local-first intake", () => {
  it("creates concise, valid built-in Agent skills", async () => {
    const root = await temporaryRoot();
    await ensureBuiltinSkills(root);
    const skill = await readFile(join(root, "dws-evidence-intake", "SKILL.md"), "utf8");
    expect(skill).toContain("name: dws-evidence-intake");
    expect(skill).toContain("Only the former are voice samples");
  });

  it("materializes role Skills inside real SDK local Plugin packages", async () => {
    const root = await temporaryRoot();
    const store = new LocalTwinStore(root);
    await store.init();
    const plugins = await store.prepareAgentPlugins();
    expect(plugins).toHaveLength(3);
    const manifest = JSON.parse(await readFile(join(plugins[0].path, ".claude-plugin", "plugin.json"), "utf8")) as { name: string };
    expect(manifest.name).toBe("hr-keyboard");
    expect(await readFile(join(plugins[0].path, "skills", "adaptive-onboarding", "SKILL.md"), "utf8")).toContain("name: adaptive-onboarding");
  });

  it("imports a folder recursively while ignoring dependency directories", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "notes"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "notes", "decision.md"), "# 决策\n先跑最小闭环。", "utf8");
    await writeFile(join(root, "node_modules", "noise.md"), "不应导入", "utf8");
    const result = await extractKnowledgeFolder(root);
    expect(result.files).toBe(1);
    expect(result.content).toContain("notes/decision.md");
    expect(result.content).not.toContain("不应导入");
  });

  it("keeps ambient DingTalk context isolated by group and de-duplicated", async () => {
    const root = await temporaryRoot();
    const context = new DingTalkContextStore(root);
    const base = { sender: "同事", senderId: "u1", content: "项目今天有变化", createdAt: new Date().toISOString() };
    await context.append({ ...base, id: "m1", conversationId: "group-a" });
    await context.append({ ...base, id: "m1", conversationId: "group-a" });
    await context.append({ ...base, id: "m2", conversationId: "group-b", content: "另一个群" });
    expect(await context.recent("group-a")).toHaveLength(1);
    expect(await context.formatForPrompt("group-a")).not.toContain("另一个群");
  });
});
