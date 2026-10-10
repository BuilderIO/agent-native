import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export const RETRY_FAILURE_MARKER = "retry-failure.marker";

export default class RetryFailureReporter implements Reporter {
  private error?: Error;
  private readonly markerPath?: string;

  constructor(options: { markerPath?: string } = {}) {
    this.markerPath = options.markerPath;
    if (!this.markerPath) this.error = new Error("markerPath is required");
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "failed" && result.status !== "timedOut") return;
    if (test.expectedStatus === result.status) return;
    if (!this.markerPath) return;

    try {
      mkdirSync(path.dirname(this.markerPath), { recursive: true });
      writeFileSync(this.markerPath, "", { flag: "a" });
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
    }
  }

  async onEnd(): Promise<{ status: "failed" } | void> {
    if (!this.error) return;
    console.error(
      `[e2e] could not preserve retry diagnostics: ${this.error.message}`,
    );
    return { status: "failed" };
  }
}
