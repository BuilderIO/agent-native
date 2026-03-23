/**
 * CLI Registry — known AI coding CLIs and their metadata.
 * Shared between the embedded terminal and the harness-cli.
 */

import { spawnSync } from "child_process";

export interface CliEntry {
  /** npm package name for npx fallback */
  installPackage: string;
  /** Env vars to strip when spawning (prevents nesting) */
  stripEnv: string[];
}

export const CLI_REGISTRY: Record<string, CliEntry> = {
  claude: {
    installPackage: "@anthropic-ai/claude-code",
    stripEnv: ["CLAUDECODE", "CLAUDE_CODE_SESSION"],
  },
  codex: {
    installPackage: "@openai/codex",
    stripEnv: [],
  },
  gemini: {
    installPackage: "@google/gemini-cli",
    stripEnv: [],
  },
  opencode: {
    installPackage: "opencode-ai",
    stripEnv: [],
  },
};

/** Check if a command name is in the CLI_REGISTRY allowlist */
export function isAllowedCommand(cmd: string): boolean {
  return Object.hasOwn(CLI_REGISTRY, cmd);
}

/** Check if a CLI command exists on PATH (safe — no shell interpolation) */
export function commandExists(cmd: string): boolean {
  try {
    const result = spawnSync("which", [cmd], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}
