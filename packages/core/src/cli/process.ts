import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { constants as osConstants } from "node:os";

export const DEV_SERVER_SUPERVISOR_ENV = "AGENT_NATIVE_DEV_SUPERVISOR";
export const DEV_SERVER_RECOVERY_EXIT_CODE = 86;

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
      cliSpawnOptions({
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
