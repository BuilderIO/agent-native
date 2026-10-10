import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TestCase, TestResult } from "@playwright/test/reporter";
import { describe, expect, it, vi } from "vitest";

import { startLoopbackProvider } from "./e2e/global-setup";
import {
  cleanupDesignE2eArtifacts,
  designE2eRunRoot,
} from "./e2e/global-teardown";
import RetryFailureReporter, {
  RETRY_FAILURE_MARKER,
} from "./e2e/retry-failure-reporter";

const testCase = (expectedStatus: TestCase["expectedStatus"]): TestCase =>
  ({ expectedStatus }) as TestCase;
const testResult = (status: TestResult["status"]): TestResult =>
  ({ status }) as TestResult;

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
      {
        pgliteDir: "run/pglite",
        resultsDir: "run/results",
        retryFailureMarker: "run/results/retry-failure.marker",
      },
      1,
      (target) => removed.push(target),
      () => true,
    );
    expect(removed).toEqual([]);
  });

  it("preserves retry diagnostics and removes the database after a flaky pass", () => {
    const removed: string[] = [];
    cleanupDesignE2eArtifacts(
      {
        pgliteDir: "run/pglite",
        resultsDir: "run/results",
        retryFailureMarker: "run/results/retry-failure.marker",
      },
      0,
      (target) => removed.push(target),
      (target) => target === "run/results/retry-failure.marker",
    );
    expect(removed).toEqual(["run/pglite"]);
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

  it("records failed and timed out attempts in the run output directory", async () => {
    const outputDir = await mkdtemp(
      path.join(os.tmpdir(), "design-playwright-retry-artifacts-"),
    );
    const markerPath = path.join(outputDir, RETRY_FAILURE_MARKER);

    try {
      const reporter = new RetryFailureReporter({ markerPath });
      reporter.onTestEnd(testCase("passed"), testResult("passed"));
      expect(existsSync(markerPath)).toBe(false);
      reporter.onTestEnd(testCase("failed"), testResult("failed"));
      expect(existsSync(markerPath)).toBe(false);
      reporter.onTestEnd(testCase("passed"), testResult("failed"));
      reporter.onTestEnd(testCase("passed"), testResult("timedOut"));
      expect(existsSync(markerPath)).toBe(true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("fails the reporter run when it cannot write a retry marker", async () => {
    const outputDir = await mkdtemp(
      path.join(os.tmpdir(), "design-playwright-retry-marker-error-"),
    );
    const blockerPath = path.join(outputDir, "not-a-directory");
    await writeFile(blockerPath, "");
    const reportError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const reporter = new RetryFailureReporter({
        markerPath: path.join(blockerPath, RETRY_FAILURE_MARKER),
      });
      reporter.onTestEnd(testCase("passed"), testResult("failed"));
      await expect(reporter.onEnd()).resolves.toEqual({ status: "failed" });
      expect(reportError).toHaveBeenCalledOnce();
    } finally {
      reportError.mockRestore();
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("fails the reporter run when the marker path is not configured", async () => {
    const reportError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const reporter = new RetryFailureReporter();
      await expect(reporter.onEnd()).resolves.toEqual({ status: "failed" });
      expect(reportError).toHaveBeenCalledOnce();
    } finally {
      reportError.mockRestore();
    }
  });
});
