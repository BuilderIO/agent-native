import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems, triageRuns } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import {
  executorStateSchema,
  triageSourceSchema,
} from "../server/triage/contracts.js";
import { stableId } from "../server/triage/ids.js";
import {
  reconcilePullRequestRun,
  type PullRequestObservation,
} from "../server/triage/pr-monitor.js";

const reviewSchema = z.object({
  author: z.string(),
  state: z.enum([
    "approved",
    "changes_requested",
    "commented",
    "pending",
    "dismissed",
  ]),
  observedAt: z.string().datetime(),
});
const checkSchema = z.object({
  name: z.string(),
  state: z.enum(["queued", "in_progress", "passed", "failed", "cancelled"]),
  observedAt: z.string().datetime(),
});
const observationSchema: z.ZodType<PullRequestObservation> = z.object({
  repo: z.string(),
  pullRequestNumber: z.number().int().positive(),
  headSha: z.string(),
  reviews: z.array(reviewSchema),
  checks: z.array(checkSchema),
  observedAt: z.string().datetime(),
});

export default defineAction({
  description:
    "Reconcile an observe-only pull-request monitoring run from ai-services callback and provider observations. Missing callbacks or provider reads remain typed failure states; no executor or GitHub write occurs.",
  schema: z.object({
    itemId: z.string().min(1),
    runId: z.string().min(1),
    source: triageSourceSchema.default("github"),
    callback: z
      .object({
        state: executorStateSchema,
        observedAt: z.string().datetime(),
        terminalReason: z.string().optional(),
      })
      .optional(),
    providerObservation: observationSchema.optional(),
    heartbeatAt: z.string().datetime().optional(),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .default(15 * 60_000),
  }),
  http: { method: "POST" },
  agentTool: false,
  run: async (
    {
      itemId,
      runId,
      source,
      callback,
      providerObservation,
      heartbeatAt,
      timeoutMs,
    },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const now = new Date().toISOString();
    const databaseRunId = stableId("run", orgId, runId);
    const result = reconcilePullRequestRun({
      triageItemId: itemId,
      runId,
      callback,
      providerObservation,
      heartbeatAt,
      now,
      timeoutMs,
    });
    const db = getDb();
    const existingRun = (
      await db
        .select({ progressLogJson: triageRuns.progressLogJson })
        .from(triageRuns)
        .where(
          and(eq(triageRuns.id, databaseRunId), eq(triageRuns.orgId, orgId)),
        )
        .limit(1)
    )[0];
    const progressLog = appendProgressLog(existingRun?.progressLogJson, {
      at: now,
      state: result.state,
      reason: result.reason,
    });

    await db.transaction(async (tx) => {
      await tx
        .insert(triageRuns)
        .values({
          id: databaseRunId,
          itemId,
          source,
          status: result.state,
          progressLogJson: JSON.stringify(progressLog),
          dispatchAttempts: 0,
          needsContinuation: result.state === "reconciliation_required" ? 1 : 0,
          startedAt: callback?.observedAt ?? now,
          heartbeatAt: now,
          completedAt: result.terminalState ? now : null,
          error:
            result.state === "failed" ||
            result.state === "timed_out" ||
            result.state === "reconciliation_required"
              ? result.reason
              : null,
          ownerEmail: userEmail,
          orgId,
        })
        .onConflictDoUpdate({
          target: triageRuns.id,
          set: {
            status: result.state,
            progressLogJson: JSON.stringify(progressLog),
            needsContinuation:
              result.state === "reconciliation_required" ? 1 : 0,
            heartbeatAt: now,
            completedAt: result.terminalState ? now : null,
            error:
              result.state === "failed" ||
              result.state === "timed_out" ||
              result.state === "reconciliation_required"
                ? result.reason
                : null,
          },
        });

      if (result.triageItemPatch) {
        await tx
          .update(triageItems)
          .set(result.triageItemPatch)
          .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
      } else if (result.state === "reconciliation_required") {
        await tx
          .update(triageItems)
          .set({ status: "reconciliation_required", updatedAt: now })
          .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
      }
    });

    return result;
  },
});

function appendProgressLog(
  value: string | undefined,
  entry: { at: string; state: string; reason: string },
) {
  if (!value) return [entry];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Triage run progress log is unreadable.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Triage run progress log is unreadable.");
  }
  return [...parsed, entry].slice(-100);
}
