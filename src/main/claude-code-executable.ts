import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, sep } from "node:path";

const require = createRequire(import.meta.url);

function nativePackageName(platform = process.platform, arch = process.arch): string {
  return `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
}

function executableName(platform = process.platform): string {
  return platform === "win32" ? "claude.exe" : "claude";
}

/**
 * Electron's ASAR filesystem makes unpacked files appear to exist at an
 * app.asar path. Child processes cannot execute that virtual path, so always
 * translate it to the matching app.asar.unpacked location before passing it
 * to the Claude Agent SDK.
 */
export function unpackedAsarPath(path: string): string {
  const marker = `${sep}app.asar${sep}`;
  return path.includes(marker) ? path.replace(marker, `${sep}app.asar.unpacked${sep}`) : path;
}

export function resolveClaudeCodeExecutable(): string | undefined {
  const override = process.env.MIRROR_CLAUDE_CODE_EXECUTABLE?.trim();
  if (override) {
    if (!existsSync(override)) throw new Error(`MIRROR_CLAUDE_CODE_EXECUTABLE 指向的文件不存在：${override}`);
    return override;
  }

  const packageName = nativePackageName();
  const binaryName = executableName();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates: string[] = [];

  if (resourcesPath) {
    candidates.push(join(resourcesPath, "app.asar.unpacked", "node_modules", packageName, binaryName));
  }

  try {
    candidates.push(unpackedAsarPath(require.resolve(`${packageName}/${binaryName}`)));
  } catch {
    // Let the SDK produce its native-package installation error below when no
    // explicit candidate can be found (useful in development environments).
  }

  return candidates.find((candidate) => existsSync(candidate));
}
