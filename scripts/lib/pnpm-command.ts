/**
 * How a root script starts pnpm, on every platform.
 *
 * On Windows pnpm is usually a `pnpm.cmd` shim. Node refuses to start a `.cmd`
 * file without a shell (CVE-2024-27980) and, without one, only finds `.exe`
 * and `.com` files on PATH. So a script that pnpm started (`pnpm run`, an
 * install script) starts that same pnpm from `npm_execpath`, with no shell.
 * Any other script runs pnpm through cmd.exe as one command line: `pnpm` bare,
 * then every argument quoted. cmd.exe gives a batch file it finds on PATH
 * under a quoted name the current folder as `%~dp0`, so a launcher that finds
 * `pnpm.cjs` from there, like pnpm 11's, looks in the wrong folder and fails
 * with "Cannot find module". Passing that line with no separate arguments
 * also avoids Node's DEP0190 warning about unescaped shell arguments.
 * Everywhere else pnpm starts directly with its argument array.
 *
 *   const pnpm = pnpmCommand(["run", "build"]);
 *   spawn(pnpm.command, pnpm.args, { cwd, stdio: "inherit", shell: pnpm.shell });
 *
 * A helper that runs any command, pnpm among them, uses startCommand instead,
 * and stopProcessTree to stop what it started.
 *
 * guard:no-bare-pnpm-spawn keeps new scripts on this path.
 */

import { spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";

export type PnpmCommand = {
  command: string;
  args: string[];
  shell: boolean;
};

/**
 * The longest line pnpmCommand builds on Windows. cmd.exe reads at most 8,191
 * characters, and Node runs the line as `<ComSpec> /d /s /c "<line>"`, so this
 * leaves room for that wrapper with a cmd.exe path as long as MAX_PATH.
 */
export const WINDOWS_COMMAND_LINE_LIMIT = 8191 - 260 - ' /d /s /c ""'.length;

export function pnpmCommand(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): PnpmCommand {
  if (platform !== "win32") {
    return { command: "pnpm", args: [...args], shell: false };
  }
  const running = runningWindowsPnpm(env);
  if (running) {
    return {
      command: running.command,
      args: [...running.args, ...args],
      shell: false,
    };
  }
  return { command: windowsCommandLine(args), args: [], shell: true };
}

/**
 * The cmd.exe line pnpmCommand falls back to on Windows. It is the longest
 * form a pnpm start takes there, so batching measures against it.
 */
export function windowsCommandLine(args: readonly string[]): string {
  const command = ["pnpm", ...args.map(quoteForCmd)].join(" ");
  if (command.length > WINDOWS_COMMAND_LINE_LIMIT) {
    throw new Error(
      `The pnpm command line is ${command.length} characters, over the ${WINDOWS_COMMAND_LINE_LIMIT} that fit cmd.exe's limit. Pass fewer arguments per call.`,
    );
  }
  return command;
}

/**
 * The pnpm that started this script, when it can start again without a shell.
 * npm and Yarn set `npm_execpath` too, so only pnpm's own entry counts: its
 * `pnpm.cjs` under Node, or the standalone `pnpm.exe`. `pnpm exec` sets
 * nothing, and a `pnpm.cmd` shim needs cmd.exe, so both fall back.
 */
function runningWindowsPnpm(
  env: NodeJS.ProcessEnv,
): { command: string; args: string[] } | null {
  const execPath = env.npm_execpath;
  if (!execPath) return null;
  const name = path.win32.basename(execPath).toLowerCase();
  if (/^pnpm\.(?:c|m)?js$/.test(name)) {
    return { command: process.execPath, args: [execPath] };
  }
  if (name === "pnpm.exe") return { command: execPath, args: [] };
  return null;
}

/** pnpm goes through pnpmCommand; any other command starts as given. */
export function startCommand(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): PnpmCommand {
  return command === "pnpm"
    ? pnpmCommand(args, platform)
    : { command, args: [...args], shell: false };
}

/**
 * Stops a command from startCommand. Under a shell, `child.kill()` would stop
 * only cmd.exe and leave pnpm running, so Windows stops the whole tree.
 */
export function stopProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (process.platform === "win32" && child.pid && child.exitCode === null) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  child.kill(signal);
}

function quoteForCmd(arg: string): string {
  // cmd.exe expands %NAME% even inside quotes and has no escape for a quote
  // inside a quoted argument, so neither can reach pnpm intact.
  if (/["%\r\n]/.test(arg)) {
    throw new Error(
      `Cannot pass ${JSON.stringify(arg)} to pnpm through cmd.exe: it contains a quote, a percent sign or a line break.`,
    );
  }
  // Backslashes before the closing quote would escape it for the program
  // reading the line, so double a trailing run.
  return `"${arg.replace(/(\\+)$/, "$1$1")}"`;
}
