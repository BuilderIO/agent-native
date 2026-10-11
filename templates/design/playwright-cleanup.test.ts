import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { startLoopbackProvider } from "./e2e/global-setup";
import {
  cleanupDesignE2eArtifacts,
  designE2eRunRoot,
} from "./e2e/global-teardown";

describe("Design Playwright artifact cleanup", () => {
  it("removes only this run's artifacts after a pass", () => {
    const removed: string[] = [];
    cleanupDesignE2eArtifacts(
      { pgliteDir: "run/pglite", resultsDir: "run/results" },
      0,
      (target) => removed.push(target),
    );
    expect(removed).toEqual(["run/pglite", "run/results"]);
  });

  it("preserves artifacts after a failure", () => {
    const removed: string[] = [];
    cleanupDesignE2eArtifacts(
      { pgliteDir: "run/pglite", resultsDir: "run/results" },
      1,
      (target) => removed.push(target),
    );
    expect(removed).toEqual([]);
  });

  it("uses the configured run root for loopback teardown", () => {
    expect(
      designE2eRunRoot("/repo/templates/design", "/tmp/custom-e2e-root", "run"),
    ).toBe("/tmp/custom-e2e-root");
  });

  it("uses the run id when no root is configured", () => {
    expect(designE2eRunRoot("/repo/templates/design", undefined, "run")).toBe(
      "/repo/.tmp/design-e2e/run",
    );
  });

  it("includes the asynchronous spawn error when the loopback provider cannot start", async () => {
    const originalExecPath = Object.getOwnPropertyDescriptor(
      process,
      "execPath",
    );
    const runRoot = await mkdtemp(
      path.join(os.tmpdir(), "design-loopback-provider-spawn-error-"),
    );

    try {
      vi.stubEnv("E2E_RUN_ROOT", runRoot);
      Object.defineProperty(process, "execPath", {
        configurable: true,
        value: path.join(runRoot, "missing-node-executable"),
      });
      await expect(startLoopbackProvider(45873)).rejects.toThrow(
        /spawn .* ENOENT/,
      );
    } finally {
      if (originalExecPath) {
        Object.defineProperty(process, "execPath", originalExecPath);
      } else {
        Reflect.deleteProperty(process, "execPath");
      }
      vi.unstubAllEnvs();
      await rm(runRoot, { recursive: true, force: true });
    }
  });
});
