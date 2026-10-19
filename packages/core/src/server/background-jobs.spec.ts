import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    stopBackgroundJobs();
    vi.unstubAllEnvs();
  });

  it("runs each registered stopper once and forgets it", () => {
    const first = vi.fn();
    const second = vi.fn(() => {
      throw new Error("stopper failed");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    registerBackgroundJobStop(first);
    registerBackgroundJobStop(second);

    stopBackgroundJobs();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();

    stopBackgroundJobs();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

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

  it("clears registered referenced timers so the process can exit", async () => {
    const childSource = `
      import { registerBackgroundJobStop, stopBackgroundJobs } from ${JSON.stringify(backgroundJobsModule)};
      const timer = setInterval(() => {}, 60_000);
      registerBackgroundJobStop(() => clearInterval(timer));
      stopBackgroundJobs();
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
