import {
  ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
  dataInsightsWidgetResultSchema,
  defineAction,
} from "@agent-native/core";
import { createDataInsightsWidgetResult } from "@agent-native/core/data-widgets";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { FormField, FormSettings } from "../shared/types.js";

function fieldOptionsSummary(field: FormField): string {
  if ("options" in field && Array.isArray(field.options)) {
    return field.options.join(", ");
  }
  if (field.type === "rating") {
    return `1-${field.validation?.max ?? 5}`;
  }
  return "";
}

export default defineAction({
  description:
    "Preview a form inline in chat. Use this when the user @-tags a form or asks about a form's fields, setup, configuration, publish state, or response count.",
  schema: z.object({
    formId: z.string().optional().describe("Form ID"),
    form: z.string().optional().describe("Form ID (legacy alias for formId)"),
  }),
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
    title: "Form preview",
    description: "Render a form setup summary and field table in chat.",
  },
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const formId = args.formId ?? args.form;
    if (!formId) throw new Error("formId is required");

    const access = await resolveAccess("form", formId);
    if (!access) throw new Error(`Form ${formId} not found`);

    const form = access.resource as typeof schema.forms.$inferSelect;
    const fields = JSON.parse(form.fields) as FormField[];
    const settings = JSON.parse(form.settings) as FormSettings;

    const db = getDb();
    const [count] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.responses)
      .where(eq(schema.responses.formId, formId));

    const responseCount = Number(count?.count) || 0;
    const publicPath = form.slug ? `/f/${form.slug}` : `/f/${form.id}`;

    return createDataInsightsWidgetResult({
      widgetId: "forms.formPreview.v1",
      title: form.title,
      summary: {
        status: form.status,
        visibility: form.visibility,
        fields: fields.length,
        responses: responseCount,
      },
      table: {
        title: `${form.title} fields`,
        columns: [
          { key: "position", label: "#", align: "right" },
          { key: "label", label: "Field" },
          { key: "type", label: "Type" },
          { key: "required", label: "Required" },
          { key: "options", label: "Options" },
        ],
        rows: fields.map((field, index) => ({
          id: field.id,
          position: index + 1,
          label: field.label,
          type: field.type,
          required: field.required ? "Yes" : "No",
          options: fieldOptionsSummary(field),
        })),
        totalRows: fields.length,
      },
      display: {
        title: form.title,
        description:
          form.description ||
          `${form.status} form with ${responseCount.toLocaleString()} response${
            responseCount === 1 ? "" : "s"
          }`,
        primaryAction: {
          label: "Open editor",
          href: `/forms/${encodeURIComponent(form.id)}?tab=edit`,
        },
      },
      form: {
        id: form.id,
        title: form.title,
        description: form.description ?? undefined,
        status: form.status,
        visibility: form.visibility,
        responseCount,
        fields,
        settings,
        publicPath,
        role: access.role,
        createdAt: form.createdAt,
        updatedAt: form.updatedAt,
      },
    });
  },
});
