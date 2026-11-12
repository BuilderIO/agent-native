import { EventEmitter } from "node:events";
import fs from "node:fs";
import os, { constants as osConstants } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cliSpawnOptions,
  DEV_SERVER_READY_FILE_ENV,
  DEV_SERVER_RECOVERY_EXIT_CODE,
  DEV_SERVER_SUPERVISOR_ENV,
  markDevServerReady,
  runDevServer,
} from "./process.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("markDevServerReady", () => {
  it("records only the first listen in a run", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-dev-ready-"));
    const file = path.join(dir, "ready");
    const env = { [DEV_SERVER_READY_FILE_ENV]: file };
    const now = vi.spyOn(Date, "now");

    try {
      now.mockReturnValue(1000);
      markDevServerReady(env);
      now.mockReturnValue(2000);
      markDevServerReady(env);

      expect(fs.readFileSync(file, "utf8")).toBe("1000");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does nothing when agent-native dev isn't watching", () => {
    const write = vi.spyOn(fs, "writeFileSync");

    markDevServerReady({});

    expect(write).not.toHaveBeenCalled();
  });

  it("never lets telemetry stop the dev server", () => {
    const missing = path.join(os.tmpdir(), "an-missing-dir", "nested", "ready");

    expect(() =>
      markDevServerReady({ [DEV_SERVER_READY_FILE_ENV]: missing }),
    ).not.toThrow();
  });
});

describe("cli process launch options", () => {
  it("allows real Windows executable paths to bypass cmd.exe", () => {
    expect(
      cliSpawnOptions("C:\\tools\\vite.exe", { shell: false }, "win32").shell,
    ).toBe(false);
  });

  it("starts this Node without cmd.exe, which splits C:\\Program Files", () => {
    expect(cliSpawnOptions(process.execPath, {}, "win32").shell).toBe(false);
  });

  it("keeps Windows shell support for command-name shims", () => {
    expect(cliSpawnOptions("pnpm", {}, "win32").shell).toBe(true);
  });

  it("does not enable a shell on Unix", () => {
    expect(cliSpawnOptions("pnpm", {}, "darwin").shell).toBe(false);
  });

  it("restarts only after the recovery exit code and keeps signal listeners bounded", async () => {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const baseline = new Map(
      signals.map((signal) => [signal, process.listenerCount(signal)]),
    );
    const children = [new EventEmitter(), new EventEmitter()];
    const spawnProcess = vi.fn(
      (_command: string, _args: string[], _options: unknown) =>
        children.shift() as EventEmitter,
    );
    const exitProcess = vi.fn();
    const realSetTimeout = globalThis.setTimeout;
    let restartTimer: NodeJS.Timeout | undefined;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      const timer = realSetTimeout(
        handler as Parameters<typeof setTimeout>[0],
        delay,
        ...args,
      );
      if (delay === 250) restartTimer = timer;
      return timer;
    }) as typeof setTimeout);

    runDevServer("vite", ["--host"], {
      env: { FIXTURE: "test" },
      spawnProcess: spawnProcess as never,
      exitProcess,
    });

    expect(spawnProcess).toHaveBeenCalledOnce();
    const firstSpawnOptions = spawnProcess.mock.calls[0]?.[2] as {
      env?: NodeJS.ProcessEnv;
    };
    expect(firstSpawnOptions.env?.[DEV_SERVER_SUPERVISOR_ENV]).toBe("1");

    spawnProcess.mock.results[0]?.value.emit(
      "exit",
      DEV_SERVER_RECOVERY_EXIT_CODE,
      null,
    );
    expect(restartTimer?.hasRef()).toBe(true);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    expect(exitProcess).not.toHaveBeenCalled();

    spawnProcess.mock.results[1]?.value.emit("exit", 0, null);
    expect(exitProcess).toHaveBeenCalledWith(0);
    for (const signal of signals) {
      expect(process.listenerCount(signal)).toBe(baseline.get(signal));
    }
  });

  it("uses a nonzero exit status when the child exits from a forwarded signal", () => {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const baseline = new Map(
      signals.map((signal) => [signal, process.listenerCount(signal)]),
    );
    const child = new EventEmitter();
    const exitProcess = vi.fn();

    runDevServer("vite", ["--host"], {
      spawnProcess: (() => child) as never,
      exitProcess,
    });

    child.emit("exit", null, "SIGTERM");

    expect(exitProcess).toHaveBeenCalledWith(128 + osConstants.signals.SIGTERM);
    for (const signal of signals) {
      expect(process.listenerCount(signal)).toBe(baseline.get(signal));
    }
  });
  it("exits immediately when a signal cancels a recovery restart", async () => {
    vi.useFakeTimers();
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const baseline = new Map(
      signals.map((signal) => [signal, process.listenerCount(signal)]),
    );
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const spawnProcess = vi.fn(() => child);
    const exitProcess = vi.fn();

    runDevServer("vite", ["--host"], {
      spawnProcess: spawnProcess as never,
      exitProcess,
    });
    child.emit("exit", DEV_SERVER_RECOVERY_EXIT_CODE, null);

    const signalHandler = process.listeners("SIGINT").at(-1);
    expect(signalHandler).toBeDefined();
    signalHandler?.();

    expect(child.kill).not.toHaveBeenCalled();
    expect(exitProcess).toHaveBeenCalledWith(128 + osConstants.signals.SIGINT);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(spawnProcess).toHaveBeenCalledOnce();
    for (const signal of signals) {
      expect(process.listenerCount(signal)).toBe(baseline.get(signal));
    }
  });
});
