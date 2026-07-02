/**
 * Granular field-level update for a form.
 *
 * Accepts a list of per-field operations (upsert / remove / reorder) and
 * applies them server-side via read-modify-write against the CURRENT row, so
 * concurrent edits to DIFFERENT fields both survive instead of the later
 * client overwriting the earlier one with its stale full-array snapshot.
 *
 * The UI form builder uses this action for all incremental edits.
 * The legacy `update-form --fields <json>` path remains available for agents
 * and bulk imports that want to replace the whole fields array at once.
 */
import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { applyFieldOps } from "../server/lib/merge-fields.js";
import { assertValidFields } from "../server/lib/validate-fields.js";
import type { FormField } from "../shared/types.js";

const fieldOpSchema = z.union([
  z.object({
    op: z.literal("upsert"),
    field: z.record(z.string(), z.any()),
  }),
  z.object({
    op: z.literal("remove"),
    id: z.string(),
  }),
  z.object({
    op: z.literal("reorder"),
    ids: z.array(z.string()),
  }),
]);

export default defineAction({
  description:
    "Apply granular field operations (upsert/remove/reorder) to a form using a server-side read-modify-write merge. Concurrent edits to different fields both survive.",
  schema: z.object({
    id: z.string().describe("Form ID"),
    ops: z
      .union([z.string(), z.array(fieldOpSchema)])
      .describe(
        "Array of field ops, or JSON string of the same. Each op is {op:'upsert',field:{...}} | {op:'remove',id:string} | {op:'reorder',ids:string[]}",
      ),
  }),
  run: async (args) => {
    await assertAccess("form", args.id, "editor");

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, args.id))
      .limit(1);

    if (!existing) {
      throw new Error(`Form ${args.id} not found`);
    }

    let ops: Array<{ op: string; [k: string]: unknown }>;
    if (typeof args.ops === "string") {
      try {
        ops = JSON.parse(args.ops);
      } catch {
        throw new Error("--ops must be valid JSON");
      }
    } else {
      ops = args.ops as Array<{ op: string; [k: string]: unknown }>;
    }

    if (!Array.isArray(ops)) {
      throw new Error("ops must be an array");
    }

    // Parse current fields from the DB row.
    let currentFields: FormField[] = [];
    try {
      currentFields = JSON.parse(existing.fields) as FormField[];
    } catch {
      currentFields = [];
    }

    // Apply ops server-side so concurrent edits on different fields both land.
    const nextFields = applyFieldOps(
      currentFields,
      ops as Parameters<typeof applyFieldOps>[1],
    );

    // Validate the result before persisting.
    assertValidFields(nextFields);

    const now = new Date().toISOString();
    await db
      .update(schema.forms)
      .set({ fields: JSON.stringify(nextFields), updatedAt: now })
      .where(eq(schema.forms.id, args.id));

    return { id: args.id, fields: nextFields, updatedAt: now };
  },
});
