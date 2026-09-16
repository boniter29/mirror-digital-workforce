import { describe, expect, it } from "vitest";
import { dwsProcessEnvironment, validateArgs } from "../src/main/dws-agent-cli";
import { similarity, RecentReplyGuard } from "../src/main/reply-guard";
import { validateWebhook } from "../src/main/dingtalk-webhook-credentials";

describe("Claude Agent SDK primitives", () => {
  it("sets a stable DWS DNS resolver without losing unrelated Go debug flags", () => {
    const env = dwsProcessEnvironment({ GODEBUG: "http2debug=1,netdns=cgo" });
    if (process.platform === "win32") expect(env.GODEBUG).toBe("http2debug=1,netdns=go");
    else expect(env.GODEBUG).toBe("http2debug=1,netdns=cgo");
  });

  it("passes current DWS cursor pagination through without task routing", () => {
    expect(validateArgs(["minutes", "list", "all", "--limit", "30", "--cursor", "next-2", "--format", "json"])).toContain("next-2");
    expect(validateArgs(["schema", "minutes list all", "--compact", "--format", "json"])).toContain("minutes list all");
  });

  it("keeps the raw DWS primitive read-only", () => {
    expect(() => validateArgs(["chat", "send", "--content", "hello"])).toThrow("只允许读取");
    expect(() => validateArgs(["todo", "task", "create", "--title", "x"])).toThrow("只允许读取");
    for (const mutation of ["edit", "reply", "publish", "rename", "move", "cancel", "complete", "archive"]) {
      expect(() => validateArgs(["product", "resource", mutation, "--id", "x"])).toThrow("只允许读取");
    }
    expect(() => validateArgs(["new-product", "mystery-action", "--id", "x"])).toThrow("未知动作默认拒绝");
    expect(validateArgs(["new-product", "mystery-action", "--help"])).toContain("--help");
    expect(validateArgs(["schema", "todo task create", "--format", "json"])).toContain("schema");
    expect(validateArgs(["contact", "dept", "get-info", "--dept-id", "1", "--format", "json"])).toContain("get-info");
    expect(validateArgs(["chat", "group", "list-my-groups", "--format", "json"])).toContain("list-my-groups");
    expect(validateArgs(["chat", "conversation-info", "--group", "cid", "--format", "json"])).toContain("conversation-info");
  });

  it("blocks duplicate inbound events and near-duplicate outbound replies", () => {
    const guard = new RecentReplyGuard();
    expect(guard.acceptIncoming("cid:user", "帮我看下这个方案")).toBe(true);
    expect(guard.acceptIncoming("cid:user", "帮我看下这个方案")).toBe(false);
    expect(guard.acceptReply("cid", "这个方案先补充数据，再决定是否推进。")).toBe(true);
    expect(guard.acceptReply("cid", "这个方案先补充数据，再决定是否推进")).toBe(false);
    expect(similarity("收到，我看一下。", "收到，我看一下")).toBeGreaterThan(0.8);
  });

  it("accepts only official custom-robot webhook URLs", () => {
    expect(validateWebhook("https://oapi.dingtalk.com/robot/send?access_token=test")).toContain("access_token=test");
    expect(() => validateWebhook("https://example.com/robot/send?access_token=test")).toThrow("钉钉官方");
  });
});
