import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { applyFieldOps } from "../server/lib/merge-fields.js";
import { invalidatePublicFormCache } from "../server/lib/public-form-ssr.js";
import {
  assertValidFields,
  normalizePersistedFields,
} from "../server/lib/validate-fields.js";
import { formFieldSchema } from "../shared/field-schema.js";
import type { FormField } from "../shared/types.js";
import { assertPublishableForm } from "./lib/assert-publishable-form.js";

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

const fieldOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert"),
    // `id` is optional on create-form (auto-generated from the label) but the
    // merge keys on it, so an id-less upsert would append a field that then
    // fails validation.
    field: formFieldSchema
      .extend({
        id: formFieldSchema.shape.id
          .unwrap()
          .describe(
            "Stable field id: an existing id replaces that field, a new id appends one.",
          ),
      })
      .describe(
        "Complete field object, with `id` set to the field being replaced (see the field schema's own per-property descriptions for what each property means per type). Never use shorthand strings. This REPLACES the whole field, so never rebuild one from view-screen's preview: it caps options and sets optionsTruncated when it did. Read the field with get-form first, or the options past the cap are deleted.",
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
      .array(fieldOpSchema)
      .describe(
        "Array of field ops (a JSON string of the same array is also accepted). Each op is {op:'upsert',field:{...}} | {op:'remove',id:string} | {op:'reorder',ids:string[]}",
      ),
  }),
  run: async (args, ctx) => {
    await assertAccess("form", args.id, "editor");

    return withFormLock(args.id, async () => {
      const db = getDb();
      const ops = args.ops as Array<{ op: string; [k: string]: unknown }>;

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

        const nextFields = applyFieldOps(
          currentFields,
          ops as Parameters<typeof applyFieldOps>[1],
        );

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
          const editTypes = Array.from(new Set(ops.map((op) => String(op.op))));
          track(
            "form_edited",
            {
              app_name: "forms",
              template_name: "forms",
              output_id: args.id,
              output_type: "form",
              form_id: args.id,
              edit_type: editTypes.length === 1 ? editTypes[0] : "mixed",
              field_count: nextFields.length,
            },
            ctx,
          );
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
