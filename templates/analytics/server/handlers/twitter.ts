import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { requireCredential, resolveCredential } from "../lib/credentials";
import {
  withRequestContextFromEvent,
  getCredentialContextFromEvent,
} from "../lib/credentials";
import { createHash } from "crypto";

// ─── In-memory cache (TTL-based) ───────────────────────────────────────
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_ENTRIES = 50;

interface CacheEntry {
  data: unknown;
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCacheKey(apiKey: string, username: string, cursor?: string): string {
  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const input = `tweets:${keyHash}:${username.toLowerCase()}:${cursor ?? ""}`;
  return createHash("sha256").update(input).digest("hex");
}

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, createdAt: Date.now() });
}

// ─── Fetch a single page of tweets ────────────────────────────────────
async function fetchTweetsPage(
  apiKey: string,
  userName: string,
  cursor?: string,
): Promise<{ tweets: unknown[]; next_cursor?: string }> {
  const url = new URL("https://api.twitterapi.io/twitter/user/last_tweets");
  url.searchParams.set("userName", userName);
  if (cursor) url.searchParams.set("cursor", cursor);

  console.log(
    "[Twitter] Fetching page for",
    userName,
    "cursor:",
    cursor || "none",
  );

  const resp = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey },
  });

  console.log("[Twitter] Response status:", resp.status);

  if (!resp.ok) {
    const text = await resp.text();
    console.error("[Twitter] API error response:", text);
    throw new Error(`Twitter API ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  console.log("[Twitter] Received", json.data?.tweets?.length || 0, "tweets");

  // API returns { status, data: { tweets: [...] }, next_cursor, has_next_page }
  return {
    tweets: json.data?.tweets ?? json.tweets ?? [],
    next_cursor: json.next_cursor ?? json.data?.next_cursor,
  };
}

// ─── Shared helper: fetch all pages for a user ───────────────────────
export async function fetchAllTweetsForUser(
  apiKey: string,
  userName: string,
  maxPages: number,
): Promise<unknown[]> {
  const fullCacheKey = getCacheKey(apiKey, userName, `full:${maxPages}`);
  const cached = getCached(fullCacheKey) as { tweets: unknown[] } | null;
  if (cached) return cached.tweets;

  const allTweets: unknown[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const pageKey = getCacheKey(apiKey, userName, cursor ?? `page${page}`);
    let pageData = getCached(pageKey) as {
      tweets: unknown[];
      next_cursor?: string;
    } | null;

    if (!pageData) {
      pageData = await fetchTweetsPage(apiKey, userName, cursor);
      setCache(pageKey, pageData);
    }

    if (pageData.tweets) {
      allTweets.push(...pageData.tweets);
    }

    cursor = pageData.next_cursor;
    if (!cursor) break;
  }

  setCache(fullCacheKey, { tweets: allTweets });
  return allTweets;
}

// ─── Handler: GET /api/twitter/tweets?userName=...&pages=... ──────────
export const handleTwitterTweets = defineEventHandler(async (event) => {
  const missing = await requireCredential(
    event,
    "TWITTER_BEARER_TOKEN",
    "Twitter",
  );
  if (missing) return missing;

  const result = await withRequestContextFromEvent(event, async (ctx) => {
    const { userName: userNameParam, pages: pagesParam } = getQuery(event);
    const userName = userNameParam as string;
    if (!userName) {
      return { error: "userName query parameter is required" };
    }
    const maxPages = Math.min(Number(pagesParam) || 5, 10);

    const apiKey = await resolveCredential("TWITTER_BEARER_TOKEN", ctx);
    console.log(
      "[Twitter] API key present:",
      !!apiKey,
      "userName:",
      userName,
      "pages:",
      maxPages,
    );
    if (!apiKey) {
      console.error("[Twitter] TWITTER_BEARER_TOKEN not configured");
      setResponseStatus(event, 500);
      return { error: "TWITTER_BEARER_TOKEN not configured" };
    }

    try {
      const tweets = await fetchAllTweetsForUser(apiKey, userName, maxPages);
      console.log(
        "[Twitter] Successfully fetched",
        tweets.length,
        "tweets for",
        userName,
      );
      return { tweets, count: tweets.length };
    } catch (error: any) {
      const message = error?.message || String(error);
      console.error("[Twitter] API error:", message, error);
      setResponseStatus(event, 502);
      return { error: message };
    }
  });
  if (result === null) {
    setResponseStatus(event, 401);
    return { error: "Sign in to access Twitter data." };
  }
  return result;
});

// ─── Handler: GET /api/twitter/multi?userNames=a,b,c&pages=... ──────
export const handleTwitterMulti = defineEventHandler(async (event) => {
  const missing = await requireCredential(
    event,
    "TWITTER_BEARER_TOKEN",
    "Twitter",
  );
  if (missing) return missing;

  const ctx = await getCredentialContextFromEvent(event);
  if (!ctx) {
    setResponseStatus(event, 401);
    return { error: "Sign in to query Twitter" };
  }

  const { userNames: userNamesParam, pages: pagesParam } = getQuery(event);
  const userNames = ((userNamesParam as string) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const maxPages = Math.min(Number(pagesParam) || 5, 10);

  console.log(
    "[Twitter Multi] Request for users:",
    userNames,
    "pages:",
    maxPages,
  );

  if (userNames.length === 0) {
    setResponseStatus(event, 400);
    return { error: "Missing userNames parameter" };
  }
  if (userNames.length > 10) {
    setResponseStatus(event, 400);
    return { error: "Max 10 usernames at a time" };
  }

  const apiKey = await resolveCredential("TWITTER_BEARER_TOKEN", ctx);
  console.log("[Twitter Multi] API key present:", !!apiKey);
  if (!apiKey) {
    console.error("[Twitter Multi] TWITTER_BEARER_TOKEN not configured");
    setResponseStatus(event, 500);
    return { error: "TWITTER_BEARER_TOKEN not configured" };
  }

  // Check full multi-user cache
  const multiKey = getCacheKey(
    apiKey,
    userNames.sort().join(","),
    `multi:${maxPages}`,
  );
  const cached = getCached(multiKey);
  if (cached) {
    console.log("[Twitter Multi] Returning cached data");
    return { cached: true, ...(cached as object) };
  }

  try {
    const result: Record<string, unknown[]> = {};
    // Fetch sequentially to avoid rate limits
    for (const userName of userNames) {
      console.log("[Twitter Multi] Fetching for user:", userName);
      result[userName] = await fetchAllTweetsForUser(
        apiKey,
        userName,
        maxPages,
      );
    }
    const payload = { users: result };
    setCache(multiKey, payload);
    console.log(
      "[Twitter Multi] Successfully fetched all users, returning",
      Object.keys(result).length,
      "users",
    );
    return { cached: false, ...payload };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error("[Twitter Multi] Error:", message, error);
    setResponseStatus(event, 502);
    return { error: message };
  }
});
