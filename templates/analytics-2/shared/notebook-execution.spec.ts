import { describe, expect, expectTypeOf, it } from "vitest";

import {
  runAdmissionSchema,
  runCancellationSchema,
  runEventSchema,
  runInvalidationSchema,
  runReceiptSchema,
  runRequestSchema,
  type AttemptIdentity,
  type RunEvent,
  type RunCancellation,
  type RunInvalidation,
  type RunReceipt,
} from "./notebook-execution.js";

export const runReceiptFixture: RunReceipt = runReceiptSchema.parse({
  status: "admitted",
  runId: "run-sample",
  request: {
    requestId: "request-sample",
    snapshot: {
      ref: {
        workspaceId: "workspace-sample",
        projectId: "project-sample",
        head: { versionId: "draft-sample", revision: "9007199254740993" },
        eventSeq: "9007199254740995",
      },
      namespace: { kind: "draft", namespaceId: "namespace-sample" },
      inputRevision: "5",
      executionFingerprint: "saved-sample",
    },
    mode: "auto",
    targetCellId: "cell-orders",
    staleValues: "reject",
    cache: "reuse",
  },
  startedAt: "2026-11-19T09:00:00Z",
  plan: {
    admittedCellIds: ["cell-orders", "cell-summary"],
    dependencyResultIds: [],
    rejectedCells: [],
  },
  attempts: [
    {
      attempt: {
        namespaceId: "namespace-sample",
        cellId: "cell-orders",
        runId: "run-sample",
        attemptId: "attempt-sample",
        outputGeneration: "fence-run-sample",
      },
      state: { status: "queued" },
    },
  ],
  cursor: "9007199254740995",
});

export const runEventFixture: RunEvent = runEventSchema.parse({
  runId: runReceiptFixture.runId,
  sequence: "9007199254740996",
  event: { type: "attempt", receipt: runReceiptFixture.attempts[0] },
});

export const runInvalidationFixture: RunInvalidation =
  runInvalidationSchema.parse({
    snapshot: runReceiptFixture.request.snapshot.ref,
    namespace: runReceiptFixture.request.snapshot.namespace,
    inputRevision: runReceiptFixture.request.snapshot.inputRevision,
    cause: "clear",
    outputs: [{ cellId: "cell-orders", outputGeneration: "fence-clear" }],
  });

export const runCancellationFixtures = [
  { status: "cancelled", reason: "cancel_confirmed" },
  { status: "completed", reason: "completion_won" },
  { status: "unknown", reason: "provider_outcome_unknown" },
] satisfies RunCancellation[];

describe("notebook execution contract", () => {
  it("round-trips admission, invalidation and an ordered attempt event", () => {
    expect(
      runAdmissionSchema.parse(JSON.parse(JSON.stringify(runReceiptFixture))),
    ).toStrictEqual(runReceiptFixture);
    expect(
      runInvalidationSchema.parse(
        JSON.parse(JSON.stringify(runInvalidationFixture)),
      ),
    ).toStrictEqual(runInvalidationFixture);
    expect(
      runEventSchema.parse(JSON.parse(JSON.stringify(runEventFixture))),
    ).toStrictEqual(runEventFixture);
  });

  it.each(runCancellationFixtures)(
    "round-trips the $status cancellation outcome",
    (outcome) => {
      expect(
        runCancellationSchema.parse(JSON.parse(JSON.stringify(outcome))),
      ).toStrictEqual(outcome);
    },
  );

  it("rejects an invalid accepted revision or missing cell target", () => {
    const request = runReceiptFixture.request;
    expect(
      runRequestSchema.safeParse({ ...request, targetCellId: undefined })
        .success,
    ).toBe(false);
    expect(
      runRequestSchema.safeParse({
        ...request,
        snapshot: { ...request.snapshot, inputRevision: "1.4" },
      }).success,
    ).toBe(false);
  });

  it("rejects missing output fences and unknown rejection reasons", () => {
    expect(
      runInvalidationSchema.safeParse({
        ...runInvalidationFixture,
        outputs: [{ cellId: "cell-orders" }],
      }).success,
    ).toBe(false);
    expect(
      runAdmissionSchema.safeParse({
        status: "rejected",
        reason: "server_error",
      }).success,
    ).toBe(false);
    expectTypeOf<AttemptIdentity["runId"]>().not.toExtend<
      AttemptIdentity["attemptId"]
    >();
  });
});
