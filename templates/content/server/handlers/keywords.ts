import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import type {
  KeywordSuggestion,
  KeywordSuggestResponse,
  KeywordVolumeResponse,
  KeywordApiStatus,
} from "../../shared/api";

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

// ---- Google Autocomplete (free, no key needed) ----

async function fetchAutocompleteSuggestions(query: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  if (Array.isArray(data) && Array.isArray(data[1])) {
    return data[1].filter((s: unknown) => typeof s === "string");
  }
  return [];
}

// ---- DataForSEO Keywords Data API ----

interface DataForSEOKeywordResult {
  keyword: string;
  search_volume?: number;
  cpc?: number;
  competition?: string; // "LOW" | "MEDIUM" | "HIGH"
  competition_index?: number; // 0-100
}

/**
 * Fetches keyword metrics from DataForSEO Google Ads Search Volume endpoint.
 * POST /v3/keywords_data/google_ads/search_volume/live
 */
async function fetchDataForSEOMetrics(
  keywords: string[],
  login: string,
  password: string,
  locationCode: number = 2840,
  languageCode: string = "en",
): Promise<
  Map<string, { volume?: number; competition?: number; cpc?: number }>
> {
  const url = `${DATAFORSEO_BASE}/keywords_data/google_ads/search_volume/live`;
  const body = [
    {
      keywords,
      location_code: locationCode,
      language_code: languageCode,
    },
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: dataforseoHeaders(login, password),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DataForSEO API error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  const metricsMap = new Map<
    string,
    { volume?: number; competition?: number; cpc?: number }
  >();

  const tasks = data?.tasks;
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      const results = task?.result;
      if (!Array.isArray(results)) continue;
      for (const item of results as DataForSEOKeywordResult[]) {
        if (!item.keyword) continue;
        metricsMap.set(item.keyword, {
          volume: item.search_volume ?? undefined,
          competition: item.competition_index ?? undefined,
          cpc: item.cpc ?? undefined,
        });
      }
    }
  }

  return metricsMap;
}

// ---- Route Handlers ----

/**
 * GET /api/keywords/suggest?q=...
 *
 * 1. Always fetches keyword suggestions from Google Autocomplete (free).
 * 2. If DataForSEO credentials are set, enriches them with volume/competition/CPC.
 */
export const suggestKeywords = defineEventHandler(async (event: H3Event) => {
  const query = ((getQuery(event).q as string) || "").trim();
  if (!query) {
    setResponseStatus(event, 400);
    return { error: "Query parameter 'q' is required" };
  }

  try {
    const rawSuggestions = await fetchAutocompleteSuggestions(query);
    const creds = getDataForSEOCredentials();

    if (creds && rawSuggestions.length > 0) {
      try {
        const metrics = await fetchDataForSEOMetrics(
          rawSuggestions,
          creds.login,
          creds.password,
        );
        const suggestions: KeywordSuggestion[] = rawSuggestions.map((kw) => {
          const m = metrics.get(kw);
          return {
            keyword: kw,
            volume: m?.volume,
            competition: m?.competition,
            cpc: m?.cpc,
          };
        });

        return {
          query,
          suggestions,
          source: "dataforseo",
        } as KeywordSuggestResponse;
      } catch (err: any) {
        console.error(
          "DataForSEO enrichment failed, using plain suggestions:",
          err.message,
        );
      }
    }

    // Plain suggestions (no DataForSEO or it failed)
    const suggestions: KeywordSuggestion[] = rawSuggestions.map((s) => ({
      keyword: s,
    }));
    return {
      query,
      suggestions,
      source: "autocomplete",
    } as KeywordSuggestResponse;
  } catch (err: any) {
    console.error("Keyword suggest error:", err);
    setResponseStatus(event, 500);
    return { error: "Failed to fetch suggestions" };
  }
});

/**
 * POST /api/keywords/volume
 * Body: { keywords: string[], locationCode?: number, languageCode?: string }
 * Fetches volume/competition/CPC from DataForSEO for given keywords.
 */
export const getKeywordVolume = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { keywords, locationCode, languageCode } = body;

  if (!Array.isArray(keywords) || keywords.length === 0) {
    setResponseStatus(event, 400);
    return { error: "'keywords' array is required" };
  }

  const creds = getDataForSEOCredentials();
  if (!creds) {
    setResponseStatus(event, 400);
    return {
      error: "DataForSEO credentials are not configured.",
    };
  }

  try {
    const metrics = await fetchDataForSEOMetrics(
      keywords.slice(0, 700), // DataForSEO supports up to 700 per request
      creds.login,
      creds.password,
      locationCode || 2840,
      languageCode || "en",
    );

    const results: KeywordSuggestion[] = keywords.map((kw) => {
      const m = metrics.get(kw);
      return {
        keyword: kw,
        volume: m?.volume,
        competition: m?.competition,
        cpc: m?.cpc,
      };
    });

    return { keywords: results } as KeywordVolumeResponse;
  } catch (err: any) {
    console.error("Keyword volume error:", err);
    setResponseStatus(event, 500);
    return { error: err.message || "Failed to fetch volume data" };
  }
});

/**
 * POST /api/keywords/configure
 * Body: { login: string, password: string }
 * Validates and stores DataForSEO credentials at runtime.
 */
export const configureApi = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { login, password } = body;
  if (!login || !password) {
    setResponseStatus(event, 400);
    return { error: "'login' and 'password' are required" };
  }

  // Validate credentials with a lightweight test call
  try {
    const testUrl = `${DATAFORSEO_BASE}/keywords_data/google_ads/search_volume/live`;
    const testBody = [
      { keywords: ["test"], location_code: 2840, language_code: "en" },
    ];
    const testRes = await fetch(testUrl, {
      method: "POST",
      headers: dataforseoHeaders(login, password),
      body: JSON.stringify(testBody),
    });
    if (testRes.status === 401 || testRes.status === 403) {
      setResponseStatus(event, 401);
      return { error: "Invalid credentials - DataForSEO rejected them" };
    }
  } catch {
    setResponseStatus(event, 500);
    return {
      error: "Could not reach DataForSEO API to validate credentials",
    };
  }

  process.env.DATAFORSEO_LOGIN = login;
  process.env.DATAFORSEO_PASSWORD = password;
  return { success: true, provider: "DataForSEO" };
});

/** GET /api/keywords/status */
export const getApiStatus = defineEventHandler((_event: H3Event) => {
  const creds = getDataForSEOCredentials();
  const status: KeywordApiStatus = {
    configured: !!creds,
    provider: creds ? "DataForSEO" : "Google Suggest (free)",
  };
  return status;
});
