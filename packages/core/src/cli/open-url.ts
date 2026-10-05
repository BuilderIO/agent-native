import { spawn } from "node:child_process";

type OpenUrlOptions = {
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
  warn?: (message: string) => void;
};

export function getUrlOpenerCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
) {
  const command =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  return { command, args: [url] };
}

export function openUrlInBrowser(
  url: string,
  options: OpenUrlOptions = {},
): void {
  const platform = options.platform ?? process.platform;
  const { command, args } = getUrlOpenerCommand(url, platform);
  const warn = options.warn ?? console.warn;
  let reportedError = false;
  const reportError = (error: unknown) => {
    if (reportedError) return;
    reportedError = true;
    const reason =
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
        ? `${command} not installed`
        : error instanceof Error
          ? error.message
          : String(error);
    warn(
      `Could not auto-open browser (${reason}). Open the printed URL manually.`,
    );
  };

  try {
    const child = (options.spawnProcess ?? spawn)(command, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    child.once("error", reportError);
    child.once("close", (code, signal) => {
      if (code === 0 && !signal) return;
      reportError(
        new Error(
          signal
            ? `${command} exited after ${signal}`
            : `${command} exited with code ${code}`,
        ),
      );
    });
    child.unref();
  } catch (error) {
    reportError(error);
  }
}
