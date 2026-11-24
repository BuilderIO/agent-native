import { AsyncLocalStorage } from "node:async_hooks";
import { types } from "node:util";

const RENEWAL_FAILURE_CODES = new Set([
  "57014",
  "55P03",
  "53300",
  "08000",
  "08003",
  "08006",
  "57P01",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
]);

export function leaseRenewalFailureCode(error: unknown): string {
  if (typeof error !== "object" || error === null || types.isProxy(error)) {
    return "unclassified";
  }
  const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
  return typeof code === "string" && RENEWAL_FAILURE_CODES.has(code)
    ? code
    : "unclassified";
}

export type LeaseRenewalOutcome =
  | "pending"
  | "renewed"
  | "fence_unavailable"
  | "fence_lost"
  | "error";

export interface LeaseRenewalAttempt {
  attempt: number;
  startedAtMs: number;
  pendingAtStart: number;
  deadlineReachedAtMs?: number;
  settledAtMs?: number;
  failureCode?: string;
  outcome: LeaseRenewalOutcome;
}

export interface LeaseRenewalMetrics {
  intervalMs: number;
  attemptDeadlineMs: number;
  maxPending: number;
  attemptCount: number;
  droppedAttempts: number;
  attempts: LeaseRenewalAttempt[];
}

const MAX_RECORDED_ATTEMPTS = 1_024;
const context = new AsyncLocalStorage<LeaseRenewalDiagnostics>();

export class LeaseRenewalDiagnostics {
  private readonly attempts: LeaseRenewalAttempt[] = [];
  private attemptCount = 0;

  constructor(
    readonly runId: string,
    private readonly settings: {
      intervalMs: number;
      attemptDeadlineMs: number;
      maxPending: number;
    },
  ) {}

  run<T>(work: () => T): T {
    return context.run(this, work);
  }

  start(pendingAtStart: number): {
    deadlineReached: () => void;
    settle: (
      outcome: Exclude<LeaseRenewalOutcome, "pending">,
      error?: unknown,
    ) => void;
  } {
    const attempt: LeaseRenewalAttempt = {
      attempt: ++this.attemptCount,
      startedAtMs: Date.now(),
      pendingAtStart,
      outcome: "pending",
    };
    if (this.attempts.length === MAX_RECORDED_ATTEMPTS) this.attempts.shift();
    this.attempts.push(attempt);
    return {
      deadlineReached: () => {
        if (attempt.outcome === "pending") {
          attempt.deadlineReachedAtMs = Date.now();
        }
      },
      settle: (outcome, error) => {
        if (attempt.outcome !== "pending") return;
        attempt.settledAtMs = Date.now();
        attempt.outcome = outcome;
        if (outcome === "error") {
          attempt.failureCode = leaseRenewalFailureCode(error);
        }
      },
    };
  }

  snapshot(): LeaseRenewalMetrics {
    return {
      ...this.settings,
      attemptCount: this.attemptCount,
      droppedAttempts: this.attemptCount - this.attempts.length,
      attempts: this.attempts.map((attempt) => ({ ...attempt })),
    };
  }
}

export function currentLeaseRenewalDiagnostics(
  runId: string,
): LeaseRenewalDiagnostics | undefined {
  const diagnostics = context.getStore();
  return diagnostics?.runId === runId ? diagnostics : undefined;
}
