import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cliSpawnOptions,
  DEV_SERVER_RECOVERY_EXIT_CODE,
  DEV_SERVER_SUPERVISOR_ENV,
  runDevServer,
} from "./process.js";

afterEach(() => {
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
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    expect(exitProcess).not.toHaveBeenCalled();

    spawnProcess.mock.results[1]?.value.emit("exit", 0, null);
    expect(exitProcess).toHaveBeenCalledWith(0);
    for (const signal of signals) {
      expect(process.listenerCount(signal)).toBe(baseline.get(signal));
    }
  });
});
