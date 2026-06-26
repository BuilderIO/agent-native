import {
  ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
  dataWidgetResultSchema,
  defineAction,
} from "@agent-native/core";
import {
  createDataChartWidgetResult,
  createDataInsightsWidgetResult,
  createDataTableWidgetResult,
} from "@agent-native/core/data-widgets";
import { buildDeepLink } from "@agent-native/core/server";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  FormField,
  ResponseInsightsChartSeries,
  ResponseInsightsTable,
} from "../shared/types.js";

const MAX_FORMS_TO_ANALYZE = 100;
const DEFAULT_FORMS_TO_ANALYZE = 50;
const MAX_RESPONSE_SAMPLE = 500;
const DEFAULT_RESPONSE_SAMPLE = 300;
const MAX_TABLE_ROWS = 100;
const DEFAULT_TABLE_ROWS = 40;

const responseInsightsSchema = z.object({
  formId: z.string().optional().describe("Analyze a specific form by ID"),
  form: z.string().optional().describe("Legacy alias for formId"),
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .default(30)
    .describe("Number of days to include in the submissions chart"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_RESPONSE_SAMPLE)
    .optional()
    .default(DEFAULT_RESPONSE_SAMPLE)
    .describe("Maximum recent responses to sample"),
  displayMode: z
    .enum(["insights", "chart", "table"])
    .optional()
    .default("insights")
    .describe(
      "Output shape for chat/UI. Use chart when the user asks for a chart, graph, or trend only. Use table when they explicitly ask for a table, rows, or tabular preview. Use insights only when they ask for a dashboard, report, or combined chart plus table.",
    ),
  tableLimit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_TABLE_ROWS)
    .optional()
    .default(DEFAULT_TABLE_ROWS)
    .describe("Maximum rows to include in the preview table"),
  formLimit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_FORMS_TO_ANALYZE)
    .optional()
    .default(DEFAULT_FORMS_TO_ANALYZE)
    .describe(
      "Maximum recent accessible forms to include when formId is not set",
    ),
});

type ResponseInsightsArgs = z.infer<typeof responseInsightsSchema>;

type FormRow = typeof schema.forms.$inferSelect;
type ResponseRow = typeof schema.responses.$inferSelect;

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanText(value: unknown, maxLength = 180): string {
  if (value === undefined || value === null || value === "") return "";
  const text = Array.isArray(value)
    ? value
        .map((item) => cleanText(item, 80))
        .filter(Boolean)
        .join(", ")
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function dateKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildDateBuckets(days: number) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (days - 1));

  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    buckets.set(day.toISOString().slice(0, 10), 0);
  }

  return { start, end, buckets };
}

function insightsPath(formId?: string): string {
  return formId
    ? `/response-insights?formId=${encodeURIComponent(formId)}`
    : "/response-insights";
}

function insightsLink(formId?: string) {
  return buildDeepLink({
    app: "forms",
    view: "response-insights",
    to: insightsPath(formId),
    params: formId ? { formId } : undefined,
  });
}

function responseSummary(
  response: ResponseRow,
  fieldsByForm: Map<string, FormField[]>,
): string {
  const fields = fieldsByForm.get(response.formId) ?? [];
  const data = safeJson<Record<string, unknown>>(response.data, {});
  const parts = fields
    .map((field) => {
      const value = cleanText(data[field.id], 80);
      return value ? `${field.label}: ${value}` : null;
    })
    .filter(Boolean)
    .slice(0, 3);
  return parts.length ? parts.join(" | ") : cleanText(data, 180);
}

