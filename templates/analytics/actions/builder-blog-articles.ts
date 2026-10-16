import { defineAction, fail } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import {
  BUILDER_ANALYTICS_CREDENTIAL_KEYS,
  resolveAnalyticsProviderCredential,
} from "../server/lib/provider-credentials";

const BUILDER_CONTENT_API_URL =
  "https://cdn.builder.io/api/v3/content/blog-article";
const BUILDER_AUTHOR_API_URL =
  "https://cdn.builder.io/api/v3/content/blog-author";
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
  "data.author",
  "data.authors",
].join(",");
const BUILDER_AUTHOR_FIELDS = [
  "id",
  "name",
  "data.fullName",
  "data.handle",
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
    author?: unknown;
    authors?: unknown;
  };
};

type BuilderAuthorResult = {
  id?: unknown;
  name?: unknown;
  data?: { fullName?: unknown; handle?: unknown };
};

type BuilderContentResponse = {
  results?: unknown;
};

/**
 * A blog-author reference. `name` and `handle` are null when the referenced
 * author entry is unpublished or deleted; `id` still says who it was.
 */
export interface BuilderBlogAuthor {
  id: string;
  name: string | null;
  handle: string | null;
}

export interface BuilderBlogArticle {
  id: string;
  handle: string;
  title: string;
  /** The article's primary author, or null when none is set. */
  author: BuilderBlogAuthor | null;
  /** Every credited author, primary first, without duplicates. */
  authors: BuilderBlogAuthor[];
  publishDate: string | null;
  firstPublished: string | null;
  createdDate: string | null;
  lastUpdated: string | null;
}

export interface BuilderBlogArticleListResult {
  articles: BuilderBlogArticle[];
  total: number;
  truncated: boolean;
  nextOffset: number | null;
}

type ArticleWithAuthorIds = {
  article: Omit<BuilderBlogArticle, "author" | "authors">;
  primaryAuthorId: string | null;
  authorIds: string[];
};

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

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function referenceId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return nonEmptyString((value as { id?: unknown }).id);
}

function articleAuthorIds(data: BuilderContentResult["data"]): {
  primary: string | null;
  all: string[];
} {
  const primary = referenceId(data?.author);
  const listed = Array.isArray(data?.authors)
    ? data.authors.map((entry) =>
        referenceId((entry as { author?: unknown } | null)?.author),
      )
    : [];
  const all = [
    ...new Set([primary, ...listed].filter((id): id is string => !!id)),
  ];
  return { primary, all };
}

