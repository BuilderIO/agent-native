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

type RequiredPinIdentity = {
  selector: string;
  title: string;
};

type RequiredPin = RequiredPinIdentity & { expectedCount: number };

function pinIdentityKey(selector: string, title: string): string {
  return JSON.stringify([selector, title]);
}

function maybeDesignRelativeFile(file: string): string | undefined {
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
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

function designRelativeFile(file: string): string {
  const relative = maybeDesignRelativeFile(file);
  if (!relative) throw new Error(`path is outside templates/design: ${file}`);
  return relative;
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

function parseRequiredPinIdentities(source: string): Map<string, RequiredPin> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `E2E_REQUIRED_PIN_IDENTITIES must be JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("E2E_REQUIRED_PIN_IDENTITIES must be a non-empty array");
  }

  const required = new Map<string, RequiredPin>();
  for (const identity of parsed) {
    if (
      !identity ||
      typeof identity !== "object" ||
      Array.isArray(identity) ||
      typeof (identity as RequiredPinIdentity).selector !== "string" ||
      typeof (identity as RequiredPinIdentity).title !== "string" ||
      !(identity as RequiredPinIdentity).title.trim()
    ) {
      throw new Error(
        "E2E_REQUIRED_PIN_IDENTITIES entries must include a selector and non-empty title",
      );
    }
    const { title } = identity as RequiredPinIdentity;
    const selector = normalizePinSelector(
      (identity as RequiredPinIdentity).selector,
    );
    const key = pinIdentityKey(selector, title);
    const existing = required.get(key);
    required.set(key, {
      selector,
      title,
      expectedCount: (existing?.expectedCount ?? 0) + 1,
    });
  }
  return required;
}

export default class RetryFailureReporter implements Reporter {
  private error?: Error;
  private readonly markerPath?: string;
  private readonly pinAttestationEnabled: boolean;
  private readonly requiredPinIdentities?: Map<string, RequiredPin>;
  private readonly pinOutcomes = new Map<string, Map<string, PinOutcome>>();
  private readonly pinAttestationErrors: string[] = [];

  constructor(
    options: { markerPath?: string; requiredPinIdentities?: string } = {},
  ) {
    this.markerPath = options.markerPath;
    if (!this.markerPath) this.error = new Error("markerPath is required");
    this.pinAttestationEnabled = options.requiredPinIdentities !== undefined;
    if (options.requiredPinIdentities !== undefined) {
      try {
        this.requiredPinIdentities = parseRequiredPinIdentities(
          options.requiredPinIdentities,
        );
      } catch (error) {
        this.pinAttestationErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (this.pinAttestationEnabled && this.requiredPinIdentities) {
      const line = test.location?.line;
      if (Number.isSafeInteger(line) && line > 0) {
        const file = maybeDesignRelativeFile(test.location.file);
        if (file?.startsWith("e2e/")) {
          const selector = `${file}:${line}`;
          const key = pinIdentityKey(selector, test.title);
          if (this.requiredPinIdentities.has(key)) {
            const outcomes = this.pinOutcomes.get(key) ?? new Map();
            outcomes.set(test.id, {
              status: result.status,
              expectedStatus: test.expectedStatus,
            });
            this.pinOutcomes.set(key, outcomes);
          }
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
    if (!this.requiredPinIdentities) return;

    for (const [key, pin] of this.requiredPinIdentities) {
      const outcomes = [...(this.pinOutcomes.get(key)?.values() ?? [])];
      if (outcomes.length < pin.expectedCount) {
        this.pinAttestationErrors.push(
          `required Design pin did not produce a result (${outcomes.length}/${pin.expectedCount}): ${pin.selector} / ${JSON.stringify(pin.title)}`,
        );
      }
      for (const outcome of outcomes) {
        if (
          outcome.status !== "passed" ||
          outcome.expectedStatus !== "passed"
        ) {
          this.pinAttestationErrors.push(
            `required Design pin did not finish as passed (status=${outcome.status}, expectedStatus=${outcome.expectedStatus}): ${pin.selector} / ${JSON.stringify(pin.title)}`,
          );
        }
      }
    }
  }
}
