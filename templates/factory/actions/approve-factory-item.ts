import { defineAction } from "@agent-native/core/action";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  triageDecisions,
  triageItems,
  triageRuns,
} from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { startBuilderRun } from "../server/triage/builder-executor.js";
import { stableId } from "../server/triage/ids.js";

export default defineAction({
  description:
    "Explicitly approve one Factory item and start one deduplicated Builder coding run. The approver, decision, guard results, and callback state are recorded before provider work is considered successful.",
  schema: z.object({
    itemId: z.string().min(1),
    decisionId: z.string().min(1).optional(),
    confirm: z.literal(true),
  }),
  // Slack content and scheduled observations are untrusted. A provider run
  // must remain paused until a human approves this exact agent tool call.
  needsApproval: true,
  http: { method: "POST" },
  run: async ({ itemId, decisionId, confirm }, context) => {
    if (!confirm) throw new Error("Explicit confirmation is required.");
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();
    const item = (
      await db
        .select()
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!item) throw new Error("Factory item not found.");

    const decisions = await db
      .select()
      .from(triageDecisions)
      .where(
        and(
          eq(triageDecisions.orgId, orgId),
          eq(triageDecisions.itemId, itemId),
        ),
      )
      .orderBy(asc(triageDecisions.createdAt));
    const decision = decisionId
      ? decisions.find((entry) => entry.id === decisionId)
      : decisions[decisions.length - 1];
    if (!decision)
      throw new Error("Evaluate the Factory item before approving it.");

    const guardResults = parseGuardResults(decision.guardResultsJson);
    const blocked = guardResults.filter((result) => result.passed === false);
    if (blocked.length > 0) {
      throw new Error(
        `Factory approval blocked by hard guards: ${blocked.map((result) => result.reason).join(" ")}`,
      );
    }

    const dedupeKey = stableId("builder", orgId, itemId, decision.id);
    const runId = stableId("run", dedupeKey);
    const existing = (
      await db
        .select()
        .from(triageRuns)
        .where(and(eq(triageRuns.id, runId), eq(triageRuns.orgId, orgId)))
        .limit(1)
    )[0];
    if (
      existing &&
      ["submitted", "acknowledged", "running", "completed"].includes(
        existing.status,
      )
    ) {
      return { ok: true, deduplicated: true, run: existing };
    }

    const now = new Date().toISOString();
    await db
      .insert(triageRuns)
      .values({
        id: runId,
        itemId,
        source: item.source,
        provider: "builder-http",
        dedupeKey,
        approvalEmail: userEmail,
        status: "submitted",
        progressLogJson: JSON.stringify([
          {
            at: now,
            state: "submitted",
            reason: "Explicit Factory approval recorded.",
          },
        ]),
        dispatchAttempts: (existing?.dispatchAttempts ?? 0) + 1,
        needsContinuation: 0,
        startedAt: now,
        heartbeatAt: now,
        completedAt: null,
        error: null,
        ownerEmail: item.ownerEmail,
        orgId,
      })
      .onConflictDoNothing();

    const run = (
      await db
        .select()
        .from(triageRuns)
        .where(and(eq(triageRuns.id, runId), eq(triageRuns.orgId, orgId)))
        .limit(1)
    )[0];
    if (!run) throw new Error("Factory run could not be recorded.");
    if (run.status !== "submitted")
      return { ok: true, deduplicated: true, run };

    try {
      const result = await startBuilderRun({
        runId,
        itemId,
        ownerEmail: userEmail,
        orgId,
        repository: item.repository,
        summary: item.summary,
        sourceUrl: item.sourceUrl,
      });
      const progress = [
        {
          at: now,
          state: "submitted",
          reason: "Explicit Factory approval recorded.",
        },
        {
          at: new Date().toISOString(),
          state: "acknowledged",
          reason:
            "Builder accepted the fire-and-forget request; waiting for signed callback.",
        },
      ];
      await db
        .update(triageRuns)
        .set({
          status: "acknowledged",
          providerTaskId: result.providerTaskId ?? null,
          progressLogJson: JSON.stringify(progress),
          heartbeatAt: new Date().toISOString(),
        })
        .where(and(eq(triageRuns.id, runId), eq(triageRuns.orgId, orgId)));
      await db
        .update(triageItems)
        .set({ status: "classified", updatedAt: new Date().toISOString() })
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
      return {
        ok: true,
        deduplicated: false,
        runId,
        branchName: result.branchName,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(triageRuns)
        .set({
          status: "failed",
          error: message,
          completedAt: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        })
        .where(and(eq(triageRuns.id, runId), eq(triageRuns.orgId, orgId)));
      throw new Error(
        `Factory approval was recorded, but Builder dispatch failed: ${message}`,
      );
    }
  },
});

function parseGuardResults(
  value: string,
): Array<{ passed: boolean; reason: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Factory decision guard results are unreadable.");
  }
  if (!Array.isArray(parsed))
    throw new Error("Factory decision guard results are unreadable.");
  return parsed.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as { passed?: unknown }).passed !== "boolean"
    ) {
      throw new Error("Factory decision guard results are unreadable.");
    }
    return {
      passed: (entry as { passed: boolean }).passed,
      reason: String(
        (entry as { reason?: unknown }).reason ??
          "Guard did not provide a reason.",
      ),
    };
  });
}
