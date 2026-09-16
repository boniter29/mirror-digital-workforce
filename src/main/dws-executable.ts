import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/**
 * Resolve the user override first, then the DWS binary bundled in the
 * installed Electron app, and finally fall back to PATH for development.
 */
export function resolveDwsExecutable(environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment.MIRROR_DWS_BIN?.trim();
  if (override) return override;

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = join(resourcesPath, "tools", "dws", process.platform === "win32" ? "dws.exe" : "dws");
    if (existsSync(bundled)) return bundled;
  }

  return "dws";
}

/** Make the bundled executable discoverable to Claude Agent SDK Bash calls. */
export function withDwsOnPath(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const executable = resolveDwsExecutable(environment);
  if (executable === "dws") return { ...environment };

  const result = { ...environment };
  const pathKey = Object.keys(result).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directory = dirname(executable);
  const entries = (result[pathKey] ?? "").split(delimiter).filter(Boolean);
  if (!entries.some((entry) => entry.toLowerCase() === directory.toLowerCase())) entries.unshift(directory);
  result[pathKey] = entries.join(delimiter);
  return result;
}
