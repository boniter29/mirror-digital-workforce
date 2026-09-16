import type { DwsImportInput } from "./types.js";

export function buildDwsImportArgs(input: DwsImportInput, cursor = "0"): string[] {
  const args = [
    "chat", "message", "list-all",
    "--start", input.start,
    "--end", input.end,
    "--limit", "30",
    "--cursor", cursor,
    "--format", "json",
  ];
  if (input.profile) args.push("--profile", input.profile);
  return args;
}

export function buildDwsAuthoredMessageArgs(input: DwsImportInput, userId: string, cursor = "0"): string[] {
  const args = [
    "chat", "message", "list-by-sender",
    "--sender-user-id", userId,
    "--start", toIso8601(input.start),
    "--end", toIso8601(input.end),
    "--limit", "30",
    "--cursor", cursor,
    "--format", "json",
  ];
  if (input.profile) args.push("--profile", input.profile);
  return args;
}

export function buildDwsMentionArgs(input: DwsImportInput, cursor = "0"): string[] {
  const args = [
    "chat", "message", "search-advanced",
    "--at-me",
    "--start", toIso8601(input.start),
    "--end", toIso8601(input.end),
    "--limit", "30",
    "--cursor", cursor,
    "--format", "json",
  ];
  if (input.profile) args.push("--profile", input.profile);
  return args;
}

export function buildDwsConversationListArgs(profile: string, cursor = "0"): string[] {
  return [
    "chat", "list-all-conversations",
    "--limit", "30",
    "--cursor", cursor,
    "--format", "json",
    "--profile", profile,
  ];
}

export function buildDwsPrivateMessageArgs(input: DwsImportInput, conversationIds: string[], cursor = "0"): string[] {
  if (!conversationIds.length) throw new Error("Private-message search requires at least one conversation ID.");
  const args = [
    "chat", "message", "search-advanced",
    "--conversation-ids", conversationIds.join(","),
    "--start", toIso8601(input.start),
    "--end", toIso8601(input.end),
    "--limit", "30",
    "--cursor", cursor,
    "--format", "json",
  ];
  if (input.profile) args.push("--profile", input.profile);
  return args;
}

export function buildDwsLiveMessageSearchArgs(input: { query?: string; start: string; end: string; atMe?: boolean; profile?: string }): string[] {
  const args = ["chat", "message", "search-advanced"];
  if (input.query?.trim()) args.push("--query", input.query.trim());
  if (input.atMe) args.push("--at-me");
  args.push("--start", toIso8601(input.start), "--end", toIso8601(input.end), "--limit", "30", "--cursor", "0", "--format", "json");
  if (input.profile) args.push("--profile", input.profile);
  return args;
}

export function buildDwsCalendarArgs(start: string, end: string, profile?: string): string[] {
  const args = ["calendar", "event", "list", "--start", toIso8601(start), "--end", toIso8601(end), "--limit", "30", "--format", "json"];
  if (profile) args.push("--profile", profile);
  return args;
}

export function buildDwsTodoArgs(profile?: string): string[] {
  const args = ["todo", "task", "list", "--page", "1", "--size", "20", "--status", "false", "--role-types", "creator,executor,participant", "--format", "json"];
  if (profile) args.push("--profile", profile);
  return args;
}

export function buildDwsDriveSearchArgs(query: string, profile?: string): string[] {
  const args = ["drive", "search", "--query", query.trim(), "--target", "all", "--limit", "10", "--format", "json"];
  if (profile) args.push("--profile", profile);
  return args;
}

export function buildDwsDocInfoArgs(node: string, profile?: string): string[] {
  const args = ["doc", "info", "--node", node.trim(), "--format", "json"];
  if (profile) args.push("--profile", profile);
  return args;
}

export function buildDwsDocReadArgs(node: string, profile?: string): string[] {
  const args = ["doc", "read", "--node", node.trim(), "--format", "json"];
  if (profile) args.push("--profile", profile);
  return args;
}

export function buildDwsProfileListArgs(): string[] {
  return ["profile", "list", "--format", "json"];
}

export function buildDwsSelfProfileArgs(profile: string): string[] {
  return ["contact", "user", "get-self", "--format", "json", "--profile", profile];
}

export function buildDwsContactSearchArgs(query: string, profile: string): string[] {
  return ["contact", "user", "search", "--query", query, "--format", "json", "--profile", profile];
}

export function buildDwsRelationArgs(name: string, dimension: "supervisor" | "subordinate", profile: string): string[] {
  return ["aisearch", "person", "--keyword", name, "--dimension", dimension, "--format", "json", "--profile", profile];
}

export function buildDwsEventArgs(groupId: string, profile?: string): string[] {
  const args = [
    "event", "consume",
    "user_im_message_receive_group",
    "--group", groupId,
    "--flatten",
    "-f", "ndjson",
  ];
  if (profile) args.push("--profile", profile);
  return args;
}

export function buildDwsEventBusArgs(groupId: string, profile?: string): string[] {
  const args = buildDwsEventArgs(groupId, profile);
  const profileIndex = args.indexOf("--profile");
  // Windows cannot fork the DWS bus. We only call this after status proves there
  // is no connected bus, so --force is safe and replaces a stale/orphan lock.
  args.splice(profileIndex >= 0 ? profileIndex : args.length, 0, "--foreground", "--force");
  return args;
}

export function buildDwsEventStatusArgs(profile?: string): string[] {
  const args = ["event", "status", "--event", "user_im_message_receive_group", "--format", "json"];
  if (profile) args.push("--profile", profile);
  return args;
}

export function buildDwsMinutesListArgs(input: {
  scope?: "all" | "mine" | "shared";
  start: string;
  end: string;
  nextToken?: string;
  profile?: string;
}): string[] {
  const args = [
    "minutes", "list", input.scope ?? "all",
    "--start", toIso8601(input.start),
    "--end", toIso8601(input.end),
    "--limit", "30",
  ];
  if (input.nextToken) args.push("--cursor", input.nextToken);
  args.push("--format", "json");
  if (input.profile) args.push("--profile", input.profile);
  return args;
}

export function buildDwsMinutesSummaryArgs(id: string, profile?: string): string[] {
  const args = ["minutes", "get", "summary", "--id", id, "--format", "json"];
  if (profile) args.push("--profile", profile);
  return args;
}

export function buildDwsWikiSpaceListArgs(type: "org" | "my", profile?: string): string[] {
  const args = ["wiki", "space", "list", "--type", type === "my" ? "myWikiSpace" : "orgWikiSpace", "--limit", "50", "--format", "json"];
  if (profile) args.push("--profile", profile);
  return args;
}

export function buildDwsWikiNodeListArgs(workspaceId: string, profile?: string, parentNodeId?: string): string[] {
  const args = ["wiki", "node", "list", "--workspace", workspaceId, "--limit", "50", "--format", "json"];
  if (parentNodeId) args.push("--folder", parentNodeId);
  if (profile) args.push("--profile", profile);
  return args;
}

function toIso8601(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}+08:00`;
  return `${value.trim().replace(" ", "T")}+08:00`;
}
