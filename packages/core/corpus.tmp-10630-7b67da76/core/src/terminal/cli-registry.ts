/**
 * CLI Registry — known AI coding CLIs and their metadata.
 * Used by the embedded terminal in the agent panel.
 */

export interface CliEntry {
  /** Human-readable display name */
  label: string;
  /** npm package name for npx fallback */
  installPackage: string;
  /** Env vars to strip when spawning (prevents nesting) */
  stripEnv: string[];
}

export const CLI_REGISTRY: Record<string, CliEntry> = {
  claude: {
    label: "Claude Code",
    installPackage: "@anthropic-ai/claude-code",
    stripEnv: ["CLAUDECODE", "CLAUDE_CODE_SESSION"],
  },
  builder: {
    label: "Builder.io",
    installPackage: "",
    stripEnv: [],
  },
  codex: {
    label: "Codex",
    installPackage: "@openai/codex",
    stripEnv: [],
  },
  gemini: {
    label: "Gemini CLI",
    installPackage: "@google/gemini-cli",
    stripEnv: [],
  },
  opencode: {
    label: "OpenCode",
    installPackage: "opencode-ai",
    stripEnv: [],
  },
};

/** Check if a command name is in the CLI_REGISTRY allowlist */
export function isAllowedCommand(cmd: string): boolean {
  return Object.hasOwn(CLI_REGISTRY, cmd);
}

/** Check if a CLI command exists on PATH (safe — no shell interpolation) */
export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync("which", [cmd], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}
