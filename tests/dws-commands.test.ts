import { describe, expect, it } from "vitest";
import { buildDwsAuthoredMessageArgs, buildDwsCalendarArgs, buildDwsConversationListArgs, buildDwsDocReadArgs, buildDwsDriveSearchArgs, buildDwsEventArgs, buildDwsEventBusArgs, buildDwsImportArgs, buildDwsMentionArgs, buildDwsMinutesListArgs, buildDwsMinutesSummaryArgs, buildDwsPrivateMessageArgs, buildDwsTodoArgs, buildDwsWikiNodeListArgs, buildDwsWikiSpaceListArgs } from "../src/shared/dws-commands";

describe("DWS command contracts", () => {
  it("builds paginated history import with JSON output", () => {
    const args = buildDwsImportArgs({ start: "2026-07-01 00:00:00", end: "2026-08-01 00:00:00", profile: "corp:user" }, "next-1");
    expect(args).toContain("list-all");
    expect(args).toContain("next-1");
    expect(args).toContain("30");
    expect(args.slice(-4)).toEqual(["--format", "json", "--profile", "corp:user"]);
  });

  it("uses flattened NDJSON for group event streaming", () => {
    const args = buildDwsEventArgs("cid-1");
    expect(args).toEqual(["event", "consume", "user_im_message_receive_group", "--group", "cid-1", "--flatten", "-f", "ndjson"]);
    expect(buildDwsEventBusArgs("cid-1", "corp:user")).toEqual(["event", "consume", "user_im_message_receive_group", "--group", "cid-1", "--flatten", "-f", "ndjson", "--foreground", "--force", "--profile", "corp:user"]);
  });

  it("paginates all accessible AI minutes and reads summaries", () => {
    expect(buildDwsMinutesListArgs({ start: "2026-01-01 00:00:00", end: "2026-08-07 23:59:59", nextToken: "next-2", profile: "corp:user" })).toEqual([
      "minutes", "list", "all", "--start", "2026-01-01T00:00:00+08:00", "--end", "2026-08-07T23:59:59+08:00", "--limit", "30", "--cursor", "next-2", "--format", "json", "--profile", "corp:user",
    ]);
    expect(buildDwsMinutesSummaryArgs("minute-1", "corp:user").slice(0, 5)).toEqual(["minutes", "get", "summary", "--id", "minute-1"]);
  });

  it("builds read-only knowledge-base traversal commands", () => {
    expect(buildDwsWikiSpaceListArgs("org", "corp:user")).toEqual(["wiki", "space", "list", "--type", "orgWikiSpace", "--limit", "50", "--format", "json", "--profile", "corp:user"]);
    expect(buildDwsWikiNodeListArgs("space-1", "corp:user", "folder-1")).toEqual(["wiki", "node", "list", "--workspace", "space-1", "--limit", "50", "--format", "json", "--folder", "folder-1", "--profile", "corp:user"]);
  });

  it("uses list-by-sender for first-person style evidence", () => {
    const args = buildDwsAuthoredMessageArgs({ start: "2026-07-01 00:00:00", end: "2026-08-01 23:59:59", profile: "corp:user" }, "user-1", "cursor-2");
    expect(args).toContain("list-by-sender");
    expect(args).toContain("--sender-user-id");
    expect(args).toContain("user-1");
    expect(args).toContain("2026-07-01T00:00:00+08:00");
  });

  it("uses @me search for addressed-question evidence", () => {
    const args = buildDwsMentionArgs({ start: "2026-07-01 00:00:00", end: "2026-08-01 23:59:59", profile: "corp:user" });
    expect(args).toContain("search-advanced");
    expect(args).toContain("--at-me");
    expect(args).toContain("--format");
    expect(args).toContain("json");
  });

  it("targets recent single chats as a separate Q&A evidence channel", () => {
    expect(buildDwsConversationListArgs("corp:user")).toEqual([
      "chat", "list-all-conversations", "--limit", "30", "--cursor", "0", "--format", "json", "--profile", "corp:user",
    ]);
    const args = buildDwsPrivateMessageArgs(
      { start: "2026-07-01 00:00:00", end: "2026-08-01 23:59:59", profile: "corp:user" },
      ["cid-1", "cid-2"],
      "private-cursor",
    );
    expect(args).toContain("cid-1,cid-2");
    expect(args).toContain("private-cursor");
    expect(args).not.toContain("--at-me");
  });

  it("builds only allowlisted read commands for live DWS knowledge", () => {
    expect(buildDwsCalendarArgs("2026-08-07 00:00:00", "2026-08-07 23:59:59", "corp:user").slice(0, 3)).toEqual(["calendar", "event", "list"]);
    expect(buildDwsTodoArgs("corp:user").slice(0, 3)).toEqual(["todo", "task", "list"]);
    expect(buildDwsDriveSearchArgs("AI大赛", "corp:user")).toContain("AI大赛");
    expect(buildDwsDocReadArgs("node-1", "corp:user").slice(0, 2)).toEqual(["doc", "read"]);
  });
});
