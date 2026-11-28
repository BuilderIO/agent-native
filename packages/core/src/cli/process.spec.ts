import { spawn } from "node:child_process";
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
  shimSpawnTarget,
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
    expect(cliSpawnOptions({ shell: false }, "win32").shell).toBe(false);
  });

  it("keeps Windows shell support for command-name shims", () => {
    expect(cliSpawnOptions({}, "win32").shell).toBe(true);
  });

  it("does not enable a shell on Unix", () => {
    expect(cliSpawnOptions({}, "darwin").shell).toBe(false);
  });

  it("starts package-manager shims directly off Windows", () => {
    expect(shimSpawnTarget("npm", ["pack", "a b"], "linux")).toEqual([
      "npm",
      ["pack", "a b"],
      false,
    ]);
  });

  it("starts npm.cmd through a shell with a quoted command line on Windows", () => {
    expect(
      shimSpawnTarget(
        "npm",
        ["pack", "--pack-destination", "C:\\Users\\Jo Doe\\Temp\\x"],
        "win32",
      ),
    ).toEqual([
      'npm pack --pack-destination "C:\\Users\\Jo Doe\\Temp\\x"',
      [],
      true,
    ]);
  });

  it("names the command when a Windows argument can't be quoted", () => {
    expect(() => shimSpawnTarget("npm", ['C:\\x"y'], "win32")).toThrow(
      /Cannot run npm on Windows: path contains/,
    );
  });

  it("passes a Windows argument with %NAME% through an environment variable", () => {
    const dir = "C:\\Users\\%USERNAME%\\my app";
    expect(
      shimSpawnTarget("npm", ["--prefix", dir, "install"], "win32"),
    ).toEqual([
      'npm --prefix "%AGENT_NATIVE_SHIM_ARG_1%" install',
      [],
      true,
      { AGENT_NATIVE_SHIM_ARG_1: dir },
    ]);
  });

  it("keeps a trailing backslash from escaping the quote around an env variable", () => {
    const [command, , , shimEnv] = shimSpawnTarget(
      "npm",
      ["C:\\%TEMP%\\"],
      "win32",
    );
    expect(command).toBe('npm "%AGENT_NATIVE_SHIM_ARG_0%"');
    expect(shimEnv).toEqual({ AGENT_NATIVE_SHIM_ARG_0: "C:\\%TEMP%\\\\" });
  });

  it("adds no environment variables when no argument has a %", () => {
    expect(shimSpawnTarget("npm", ["a b"], "win32")).toHaveLength(3);
  });

  // oracle-change: runs only on Windows, where cmd.exe and a .cmd shim exist
  it.skipIf(process.platform !== "win32")(
    "delivers arguments to a real .cmd shim unchanged, including %NAME%",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-target-"));
      const out = path.join(dir, "argv.json");
      const manager = "npm";
      fs.writeFileSync(
        path.join(dir, "record-argv.cjs"),
        "require('fs').writeFileSync(process.env.SHIM_TEST_OUT, JSON.stringify(process.argv.slice(2)))",
      );
      fs.writeFileSync(
        path.join(dir, `${manager}.cmd`),
        '@echo off\r\n"%SHIM_TEST_NODE%" "%~dp0record-argv.cjs" %*\r\n',
      );
      const args = [
        "--prefix",
        "C:\\Users\\Jo Doe\\%SHIM_TEST_VAR%\\app\\",
        "install",
      ];
      try {
        const [command, commandArgs, shell, shimEnv] = shimSpawnTarget(
          manager,
          args,
          "win32",
        );
        await new Promise<void>((resolve, reject) => {
          const child = spawn(command, commandArgs, {
            shell,
            stdio: "ignore",
            cwd: os.tmpdir(),
            env: {
              ...process.env,
              PATH: `${dir}${path.delimiter}${process.env.PATH}`,
              SHIM_TEST_NODE: process.execPath,
              SHIM_TEST_OUT: out,
              SHIM_TEST_VAR: "EXPANDED",
              ...shimEnv,
            },
          });
          child.on("error", reject);
          child.on("exit", (code) =>
            code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
          );
        });
        expect(JSON.parse(fs.readFileSync(out, "utf8"))).toEqual(args);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

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
