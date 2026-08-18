import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

export type CodexLoginLaunchSpec =
  | {
      ok: true;
      command: string;
      args: string[];
    }
  | {
      ok: false;
      error: string;
    };

type CommandAvailable = (command: string) => boolean;

export interface DetachedLaunchResult {
  ok: boolean;
  cwd: string;
  error?: string;
}

type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface DetachedLaunchOptions {
  /** Wait for wrapper commands (such as macOS osascript) to exit. */
  waitForExit?: boolean;
}

/** Spawn a detached process and resolve only after spawn or error is known. */
export function spawnDetached(
  command: string,
  args: string[],
  cwd: string,
  spawnProcess: SpawnProcess = (nextCommand, nextArgs, options) =>
    spawn(nextCommand, nextArgs, options),
  { waitForExit = false }: DetachedLaunchOptions = {},
): Promise<DetachedLaunchResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DetachedLaunchResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawnProcess(command, args, {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      const onError = (err: Error) => {
        finish({
          ok: false,
          cwd,
          error: err instanceof Error ? err.message : String(err),
        });
      };
      const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0) {
          finish({ ok: true, cwd });
          return;
        }
        finish({
          ok: false,
          cwd,
          error: `Process exited with ${
            signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
          }.`,
        });
      };
      child.once("spawn", () => {
        if (waitForExit) {
          child.once("close", onClose);
          return;
        }
        child.removeListener("error", onError);
        child.unref();
        finish({ ok: true, cwd });
      });
      child.once("error", onError);
    } catch (err) {
      finish({
        ok: false,
        cwd,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

const LINUX_TERMINAL_CANDIDATES = [
  { command: "x-terminal-emulator", args: ["-e", "codex", "login"] },
  { command: "gnome-terminal", args: ["--", "codex", "login"] },
  { command: "konsole", args: ["-e", "codex", "login"] },
  { command: "xfce4-terminal", args: ["--command", "codex login"] },
  { command: "xterm", args: ["-e", "codex", "login"] },
] as const;

export function getCodexLoginLaunchSpec(
  platform: string,
  commandAvailable: CommandAvailable = () => true,
): CodexLoginLaunchSpec {
  if (platform === "darwin") {
    return {
      ok: true,
      command: "/usr/bin/osascript",
      args: [
        "-e",
        'tell application "Terminal" to do script "codex login"',
        "-e",
        'tell application "Terminal" to activate',
      ],
    };
  }
  if (platform === "win32") {
    return {
      ok: true,
      command: "cmd.exe",
      args: ["/d", "/k", "codex login"],
    };
  }
  if (platform === "linux") {
    const terminal = LINUX_TERMINAL_CANDIDATES.find((candidate) =>
      commandAvailable(candidate.command),
    );
    if (terminal)
      return { ok: true, command: terminal.command, args: [...terminal.args] };
    return {
      ok: false,
      error:
        "No supported terminal emulator was found. Install a terminal emulator and try again.",
    };
  }
  return {
    ok: false,
    error: `Opening a terminal is not supported on ${platform}.`,
  };
}
