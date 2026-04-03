// DataForSEO Labs API helper
// Uses relevant_pages endpoint for per-page SEO metrics
// and ranked_keywords for keyword-level data

import { resolveCredential } from "./credentials";

const API_BASE = "https://api.dataforseo.com/v3";

// In-memory cache (same pattern as bigquery.ts)
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_CACHE = 50;

async function getAuth(): Promise<string> {
  const login = await resolveCredential("DATAFORSEO_LOGIN");
  const password = await resolveCredential("DATAFORSEO_PASSWORD");
  if (!login || !password) {
    throw new Error(
      "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD env vars required",
    );
  }
  return Buffer.from(`${login}:${password}`).toString("base64");
}

async function apiPost<T>(path: string, body: unknown[]): Promise<T> {
  const cacheKey = JSON.stringify({ path, body });
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${await getAuth()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DataForSEO API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // Manage cache size
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(cacheKey, { data, ts: Date.now() });

  return data as T;
}

export interface BlogPageSeo {
  url: string;
  handle: string;
  etv: number;
  ranked_keywords: number;
  estimated_paid_traffic_cost: number;
}

interface RelevantPagesResponse {
  tasks: {
    status_code: number;
    status_message: string;
    result: {
      total_count: number;
      items_count: number;
      items: {
        page_address: string;
        metrics: {
          organic?: {
            etv: number;
            count: number;
            estimated_paid_traffic_cost: number;
          };
        };
      }[];
    }[];
  }[];
}

// Get SEO data for all your-domain.com/blog/ pages
export async function getRelevantBlogPages(
  limit = 100,
  offset = 0,
): Promise<BlogPageSeo[]> {
  const data = await apiPost<RelevantPagesResponse>(
    "/dataforseo_labs/google/relevant_pages/live",
    [
      {
        target: "your-domain.com",
        language_name: "English",
        location_code: 2840,
        limit,
        offset,
        filters: ["page_address", "like", "%/blog/%"],
        order_by: ["metrics.organic.etv,desc"],
      },
    ],
  );

  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(
      `DataForSEO task error: ${task?.status_code} ${task?.status_message}`,
    );
  }

  const items = task.result?.[0]?.items ?? [];
  return items.map((item) => {
    const match = item.page_address?.match(/\/blog\/([^/?#]+)/);
    const organic = item.metrics?.organic;
    return {
      url: item.page_address,
      handle: match?.[1] ?? "",
      etv: organic?.etv ?? 0,
      ranked_keywords: organic?.count ?? 0,
      estimated_paid_traffic_cost: organic?.estimated_paid_traffic_cost ?? 0,
    };
  });
}

// Get ALL blog page SEO data (paginated)
export async function getAllBlogPagesSeo(): Promise<
  Record<string, BlogPageSeo>
> {
  const result: Record<string, BlogPageSeo> = {};
  for (let offset = 0; offset < 1000; offset += 100) {
    const batch = await getRelevantBlogPages(100, offset);
    for (const page of batch) {
      if (page.handle) {
        result[page.handle] = page;
      }
    }
    if (batch.length < 100) break;
  }
  return result;
}

export interface RankedKeyword {
  keyword: string;
  search_volume: number;
  rank_absolute: number;
  url: string;
  etv: number;
}

interface RankedKeywordsResponse {
  tasks: {
    status_code: number;
    result: {
      total_count: number;
      items: {
        keyword_data: {
          keyword: string;
          keyword_info: { search_volume: number };
        };
        ranked_serp_element: {
          serp_item: {
            rank_absolute: number;
            relative_url: string;
            etv: number;
          };
        };
      }[];
    }[];
  }[];
}

// Bulk fetch: top ranked keywords across ALL blog pages, with rank changes
export interface BlogKeywordRanking {
  keyword: string;
  search_volume: number;
  rank_absolute: number;
  prev_rank_absolute: number | null;
  is_new: boolean;
  is_up: boolean;
  is_down: boolean;
  url: string;
  handle: string;
  etv: number;
}

interface BulkRankedKeywordsResponse {
  tasks: {
    status_code: number;
    result: {
      total_count: number;
      items_count: number;
      items: {
        keyword_data: {
          keyword: string;
          keyword_info: { search_volume: number };
        };
        ranked_serp_element: {
          serp_item: {
            rank_absolute: number;
            relative_url: string;
            etv: number;
          };
        };
        rank_changes?: {
          previous_rank_absolute: number | null;
          is_new: boolean;
          is_up: boolean;
          is_down: boolean;
        };
      }[];
    }[];
  }[];
}

export async function getTopBlogKeywords(
  limit = 100,
  offset = 0,
): Promise<BlogKeywordRanking[]> {
  const data = await apiPost<BulkRankedKeywordsResponse>(
    "/dataforseo_labs/google/ranked_keywords/live",
    [
      {
        target: "your-domain.com",
        language_name: "English",
        location_code: 2840,
        limit,
        offset,
        filters: [
          "ranked_serp_element.serp_item.relative_url",
          "like",
          "/blog/%",
        ],
        order_by: ["ranked_serp_element.serp_item.etv,desc"],
      },
    ],
  );

  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(`DataForSEO ranked_keywords error: ${task?.status_code}`);
  }

  return (task.result?.[0]?.items ?? []).map((item) => {
    const relUrl = item.ranked_serp_element.serp_item.relative_url;
    const handleMatch = relUrl?.match(/\/blog\/([^/?#]+)/);
    const rc = item.rank_changes;
    return {
      keyword: item.keyword_data.keyword,
      search_volume: item.keyword_data.keyword_info?.search_volume ?? 0,
      rank_absolute: item.ranked_serp_element.serp_item.rank_absolute,
      prev_rank_absolute: rc?.previous_rank_absolute ?? null,
      is_new: rc?.is_new ?? false,
      is_up: rc?.is_up ?? false,
      is_down: rc?.is_down ?? false,
      url: relUrl,
      handle: handleMatch?.[1] ?? "",
      etv: item.ranked_serp_element.serp_item.etv ?? 0,
    };
  });
}

// Paginated: get all top blog keywords (up to maxPages * 100)
export async function getAllTopBlogKeywords(
  maxResults = 500,
): Promise<BlogKeywordRanking[]> {
  const all: BlogKeywordRanking[] = [];
  for (let offset = 0; offset < maxResults; offset += 100) {
    const limit = Math.min(100, maxResults - offset);
    const batch = await getTopBlogKeywords(limit, offset);
    all.push(...batch);
    if (batch.length < limit) break;
  }
  return all;
}

// Get top ranked keywords for a specific blog page slug
export async function getRankedKeywordsForPage(
  blogSlug: string,
  limit = 10,
): Promise<RankedKeyword[]> {
  const data = await apiPost<RankedKeywordsResponse>(
    "/dataforseo_labs/google/ranked_keywords/live",
    [
      {
        target: "your-domain.com",
        language_name: "English",
        location_code: 2840,
        limit,
        filters: [
          "ranked_serp_element.serp_item.relative_url",
          "=",
          `/blog/${blogSlug}`,
        ],
        order_by: ["ranked_serp_element.serp_item.etv,desc"],
      },
    ],
  );

  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) return [];

  return (task.result?.[0]?.items ?? []).map((item) => ({
    keyword: item.keyword_data.keyword,
    search_volume: item.keyword_data.keyword_info?.search_volume ?? 0,
    rank_absolute: item.ranked_serp_element.serp_item.rank_absolute,
    url: item.ranked_serp_element.serp_item.relative_url,
    etv: item.ranked_serp_element.serp_item.etv ?? 0,
  }));
}
