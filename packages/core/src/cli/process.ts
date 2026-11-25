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
  options: Pick<SpawnOptions, "env" | "shell" | "stdio"> = {},
  platform: NodeJS.Platform = process.platform,
): Pick<SpawnOptions, "env" | "shell" | "stdio"> {
  return {
    stdio: options.stdio ?? "inherit",
    shell: options.shell ?? platform === "win32",
    env: options.env ?? process.env,
  };
}

/** Prefix of the private environment variables that carry `%` arguments. */
export const SHIM_ARG_ENV_PREFIX = "AGENT_NATIVE_SHIM_ARG_";

/**
 * `[command, args, shell]`, plus a fourth element when a Windows command line
 * refers to environment variables: the caller has to add those to the `env` it
 * spawns with.
 */
export type ShimSpawnTarget =
  | [command: string, args: string[], shell: boolean]
  | [
      command: string,
      args: string[],
      shell: boolean,
      shimEnv: Record<string, string>,
    ];

/**
 * The `[command, args, shell]` to spawn a package-manager shim such as npm or
 * pnpm. On Windows these are `.cmd` files, which Node starts only through a
 * shell (CVE-2024-27980; `spawn("npm.cmd", args)` fails with EINVAL), and the
 * shell needs the command line quoted because paths may contain spaces.
 *
 * cmd.exe expands `%NAME%` even inside double quotes, so a path such as
 * `C:\Users\%USERNAME%\app` would be rewritten before the shim sees it. Such
 * an argument goes into a private environment variable (the fourth element,
 * which the caller adds to the spawn `env`) and the command line refers to that
 * variable; cmd.exe does not expand a value a second time. A `"` cannot be
 * escaped in cmd.exe at all, so an argument with one is refused.
 *
 * The command name stays unquoted: the npm and pnpm shims find their files
 * through `%~dp0`, which cmd.exe resolves to the working directory when the
 * name is quoted.
 */
export function shimSpawnTarget(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): ShimSpawnTarget {
  if (platform !== "win32") return [command, args, false];
  const shimEnv: Record<string, string> = {};
  const quoted = args.map((arg, index) => {
    if (arg.includes('"')) {
      throw new Error(
        `Cannot run ${command} on Windows: path contains '"': ${arg}`,
      );
    }
    const closed = arg.replace(/(\\*)$/, "$1$1");
    if (arg.includes("%")) {
      const name = `${SHIM_ARG_ENV_PREFIX}${index}`;
      shimEnv[name] = closed;
      return `"%${name}%"`;
    }
    return /[\s&|<>^()!]/.test(arg) ? `"${closed}"` : arg;
  });
  const line = [command, ...quoted].join(" ");
  return Object.keys(shimEnv).length > 0
    ? [line, [], true, shimEnv]
    : [line, [], true];
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
