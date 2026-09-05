/**
 * Granular field-level update for a form.
 *
 * Accepts a list of per-field operations (upsert / remove / reorder) and
 * applies them server-side via read-modify-write against the CURRENT row, so
 * concurrent edits to DIFFERENT fields both survive instead of the later
 * client overwriting the earlier one with its stale full-array snapshot.
 *
 * The read-modify-write runs under a per-form in-process lock (same pattern
 * as `patch-deck` in the slides template) so two concurrent callers (e.g. the
 * form-builder autosave and an agent edit) are serialized instead of racing
 * on the same row — without the lock, the second writer's read would miss
 * the first writer's not-yet-committed update and silently clobber it.
 * The database compare-and-swap below also covers requests on different
 * instances, retrying granular operations against the latest row after a
 * conflict.
 *
 * The UI form builder uses this action for all incremental edits.
 * The legacy `update-form --fields <json>` path remains available for agents
 * and bulk imports that want to replace the whole fields array at once.
 */
import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { applyFieldOps } from "../server/lib/merge-fields.js";
import { invalidatePublicFormCache } from "../server/lib/public-form-ssr.js";
import {
  assertValidFields,
  FIELD_TYPES,
  normalizePersistedFields,
} from "../server/lib/validate-fields.js";
import type { FormField } from "../shared/types.js";
import { assertPublishableForm } from "./lib/assert-publishable-form.js";

// ---------------------------------------------------------------------------
// Per-form write lock — mirrors `withDeckLock` in
// templates/slides/actions/patch-deck.ts so concurrent client and agent
// writes to the same form's fields are serialised in-process.
// ---------------------------------------------------------------------------
const LOCK_KEY = "__formsFieldPatchLocks" as const;
type GlobalWithLocks = typeof globalThis & {
  [LOCK_KEY]?: Map<string, Promise<unknown>>;
};
const globalRef = globalThis as GlobalWithLocks;
if (!globalRef[LOCK_KEY]) {
  globalRef[LOCK_KEY] = new Map<string, Promise<unknown>>();
}
const formLocks: Map<string, Promise<unknown>> = globalRef[LOCK_KEY]!;

export function withFormLock<T>(
  formId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = formLocks.get(formId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  formLocks.set(formId, next);
  next
    .finally(() => {
      if (formLocks.get(formId) === next) formLocks.delete(formId);
    })
    .catch(() => {});
  return next;
}

const fieldOpSchema = z.union([
  z.object({
    op: z.literal("upsert"),
    field: z
      .record(z.string(), z.any())
      .describe(
        `Complete field object with id, type, label, and required. Field types: ${FIELD_TYPES.join(", ")}. Never use shorthand strings. This REPLACES the whole field, so never rebuild one from view-screen's preview: it caps options and sets optionsTruncated when it did. Read the field with get-form first, or the options past the cap are deleted.`,
      ),
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
    "Apply granular field operations (upsert/remove/reorder) to a form using a server-side read-modify-write merge. Concurrent edits to different fields both survive. Before adding or restyling a field, read the form with `get-form` and follow its theme and the other fields' label, required, and help-text conventions so the new field matches its siblings.",
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

    return withFormLock(args.id, async () => {
      const db = getDb();
      let ops: Array<{ op: string; [k: string]: unknown }>;
      if (typeof args.ops === "string") {
        try {
          ops = JSON.parse(args.ops);
        } catch {
          fail("--ops must be valid JSON", { errorCode: "invalid_ops" });
        }
      } else {
        ops = args.ops as Array<{ op: string; [k: string]: unknown }>;
      }

      if (!Array.isArray(ops)) {
        fail("ops must be an array", { errorCode: "invalid_ops" });
      }

      // ponytail: three CAS attempts; move to a shared retry policy if hot-form
      // contention needs tuning.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const [existing] = await db
          .select()
          .from(schema.forms)
          .where(eq(schema.forms.id, args.id))
          .limit(1);

        if (!existing) {
          fail(`Form ${args.id} not found`, {
            errorCode: "form_not_found",
            statusCode: 404,
          });
        }

        // Parse current fields from the DB row.
        let currentFields: FormField[];
        try {
          currentFields = normalizePersistedFields(
            JSON.parse(existing.fields),
          ) as FormField[];
        } catch {
          fail("Cannot update fields because saved fields are invalid", {
            errorCode: "invalid_existing_fields",
          });
        }

        // Apply ops server-side so concurrent edits on different fields both land.
        const nextFields = applyFieldOps(
          currentFields,
          ops as Parameters<typeof applyFieldOps>[1],
        );

        // Validate the result before persisting.
        assertValidFields(nextFields);
        if (existing.status === "published") {
          assertPublishableForm(nextFields);
        }

        const now = new Date().toISOString();
        const [written] = await db
          .update(schema.forms)
          .set({ fields: JSON.stringify(nextFields), updatedAt: now })
          .where(
            and(
              eq(schema.forms.id, args.id),
              eq(schema.forms.fields, existing.fields),
              eq(schema.forms.updatedAt, existing.updatedAt),
            ),
          )
          .returning({ id: schema.forms.id });

        if (written) {
          invalidatePublicFormCache(existing);
          return { id: args.id, fields: nextFields, updatedAt: now };
        }
      }

      fail(
        `Form ${args.id} changed while this update was in progress; read it again and retry`,
        { errorCode: "form_changed", statusCode: 409 },
      );
    });
  },
});
