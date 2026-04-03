/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches the matching form data via API.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { readAppState } from "@agent-native/core/application-state";
import { getDb, schema } from "../server/db/index.js";
import { eq, sql } from "drizzle-orm";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

async function fetchFormDetail(formId: string) {
  try {
    const db = getDb();
    const form = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, formId))
      .get();
    if (!form) return null;

    const responseCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.responses)
      .where(eq(schema.responses.formId, formId))
      .get();

    return {
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
  } catch {
    return null;
  }
}

async function fetchFormsList() {
  try {
    const db = getDb();
    const rows = await db.select().from(schema.forms).all();

    const counts = await db
      .select({
        formId: schema.responses.formId,
        count: sql<number>`count(*)`,
      })
      .from(schema.responses)
      .groupBy(schema.responses.formId)
      .all();
    const countMap = new Map(counts.map((c) => [c.formId, c.count]));

    return rows.map((form) => ({
      id: form.id,
      title: form.title,
      status: form.status,
      slug: form.slug,
      responseCount: countMap.get(form.id) || 0,
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
    }));
  } catch {
    return [];
  }
}

export default async function main(args: string[]) {
  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = navigation as any;

  if (nav?.formId) {
    // User is viewing a specific form
    const form = await fetchFormDetail(nav.formId);
    if (form) screen.form = form;
  }

  if (nav?.view === "forms" || nav?.view === "forms-list" || !nav?.formId) {
    // User is on the forms list or we should show the list for context
    const forms = await fetchFormsList();
    screen.formsList = {
      count: forms.length,
      forms,
    };
  }

  if (nav?.view === "responses" && nav?.formId) {
    // User is viewing responses for a form
    try {
      const db = getDb();
      const responses = await db
        .select()
        .from(schema.responses)
        .where(eq(schema.responses.formId, nav.formId))
        .limit(20)
        .all();

      const total = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.responses)
        .where(eq(schema.responses.formId, nav.formId))
        .get();

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
      // Responses fetch failed, continue without
    }
  }

  if (Object.keys(screen).length === 0) {
    console.log("No application state found. Is the app running?");
    return;
  }

  const formCount = (screen.formsList as any)?.count ?? 0;
  console.error(
    `Current view: ${nav?.view ?? "unknown"}` +
      (nav?.formId ? ` (form: ${nav.formId})` : "") +
      ` — ${formCount} form(s)`,
  );
  console.log(JSON.stringify(screen, null, 2));
}
