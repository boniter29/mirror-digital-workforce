import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveDwsExecutable } from "./dws-executable.js";

const execFileAsync = promisify(execFile);
const MAX_ARGS = 96;
const MAX_ARG_LENGTH = 8_192;
const BLOCKED_MUTATIONS = new Set([
  "send", "create", "update", "delete", "remove", "approve", "reject",
  "upload", "write", "add-member", "remove-member", "set", "edit", "reply",
  "publish", "rename", "move", "cancel", "complete", "archive", "restore",
  "close", "open", "start", "stop", "invite", "kick", "grant", "revoke",
  "bind", "unbind", "subscribe", "unsubscribe", "mark", "submit", "execute",
]);
const READ_ONLY_ACTIONS = new Set([
  "schema", "list", "list-all", "list-by-sender", "list-all-conversations",
  "search", "search-advanced", "get", "get-self", "read", "info", "status",
  "detail", "describe", "query", "find", "show", "current", "inspect", "view",
  "summary", "person", "consume",
  "get-info", "list-members", "get-members", "list-sub-depts", "list-my-groups",
  "conversation-info", "list-conversations", "list-groups",
]);

export interface DwsCliExecution {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
}

/**
 * A deliberately task-agnostic DWS primitive for Claude Agent SDK.
 * It does not route intents, select products, paginate, parse, summarize, or
 * format results. The Agent discovers the current CLI schema and owns those
 * decisions. This class only enforces local read-only and process boundaries.
 */
export class DwsAgentCli {
  async execute(rawArgs: string[]): Promise<DwsCliExecution> {
    const args = validateArgs(rawArgs);
    const { stdout, stderr } = await execFileAsync(resolveDwsExecutable(), args, {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      env: dwsProcessEnvironment(),
    });
    return { command: `dws ${args.map(quoteForDisplay).join(" ")}`, args, stdout, stderr };
  }
}

/** Prefer the Go DNS resolver for the DWS Go binary on Windows/TUN setups. */
export function dwsProcessEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (process.platform !== "win32") return environment;
  const options = (environment.GODEBUG ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("netdns="));
  options.push("netdns=go");
  return { ...environment, GODEBUG: options.join(",") };
}

export function validateArgs(rawArgs: string[]): string[] {
  if (!Array.isArray(rawArgs) || !rawArgs.length) throw new Error("DWS CLI 参数不能为空。");
  if (rawArgs.length > MAX_ARGS) throw new Error(`DWS CLI 参数不能超过 ${MAX_ARGS} 个。`);
  const args = rawArgs.map((value) => {
    if (typeof value !== "string") throw new Error("DWS CLI 参数必须是字符串数组。");
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_ARG_LENGTH || /[\0\r\n\u2028\u2029]/u.test(trimmed)) {
      throw new Error("DWS CLI 参数为空、过长或含有控制字符。");
    }
    return trimmed;
  });
  if (args.includes("--yes") || args.includes("-y")) throw new Error("Agent 的 DWS 工具是只读的，不能自动确认写操作。");
  if (args[0] === "schema" || args.includes("--help") || args.includes("-h") || args.includes("--version") || args.includes("-v")) return args;
  const firstFlag = args.findIndex((value) => value.startsWith("-"));
  const commandTokens = args.slice(0, firstFlag < 0 ? args.length : firstFlag).map((value) => value.toLowerCase());
  if (commandTokens.some((value) => BLOCKED_MUTATIONS.has(value.toLowerCase()))) {
    throw new Error("Agent 的 DWS 工具只允许读取；检测到可能改变钉钉数据的命令。");
  }
  if (!commandTokens.some((value) => READ_ONLY_ACTIONS.has(value))) {
    throw new Error("Agent 的 DWS 工具只允许已识别的读取命令。请先用 schema 或 --help 确认只读动作；未知动作默认拒绝。");
  }
  return args;
}

function quoteForDisplay(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}
