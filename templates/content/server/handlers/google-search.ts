import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import type {
  GoogleSearchResult,
  GoogleSearchResponse,
} from "../../shared/api";

// ---- Provider detection ----

type GoogleSearchProvider = "google-cse" | "dataforseo" | null;

function getActiveProvider(): GoogleSearchProvider {
  if (getGoogleCSECredentials()) return "google-cse";
  if (getDataForSEOCredentials()) return "dataforseo";
  return null;
}

// ---- Google Custom Search API ----

function getGoogleCSECredentials(): { apiKey: string; cx: string } | null {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return null;
  return { apiKey, cx };
}

interface GoogleCSEItem {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
  formattedUrl?: string;
}

async function searchWithGoogleCSE(
  query: string,
  page: number,
  creds: { apiKey: string; cx: string },
): Promise<GoogleSearchResponse> {
  const startIndex = page * 10 + 1; // Google CSE uses 1-based start index
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", creds.apiKey);
  url.searchParams.set("cx", creds.cx);
  url.searchParams.set("q", query);
  url.searchParams.set("start", String(startIndex));

  const response = await fetch(url.toString());

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const msg =
      body?.error?.message || `Google CSE API error: ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const items: GoogleCSEItem[] = data.items || [];
  const totalResults = parseInt(
    data.searchInformation?.totalResults || "0",
    10,
  );

  const results: GoogleSearchResult[] = items
    .filter((item) => item.link && item.title)
    .map((item, idx) => ({
      title: item.title!,
      url: item.link!,
      description: item.snippet || "",
      domain: item.displayLink || getDomain(item.link!),
      position: startIndex + idx,
      breadcrumb: item.formattedUrl,
    }));

  return {
    results,
    hasNextPage:
      startIndex + results.length - 1 < totalResults && results.length > 0,
  };
}

// ---- DataForSEO SERP API ----

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

function getDataForSEOCredentials(): {
  login: string;
  password: string;
} | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

function dataforseoHeaders(login: string, password: string) {
  const encoded = Buffer.from(`${login}:${password}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/json",
  };
}

interface SerpItem {
  type?: string;
  title?: string;
  url?: string;
  description?: string;
  domain?: string;
  breadcrumb?: string;
  rank_absolute?: number;
}

async function searchWithDataForSEO(
  query: string,
  page: number,
  creds: { login: string; password: string },
): Promise<GoogleSearchResponse> {
  const offset = page * 10;
  const url = `${DATAFORSEO_BASE}/serp/google/organic/live/advanced`;
  const body = [
    {
      keyword: query,
      location_code: 2840,
      language_code: "en",
      depth: 20,
      offset,
    },
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: dataforseoHeaders(creds.login, creds.password),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DataForSEO API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  const task = data?.tasks?.[0];
  const items: SerpItem[] = task?.result?.[0]?.items || [];
  const totalCount = task?.result?.[0]?.se_results_count || 0;

  const results: GoogleSearchResult[] = items
    .filter((item) => item.type === "organic" && item.url && item.title)
    .map((item, idx) => ({
      title: item.title!,
      url: item.url!,
      description: item.description || "",
      domain: item.domain || getDomain(item.url!),
      position: item.rank_absolute || offset + idx + 1,
      breadcrumb: item.breadcrumb,
    }));

  return {
    results,
    hasNextPage: offset + results.length < totalCount && results.length > 0,
  };
}

// ---- Route Handlers ----

/**
 * GET /api/google/search?q=...&page=0
 *
 * Auto-detects provider: prefers Google CSE if configured, falls back to DataForSEO.
 */
export const searchGoogle = defineEventHandler(async (event: H3Event) => {
  const q = getQuery(event);
  const query = ((q.q as string) || "").trim();
  if (!query) {
    setResponseStatus(event, 400);
    return { error: "Query parameter 'q' is required" };
  }

  const page = parseInt((q.page as string) || "0", 10);

  try {
    const cseCreds = getGoogleCSECredentials();
    if (cseCreds) {
      return await searchWithGoogleCSE(query, page, cseCreds);
    }

    const dfsCreds = getDataForSEOCredentials();
    if (dfsCreds) {
      return await searchWithDataForSEO(query, page, dfsCreds);
    }

    setResponseStatus(event, 400);
    return {
      error:
        "No Google search provider configured. Set GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX, or DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD.",
    };
  } catch (err: any) {
    console.error("Google search error:", err);
    setResponseStatus(event, 500);
    return { error: err.message || "Failed to fetch search results" };
  }
});

/**
 * GET /api/google/status
 *
 * Returns which Google search provider is active.
 */
export const googleSearchStatus = defineEventHandler((_event: H3Event) => {
  const provider = getActiveProvider();
  const cse = !!getGoogleCSECredentials();
  const dfs = !!getDataForSEOCredentials();

  return {
    configured: provider !== null,
    provider:
      provider === "google-cse"
        ? "Google Custom Search"
        : provider === "dataforseo"
          ? "DataForSEO"
          : "None",
    googleCSE: cse,
    dataForSEO: dfs,
  };
});

/**
 * POST /api/google/configure
 * Body: { provider: "google-cse", apiKey, cx } or { provider: "dataforseo", login, password }
 */
export const configureGoogleSearch = defineEventHandler(
  async (event: H3Event) => {
    const body = await readBody(event);
    const { provider } = body;

    if (provider === "google-cse") {
      const { apiKey, cx } = body;
      if (!apiKey || !cx) {
        setResponseStatus(event, 400);
        return { error: "'apiKey' and 'cx' are required for Google CSE" };
      }

      // Validate with a test query
      try {
        const testUrl = new URL("https://www.googleapis.com/customsearch/v1");
        testUrl.searchParams.set("key", apiKey);
        testUrl.searchParams.set("cx", cx);
        testUrl.searchParams.set("q", "test");
        const testRes = await fetch(testUrl.toString());
        if (
          testRes.status === 400 ||
          testRes.status === 401 ||
          testRes.status === 403
        ) {
          const resBody = await testRes.json().catch(() => null);
          setResponseStatus(event, 401);
          return {
            error: resBody?.error?.message || "Invalid Google CSE credentials",
          };
        }
      } catch {
        setResponseStatus(event, 500);
        return { error: "Could not reach Google CSE API" };
      }

      process.env.GOOGLE_CSE_API_KEY = apiKey;
      process.env.GOOGLE_CSE_CX = cx;
      return { success: true, provider: "Google Custom Search" };
    }

    if (provider === "dataforseo") {
      const { login, password } = body;
      if (!login || !password) {
        setResponseStatus(event, 400);
        return {
          error: "'login' and 'password' are required for DataForSEO",
        };
      }

      process.env.DATAFORSEO_LOGIN = login;
      process.env.DATAFORSEO_PASSWORD = password;
      return { success: true, provider: "DataForSEO" };
    }

    setResponseStatus(event, 400);
    return {
      error: "Invalid provider. Use 'google-cse' or 'dataforseo'.",
    };
  },
);

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
