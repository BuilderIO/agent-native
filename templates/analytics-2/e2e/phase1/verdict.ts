import { performance } from "node:perf_hooks";

import {
  candidateBuildIssue,
  finishBuildVerdict,
  type BuildObservation,
} from "../build-boundary.js";

type Verdict = "PASS" | "FAIL" | "COULD-NOT-RUN";
type Proof = "transition" | "oracle" | "readback" | "rejecting" | "cold";
type Step = {
  label: string;
  elapsedMs: number;
  status: "passed" | "failed";
  proof?: Proof;
};

export class MissingCapability extends Error {
  constructor(readonly capability: string) {
    super("not implemented");
  }
}

export class UnavailableFixture extends Error {}
export class EvidenceFailure extends Error {}

export class Evidence {
  readonly steps: Step[] = [];
  readonly ids: Record<string, string> = {};
  readonly actorIds: Record<string, string> = {};
  readonly screenshots: string[] = [];
  readonly actions: {
    name: string;
    actor: string;
    method: string;
    status: number;
    elapsedMs: number;
    traceId?: string;
  }[] = [];

  async step<T>(label: string, run: () => Promise<T>, proof?: Proof) {
    const started = performance.now();
    let status: Step["status"] = "failed";
    try {
      const value = await run();
      status = "passed";
      return value;
    } finally {
      this.steps.push({
        label,
        elapsedMs: performance.now() - started,
        status,
        ...(proof && { proof }),
      });
    }
  }

  completenessIssue() {
    const failed = this.steps.find((step) => step.status === "failed");
    if (failed) return `Evidence step failed: ${failed.label}`;
    const proofs: Proof[] = [
      "transition",
      "oracle",
      "readback",
      "rejecting",
      "cold",
    ];
    const missing = proofs.filter(
      (proof) =>
        !this.steps.some(
          (step) => step.proof === proof && step.status === "passed",
        ),
    );
    const fields: string[] = [...missing];
    if (!this.actions.some((action) => action.status === 200))
      fields.push("action response");
    if (!Object.keys(this.ids).some((key) => !key.endsWith("WorkspaceId")))
      fields.push("record identity");
    if (!this.screenshots.length) fields.push("screenshot");
    return fields.length ? `Incomplete evidence: ${fields.join(", ")}` : null;
  }
}

function classifyError(error: unknown): {
  verdict: Verdict;
  reason: string;
  capability?: string;
  diagnostic?: string;
} {
  if (error instanceof MissingCapability)
    return {
      verdict: "FAIL",
      reason: "not implemented",
      capability: error.capability,
    };
  if (error instanceof UnavailableFixture)
    return { verdict: "COULD-NOT-RUN", reason: error.message };
  if (error instanceof EvidenceFailure)
    return { verdict: "FAIL", reason: error.message };
  const diagnostic =
    error instanceof Error
      ? error.stack?.match(/\be2e\/phase1\/[\w-]+\.ts:\d+:\d+/)?.[0]
      : undefined;
  return {
    verdict: "FAIL",
    reason: "flow assertion or operation failed",
    ...(diagnostic && { diagnostic }),
  };
}

export async function evaluateFlow({
  expectedSha,
  observe,
  run,
  onFailure,
  evidence,
}: {
  expectedSha: string;
  observe: () => Promise<BuildObservation>;
  run: () => Promise<void>;
  onFailure?: () => Promise<void>;
  evidence: Evidence;
}) {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const before = await observe();
  const preflight = candidateBuildIssue(before, expectedSha);
  let observed: ReturnType<typeof classifyError> = {
    verdict: "COULD-NOT-RUN",
    reason: "flow not started",
  };
  if (!preflight) {
    try {
      await run();
      const incomplete = evidence.completenessIssue();
      observed = incomplete
        ? { verdict: "FAIL", reason: incomplete }
        : {
            verdict: "PASS",
            reason:
              "mounted transition, oracle, action readback, rejection and cold reopen passed",
          };
    } catch (error) {
      observed = classifyError(error);
    }
  }
  const gate = await finishBuildVerdict(
    observed.verdict,
    observed.reason,
    before,
    observe,
    expectedSha,
  );
  if (gate.status !== "PASS" && !preflight && onFailure) await onFailure();
  return {
    verdict: gate.status,
    reason: gate.detail,
    observed,
    expectedSha,
    shaBefore: gate.before.kind === "read" ? gate.before.sha : null,
    shaAfter: gate.after.kind === "read" ? gate.after.sha : null,
    buildBefore: gate.before,
    buildAfter: gate.after,
    startedAt,
    elapsedMs: performance.now() - started,
    ...evidence,
  };
}
