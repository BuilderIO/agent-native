import type { SpawnOptions } from "node:child_process";

/**
 * Keep Windows command-name launches compatible with `.cmd` shims while
 * allowing callers that already have a real executable path to opt out of the
 * shell. The latter is important for paths such as `C:\\Program Files\\nodejs\\node.exe`.
 */
export function cliSpawnOptions(
  options: Pick<SpawnOptions, "env" | "shell" | "stdio"> = {},
  platform: NodeJS.Platform = process.platform,
): Pick<SpawnOptions, "env" | "shell" | "stdio"> {
  return {
    stdio: options.stdio ?? "inherit",
    shell: options.shell ?? platform === "win32",
    env: options.env ?? process.env,
  };
}
