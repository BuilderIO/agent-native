import { resolveSecret } from "@agent-native/core/server";

const GOOGLE_IMAGE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1";
const LOGO_DEV_SEARCH_URL = "https://api.logo.dev/search";
const PROVIDER_TIMEOUT_MS = 15_000;

export interface ImageSearchResult {
  url: string;
  thumbnail: string;
  title: string;
  width?: number;
  height?: number;
}

export interface LogoSearchResult {
  name: string;
  domain: string;
  logoUrl: string;
  source: "logo.dev" | "domain-guess";
}

export interface MediaSearchRuntime {
  resolveSecret: (key: string) => Promise<string | null | undefined>;
  fetch: typeof fetch;
}

const defaultRuntime: MediaSearchRuntime = {
  resolveSecret,
  fetch: (...args) => fetch(...args),
};

function fetchOptions(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  };
}

function normalizedDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/", 1)[0]!
    .replace(/[^a-z0-9.-]/g, "");
}

function logoResult(
  name: string,
  domain: string,
  source: LogoSearchResult["source"],
): LogoSearchResult | null {
  const normalized = normalizedDomain(domain);
  if (!normalized || !normalized.includes(".")) return null;
  return {
    name: name.trim() || normalized.split(".")[0] || normalized,
    domain: normalized,
    logoUrl: `https://cdn.brandfetch.io/${normalized}/logo.png`,
    source,
  };
}

function guessedLogoDomains(query: string): LogoSearchResult[] {
  const normalized = normalizedDomain(query);
  if (normalized.includes(".")) {
    const result = logoResult(
      normalized.split(".")[0] ?? normalized,
      normalized,
      "domain-guess",
    );
    return result ? [result] : [];
  }

  const compact = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dashed = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!compact) return [];

  const candidates = [
    ...["com", "io", "co", "dev", "org", "net"].map(
      (tld) => `${compact}.${tld}`,
    ),
    ...(dashed && dashed !== compact ? [`${dashed}.com`] : []),
  ];
  return candidates.flatMap((domain) => {
    const result = logoResult(query, domain, "domain-guess");
    return result ? [result] : [];
  });
}

export async function searchProviderImages(
  query: string,
  count = 10,
  runtime: MediaSearchRuntime = defaultRuntime,
): Promise<ImageSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("Image search requires a query.");

  const [apiKey, searchEngineId] = await Promise.all([
    runtime.resolveSecret("GOOGLE_API_KEY"),
    runtime.resolveSecret("GOOGLE_SEARCH_CX"),
  ]);
  if (!apiKey || !searchEngineId) {
    throw new Error(
      "Google Search not configured. Save GOOGLE_API_KEY and GOOGLE_SEARCH_CX in settings.",
    );
  }

  const params = new URLSearchParams({
    key: apiKey,
    cx: searchEngineId,
    q: normalizedQuery,
    searchType: "image",
    num: String(Math.max(1, Math.min(Math.floor(count), 10))),
    safe: "active",
  });
  const response = await runtime.fetch(
    `${GOOGLE_IMAGE_SEARCH_URL}?${params}`,
    fetchOptions(),
  );
  if (!response.ok) {
    throw new Error(`Google image search failed (${response.status}).`);
  }

  const data = (await response.json()) as {
    items?: Array<{
      link?: unknown;
      title?: unknown;
      image?: {
        width?: unknown;
        height?: unknown;
        thumbnailLink?: unknown;
      };
    }>;
  };
  return (data.items ?? []).flatMap((item) => {
    if (typeof item.link !== "string" || !item.link) return [];
    const thumbnail =
      typeof item.image?.thumbnailLink === "string"
        ? item.image.thumbnailLink
        : item.link;
    return [
      {
        url: item.link,
        thumbnail,
        title: typeof item.title === "string" ? item.title : "Untitled image",
        ...(typeof item.image?.width === "number"
          ? { width: item.image.width }
          : {}),
        ...(typeof item.image?.height === "number"
          ? { height: item.image.height }
          : {}),
      },
    ];
  });
}

export async function searchProviderLogos(
  query: string,
  runtime: MediaSearchRuntime = defaultRuntime,
): Promise<LogoSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("Logo search requires a query.");

  const secretKey = await runtime.resolveSecret("LOGO_DEV_SECRET_KEY");
  if (secretKey?.startsWith("sk_")) {
    try {
      const url = new URL(LOGO_DEV_SEARCH_URL);
      url.searchParams.set("q", normalizedQuery);
      const response = await runtime.fetch(
        url,
        fetchOptions({
          headers: { Authorization: `Bearer ${secretKey}` },
        }),
      );
      if (response.ok) {
        const data = (await response.json()) as Array<{
          name?: unknown;
          domain?: unknown;
        }>;
        const results = data.flatMap((item) => {
          if (typeof item.domain !== "string") return [];
          const result = logoResult(
            typeof item.name === "string" ? item.name : normalizedQuery,
            item.domain,
            "logo.dev",
          );
          return result ? [result] : [];
        });
        if (results.length > 0) return results;
      }
    } catch {
      // The deterministic domain fallback keeps the UI usable during provider outages.
    }
  }

  return guessedLogoDomains(normalizedQuery);
}

export async function getLogoProviderConfig(
  runtime: MediaSearchRuntime = defaultRuntime,
) {
  const [brandfetchId, logoDevToken, logoDevSecret] = await Promise.all([
    runtime.resolveSecret("BRANDFETCH_CLIENT_ID"),
    runtime.resolveSecret("LOGO_DEV_TOKEN"),
    runtime.resolveSecret("LOGO_DEV_SECRET_KEY"),
  ]);
  return {
    brandfetchId: brandfetchId || null,
    logoDevToken: logoDevToken?.startsWith("pk_") ? logoDevToken : null,
    hasLogoDevSecret: logoDevSecret?.startsWith("sk_") === true,
  };
}
