import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
);

import { getDb, schema } from "../db/index.js";
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

// ---------------------------------------------------------------------------
// Public form cache (60s TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const publicFormCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCachedPublicForm(slug: string): unknown | undefined {
  const entry = publicFormCache.get(slug);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    publicFormCache.delete(slug);
    return undefined;
  }
  return entry.data;
}

function setCachedPublicForm(slug: string, data: unknown): void {
  publicFormCache.set(slug, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// Invalidate cache for a slug (called on form updates/deletes)
function invalidatePublicFormCache(slug?: string): void {
  if (slug) {
    publicFormCache.delete(slug);
  } else {
    publicFormCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const listForms = defineEventHandler(async (_event: H3Event) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.forms)
    .orderBy(schema.forms.updatedAt);
  // Get response counts per form
  const counts = await db
    .select({
      formId: schema.responses.formId,
      count: sql<number>`count(*)`,
    })
    .from(schema.responses)
    .groupBy(schema.responses.formId);
  const countMap = new Map(counts.map((c) => [c.formId, c.count]));
  return rows.map((r) => rowToForm(r, countMap.get(r.id) ?? 0)).reverse();
});

export const getForm = defineEventHandler(async (event: H3Event) => {
  const db = getDb();
  const id = getRouterParam(event, "id") as string;
  const row = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))

    .then((rows) => rows[0]);

  if (!row) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  const count = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.responses)
    .where(eq(schema.responses.formId, id))

    .then((rows) => rows[0]);

  return rowToForm(row, count?.count ?? 0);
});

export const createForm = defineEventHandler(async (event: H3Event) => {
  const db = getDb();
  const body = await readBody(event);
  const now = new Date().toISOString();
  const id = nanoid(10);
  const slug =
    body.slug || slugify(body.title || "untitled") + "/" + id.slice(0, 6);

  const defaultSettings: FormSettings = {
    submitText: "Submit",
    successMessage: "Thank you! Your response has been recorded.",
    showProgressBar: false,
  };

  try {
    await db.insert(schema.forms).values({
      id,
      title: body.title || "Untitled Form",
      description: body.description || null,
      slug,
      fields: JSON.stringify(body.fields || []),
      settings: JSON.stringify(body.settings || defaultSettings),
      status: body.status || "draft",
      createdAt: now,
      updatedAt: now,
    });
  } catch (err: any) {
    if (err?.message?.includes("UNIQUE constraint")) {
      setResponseStatus(event, 409);
      return { error: "A form with this slug already exists" };
    }
    throw err;
  }

  const row = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))

    .then((rows) => rows[0]);
  return rowToForm(row!, 0);
});

export const updateForm = defineEventHandler(async (event: H3Event) => {
  const db = getDb();
  const id = getRouterParam(event, "id") as string;
  const body = await readBody(event);
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))

    .then((rows) => rows[0]);

  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  const updates: Record<string, unknown> = { updatedAt: now };
  if (body.title !== undefined) {
    updates.title = body.title;
    // Auto-update slug when title changes (unless slug is explicitly provided)
    if (body.slug === undefined) {
      const idSuffix = id.slice(0, 6);
      updates.slug = slugify(body.title || "untitled") + "/" + idSuffix;
    }
  }
  if (body.description !== undefined) updates.description = body.description;
  if (body.slug !== undefined) updates.slug = body.slug;
  if (body.fields !== undefined) updates.fields = JSON.stringify(body.fields);
  if (body.settings !== undefined)
    updates.settings = JSON.stringify(body.settings);
  if (body.status !== undefined) updates.status = body.status;

  try {
    await db.update(schema.forms).set(updates).where(eq(schema.forms.id, id));
  } catch (err: any) {
    if (err?.message?.includes("UNIQUE constraint")) {
      setResponseStatus(event, 409);
      return { error: "A form with this slug already exists" };
    }
    throw err;
  }

  // Invalidate cache for old and new slugs
  invalidatePublicFormCache(existing.slug);
  if (updates.slug && updates.slug !== existing.slug) {
    invalidatePublicFormCache(updates.slug as string);
  }

  const row = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))

    .then((rows) => rows[0]);
  return rowToForm(row!);
});

export const deleteForm = defineEventHandler(async (event: H3Event) => {
  const db = getDb();
  const id = getRouterParam(event, "id") as string;

  const existing = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))

    .then((rows) => rows[0]);

  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  // Delete responses first, then form
  await db.delete(schema.responses).where(eq(schema.responses.formId, id));
  await db.delete(schema.forms).where(eq(schema.forms.id, id));

  // Invalidate cache
  invalidatePublicFormCache(existing.slug);

  return { success: true };
});

export const getPublicForm = defineEventHandler(async (event: H3Event) => {
  // URL: /api/forms/public/{formId} — extract last path segment as the ID
  const url = event.node.req.url ?? "";
  const afterPublic = url.split("/api/forms/public/")[1] || "";
  const segments = afterPublic.split("?")[0].split("/").filter(Boolean);
  const formId = segments[segments.length - 1] || "";

  // Check cache first
  const cached = getCachedPublicForm(formId);
  if (cached) return cached;

  const db = getDb();
  const row = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, formId))
    .then((rows) => rows[0]);

  if (!row || row.status !== "published") {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  // Return only what public users need
  const result = {
    id: row.id,
    title: row.title,
    description: row.description,
    fields: JSON.parse(row.fields),
    settings: JSON.parse(row.settings),
  };

  setCachedPublicForm(formId, result);
  return result;
});