function buildSpecificFormTable(
  form: FormRow,
  responses: ResponseRow[],
  tableLimit: number,
  totalRows: number,
): ResponseInsightsTable {
  const fields = safeJson<FormField[]>(form.fields, []).slice(0, 7);
  const hasSubmitter = responses.some((row) => row.submitterEmail);
  const columns = [
    { key: "submittedAt", label: "Submitted" },
    ...(hasSubmitter ? [{ key: "submitterEmail", label: "Email" }] : []),
    ...fields.map((field) => ({ key: field.id, label: field.label })),
  ];
  const rows = responses.slice(0, tableLimit).map((response) => {
    const data = safeJson<Record<string, unknown>>(response.data, {});
    return {
      id: response.id,
      submittedAt: response.submittedAt,
      ...(hasSubmitter
        ? { submitterEmail: response.submitterEmail ?? "" }
        : {}),
      ...Object.fromEntries(
        fields.map((field) => [field.id, cleanText(data[field.id])]),
      ),
    };
  });

  return {
    title: `Recent responses for ${form.title}`,
    columns,
    rows,
    totalRows,
    sampledRows: responses.length,
    truncated: totalRows > rows.length,
  };
}

function buildAllFormsTable(
  formsById: Map<string, FormRow>,
  fieldsByForm: Map<string, FormField[]>,
  responses: ResponseRow[],
  tableLimit: number,
  totalRows: number,
): ResponseInsightsTable {
  const hasSubmitter = responses.some((row) => row.submitterEmail);
  const columns = [
    { key: "submittedAt", label: "Submitted" },
    { key: "form", label: "Form" },
    ...(hasSubmitter ? [{ key: "submitterEmail", label: "Email" }] : []),
    { key: "summary", label: "Response" },
  ];
  const rows = responses.slice(0, tableLimit).map((response) => ({
    id: response.id,
    formId: response.formId,
    submittedAt: response.submittedAt,
    form: formsById.get(response.formId)?.title ?? response.formId,
    ...(hasSubmitter ? { submitterEmail: response.submitterEmail ?? "" } : {}),
    summary: responseSummary(response, fieldsByForm),
  }));

  return {
    title: "Recent responses across forms",
    columns,
    rows,
    totalRows,
    sampledRows: responses.length,
    truncated: totalRows > rows.length,
  };
}

async function loadForms(args: ResponseInsightsArgs) {
  const formId = args.formId ?? args.form;
  const db = getDb();

  if (formId) {
    const { resource } = await assertAccess("form", formId, "editor");
    return [resource as FormRow];
  }

  const rows = await db
    .select({
      id: schema.forms.id,
      title: schema.forms.title,
      description: schema.forms.description,
      slug: schema.forms.slug,
      fields: schema.forms.fields,
      settings: schema.forms.settings,
      status: schema.forms.status,
      visibility: schema.forms.visibility,
      ownerEmail: schema.forms.ownerEmail,
      orgId: schema.forms.orgId,
      deletedAt: schema.forms.deletedAt,
      createdAt: schema.forms.createdAt,
      updatedAt: schema.forms.updatedAt,
    })
    .from(schema.forms)
    .where(
      and(
        accessFilter(schema.forms, schema.formShares, undefined, "editor"),
        isNull(schema.forms.deletedAt),
      ),
    )
    .orderBy(desc(schema.forms.updatedAt))
    .limit(args.formLimit);

  return rows;
}

