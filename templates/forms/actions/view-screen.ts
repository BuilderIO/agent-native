import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { getDb, schema } from "../server/db/index.js";
import { eq, sql } from "drizzle-orm";

export default defineAction({
  description: "See what the user is currently looking at on screen.",
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
          .where(eq(schema.forms.id, nav.formId))
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
        const rows = await db.select().from(schema.forms);
        const counts = await db
          .select({
            formId: schema.responses.formId,
            count: sql<number>`count(*)`,
          })
          .from(schema.responses)
          .groupBy(schema.responses.formId);
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
        };
      } catch {
        // continue without forms list
      }
    }

    if (nav?.view === "responses" && nav?.formId) {
      try {
        const db = getDb();
        const responses = await db
          .select()
          .from(schema.responses)
          .where(eq(schema.responses.formId, nav.formId))
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
