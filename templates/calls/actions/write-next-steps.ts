/**
 * Persist just the `nextStepsJson` + `actionItemsJson` on a call summary.
 *
 * Usage (agent-only):
 *   pnpm action write-next-steps --callId=<id> --nextSteps='[...]' --actionItems='[...]'
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

const NextStepSchema = z.object({
  text: z.string().min(1),
  owner: z.string().optional(),
  dueAt: z.string().optional(),
  quoteMs: z.coerce.number().int().min(0).optional(),
});

const ActionItemSchema = z.object({
  text: z.string().min(1),
  owner: z.string().optional(),
  ms: z.coerce.number().int().min(0).optional(),
});

function parseInput<T>(
  raw: string | T[] | undefined,
  schema: z.ZodType<T>,
  fieldName: string,
): T[] | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid --${fieldName} JSON: ${(e as Error).message}`);
    }
    return z.array(schema).parse(parsed);
  }
  return z.array(schema).parse(raw);
}

export default defineAction({
  description:
    "Write just nextSteps and/or actionItems on a call summary. Called by the agent after regenerate-next-steps.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    nextSteps: z
      .union([z.string(), z.array(NextStepSchema)])
      .optional()
      .describe(
        "Array of {text, owner?, dueAt?, quoteMs?} — JSON-encoded string (CLI) or array (agent).",
      ),
    actionItems: z
      .union([z.string(), z.array(ActionItemSchema)])
      .optional()
      .describe(
        "Array of {text, owner?, ms?} — JSON-encoded string (CLI) or array (agent).",
      ),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const nextSteps = parseInput(
      args.nextSteps as any,
      NextStepSchema,
      "nextSteps",
    );
    const actionItems = parseInput(
      args.actionItems as any,
      ActionItemSchema,
      "actionItems",
    );

    if (!nextSteps && !actionItems) {
      throw new Error("Provide at least --nextSteps or --actionItems");
    }

    const db = getDb();
    const nowIso = new Date().toISOString();

    const patch: Record<string, unknown> = { updatedAt: nowIso };
    if (nextSteps) patch.nextStepsJson = JSON.stringify(nextSteps);
    if (actionItems) patch.actionItemsJson = JSON.stringify(actionItems);

    const [existing] = await db
      .select({ callId: schema.callSummaries.callId })
      .from(schema.callSummaries)
      .where(eq(schema.callSummaries.callId, args.callId))
      .limit(1);

    if (existing) {
      await db
        .update(schema.callSummaries)
        .set(patch)
        .where(eq(schema.callSummaries.callId, args.callId));
    } else {
      await db.insert(schema.callSummaries).values({
        callId: args.callId,
        nextStepsJson: nextSteps ? JSON.stringify(nextSteps) : "[]",
        actionItemsJson: actionItems ? JSON.stringify(actionItems) : "[]",
        generatedBy: "agent",
        generatedAt: nowIso,
        updatedAt: nowIso,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Wrote next-steps/action-items for ${args.callId} (${nextSteps?.length ?? "-"} next, ${actionItems?.length ?? "-"} actions)`,
    );
    return {
      callId: args.callId,
      nextSteps: nextSteps?.length ?? null,
      actionItems: actionItems?.length ?? null,
    };
  },
});
