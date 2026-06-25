import { defineAction } from "@agent-native/core";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  toPublicFormSettings,
  type FormField,
  type FormSettings,
} from "../shared/types.js";
import { readAppStateForCurrentTab } from "./_tab-state.js";

const FORMS_LIST_LIMIT = 25;
const RESPONSE_PREVIEW_LIMIT = 5;
const FIELD_PREVIEW_LIMIT = 20;

function canReadPrivateFormData(role: string): boolean {
  return role === "owner" || role === "editor" || role === "admin";
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanText(value: unknown, maxLength = 160): string {
  if (value === undefined || value === null || value === "") return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
}

function summarizeFields(fields: FormField[]) {
  return fields.slice(0, FIELD_PREVIEW_LIMIT).map((field) => ({
    id: field.id,
    type: field.type,
    label: field.label,
    required: field.required,
    ...(field.options?.length
      ? {
          options: field.options.slice(0, 8),
          optionCount: field.options.length,
        }
      : {}),
  }));
}

function summarizeSettings(settings: FormSettings) {
  return {
    ...toPublicFormSettings(settings),
    integrationCount: settings.integrations?.length ?? 0,
    integrations: settings.integrations?.map((integration) => ({
      id: integration.id,
      type: integration.type,
      name: integration.name,
      enabled: integration.enabled,
    })),
    allowedOriginsCount: settings.allowedOrigins?.length ?? 0,
  };
}

function summarizeResponseData(
  data: Record<string, unknown>,
  fields: FormField[],
) {
  const fieldLabels = new Map(fields.map((field) => [field.id, field.label]));
  return Object.entries(data)
    .slice(0, 8)
    .map(([key, value]) => ({
      fieldId: key,
      label: fieldLabels.get(key) ?? key,
      value: cleanText(value),
    }));
}

export default defineAction({
  description: "See what the user is currently looking at on screen.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = await readAppStateForCurrentTab("navigation", {
      fallbackToGlobal: false,
    });

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = navigation as any;
    const activeTab = nav?.activeTab ?? nav?.tab;

    if (nav?.formId) {
      try {
        const access = await resolveAccess("form", nav.formId);
        if (access) {
          const db = getDb();
          const form = access.resource as typeof schema.forms.$inferSelect;
          const fields = safeJson<FormField[]>(form.fields, []);
          const settings = safeJson<FormSettings>(form.settings, {});
          const canReadPrivateData = canReadPrivateFormData(access.role);
          const [responseCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(schema.responses)
            .where(eq(schema.responses.formId, nav.formId));

          screen.form = {
            id: form.id,
            title: form.title,
            description: form.description,
            slug: form.slug,
            status: form.status,
            fieldCount: fields.length,
            fields: summarizeFields(fields),
            fieldsCapped: fields.length > FIELD_PREVIEW_LIMIT,
            role: access.role,
            settings: canReadPrivateData
              ? summarizeSettings(settings)
              : toPublicFormSettings(settings),
            responseCount: responseCount?.count ?? 0,
            createdAt: form.createdAt,
            updatedAt: form.updatedAt,
          };
        }
      } catch {
        // continue without form detail
      }
    }

    if (nav?.view === "forms" || nav?.view === "forms-list" || !nav?.formId) {
      try {
        const db = getDb();
        const rows = await db
          .select({
            id: schema.forms.id,
            title: schema.forms.title,
            status: schema.forms.status,
            slug: schema.forms.slug,
            createdAt: schema.forms.createdAt,
            updatedAt: schema.forms.updatedAt,
          })
          .from(schema.forms)
          .where(
            and(
              accessFilter(schema.forms, schema.formShares),
              isNull(schema.forms.deletedAt),
            ),
          )
          .orderBy(desc(schema.forms.updatedAt))
          .limit(FORMS_LIST_LIMIT);
        const formIds = rows.map((form) => form.id);
        const counts =
          formIds.length > 0
            ? await db
                .select({
                  formId: schema.responses.formId,
                  count: sql<number>`count(*)`,
                })
                .from(schema.responses)
                .where(inArray(schema.responses.formId, formIds))
                .groupBy(schema.responses.formId)
            : [];
        const countMap = new Map(counts.map((c) => [c.formId, c.count]));

        screen.formsList = {
          count: rows.length,
          forms: rows.map((form) => ({
            id: form.id,
            title: form.title,
            status: form.status,
            slug: form.slug,
            responseCount: countMap.get(form.id) || 0,
            createdAt: form.createdAt,
            updatedAt: form.updatedAt,
          })),
          capped: rows.length >= FORMS_LIST_LIMIT,
        };
      } catch {
        // continue without forms list
      }
    }

    if (nav?.view === "response-insights") {
      screen.responseInsights = {
        formId: nav.formId,
        action:
          nav.formId !== undefined
            ? `response-insights --formId ${nav.formId}`
            : "response-insights",
      };
    }

    if (
      (nav?.view === "responses" ||
        (nav?.view === "form" &&
          (activeTab === "responses" || activeTab === "results"))) &&
      nav?.formId
    ) {
      try {
        const db = getDb();
        const access = await resolveAccess("form", nav.formId);
        if (!access || !canReadPrivateFormData(access.role)) return screen;
        const form = access.resource as typeof schema.forms.$inferSelect;
        const fields = safeJson<FormField[]>(form.fields, []);

        const responses = await db
          .select({
            id: schema.responses.id,
            data: schema.responses.data,
            submittedAt: schema.responses.submittedAt,
          })
          .from(schema.responses)
          .where(eq(schema.responses.formId, nav.formId))
          .orderBy(desc(schema.responses.submittedAt))
          .limit(RESPONSE_PREVIEW_LIMIT);

        const [total] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.responses)
          .where(eq(schema.responses.formId, nav.formId));

        screen.responses = {
          formId: nav.formId,
          total: total?.count ?? 0,
          showing: responses.length,
          capped: (total?.count ?? 0) > responses.length,
          data: responses.map((r) => ({
            id: r.id,
            submittedAt: r.submittedAt,
            values: summarizeResponseData(
              safeJson<Record<string, unknown>>(r.data, {}),
              fields,
            ),
          })),
        };
      } catch {
        // continue without responses
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }

    return screen;
  },
});
