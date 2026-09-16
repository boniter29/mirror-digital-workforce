import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

describe("four-level Agent permission UI", () => {
  it("exposes exactly the four requested project permission modes", () => {
    const permissionBlock = appSource.match(/const PERMISSION_LEVELS:[\s\S]*?\n\];/)?.[0] ?? "";
    expect(permissionBlock.match(/id: "/g)).toHaveLength(4);
    expect(permissionBlock).toContain('title: "完全权限"');
    expect(permissionBlock).toContain('title: "自动审核"');
    expect(permissionBlock).toContain('title: "敏感操作确认"');
    expect(permissionBlock).toContain('title: "每次询问我"');
  });

  it("keeps the four-mode selector near conversation composers", () => {
    expect(appSource).toContain("function PermissionControl");
    expect(appSource.match(/<PermissionControl/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(appSource).toContain("权限模式 · 四选一");
  });

  it("keeps per-tool project approval in the request modal instead of treating it as a fifth mode", () => {
    expect(appSource).toContain("本项目始终允许");
    expect(appSource).toContain('allow("allow_always")');
    expect(appSource).toContain("request.canRemember");
  });
});
