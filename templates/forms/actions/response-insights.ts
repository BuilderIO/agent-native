import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import type { FormField } from "../shared/types.js";

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
    .max(1000)
    .optional()
    .default(500)
    .describe("Maximum recent responses to sample"),
  tableLimit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe("Maximum rows to include in the preview table"),
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
) {
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
    columns,
    rows,
    totalRows: responses.length,
    truncated: responses.length > tableLimit,
  };
}

function buildAllFormsTable(
  formsById: Map<string, FormRow>,
  fieldsByForm: Map<string, FormField[]>,
  responses: ResponseRow[],
  tableLimit: number,
) {
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
    columns,
    rows,
    totalRows: responses.length,
    truncated: responses.length > tableLimit,
  };
}

async function loadForms(args: ResponseInsightsArgs) {
  const formId = args.formId ?? args.form;
  const db = getDb();

  if (formId) {
    const access = await resolveAccess("form", formId);
    if (!access) throw new Error(`Form ${formId} not found`);
    const [form] = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, formId))
      .limit(1);
    return form ? [form] : [];
  }

  const rows = await db
    .select()
    .from(schema.forms)
    .where(accessFilter(schema.forms, schema.formShares))
    .orderBy(desc(schema.forms.updatedAt));

  return rows.filter((form) => !form.deletedAt);
}

export default defineAction({
  description:
    "Analyze form response data and return SQL-backed summary, chart, table, and embeddable response-insights UI data.",
  schema: responseInsightsSchema,
  http: { method: "GET" },
  readOnly: true,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Response insights",
      description:
        "Open a Forms response analytics view with charts and a response table.",
      iframeTitle: "Agent-Native Forms",
      openLabel: "Open response insights",
      embedByDefault: true,
      height: 620,
    }),
  },
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

    const responses =
      formIds.length > 0
        ? await db
            .select()
            .from(schema.responses)
            .where(
              formIds.length === 1
                ? eq(schema.responses.formId, formIds[0]!)
                : inArray(schema.responses.formId, formIds),
            )
            .orderBy(desc(schema.responses.submittedAt))
            .limit(args.limit)
        : [];

    const counts =
      formIds.length > 0
        ? await db
            .select({
              formId: schema.responses.formId,
              count: sql<number>`count(*)`,
            })
            .from(schema.responses)
            .where(
              formIds.length === 1
                ? eq(schema.responses.formId, formIds[0]!)
                : inArray(schema.responses.formId, formIds),
            )
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
      const submittedAt = new Date(response.submittedAt);
      if (submittedAt < start || submittedAt > end) continue;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const targetForm = formId ? forms[0] : undefined;
    const table = targetForm
      ? buildSpecificFormTable(targetForm, responses, args.tableLimit)
      : buildAllFormsTable(formsById, fieldsByForm, responses, args.tableLimit);

    return {
      scope: {
        formId: targetForm?.id,
        title: targetForm?.title ?? "All forms",
        days: args.days,
        sampledLimit: args.limit,
      },
      summary: {
        forms: forms.length,
        responses: totalResponses,
        sampledResponses: responses.length,
        truncated: totalResponses > responses.length,
        rangeStart: start.toISOString().slice(0, 10),
        rangeEnd: end.toISOString().slice(0, 10),
      },
      forms: forms.map((form) => ({
        id: form.id,
        title: form.title,
        slug: form.slug,
        status: form.status,
        responseCount: responseCountByForm.get(form.id) ?? 0,
        url: `/forms/${encodeURIComponent(form.id)}`,
      })),
      dailySubmissions: Array.from(buckets.entries()).map(
        ([date, submissions]) => ({
          date,
          submissions,
        }),
      ),
      table,
      embed: {
        src: insightsPath(targetForm?.id),
        title: targetForm
          ? `${targetForm.title} response insights`
          : "Forms response insights",
        height: 620,
      },
    };
  },
});
