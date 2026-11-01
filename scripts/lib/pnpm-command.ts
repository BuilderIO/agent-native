/**
 * How a root script starts pnpm, on every platform.
 *
 * On Windows pnpm is usually a `pnpm.cmd` shim. Node refuses to start a `.cmd`
 * file without a shell (CVE-2024-27980) and, without one, only finds `.exe`
 * and `.com` files on PATH. So there pnpm runs through cmd.exe as one command
 * line with every argument quoted. Passing that line with no separate
 * arguments also avoids Node's DEP0190 warning about unescaped shell
 * arguments. Everywhere else pnpm starts directly with its argument array.
 *
 *   const pnpm = pnpmCommand(["run", "build"]);
 *   spawn(pnpm.command, pnpm.args, { cwd, stdio: "inherit", shell: pnpm.shell });
 *
 * guard:no-bare-pnpm-spawn keeps new scripts on this path.
 */

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
): PnpmCommand {
  if (platform !== "win32") {
    return { command: "pnpm", args: [...args], shell: false };
  }
  const command = ["pnpm", ...args].map(quoteForCmd).join(" ");
  if (command.length > WINDOWS_COMMAND_LINE_LIMIT) {
    throw new Error(
      `The pnpm command line is ${command.length} characters, over the ${WINDOWS_COMMAND_LINE_LIMIT} that fit cmd.exe's limit. Pass fewer arguments per call.`,
    );
  }
  return { command, args: [], shell: true };
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
