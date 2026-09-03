import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertIntegrationUrlsAllowed } from "../server/lib/integrations.js";
import { invalidatePublicFormCache } from "../server/lib/public-form-ssr.js";
import {
  assertValidFields,
  FIELD_TYPES,
  normalizeFieldIds,
} from "../server/lib/validate-fields.js";
import {
  assertValidFormCompletionSettings,
  FORM_SETTINGS_KEYS,
  type FormField,
  type FormSettings,
} from "../shared/types.js";
import { assertPublishableForm } from "./lib/assert-publishable-form.js";
import { withFormLock } from "./patch-form-fields.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export default defineAction({
  description:
    "Update an existing form, including settings.completionMode (message, redirect, message_then_refresh, or refresh) and settings.completionRefreshSeconds, or settings.emailOnNewResponses to email the form owner when new responses arrive.",
  schema: z.object({
    id: z.string().describe("Form ID (required)"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    slug: z.string().optional().describe("New URL slug"),
    // Accept fields as a JSON string (agent CLI / older callers) or as an
    // actual array (UI POSTs JSON bodies via useActionMutation, which
    // serializes the FormField[] directly — Zod must accept both).
    fields: z
      .union([z.string(), z.array(z.any())])
      .optional()
      .describe(
        `Array of complete field objects with id, type, label, and required (or JSON string of the same). Field types: ${FIELD_TYPES.join(", ")}. Never use shorthand strings such as 'text: Enter a name'. This REPLACES the whole fields array, so never rebuild it from view-screen's preview: it caps options and sets optionsTruncated when it did. Read the form with get-form first, or the options past the cap are deleted.`,
      ),
    settings: z
      .union([z.string(), z.record(z.string(), z.any())])
      .optional()
      .describe(
        `Form settings object (or JSON string of the same). Valid settings: ${FORM_SETTINGS_KEYS.join(", ")}. Set completionMode to message, redirect, message_then_refresh, or refresh. Use completionRefreshSeconds with message_then_refresh. Set emailOnNewResponses=true to email the form owner for each new response.`,
      ),
    status: z
      .enum(["draft", "published", "closed"])
      .optional()
      .describe("New status"),
  }),
  run: async (args) => {
    await assertAccess("form", args.id, "editor");

    return withFormLock(args.id, async () => {
      const db = getDb();
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

      const now = new Date().toISOString();
      const updates: Record<string, unknown> = { updatedAt: now };

      if (args.title !== undefined) {
        updates.title = args.title;
        if (args.slug === undefined) {
          const idSuffix = args.id.slice(0, 6);
          updates.slug = slugify(args.title || "untitled") + "-" + idSuffix;
        }
      }
      if (args.description !== undefined)
        updates.description = args.description;
      if (args.slug !== undefined) updates.slug = args.slug;
      if (args.fields !== undefined) {
        let parsedFields: unknown;
        if (typeof args.fields === "string") {
          try {
            parsedFields = JSON.parse(args.fields);
          } catch {
            fail("--fields must be valid JSON", {
              errorCode: "invalid_fields",
            });
          }
        } else {
          parsedFields = args.fields;
        }
        parsedFields = normalizeFieldIds(parsedFields);
        assertValidFields(parsedFields);
        updates.fields = JSON.stringify(parsedFields);
      }
      if (args.settings !== undefined) {
        let incomingSettings: FormSettings;
        if (typeof args.settings === "string") {
          try {
            incomingSettings = JSON.parse(args.settings) as FormSettings;
          } catch {
            fail("--settings must be valid JSON", {
              errorCode: "invalid_settings",
            });
          }
        } else {
          incomingSettings = args.settings as unknown as FormSettings;
        }
        let existingSettings: FormSettings = {};
        try {
          existingSettings = JSON.parse(existing.settings) as FormSettings;
        } catch {
          fail("Cannot update settings because saved settings are invalid", {
            errorCode: "invalid_existing_settings",
          });
        }
        assertValidFormCompletionSettings(incomingSettings);
        const parsedSettings = { ...existingSettings, ...incomingSettings };
        // Reject blocked integration URLs at save time (private IPs,
        // cloud-metadata, non-http(s) schemes). fireIntegrations also
        // re-checks at runtime as defense-in-depth.
        assertIntegrationUrlsAllowed(parsedSettings);
        updates.settings = JSON.stringify(parsedSettings);
      }
      if (args.status !== undefined) updates.status = args.status;

      // Pre-publish validation. Reject any update that would leave a published
      // form missing required configuration that makes it unsubmittable.
      if ((args.status ?? existing.status) === "published") {
        // Use the incoming fields if provided, otherwise the existing row.
        const effectiveFieldsRaw =
          updates.fields !== undefined ? updates.fields : existing.fields;
        let effectiveFields: FormField[] = [];
        try {
          effectiveFields =
            typeof effectiveFieldsRaw === "string"
              ? (JSON.parse(effectiveFieldsRaw) as FormField[])
              : ((effectiveFieldsRaw as unknown as FormField[]) ?? []);
        } catch {
          effectiveFields = [];
        }

        assertPublishableForm(effectiveFields);
      }

      const [written] = await db
        .update(schema.forms)
        .set(updates)
        .where(
          and(
            eq(schema.forms.id, args.id),
            eq(schema.forms.fields, existing.fields),
            eq(schema.forms.updatedAt, existing.updatedAt),
          ),
        )
        .returning({ id: schema.forms.id });

      if (!written) {
        fail(
          `Form ${args.id} changed while this update was in progress; read it again and retry`,
          { errorCode: "form_changed", statusCode: 409 },
        );
      }

      // Do not re-read after the write. On pooled Postgres a follow-up SELECT
      // can land on a lagging replica and return the pre-update field array,
      // which makes the agent report stale state and can overwrite a later edit
      // with that stale snapshot. The values written above are already validated.
      const row = { ...existing, ...updates } as typeof existing;

      invalidatePublicFormCache(existing, row);

      return {
        id: row!.id,
        title: row!.title,
        description: row!.description ?? undefined,
        slug: row!.slug,
        fields: JSON.parse(row!.fields) as FormField[],
        settings: JSON.parse(row!.settings) as FormSettings,
        status: row!.status,
        visibility: row!.visibility,
        ownerEmail: row!.ownerEmail,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  },
});
