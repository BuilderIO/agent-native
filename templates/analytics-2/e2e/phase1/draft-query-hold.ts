import { expect } from "@playwright/test";
import { z } from "zod";

import type {
  DraftFixtureCell,
  DraftFixturePhase,
} from "../../shared/phase1-draft-fixture.js";
import type { FlowContext } from "./runtime.js";

const holdReceipt = z.object({ holdId: z.uuid() });
const holdStatus = z.discriminatedUnion("status", [
  z.object({ status: z.literal("armed") }),
  z.object({
    status: z.literal("held"),
    runId: z.string().min(1),
    attemptId: z.string().min(1),
    projectId: z.string().min(1),
    cellId: z.string().min(1),
  }),
]);

export async function withHeldDraftQuery<T>(
  flow: Pick<FlowContext, "workerFixture">,
  target: DraftFixtureCell,
  phase: DraftFixturePhase,
  run: (hold: {
    waitForAttempt(runId: string): Promise<string>;
    release(): Promise<void>;
  }) => Promise<T>,
) {
  const { holdId } = holdReceipt.parse(
    await flow.workerFixture("draft-hold-query", { ...target, phase }),
  );
  const scope = { ...target, holdId };
  let released = false;
  try {
    return await run({
      async waitForAttempt(runId) {
        let attemptId: string | undefined;
        await expect
          .poll(
            async () => {
              const state = holdStatus.parse(
                await flow.workerFixture("draft-hold-status", scope),
              );
              if (state.status === "armed") return false;
              expect(state).toMatchObject({ ...target, runId });
              attemptId = state.attemptId;
              return true;
            },
            { timeout: 60_000 },
          )
          .toBe(true);
        return z.string().min(1).parse(attemptId);
      },
      async release() {
        expect(await flow.workerFixture("draft-release-query", scope)).toEqual({
          released: true,
        });
        released = true;
      },
    });
  } finally {
    if (!released) await flow.workerFixture("draft-reset-query", scope);
  }
}
