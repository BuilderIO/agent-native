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

export async function terminalPath(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const [fs, os, path] = await Promise.all([
    import("node:fs"),
    import("node:os"),
    import("node:path"),
  ]);
  const home = environment.HOME || os.homedir();
  const nvmDirectories = home
    ? (() => {
        try {
          return fs
            .readdirSync(path.join(home, ".nvm", "versions", "node"))
            .map((version) =>
              path.join(home, ".nvm", "versions", "node", version, "bin"),
            );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }
      })()
    : [];
  const entries = [
    ...(environment.PATH ?? "").split(path.delimiter).filter(Boolean),
    environment.PNPM_HOME,
    home ? path.join(home, ".local", "bin") : undefined,
    home ? path.join(home, ".local", "share", "pnpm") : undefined,
    home ? path.join(home, "Library", "pnpm") : undefined,
    home ? path.join(home, ".opencode", "bin") : undefined,
    home ? path.join(home, ".cargo", "bin") : undefined,
    ...nvmDirectories,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter((entry): entry is string => Boolean(entry));
  return [...new Set(entries)].join(path.delimiter);
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
  pi: {
    label: "Pi",
    installPackage: "",
    stripEnv: [],
  },
};

/** Check if a command name is in the CLI_REGISTRY allowlist */
export function isAllowedCommand(cmd: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLI_REGISTRY, cmd);
}

/** Resolve a CLI from the user's shell locations, including GUI launch paths. */
export async function resolveCommandPath(
  cmd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("which", [cmd], {
    encoding: "utf8",
    env: { ...environment, PATH: await terminalPath(environment) },
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const resolved = result.stdout?.trim().split(/\r?\n/)[0];
  return resolved || cmd;
}

/** Check if a CLI command exists on PATH (safe — no shell interpolation) */
export async function commandExists(cmd: string): Promise<boolean> {
  return (await resolveCommandPath(cmd)) !== null;
}
