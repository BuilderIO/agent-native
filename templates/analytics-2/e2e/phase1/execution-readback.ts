import { createHash } from "node:crypto";

import { z } from "zod";

import {
  runEventSchema,
  runReceiptSchema,
} from "../../shared/notebook-execution.js";
import { completeResultManifestSchema } from "../../shared/notebook-result-contract.js";

const scalar = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({
    type: z.enum(["int64", "integer"]),
    value: z.string().regex(/^-?\d+$/),
  }),
  z.object({
    type: z.literal("decimal"),
    value: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  }),
]);
export const evidenceRowsSchema = z.array(z.array(scalar));

const runRead = z.object({
  status: z.literal("found"),
  run: runReceiptSchema,
  events: z.array(runEventSchema),
});

export function readRunAttempts(value: unknown, runId: string) {
  const { run, events } = runRead.parse(value);
  if (run.runId !== runId) throw new Error("Notebook run identity changed");
  const attempts = new Map(
    run.attempts.map((entry) => [entry.attempt.attemptId, entry]),
  );
  for (const { runId: eventRunId, event } of events) {
    if (eventRunId !== runId)
      throw new Error("Notebook run event identity changed");
    if (
      event.type === "attempt" &&
      attempts.has(event.receipt.attempt.attemptId)
    )
      attempts.set(event.receipt.attempt.attemptId, event.receipt);
  }
  return { ...run, attempts: [...attempts.values()] };
}

export function readAttempt(value: unknown, runId: string, cellId: string) {
  const { run, events } = runRead.parse(value);
  if (run.runId !== runId) throw new Error("Notebook run identity changed");
  const entry = run.attempts.find(({ attempt }) => attempt.cellId === cellId);
  if (!entry) throw new Error("Notebook run is missing the admitted cell");
  const latest = [...events]
    .reverse()
    .find(
      ({ event }) =>
        event.type === "attempt" &&
        event.receipt.attempt.attemptId === entry.attempt.attemptId,
    )?.event;
  return {
    ...(latest?.type === "attempt" ? latest.receipt : entry),
    run,
    events,
  };
}

export function readCompletedResultPage(
  value: unknown,
  page: number,
  rowCount: string,
  resultId: string,
) {
  return z
    .object({
      status: z.literal("ready"),
      page: z.literal(page),
      rows: evidenceRowsSchema,
      manifest: completeResultManifestSchema.refine(
        ({ rowCount: count, result }) =>
          count === rowCount && result.resultId === resultId,
        "Result identity or complete row count changed",
      ),
    })
    .parse(value);
}

export function dependencyFingerprint(resultIds: readonly string[]) {
  return createHash("sha256").update(JSON.stringify(resultIds)).digest("hex");
}
