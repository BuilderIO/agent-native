import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

export const RETRY_FAILURE_MARKER = "retry-failure.marker";
const DESIGN_DIR = path.resolve(import.meta.dirname, "..");

type PinOutcome = {
  status: TestResult["status"];
  expectedStatus: TestCase["expectedStatus"];
};

function designRelativeFile(file: string): string {
  const absolute = path.isAbsolute(file)
    ? path.resolve(file)
    : path.resolve(DESIGN_DIR, file);
  const relative = path.relative(DESIGN_DIR, absolute);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`path is outside templates/design: ${file}`);
  }
  return relative.split(path.sep).join("/");
}

function normalizePinSelector(selector: string): string {
  const separator = selector.lastIndexOf(":");
  if (separator < 1) {
    throw new Error(
      `expected a file:line selector, got ${JSON.stringify(selector)}`,
    );
  }
  const file = selector.slice(0, separator);
  const line = Number(selector.slice(separator + 1));
  if (!Number.isSafeInteger(line) || line < 1) {
    throw new Error(
      `expected a positive line number, got ${JSON.stringify(selector)}`,
    );
  }
  const normalizedFile = designRelativeFile(file);
  if (!normalizedFile.startsWith("e2e/")) {
    throw new Error(
      `expected an e2e selector, got ${JSON.stringify(selector)}`,
    );
  }
  return `${normalizedFile}:${line}`;
}

function parseRequiredPinSelectors(source: string): Map<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `E2E_REQUIRED_PIN_SELECTORS must be JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("E2E_REQUIRED_PIN_SELECTORS must be a non-empty array");
  }

  const counts = new Map<string, number>();
  for (const selector of parsed) {
    if (typeof selector !== "string") {
      throw new Error("E2E_REQUIRED_PIN_SELECTORS entries must be strings");
    }
    const normalized = normalizePinSelector(selector);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

export default class RetryFailureReporter implements Reporter {
  private error?: Error;
  private readonly markerPath?: string;
  private readonly pinAttestationEnabled: boolean;
  private readonly requiredPinSelectors?: Map<string, number>;
  private readonly pinOutcomes = new Map<string, Map<string, PinOutcome>>();
  private readonly pinAttestationErrors: string[] = [];

  constructor(
    options: { markerPath?: string; requiredPinSelectors?: string } = {},
  ) {
    this.markerPath = options.markerPath;
    if (!this.markerPath) this.error = new Error("markerPath is required");
    this.pinAttestationEnabled = options.requiredPinSelectors !== undefined;
    if (options.requiredPinSelectors !== undefined) {
      try {
        this.requiredPinSelectors = parseRequiredPinSelectors(
          options.requiredPinSelectors,
        );
      } catch (error) {
        this.pinAttestationErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (this.pinAttestationEnabled && this.requiredPinSelectors) {
      const line = test.location?.line;
      if (Number.isSafeInteger(line) && line > 0) {
        try {
          const selector = `${designRelativeFile(test.location.file)}:${line}`;
          if (this.requiredPinSelectors.has(selector)) {
            const outcomes = this.pinOutcomes.get(selector) ?? new Map();
            outcomes.set(test.id, {
              status: result.status,
              expectedStatus: test.expectedStatus,
            });
            this.pinOutcomes.set(selector, outcomes);
          }
        } catch {
          // Non-Design tests cannot match the required e2e selectors.
        }
      }
    }

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

  async onEnd(result?: FullResult): Promise<{ status: "failed" } | void> {
    if (this.pinAttestationEnabled) this.verifyRequiredPinOutcomes();
    if (
      this.pinAttestationEnabled &&
      (result?.status === "interrupted" || result?.status === "timedout")
    ) {
      this.pinAttestationErrors.push(
        `required Design pin run ended with status ${result.status}`,
      );
    }

    if (this.error) {
      console.error(
        `[e2e] could not preserve retry diagnostics: ${this.error.message}`,
      );
    }
    if (this.pinAttestationErrors.length > 0) {
      console.error(
        `[e2e] required Design pin outcome attestation failed:\n${this.pinAttestationErrors.join("\n")}`,
      );
    }
    if (this.error || this.pinAttestationErrors.length > 0) {
      return { status: "failed" };
    }
  }

  private verifyRequiredPinOutcomes(): void {
    if (!this.requiredPinSelectors) return;

    for (const [selector, expectedCount] of this.requiredPinSelectors) {
      const outcomes = [...(this.pinOutcomes.get(selector)?.values() ?? [])];
      if (outcomes.length < expectedCount) {
        this.pinAttestationErrors.push(
          `required Design pin did not produce a result (${outcomes.length}/${expectedCount}): ${selector}`,
        );
      }
      for (const outcome of outcomes) {
        if (
          outcome.status !== "passed" ||
          outcome.expectedStatus !== "passed"
        ) {
          this.pinAttestationErrors.push(
            `required Design pin did not finish as passed (status=${outcome.status}, expectedStatus=${outcome.expectedStatus}): ${selector}`,
          );
        }
      }
    }
  }
}
