import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "See what the user is currently looking at on screen.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = navigation as any;

    if (nav?.formId) {
      const db = getDb();
      try {
        const [form] = await db
          .select()
          .from(schema.forms)
          .where(
            and(
              eq(schema.forms.id, nav.formId),
              accessFilter(schema.forms, schema.formShares),
            ),
          )
          .limit(1);
        if (form) {
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
            fields: JSON.parse(form.fields),
            settings: JSON.parse(form.settings),
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
          .limit(100);
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
          capped: rows.length >= 100,
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

    if (nav?.view === "responses" && nav?.formId) {
      try {
        const db = getDb();
        const [form] = await db
          .select({ id: schema.forms.id })
          .from(schema.forms)
          .where(
            and(
              eq(schema.forms.id, nav.formId),
              accessFilter(schema.forms, schema.formShares),
            ),
          )
          .limit(1);
        if (!form) return screen;

        const responses = await db
          .select({
            id: schema.responses.id,
            data: schema.responses.data,
            submittedAt: schema.responses.submittedAt,
          })
          .from(schema.responses)
          .where(eq(schema.responses.formId, nav.formId))
          .orderBy(desc(schema.responses.submittedAt))
          .limit(20);

        const [total] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.responses)
          .where(eq(schema.responses.formId, nav.formId));

        screen.responses = {
          formId: nav.formId,
          total: total?.count ?? 0,
          showing: responses.length,
          data: responses.map((r) => ({
            id: r.id,
            submittedAt: r.submittedAt,
            data: JSON.parse(r.data),
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
