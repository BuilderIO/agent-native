import { EventEmitter } from "node:events";
import { constants as osConstants } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cliSpawnOptions,
  DEV_SERVER_RECOVERY_EXIT_CODE,
  DEV_SERVER_SUPERVISOR_ENV,
  runDevServer,
} from "./process.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cli process launch options", () => {
  it("allows real Windows executable paths to bypass cmd.exe", () => {
    expect(cliSpawnOptions({ shell: false }, "win32").shell).toBe(false);
  });

  it("keeps Windows shell support for command-name shims", () => {
    expect(cliSpawnOptions({}, "win32").shell).toBe(true);
  });

  it("does not enable a shell on Unix", () => {
    expect(cliSpawnOptions({}, "darwin").shell).toBe(false);
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
