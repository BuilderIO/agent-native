import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { getCodexLoginLaunchSpec, spawnDetached } from "./codex-login-launcher";

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
  ])("uses a fixed login command on %s", (platform, command, args) => {
    expect(getCodexLoginLaunchSpec(platform)).toEqual({
      ok: true,
      command,
      args,
    });
  });

  it("selects the first available Linux terminal emulator", () => {
    const unavailable = new Set(["x-terminal-emulator"]);
    expect(
      getCodexLoginLaunchSpec(
        "linux",
        (command) => !unavailable.has(command) && command === "gnome-terminal",
      ),
    ).toEqual({
      ok: true,
      command: "gnome-terminal",
      args: ["--", "codex", "login"],
    });
  });

  it("returns install guidance when Linux has no supported terminal", () => {
    expect(getCodexLoginLaunchSpec("linux", () => false)).toEqual({
      ok: false,
      error:
        "No supported terminal emulator was found. Install a terminal emulator and try again.",
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

  it("does not report success before the child emits spawn", async () => {
    const child = new EventEmitter() as EventEmitter & {
      unref: () => void;
    };
    child.unref = vi.fn();
    const launch = spawnDetached(
      "codex",
      ["login"],
      "/tmp",
      () => child as never,
    );

    child.emit("spawn");

    await expect(launch).resolves.toEqual({ ok: true, cwd: "/tmp" });
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it("returns a launch error when the child reports an asynchronous spawn failure", async () => {
    const child = new EventEmitter() as EventEmitter & {
      unref: () => void;
    };
    child.unref = vi.fn();
    const launch = spawnDetached(
      "missing-terminal",
      [],
      "/tmp",
      () => child as never,
    );

    child.emit("error", new Error("spawn ENOENT"));

    await expect(launch).resolves.toEqual({
      ok: false,
      cwd: "/tmp",
      error: "spawn ENOENT",
    });
    expect(child.unref).not.toHaveBeenCalled();
  });

  it("waits for wrapper exit status when requested", async () => {
    const child = new EventEmitter() as EventEmitter & {
      unref: () => void;
    };
    child.unref = vi.fn();
    const launch = spawnDetached(
      "/usr/bin/osascript",
      [],
      "/tmp",
      () => child as never,
      { waitForExit: true },
    );

    child.emit("spawn");
    child.emit("close", 0, null);

    await expect(launch).resolves.toEqual({ ok: true, cwd: "/tmp" });
    expect(child.unref).not.toHaveBeenCalled();
  });

  it("reports a wrapper's non-zero exit instead of claiming success", async () => {
    const child = new EventEmitter() as EventEmitter & {
      unref: () => void;
    };
    child.unref = vi.fn();
    const launch = spawnDetached(
      "/usr/bin/osascript",
      [],
      "/tmp",
      () => child as never,
      { waitForExit: true },
    );

    child.emit("spawn");
    child.emit("close", 1, null);

    await expect(launch).resolves.toEqual({
      ok: false,
      cwd: "/tmp",
      error: "Process exited with code 1.",
    });
  });
});
