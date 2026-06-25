import { defineAction } from "@agent-native/core";
import { calculateCost, recordUsage } from "@agent-native/core/usage";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertPlanEditor, nowIso } from "../server/plans.js";

/**
 * Attach token usage + a derived cost estimate to an existing recap, keyed by
 * plan id. The PR Visual Recap workflow calls this AFTER the coding agent
 * (Claude Code / Codex) exits — the recap is created mid-run, before the run's
 * own token total exists, so usage can't ride along with create-visual-recap.
 *
 * Internal by design: no `publicAgent`, so it is NOT advertised as an MCP tool
 * to connected agents. It is still mounted as a plain POST action route
 * (`/_agent-native/actions/record-recap-usage`) which the workflow reaches with
 * the connect-minted `PLAN_RECAP_TOKEN`; `assertPlanEditor` scopes the write to
 * the recap's owner.
 *
 * Idempotent: a re-push re-records the same plan id and overwrites the row
 * (and, via recordUsage's refId, the mirrored token_usage row) rather than
 * double-counting.
 */
export default defineAction({
  description:
    "Record the LLM token usage and derived cost for a recap, keyed by plan id. Internal mechanic used by the PR Visual Recap workflow after the agent run finishes; not an agent-facing tool.",
  agentTool: false,
  schema: z.object({
    planId: z.string().min(1),
    agent: z.enum(["claude", "codex"]).optional(),
    model: z.string().min(1),
    // Token counts must already be normalized to the cache-exclusive shape
    // calculateCost expects (the recap CLI strips Codex's cached_input_tokens
    // out of input and folds reasoning_output_tokens into output before POSTing).
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative().default(0),
    cacheWriteTokens: z.number().int().nonnegative().default(0),
    // Claude Code reports a real dollar cost (total_cost_usd); Codex does not.
    reportedCostUsd: z.number().nonnegative().optional(),
  }),
  run: async (args) => {
    await assertPlanEditor(args.planId);

    const db = getDb();
    const [row] = await db
      .select({
        ownerEmail: schema.plans.ownerEmail,
        kind: schema.plans.kind,
      })
      .from(schema.plans)
      .where(eq(schema.plans.id, args.planId))
      .limit(1);
    if (!row) throw new Error(`Plan ${args.planId} not found`);

    // Prefer the agent's reported dollar cost; otherwise estimate from tokens.
    const reported = args.reportedCostUsd != null;
    const costCentsX100 = reported
      ? Math.max(1, Math.round(args.reportedCostUsd! * 10_000)) // USD → centicents
      : calculateCost(
          args.inputTokens,
          args.outputTokens,
          args.model,
          args.cacheReadTokens,
          args.cacheWriteTokens,
        );
    const costSource = reported ? "reported" : "estimated";
    const recordedAt = nowIso();

    await db
      .update(schema.plans)
      .set({
        usageAgent: args.agent ?? null,
        usageModel: args.model,
        usageInputTokens: args.inputTokens,
        usageOutputTokens: args.outputTokens,
        usageCacheReadTokens: args.cacheReadTokens,
        usageCacheWriteTokens: args.cacheWriteTokens,
        usageCostCentsX100: costCentsX100,
        usageCostSource: costSource,
        usageRecordedAt: recordedAt,
        updatedAt: recordedAt,
      })
      .where(eq(schema.plans.id, args.planId));

    // Mirror into the shared token_usage table so recap spend shows up in the
    // existing Usage admin panel + cross-app aggregation. refId = plan id makes
    // it idempotent on re-push; costCentsX100 carries the exact figure stored on
    // the plan row (reported when available) so the two surfaces agree.
    await recordUsage({
      ownerEmail: row.ownerEmail,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheReadTokens: args.cacheReadTokens,
      cacheWriteTokens: args.cacheWriteTokens,
      model: args.model,
      label: "visual-recap",
      app: "plan",
      refId: args.planId,
      costCentsX100,
    });

    return { planId: args.planId, costCentsX100, costSource };
  },
});
