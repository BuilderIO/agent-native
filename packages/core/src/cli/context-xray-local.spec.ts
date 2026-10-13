import { EventEmitter } from "node:events";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { installLocalContextXray } from "./context-xray-local.js";

function createOpenUrlHarness(
  childProcess: { spawn: (...args: unknown[]) => unknown },
  warn: (...args: unknown[]) => void,
  platform = "linux",
) {
  const home = mkdtempSync(path.join(tmpdir(), "context-xray-open-url-"));
  const homeSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
  try {
    const { scriptPath } = installLocalContextXray({
      baseDir: home,
      clients: [],
      scope: "project",
    });
    const executable = readFileSync(scriptPath, "utf8");
    const start = executable.indexOf("function openUrl(url) {");
    const end = executable.indexOf("\n}\n\nfunction printSummary", start);
    if (start < 0 || end < 0) {
      throw new Error("Could not find openUrl in the Context X-Ray executable");
    }
    return runInNewContext(`(${executable.slice(start, end + 2)})`, {
      childProcess,
      process: { platform },
      console: { warn },
    }) as (url: string) => void;
  } finally {
    homeSpy.mockRestore();
    rmSync(home, { recursive: true, force: true });
  }
}

describe("Context X-Ray browser opener", () => {
  it.each([
    { code: 0, signal: null, warns: false },
    { code: 1, signal: null, warns: true },
    { code: null, signal: "SIGTERM", warns: true },
  ])("reports close result $code / $signal", ({ code, signal, warns }) => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn(() => child);
    const warn = vi.fn();
    const openUrl = createOpenUrlHarness({ spawn }, warn);

    openUrl("file:///tmp/report.html");
    child.emit("close", code, signal);

    expect(warn).toHaveBeenCalledTimes(warns ? 1 : 0);
    if (warns) {
      expect(warn).toHaveBeenCalledWith(
        "Could not auto-open browser. Open the printed URL manually.",
      );
    }
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("warns once when a spawn error is followed by close", () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const warn = vi.fn();
    const openUrl = createOpenUrlHarness({ spawn: vi.fn(() => child) }, warn);

    openUrl("file:///tmp/report.html");
    child.emit("error", new Error("spawn xdg-open ENOENT"));
    child.emit("close", null, null);

    expect(warn).toHaveBeenCalledOnce();
  });

  it("passes Windows file URLs with shell metacharacters to Explorer as data", () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn(() => child);
    const openUrl = createOpenUrlHarness({ spawn }, vi.fn(), "win32");
    const url = "file:///C:/reports/report&summary.html";

    openUrl(url);

    expect(spawn).toHaveBeenCalledWith(
      "explorer.exe",
      [url],
      expect.objectContaining({ shell: false }),
    );
  });
});
