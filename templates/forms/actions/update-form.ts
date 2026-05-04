import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { assertIntegrationUrlsAllowed } from "../server/lib/integrations.js";
import type { FormField, FormSettings } from "../shared/types.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export default defineAction({
  description: "Update an existing form.",
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
      .describe("Array of form fields (or JSON string of the same)"),
    settings: z
      .union([z.string(), z.record(z.string(), z.any())])
      .optional()
      .describe("Form settings object (or JSON string of the same)"),
    status: z
      .enum(["draft", "published", "closed"])
      .optional()
      .describe("New status"),
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

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.title !== undefined) {
      updates.title = args.title;
      if (args.slug === undefined) {
        const idSuffix = args.id.slice(0, 6);
        updates.slug = slugify(args.title || "untitled") + "-" + idSuffix;
      }
    }
    if (args.description !== undefined) updates.description = args.description;
    if (args.slug !== undefined) updates.slug = args.slug;
    if (args.fields !== undefined) {
      if (typeof args.fields === "string") {
        try {
          JSON.parse(args.fields);
          updates.fields = args.fields;
        } catch {
          throw new Error("--fields must be valid JSON");
        }
      } else {
        updates.fields = JSON.stringify(args.fields);
      }
    }
    if (args.settings !== undefined) {
      let parsedSettings: FormSettings;
      if (typeof args.settings === "string") {
        try {
          parsedSettings = JSON.parse(args.settings) as FormSettings;
          updates.settings = args.settings;
        } catch {
          throw new Error("--settings must be valid JSON");
        }
      } else {
        parsedSettings = args.settings as unknown as FormSettings;
        updates.settings = JSON.stringify(args.settings);
      }
      // Reject blocked integration URLs at save time (private IPs,
      // cloud-metadata, non-http(s) schemes). fireIntegrations also
      // re-checks at runtime as defense-in-depth.
      assertIntegrationUrlsAllowed(parsedSettings);
    }
    if (args.status !== undefined) updates.status = args.status;

    // Pre-publish validation. Reject the publish if the form is missing
    // required configuration that would make it unsubmittable. This also
    // catches the agent flipping status to "published" on an empty/broken
    // form. We only validate on transition INTO published — leaving an
    // already-published form alone (or unpublishing it) shouldn't error.
    if (args.status === "published") {
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

      const issues: string[] = [];
      if (effectiveFields.length === 0) {
        issues.push("form has no fields");
      }
      const optionTypes = new Set(["select", "multiselect", "radio"]);
      for (const [idx, field] of effectiveFields.entries()) {
        const label = String(field?.label ?? "").trim();
        if (!label) {
          issues.push(`field #${idx + 1} is missing a label`);
        }
        if (
          optionTypes.has(field?.type) &&
          (!Array.isArray(field?.options) || field.options.length === 0)
        ) {
          issues.push(`field "${label || `#${idx + 1}`}" has no options`);
        }
        // For required Number/Scale fields, conflicting min/max would
        // render the field unsubmittable — block publish on that too.
        if (
          field?.required &&
          (field?.type === "number" || field?.type === "scale") &&
          field?.validation?.min !== undefined &&
          field?.validation?.max !== undefined &&
          Number(field.validation.min) > Number(field.validation.max)
        ) {
          issues.push(
            `required field "${label || `#${idx + 1}`}" has min > max`,
          );
        }
      }

      if (issues.length > 0) {
        throw new Error(
          `Cannot publish: ${issues.join("; ")}. Fix these before publishing.`,
        );
      }
    }

    await db
      .update(schema.forms)
      .set(updates)
      .where(eq(schema.forms.id, args.id));

    const [row] = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, args.id))
      .limit(1);

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
  },
});
