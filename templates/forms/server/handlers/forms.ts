import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

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

// ---------------------------------------------------------------------------
// Public form handler (unauthenticated — stays as API route)
// ---------------------------------------------------------------------------

export const getPublicForm = defineEventHandler(async (event: H3Event) => {
  // URL: /api/forms/public/{slug} — extract full slug (may contain slashes)
  const url = event.node.req.url ?? "";
  const afterPublic = url.split("/api/forms/public/")[1] || "";
  const slug = decodeURIComponent(afterPublic.split("?")[0]);

  if (!slug) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  // Check cache first
  const cached = getCachedPublicForm(slug);
  if (cached) return cached;

  const db = getDb();
  // Try matching by slug first, then fall back to matching by ID
  let row = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.slug, slug))
    .then((rows) => rows[0]);

  if (!row) {
    // Fall back to ID-based lookup (for legacy URLs or direct ID access)
    row = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, slug))
      .then((rows) => rows[0]);
  }

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

  setCachedPublicForm(slug, result);
  return result;
});
