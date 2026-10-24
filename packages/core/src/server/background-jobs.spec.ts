import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as dbClient from "../db/client.js";
import {
  registerBackgroundJobStop,
  stopBackgroundJobs,
} from "./background-jobs.js";
import { installDevDatabaseCloseHook } from "./dev-database-lifecycle.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const backgroundJobsModule = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "background-jobs.ts"),
).href;

describe("background job shutdown", () => {
  afterEach(async () => {
    await stopBackgroundJobs();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("runs each registered stopper once and forgets it", async () => {
    const first = vi.fn();
    const second = vi.fn(() => {
      throw new Error("stopper failed");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    registerBackgroundJobStop(first);
    registerBackgroundJobStop(second);

    await stopBackgroundJobs();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();

    await stopBackgroundJobs();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("awaits async stoppers before resolving", async () => {
    let finished = false;
    registerBackgroundJobStop(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      finished = true;
    });

    await stopBackgroundJobs();
    expect(finished).toBe(true);
  });

  it("stops waiting for a job that never finishes and names it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const other = vi.fn();
    registerBackgroundJobStop(function stopStuckJob() {
      return new Promise<void>(() => {});
    });
    registerBackgroundJobStop(other);

    await stopBackgroundJobs(20);

    expect(other).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("stopStuckJob"));
  }, 2_000);

  it("installs the Nitro close hook on production Node hosts", () => {
    vi.stubEnv("NODE_ENV", "production");
    const closeHooks: Array<() => void | Promise<void>> = [];
    installDevDatabaseCloseHook({
      hooks: {
        hook(name: string, handler: () => void | Promise<void>) {
          if (name === "close") closeHooks.push(handler);
        },
      },
    });
    expect(closeHooks).toHaveLength(1);
  });

  it("stops jobs but leaves the database open when a production server closes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const stop = vi.fn();
    registerBackgroundJobStop(stop);
    const shutdown = vi
      .spyOn(dbClient, "beginPgliteClientShutdown")
      .mockImplementation(() => {});
    const closeDb = vi
      .spyOn(dbClient, "closeDbExec")
      .mockResolvedValue(undefined);

    const closeHooks: Array<() => void | Promise<void>> = [];
    installDevDatabaseCloseHook({
      hooks: {
        hook(name: string, handler: () => void | Promise<void>) {
          if (name === "close") closeHooks.push(handler);
        },
      },
    });
    await closeHooks[0]!();

    expect(stop).toHaveBeenCalledOnce();
    expect(shutdown).not.toHaveBeenCalled();
    expect(closeDb).not.toHaveBeenCalled();
  });

  it("awaits registered stoppers before pausing the database on Nitro close", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const order: string[] = [];
    let releaseStop!: () => void;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    registerBackgroundJobStop(async () => {
      order.push("stop-start");
      await stopGate;
      order.push("stop-done");
    });

    vi.spyOn(dbClient, "beginPgliteClientShutdown").mockImplementation(() => {
      order.push("db-shutdown");
    });
    vi.spyOn(dbClient, "waitForPgliteClientOperations").mockResolvedValue(
      undefined,
    );
    vi.spyOn(dbClient, "closeDbExec").mockResolvedValue(undefined);

    const closeHooks: Array<() => void | Promise<void>> = [];
    installDevDatabaseCloseHook({
      hooks: {
        hook(name: string, handler: () => void | Promise<void>) {
          if (name === "close") closeHooks.push(handler);
        },
      },
    });

    const closing = closeHooks[0]!();
    await Promise.resolve();
    expect(order).toEqual(["stop-start"]);
    expect(order).not.toContain("db-shutdown");

    releaseStop();
    await closing;

    expect(order).toEqual(["stop-start", "stop-done", "db-shutdown"]);
  });

  it("clears registered referenced timers so the process can exit", async () => {
    const childSource = `
      import { registerBackgroundJobStop, stopBackgroundJobs } from ${JSON.stringify(backgroundJobsModule)};
      const timer = setInterval(() => {}, 60_000);
      registerBackgroundJobStop(() => clearInterval(timer));
      await stopBackgroundJobs();
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", childSource],
      {
        cwd: repoRoot,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new Error(
            `Child process stayed alive after stopBackgroundJobs${
              stderr ? `: ${stderr}` : ""
            }`,
          ),
        );
      }, 5_000);
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        if (signal) {
          reject(
            new Error(
              `Child exited from ${signal}${stderr ? `: ${stderr}` : ""}`,
            ),
          );
          return;
        }
        resolve(code ?? 1);
      });
    });

    await expect(exited).resolves.toBe(0);
  }, 15_000);
});
