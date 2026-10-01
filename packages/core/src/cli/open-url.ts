import { spawn } from "node:child_process";

type OpenUrlOptions = {
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
  warn?: (message: string) => void;
};

export function openUrlInBrowser(
  url: string,
  options: OpenUrlOptions = {},
): void {
  const platform = options.platform ?? process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const warn = options.warn ?? console.warn;
  const reportError = (error: unknown) => {
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
      shell: platform === "win32",
      windowsHide: true,
    });
    child.on("error", reportError);
    child.unref();
  } catch (error) {
    reportError(error);
  }
}
