import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  codexConfigPath,
  coworkConfigPath,
  cursorUserConfig,
  githubCopilotUserConfig,
  opencodeUserConfig,
  type ClientId,
} from "./mcp-config-writers.js";

type ClientSignals = { dirs: string[]; files: string[]; commands: string[] };

function clientSignals(client: ClientId): ClientSignals {
  const home = os.homedir();
  switch (client) {
    case "claude-code":
    case "claude-code-cli":
      return {
        dirs: [path.join(home, ".claude")],
        // The native installer puts `claude` in ~/.local/bin without adding
        // that folder to PATH, and ~/.claude only appears after first launch.
        files: [
          path.join(home, ".claude.json"),
          path.join(home, ".local", "bin", "claude"),
        ],
        commands: ["claude"],
      };
    case "codex":
      return {
        dirs: [path.dirname(codexConfigPath())],
        files: [],
        commands: ["codex"],
      };
    case "cowork":
      return {
        dirs: [path.dirname(coworkConfigPath())],
        files: [],
        commands: [],
      };
    case "cursor":
      return {
        dirs: [path.dirname(cursorUserConfig())],
        files: [],
        commands: ["cursor"],
      };
    case "opencode":
      return {
        dirs: [path.dirname(opencodeUserConfig())],
        files: [],
        commands: ["opencode"],
      };
    case "github-copilot":
      return {
        dirs: [path.dirname(githubCopilotUserConfig())],
        files: [],
        commands: ["code"],
      };
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    // coercion-ok: a missing or unreadable path is not evidence of an install.
    return false;
  }
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    // coercion-ok: a missing or unreadable path is not evidence of an install.
    return false;
  }
}

function commandOnPath(command: string, env: NodeJS.ProcessEnv): boolean {
  const extensions =
    process.platform === "win32"
      ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)]
      : [""];
  return (env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) =>
      extensions.some((extension) =>
        isFile(path.join(dir, command + extension)),
      ),
    );
}

/**
 * Returns the candidates that show signs of being installed on this machine:
 * a config folder, a known file, or a command on PATH. Order follows
 * `candidates`.
 */
export function detectInstalledClients(
  candidates: readonly ClientId[],
  env: NodeJS.ProcessEnv = process.env,
): ClientId[] {
  return candidates.filter((client) => {
    const signals = clientSignals(client);
    return (
      signals.dirs.some(isDirectory) ||
      signals.files.some(isFile) ||
      signals.commands.some((command) => commandOnPath(command, env))
    );
  });
}

export function isHomeDirectory(dir: string, home = os.homedir()): boolean {
  const resolve = (value: string) => {
    try {
      return fs.realpathSync(value);
    } catch {
      // coercion-ok: compare the plain resolved path when realpath fails.
      return path.resolve(value);
    }
  };
  const a = resolve(dir);
  const b = resolve(home);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}