function normalizeArticle(
  result: BuilderContentResult,
): ArticleWithAuthorIds | null {
  const handle = normalizeHandle(
    result.data?.handle ?? result.handle ?? result.data?.url,
  );
  if (!handle) return null;
  const authorIds = articleAuthorIds(result.data);
  return {
    primaryAuthorId: authorIds.primary,
    authorIds: authorIds.all,
    article: {
      id: typeof result.id === "string" ? result.id : handle,
      handle,
      title: typeof result.name === "string" ? result.name : handle,
      publishDate: normalizeDate(
        result.data?.date ?? result.firstPublished ?? result.createdDate,
      ),
      firstPublished: normalizeDate(result.firstPublished),
      createdDate: normalizeDate(result.createdDate),
      lastUpdated: normalizeDate(result.lastUpdated),
    },
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

async function fetchBuilderResults(
  url: URL,
  label: string,
  signal: AbortSignal | undefined,
): Promise<unknown[]> {
  const response = await fetch(url, { ...(signal ? { signal } : {}) });
  if (!response.ok) {
    fail(`${label} returned HTTP ${response.status}.`, {
      errorCode: "provider_error",
      statusCode: 502,
    });
  }

  let payload: BuilderContentResponse;
  try {
    payload = (await response.json()) as BuilderContentResponse;
  } catch {
    fail(`${label} returned invalid JSON.`, {
      errorCode: "provider_error",
      statusCode: 502,
    });
  }
  if (!Array.isArray(payload.results)) {
    fail(`${label} returned no results array.`, {
      errorCode: "provider_error",
      statusCode: 502,
    });
  }
  return payload.results;
}

async function resolveAuthors(
  ids: string[],
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<Map<string, BuilderBlogAuthor>> {
  const resolved = new Map<string, BuilderBlogAuthor>();
  for (let start = 0; start < ids.length; start += BUILDER_PAGE_SIZE) {
    const url = new URL(BUILDER_AUTHOR_API_URL);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("fields", BUILDER_AUTHOR_FIELDS);
    url.searchParams.set("limit", String(BUILDER_PAGE_SIZE));
    url.searchParams.set(
      "query.id.$in",
      JSON.stringify(ids.slice(start, start + BUILDER_PAGE_SIZE)),
    );
    url.searchParams.set("noTraverse", "true");

    const results = await fetchBuilderResults(
      url,
      "Builder Content API (blog authors)",
      signal,
    );
    for (const raw of results) {
      if (!raw || typeof raw !== "object") continue;
      const author = raw as BuilderAuthorResult;
      const id = nonEmptyString(author.id);
      if (!id) continue;
      resolved.set(id, {
        id,
        name:
          nonEmptyString(author.data?.fullName) ?? nonEmptyString(author.name),
        handle: nonEmptyString(author.data?.handle),
      });
    }
  }
  return resolved;
}

export async function listBuilderBlogArticles(
  args: { handles?: string[]; offset?: number },
  context?: ActionRunContext,
): Promise<BuilderBlogArticleListResult> {
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
  const startOffset = args.offset ?? 0;
  if (!Number.isSafeInteger(startOffset) || startOffset < 0) {
    throw new Error(
      "Builder Content API offset must be a non-negative integer.",
    );
  }
  const found = new Map<string, ArticleWithAuthorIds>();
  let nextOffset: number | null = null;

  for (let page = 0; page < BUILDER_MAX_PAGES; page += 1) {
    const offset = startOffset + page * BUILDER_PAGE_SIZE;
    const url = new URL(BUILDER_CONTENT_API_URL);
    url.searchParams.set("apiKey", credential.value);
    url.searchParams.set("fields", BUILDER_CONTENT_FIELDS);
    url.searchParams.set("limit", String(BUILDER_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sort.createdDate", "-1");
    url.searchParams.set("query.published", "published");
    url.searchParams.set("noTraverse", "true");

    const results = await fetchBuilderResults(
      url,
      "Builder Content API",
      context?.signal,
    );

    for (const raw of results) {
      if (!raw || typeof raw !== "object") continue;
      const normalized = normalizeArticle(raw as BuilderContentResult);
      if (!normalized) continue;
      const { handle } = normalized.article;
      if (requestedHandles.size > 0 && !requestedHandles.has(handle)) {
        continue;
      }
      if (!found.has(handle)) found.set(handle, normalized);
    }

    if (
      (requestedHandles.size > 0 && found.size >= requestedHandles.size) ||
      results.length < BUILDER_PAGE_SIZE ||
      results.length === 0
    ) {
      break;
    }
    if (page === BUILDER_MAX_PAGES - 1) {
      nextOffset = offset + BUILDER_PAGE_SIZE;
    }
  }

  const authors = await resolveAuthors(
    [...new Set([...found.values()].flatMap((entry) => entry.authorIds))],
    credential.value,
    context?.signal,
  );
  const authorFor = (id: string): BuilderBlogAuthor =>
    authors.get(id) ?? { id, name: null, handle: null };

  return {
    articles: [...found.values()].map((entry) => ({
      ...entry.article,
      author: entry.primaryAuthorId ? authorFor(entry.primaryAuthorId) : null,
      authors: entry.authorIds.map(authorFor),
    })),
    total: found.size,
    truncated: nextOffset !== null,
    nextOffset,
  };
}

export default defineAction({
  description:
    "List published Builder.io blog-article metadata: each article's handle, canonical data.date publish date, and authors (author is the primary author; authors lists every credited author, with a null name when the author entry is unpublished). This is a read-only source for joining Builder content to Analytics warehouse metrics; it never returns article bodies. A bounded feed returns truncated=true and nextOffset when more pages remain.",
  schema: z.object({
    handles: z
      .array(z.string().trim().min(1))
      .max(1000)
      .optional()
      .describe(
        "Optional article handles to resolve. When omitted, paginate the published blog-article feed.",
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Optional zero-based offset for continuing a truncated feed."),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  grounding: true,
  run: async (args, context) => {
    return listBuilderBlogArticles(args, context);
  },
});
