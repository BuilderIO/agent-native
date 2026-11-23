import { randomUUID } from "node:crypto";
import { once } from "node:events";

import { z } from "zod";

import type {
  DraftFixtureAttempt,
  DraftFixtureBridge,
  DraftFixtureCell,
  DraftFixturePhase,
} from "../../../shared/phase1-draft-fixture.js";
import { FixtureControlError } from "./control-server.js";

const cell = z.strictObject({
  projectId: z.string().min(1).max(200),
  cellId: z.string().min(1).max(200),
});
const held = cell.extend({ holdId: z.uuid() });

export const draftWorkerInput = z.discriminatedUnion("operation", [
  cell.extend({
    operation: z.literal("draft-hold-query"),
    phase: z.enum([
      "before-dispatch",
      "before-promotion",
      "before-candidate-promotion",
    ]),
  }),
  held.extend({ operation: z.literal("draft-hold-status") }),
  held.extend({ operation: z.literal("draft-release-query") }),
  held.extend({ operation: z.literal("draft-reset-query") }),
  cell.extend({ operation: z.literal("draft-incomplete-result") }),
  cell.extend({ operation: z.literal("draft-reset-result") }),
]);

const cellKey = ({ projectId, cellId }: DraftFixtureCell) =>
  JSON.stringify([projectId, cellId]);

export function createDraftWorkerControl() {
  type Hold = {
    id: string;
    phase: DraftFixturePhase;
    release: AbortController;
    attempt?: DraftFixtureAttempt;
  };
  const holds = new Map<string, Hold>();
  const incomplete = new Set<string>();
  const bridge: DraftFixtureBridge = {
    hold(attempt, phase, signal) {
      const hold = holds.get(cellKey(attempt));
      if (!hold || hold.phase !== phase || hold.attempt) return;
      hold.attempt = attempt;
      return waitForRelease(hold.release.signal, signal);
    },
    takeIncomplete(cell) {
      return incomplete.delete(cellKey(cell));
    },
  };
  function control(input: z.infer<typeof draftWorkerInput>) {
    const key = cellKey(input);
    switch (input.operation) {
      case "draft-hold-query": {
        if (holds.has(key))
          throw new FixtureControlError(
            "This draft cell already has a hold",
            409,
          );
        const holdId = randomUUID();
        holds.set(key, {
          id: holdId,
          phase: input.phase,
          release: new AbortController(),
        });
        return { holdId };
      }
      case "draft-hold-status":
      case "draft-release-query":
      case "draft-reset-query": {
        const hold = holds.get(key);
        if (!hold || hold.id !== input.holdId)
          throw new FixtureControlError(
            "Unknown hold for this draft cell",
            404,
          );
        if (input.operation === "draft-hold-status")
          return hold.attempt
            ? { status: "held", ...hold.attempt }
            : { status: "armed" };
        if (input.operation === "draft-release-query" && !hold.attempt)
          throw new FixtureControlError(
            "The worker has not reached its hold",
            409,
          );
        hold.release.abort();
        holds.delete(key);
        return { released: true };
      }
      case "draft-incomplete-result":
        incomplete.add(key);
        return { armed: true };
      case "draft-reset-result":
        incomplete.delete(key);
        return { reset: true };
    }
  }
  return { bridge, control };
}

async function waitForRelease(release: AbortSignal, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(75_000);
  const cancelled = signal ? AbortSignal.any([signal, timeout]) : timeout;
  await once(release, "abort", { signal: cancelled });
}
