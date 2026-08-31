import { defineAction } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import {
  BUILDER_ANALYTICS_CREDENTIAL_KEYS,
  resolveAnalyticsProviderCredential,
} from "../server/lib/provider-credentials";

const BUILDER_CONTENT_API_URL =
  "https://cdn.builder.io/api/v3/content/blog-article";
const BUILDER_CONTENT_FIELDS = [
  "id",
  "name",
  "published",
  "createdDate",
  "lastUpdated",
  "firstPublished",
  "data.handle",
  "data.date",
  "data.url",
].join(",");
const BUILDER_PAGE_SIZE = 100;
const BUILDER_MAX_PAGES = 200;

type BuilderContentResult = {
  id?: unknown;
  name?: unknown;
  published?: unknown;
  createdDate?: unknown;
  lastUpdated?: unknown;
  firstPublished?: unknown;
  handle?: unknown;
  data?: {
    handle?: unknown;
    date?: unknown;
    url?: unknown;
  };
};

type BuilderContentResponse = {
  results?: unknown;
};

export interface BuilderBlogArticle {
  id: string;
  handle: string;
  title: string;
  publishDate: string | null;
  firstPublished: string | null;
  createdDate: string | null;
  lastUpdated: string | null;
}

function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fromBlogPath = trimmed.match(/\/blog\/([^/?#]+)/i)?.[1];
  return decodeURIComponent(fromBlogPath ?? trimmed.replace(/^\/+|\/+$/g, ""));
}

function normalizeDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const numeric = Number(raw);
  const date = new Date(Number.isFinite(numeric) && raw !== "" ? numeric : raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeArticle(
  result: BuilderContentResult,
): BuilderBlogArticle | null {
  const handle = normalizeHandle(
    result.data?.handle ?? result.handle ?? result.data?.url,
  );
  if (!handle) return null;
  return {
    id: typeof result.id === "string" ? result.id : handle,
    handle,
    title: typeof result.name === "string" ? result.name : handle,
    // `data.date` is the article's canonical publish date. Builder's
    // first-publish timestamp is only a fallback for older entries without it.
    publishDate: normalizeDate(
      result.data?.date ?? result.firstPublished ?? result.createdDate,
    ),
    firstPublished: normalizeDate(result.firstPublished),
    createdDate: normalizeDate(result.createdDate),
    lastUpdated: normalizeDate(result.lastUpdated),
  };
}

function requestContext(context?: ActionRunContext) {
  if (!context?.userEmail) {
    throw new Error("Builder Content API requires an authenticated user.");
  }
  return {
    userEmail: context.userEmail,
    orgId: context.orgId ?? null,
  };
}

export async function listBuilderBlogArticles(
  args: { handles?: string[] },
  context?: ActionRunContext,
): Promise<BuilderBlogArticle[]> {
  const credential = await resolveAnalyticsProviderCredential({
    provider: "builder",
    keys: BUILDER_ANALYTICS_CREDENTIAL_KEYS,
    ctx: requestContext(context),
  });
  if (!credential) {
    throw new Error(
      "Builder Content API is not connected for this Analytics workspace.",
    );
  }

  const requestedHandles = new Set(
    (args.handles ?? [])
      .map((handle) => normalizeHandle(handle))
      .filter((handle): handle is string => Boolean(handle)),
  );
  const found = new Map<string, BuilderBlogArticle>();

  for (let page = 0; page < BUILDER_MAX_PAGES; page += 1) {
    const url = new URL(BUILDER_CONTENT_API_URL);
    url.searchParams.set("apiKey", credential.value);
    url.searchParams.set("fields", BUILDER_CONTENT_FIELDS);
    url.searchParams.set("limit", String(BUILDER_PAGE_SIZE));
    url.searchParams.set("offset", String(page * BUILDER_PAGE_SIZE));
    url.searchParams.set("sort.createdDate", "-1");
    url.searchParams.set("query.published", "published");
    url.searchParams.set("noTraverse", "true");

    const response = await fetch(url, {
      ...(context?.signal ? { signal: context.signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`Builder Content API returned HTTP ${response.status}.`);
    }

    let payload: BuilderContentResponse;
    try {
      payload = (await response.json()) as BuilderContentResponse;
    } catch {
      throw new Error("Builder Content API returned invalid JSON.");
    }
    if (!Array.isArray(payload.results)) {
      throw new Error("Builder Content API returned no results array.");
    }

    for (const raw of payload.results) {
      if (!raw || typeof raw !== "object") continue;
      const article = normalizeArticle(raw as BuilderContentResult);
      if (!article) continue;
      if (requestedHandles.size > 0 && !requestedHandles.has(article.handle)) {
        continue;
      }
      if (!found.has(article.handle)) found.set(article.handle, article);
    }

    if (
      (requestedHandles.size > 0 && found.size >= requestedHandles.size) ||
      payload.results.length < BUILDER_PAGE_SIZE ||
      payload.results.length === 0
    ) {
      break;
    }
  }

  return [...found.values()];
}

export default defineAction({
  description:
    "List published Builder.io blog-article metadata, including each article handle and canonical data.date publish date. This is a read-only source for joining Builder content to Analytics warehouse metrics; it never returns article bodies.",
  schema: z.object({
    handles: z
      .array(z.string().trim().min(1))
      .max(1000)
      .optional()
      .describe(
        "Optional article handles to resolve. When omitted, paginate the published blog-article feed.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  grounding: true,
  run: async (args, context) => {
    const articles = await listBuilderBlogArticles(args, context);
    return { articles, total: articles.length };
  },
});
