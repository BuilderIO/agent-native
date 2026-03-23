/**
 * CLI Registry — known AI coding CLIs and their metadata.
 * Shared between the embedded terminal and the harness-cli.
 */

import { execSync } from "child_process";

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

/** Check if a CLI command exists on PATH */
export function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
