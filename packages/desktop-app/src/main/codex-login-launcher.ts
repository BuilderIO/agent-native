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

export function getCodexLoginLaunchSpec(
  platform: string,
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
    return {
      ok: true,
      command: "x-terminal-emulator",
      args: ["-e", "codex", "login"],
    };
  }
  return {
    ok: false,
    error: `Opening a terminal is not supported on ${platform}.`,
  };
}
