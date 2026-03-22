import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import type { Form, FormField, FormSettings } from "../../shared/types.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function rowToForm(
  row: typeof schema.forms.$inferSelect,
  responseCount?: number,
): Form {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    slug: row.slug,
    fields: JSON.parse(row.fields) as FormField[],
    settings: JSON.parse(row.settings) as FormSettings,
    status: row.status,
    responseCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const listForms = defineEventHandler((_event: H3Event) => {
  const rows = db
    .select()
    .from(schema.forms)
    .orderBy(schema.forms.updatedAt)
    .all();

  // Get response counts per form
  const counts = db
    .select({
      formId: schema.responses.formId,
      count: sql<number>`count(*)`,
    })
    .from(schema.responses)
    .groupBy(schema.responses.formId)
    .all();

  const countMap = new Map(counts.map((c) => [c.formId, c.count]));
  return rows.map((r) => rowToForm(r, countMap.get(r.id) ?? 0)).reverse();
});

export const getForm = defineEventHandler((event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  const row = db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))
    .get();

  if (!row) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  const count = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.responses)
    .where(eq(schema.responses.formId, id))
    .get();

  return rowToForm(row, count?.count ?? 0);
});

export const createForm = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const now = new Date().toISOString();
  const id = nanoid();
  const slug =
    body.slug || slugify(body.title || "untitled") + "-" + id.slice(0, 6);

  const defaultSettings: FormSettings = {
    primaryColor: "#2563eb",
    backgroundColor: "#ffffff",
    fontFamily: "Inter",
    submitText: "Submit",
    successMessage: "Thank you! Your response has been recorded.",
    showProgressBar: false,
  };

  db.insert(schema.forms)
    .values({
      id,
      title: body.title || "Untitled Form",
      description: body.description || null,
      slug,
      fields: JSON.stringify(body.fields || []),
      settings: JSON.stringify(body.settings || defaultSettings),
      status: body.status || "draft",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))
    .get();
  return rowToForm(row!, 0);
});

export const updateForm = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  const body = await readBody(event);
  const now = new Date().toISOString();

  const existing = db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))
    .get();

  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  const updates: Record<string, unknown> = { updatedAt: now };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.slug !== undefined) updates.slug = body.slug;
  if (body.fields !== undefined) updates.fields = JSON.stringify(body.fields);
  if (body.settings !== undefined)
    updates.settings = JSON.stringify(body.settings);
  if (body.status !== undefined) updates.status = body.status;

  db.update(schema.forms).set(updates).where(eq(schema.forms.id, id)).run();

  const row = db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))
    .get();
  return rowToForm(row!);
});

export const deleteForm = defineEventHandler((event: H3Event) => {
  const id = getRouterParam(event, "id") as string;

  const existing = db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))
    .get();

  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  // Delete responses first, then form
  db.delete(schema.responses).where(eq(schema.responses.formId, id)).run();
  db.delete(schema.forms).where(eq(schema.forms.id, id)).run();
  return { success: true };
});

export const getPublicForm = defineEventHandler((event: H3Event) => {
  const slug = getRouterParam(event, "slug") as string;
  const row = db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.slug, slug))
    .get();

  if (!row || row.status !== "published") {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  // Return only what public users need
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    fields: JSON.parse(row.fields),
    settings: JSON.parse(row.settings),
  };
});
