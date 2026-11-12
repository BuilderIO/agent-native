import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import fs from "node:fs";
import { constants as osConstants } from "node:os";

export const DEV_SERVER_SUPERVISOR_ENV = "AGENT_NATIVE_DEV_SUPERVISOR";
export const DEV_SERVER_RECOVERY_EXIT_CODE = 86;
export const DEV_SERVER_READY_FILE_ENV = "AGENT_NATIVE_DEV_READY_FILE";
/** Set on a workspace deploy's app builds: the deploy reports for all of them. */
export const WORKSPACE_DEPLOY_BUILD_ENV = "AGENT_NATIVE_WORKSPACE_DEPLOY_BUILD";

/**
 * Tells `agent-native dev` when this server is first listening. Only the first
 * call in a run creates the file, so restarts and later workspace apps don't count.
 */
export function markDevServerReady(env: NodeJS.ProcessEnv = process.env): void {
  const file = env[DEV_SERVER_READY_FILE_ENV];
  if (!file) return;
  try {
    fs.writeFileSync(file, String(Date.now()), { flag: "wx" });
    // coercion-ok: the file already exists, or telemetry can't write it
  } catch {}
}

export function cliSpawnOptions(
  command: string,
  options: Pick<SpawnOptions, "env" | "shell" | "stdio"> = {},
  platform: NodeJS.Platform = process.platform,
): Pick<SpawnOptions, "env" | "shell" | "stdio"> {
  return {
    stdio: options.stdio ?? "inherit",
    // cmd.exe is only for command-name shims like pnpm. It splits an unquoted
    // path at its spaces, and Node installs to C:\Program Files by default.
    shell:
      options.shell ?? (platform === "win32" && command !== process.execPath),
    env: options.env ?? process.env,
  };
}

export function runDevServer(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
    stdio?: "inherit" | "pipe";
    spawnProcess?: typeof spawn;
    exitProcess?: (code: number) => void;
  } = {},
): void {
  const env = {
    ...(options.env ?? process.env),
    [DEV_SERVER_SUPERVISOR_ENV]: "1",
  };
  const spawnProcess = options.spawnProcess ?? spawn;
  const exitProcess =
    options.exitProcess ?? ((code: number) => process.exit(code));
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  let child: ChildProcess | undefined;
  let restartTimer: NodeJS.Timeout | undefined;
  let forceExitTimer: NodeJS.Timeout | undefined;
  let shuttingDown = false;

  const cleanup = () => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    signalHandlers.clear();
    if (restartTimer) clearTimeout(restartTimer);
    if (forceExitTimer) clearTimeout(forceExitTimer);
  };

  const start = () => {
    restartTimer = undefined;
    child = spawnProcess(
      command,
      args,
      cliSpawnOptions(command, {
        env,
        shell: options.shell,
        stdio: options.stdio,
      }),
    );
    child.once("exit", (code, signal) => {
      if (code === DEV_SERVER_RECOVERY_EXIT_CODE && !shuttingDown) {
        restartTimer = setTimeout(start, 250);
        return;
      }
      cleanup();
      exitProcess(code ?? (signal ? 128 + osConstants.signals[signal] : 0));
    });
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const handler = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = undefined;
        cleanup();
        exitProcess(128 + osConstants.signals[signal]);
        return;
      }
      child?.kill(signal);
      forceExitTimer = setTimeout(() => {
        child?.kill("SIGKILL");
        exitProcess(1);
      }, 5_000);
      forceExitTimer.unref();
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  start();
}
