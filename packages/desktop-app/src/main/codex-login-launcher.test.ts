import { describe, expect, it } from "vitest";

import { getCodexLoginLaunchSpec } from "./codex-login-launcher";

describe("getCodexLoginLaunchSpec", () => {
  it.each([
    [
      "darwin",
      "/usr/bin/osascript",
      [
        "-e",
        'tell application "Terminal" to do script "codex login"',
        "-e",
        'tell application "Terminal" to activate',
      ],
    ],
    ["win32", "cmd.exe", ["/d", "/k", "codex login"]],
    ["linux", "x-terminal-emulator", ["-e", "codex", "login"]],
  ])("uses a fixed login command on %s", (platform, command, args) => {
    expect(getCodexLoginLaunchSpec(platform)).toEqual({
      ok: true,
      command,
      args,
    });
  });

  it("does not interpolate renderer-controlled values into the command", () => {
    const spec = getCodexLoginLaunchSpec("darwin");

    expect(spec).toEqual({
      ok: true,
      command: "/usr/bin/osascript",
      args: [
        "-e",
        'tell application "Terminal" to do script "codex login"',
        "-e",
        'tell application "Terminal" to activate',
      ],
    });
  });

  it("rejects unsupported platforms", () => {
    expect(getCodexLoginLaunchSpec("aix")).toEqual({
      ok: false,
      error: "Opening a terminal is not supported on aix.",
    });
  });
});