export default defineAction({
  description:
    "Analyze form response data and return a native widget. Set displayMode=chart for chart-only requests, displayMode=table for table-only requests, and displayMode=insights only for combined dashboards/reports.",
  schema: responseInsightsSchema,
  outputSchema: dataWidgetResultSchema,
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
    title: "Response insights",
    description:
      "Render response analytics as a native chart, table, or insights output.",
  },
  http: { method: "GET" },
  readOnly: true,
  link: ({ args, result }) => {
    const resultFormId =
      result && typeof result === "object"
        ? (result as { scope?: { formId?: string } }).scope?.formId
        : undefined;
    const formId =
      resultFormId ??
      (args && typeof args === "object"
        ? ((args as ResponseInsightsArgs).formId ??
          (args as ResponseInsightsArgs).form)
        : undefined);

    return {
      url: insightsLink(formId),
      label: "Open response insights",
      view: "response-insights",
    };
  },
  run: async (args) => {
    const formId = args.formId ?? args.form;
    const db = getDb();
    const forms = await loadForms(args);
    const formIds = forms.map((form) => form.id);

    if (formId && forms.length === 0) {
      throw new Error(`Form ${formId} not found`);
    }

    const responseFilter =
      formIds.length === 0
        ? null
        : formIds.length === 1
          ? eq(schema.responses.formId, formIds[0]!)
          : inArray(schema.responses.formId, formIds);

    const responses = responseFilter
      ? await db
          .select({
            id: schema.responses.id,
            formId: schema.responses.formId,
            data: schema.responses.data,
            submittedAt: schema.responses.submittedAt,
            ip: schema.responses.ip,
            submitterEmail: schema.responses.submitterEmail,
            pageUrl: schema.responses.pageUrl,
            clientSurface: schema.responses.clientSurface,
          })
          .from(schema.responses)
          .where(responseFilter)
          .orderBy(desc(schema.responses.submittedAt))
          .limit(args.limit)
      : [];

    const counts = responseFilter
      ? await db
          .select({
            formId: schema.responses.formId,
            count: sql<number>`count(*)`,
          })
          .from(schema.responses)
          .where(responseFilter)
          .groupBy(schema.responses.formId)
      : [];

    const responseCountByForm = new Map(
      counts.map((row) => [row.formId, Number(row.count) || 0]),
    );
    const totalResponses = Array.from(responseCountByForm.values()).reduce(
      (sum, count) => sum + count,
      0,
    );
    const formsById = new Map(forms.map((form) => [form.id, form]));
    const fieldsByForm = new Map(
      forms.map((form) => [form.id, safeJson<FormField[]>(form.fields, [])]),
    );

    const { start, end, buckets } = buildDateBuckets(args.days);
    for (const response of responses) {
      const key = dateKey(response.submittedAt);
      if (!key || !buckets.has(key)) continue;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const targetForm = formId ? forms[0] : undefined;
    const table = targetForm
      ? buildSpecificFormTable(
          targetForm,
          responses,
          args.tableLimit,
          totalResponses,
        )
      : buildAllFormsTable(
          formsById,
          fieldsByForm,
          responses,
          args.tableLimit,
          totalResponses,
        );
    const dailySubmissions = Array.from(buckets.entries()).map(
      ([date, submissions]) => ({
        date,
        submissions,
      }),
    );
    const chartSeries: ResponseInsightsChartSeries = {
      type: "bar",
      title: "Submissions by day",
      xKey: "date",
      series: [{ key: "submissions", label: "Submissions" }],
      data: dailySubmissions,
      sampled: totalResponses > responses.length,
    };
    const title = targetForm?.title ?? "All forms";

    const baseResult = {
      scope: {
        ...(targetForm ? { formId: targetForm.id } : {}),
        title,
        days: args.days,
        sampledLimit: args.limit,
        formLimit: args.formLimit,
      },
      summary: {
        forms: forms.length,
        responses: totalResponses,
        sampledResponses: responses.length,
        truncated: totalResponses > responses.length,
        rangeStart: start.toISOString().slice(0, 10),
        rangeEnd: end.toISOString().slice(0, 10),
        scopeCapped: !targetForm && forms.length >= args.formLimit,
      },
      forms: forms.map((form) => ({
        id: form.id,
        title: form.title,
        slug: form.slug,
        status: form.status,
        responseCount: responseCountByForm.get(form.id) ?? 0,
        url: `/forms/${encodeURIComponent(form.id)}?tab=edit`,
      })),
      display: {
        title: targetForm
          ? `${targetForm.title} response insights`
          : "Forms response insights",
        route: insightsPath(targetForm?.id),
        primaryAction: {
          label: targetForm ? "Open responses" : "Open forms",
          href: targetForm
            ? `/forms/${encodeURIComponent(targetForm.id)}/responses`
            : "/forms",
        },
      },
    };

    if (args.displayMode === "chart") {
      return createDataChartWidgetResult({
        ...baseResult,
        widgetId: "forms.responseInsights.chart.v1",
        chartSeries,
      });
    }

    if (args.displayMode === "table") {
      return createDataTableWidgetResult({
        ...baseResult,
        widgetId: "forms.responseInsights.table.v1",
        table,
      });
    }

    const result = createDataInsightsWidgetResult({
      ...baseResult,
      widgetId: "forms.responseInsights.v1",
      chartSeries,
      table,
    });

    return result;
  },
});
