import {
  getGoogleServiceAccountToken,
  readServiceAccountIdentity,
} from "./google-analytics";

const API_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const WEBMASTERS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";
/** The Search Analytics API's largest page. */
const PAGE_SIZE = 25_000;

export type SearchAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
};

export type SearchAnalyticsRequest = {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  /** RE2 pattern the page URL must match. */
  pageRegex?: string;
  maxRows: number;
  signal?: AbortSignal;
};

async function noAccess(siteUrl: string, detail: string): Promise<Error> {
  const identity = await readServiceAccountIdentity();
  const who =
    identity.status === "ok" ? identity.email : "the Analytics service account";
  return Object.assign(
    new Error(
      `Search Console denied ${who} access to ${siteUrl}. A property owner adds it under Settings → Users and permissions, and the Search Console API must be enabled on its Google Cloud project. (${detail})`,
    ),
    { errorCode: "search_console_no_access", statusCode: 424 },
  );
}

/**
 * Every row of one Search Analytics query, paged by `startRow`. Throws once
 * `maxRows` is passed rather than returning a partial result.
 */
export async function querySearchAnalytics(
  request: SearchAnalyticsRequest,
): Promise<SearchAnalyticsRow[]> {
  const token = await getGoogleServiceAccountToken(WEBMASTERS_READONLY_SCOPE);
  const url = `${API_BASE}/sites/${encodeURIComponent(request.siteUrl)}/searchAnalytics/query`;
  const rows: SearchAnalyticsRow[] = [];
  for (let startRow = 0; ; startRow += PAGE_SIZE) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: request.startDate,
        endDate: request.endDate,
        dimensions: request.dimensions,
        type: "web",
        dataState: "final",
        rowLimit: PAGE_SIZE,
        startRow,
        ...(request.pageRegex
          ? {
              dimensionFilterGroups: [
                {
                  filters: [
                    {
                      dimension: "page",
                      operator: "includingRegex",
                      expression: request.pageRegex,
                    },
                  ],
                },
              ],
            }
          : {}),
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (res.status === 403) {
      throw await noAccess(
        request.siteUrl,
        `HTTP 403: ${(await res.text()).slice(0, 300)}`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `Search Console API error ${res.status} for ${request.siteUrl}: ${(await res.text()).slice(0, 500)}`,
      );
    }
    const page = (await res.json()) as { rows?: SearchAnalyticsRow[] };
    const pageRows = page.rows ?? [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return rows;
    if (rows.length >= request.maxRows) {
      throw new Error(
        `Search Console returned more than ${request.maxRows} rows for ${request.siteUrl}; the read would be incomplete.`,
      );
    }
  }
}
