import { defineAction, fail } from "@agent-native/core/action";
import { getAppProductionUrl } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertIntegrationUrlsAllowed } from "../server/lib/integrations.js";
import { invalidatePublicFormCache } from "../server/lib/public-form-ssr.js";
import {
  assertValidFields,
  normalizeFieldIds,
} from "../server/lib/validate-fields.js";
import { formFieldSchema } from "../shared/field-schema.js";
import {
  assertValidFormCompletionSettings,
  FORM_SETTINGS_KEYS,
  type FormField,
  type FormSettings,
} from "../shared/types.js";
import { assertNotUnconfirmedFieldLoss } from "./lib/assert-not-unconfirmed-field-loss.js";
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
    "Update an existing form, including settings.completionMode (message, redirect, message_then_refresh, or refresh) and settings.completionRefreshSeconds, or settings.emailOnNewResponses to email the form owner when new responses arrive. " +
    "Only for edits to THAT form. A request describing a different form — another purpose, audience, or set of questions — is a new form: call create-form. A form open in <current-screen> is context, not a target: never reuse its id for a new form request, however recently you created it.",
  access: {
    scope: "resource",
    resource: { type: "form", idFrom: "id", level: "editor" },
  },
  schema: z.object({
    id: z.string().describe("Form ID (required)"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    slug: z.string().optional().describe("New URL slug"),
    fields: z
      .array(formFieldSchema)
      .optional()
      .describe(
        "Array of complete field objects (a JSON string of the same array is also accepted). Each field property's meaning depends on its `type` — see the field schema's own per-property descriptions. Never use shorthand strings such as 'text: Enter a name'. This REPLACES the whole fields array, so never rebuild it from view-screen's preview: it caps options and sets optionsTruncated when it did. Read the form with get-form first, or the options past the cap are deleted. To add or remove individual questions, use patch-form-fields instead.",
      ),
    confirmReplaceFields: z
      .boolean()
      .optional()
      .describe(
        "Set only after the user explicitly asked to rewrite THIS form in place. Required when `fields` discards most of the form's existing questions; without it that call is rejected so a new-form request cannot overwrite an existing form.",
      ),
    settings: z
      .record(z.string(), z.any())
      .optional()
      .describe(
        `Form settings object (a JSON string of the same object is also accepted). Valid settings: ${FORM_SETTINGS_KEYS.join(", ")}. Set completionMode to message, redirect, message_then_refresh, or refresh. Use completionRefreshSeconds with message_then_refresh. Set emailOnNewResponses=true to email the form owner for each new response.`,
      ),
    status: z
      .enum(["draft", "published", "closed"])
      .optional()
      .describe("New status"),
  }),
  run: async (args, ctx) => {
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
      let fieldsForTracking: FormField[] | undefined;
      let settingsForTracking: FormSettings | undefined;
      let integrationSettingsChanged = false;

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
        const parsedFields = normalizeFieldIds(args.fields);
        assertValidFields(parsedFields);
        let existingFields: FormField[] = [];
        try {
          existingFields = JSON.parse(existing.fields) as FormField[];
        } catch {
          fail("Cannot replace fields because the saved fields are invalid", {
            errorCode: "invalid_existing_fields",
          });
        }
        assertNotUnconfirmedFieldLoss({
          existing: existingFields,
          incoming: parsedFields as FormField[],
          confirmed: args.confirmReplaceFields === true,
          existingTitle: existing.title,
          incomingTitle: args.title,
        });
        updates.fields = JSON.stringify(parsedFields);
        fieldsForTracking = parsedFields as FormField[];
      }
      if (args.settings !== undefined) {
        const incomingSettings = args.settings as unknown as FormSettings;
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
        assertIntegrationUrlsAllowed(parsedSettings);
        updates.settings = JSON.stringify(parsedSettings);
        settingsForTracking = parsedSettings;
        integrationSettingsChanged = Object.prototype.hasOwnProperty.call(
          incomingSettings,
          "integrations",
        );
      }
      if (args.status !== undefined) updates.status = args.status;

      if ((args.status ?? existing.status) === "published") {
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

      const row = { ...existing, ...updates } as typeof existing;

      invalidatePublicFormCache(existing, row);

      if (fieldsForTracking) {
        track(
          "form_edited",
          {
            app_name: "forms",
            template_name: "forms",
            output_id: row.id,
            output_type: "form",
            form_id: row.id,
            edit_type: "fields_replace",
            field_count: fieldsForTracking.length,
          },
          ctx,
        );
      }
      if (integrationSettingsChanged) {
        const destinations = Array.from(
          new Set(
            (settingsForTracking?.integrations ?? [])
              .map((integration) => integration.type)
              .filter(Boolean),
          ),
        );
        track(
          "integration_set",
          {
            app_name: "forms",
            template_name: "forms",
            output_id: row.id,
            output_type: "form",
            form_id: row.id,
            destination:
              destinations.length === 0
                ? "none"
                : destinations.length === 1
                  ? destinations[0]
                  : "multiple",
            integration_count: destinations.length,
          },
          ctx,
        );
      }
      if (args.status === "published" && existing.status !== "published") {
        track(
          "form_published",
          {
            app_name: "forms",
            template_name: "forms",
            output_id: row.id,
            output_type: "form",
            form_id: row.id,
            public_url: `${getAppProductionUrl()}/f/${encodeURIComponent(row.slug)}`,
          },
          ctx,
        );
      }

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
