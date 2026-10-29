import { ssrfSafeFetch } from "../extensions/url-safety.js";

export const GOOGLE_FONTS_CATALOG_URL =
  "https://fonts.google.com/metadata/fonts";
export const GOOGLE_FONTS_CSS_ORIGIN = "https://fonts.googleapis.com";
export const GOOGLE_FONTS_FILE_ORIGIN = "https://fonts.gstatic.com";

const CATALOG_TTL_MS = 60 * 60 * 1000;
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const MAX_CATALOG_FAMILIES = 20_000;
const CATALOG_TIMEOUT_MS = 10_000;

/** One family in Google's public catalog, with the weights it really ships. */
export interface GoogleFontCatalogFamily {
  family: string;
  category: string;
  /** Upright weights, ascending. */
  weights: number[];
  /** Italic weights, ascending. */
  italicWeights: number[];
  /** True when the family is a variable font with a `wght` axis. */
  variable: boolean;
}

export class GoogleFontError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "GoogleFontError";
  }
}

type SsrfFetchOptions = Parameters<typeof ssrfSafeFetch>[2];

export type GoogleFontsRuntime = {
  fetch: typeof ssrfSafeFetch;
};

const defaultRuntime: GoogleFontsRuntime = { fetch: ssrfSafeFetch };

let catalogCache: { at: number; families: GoogleFontCatalogFamily[] } | null =
  null;
let catalogInflight: Promise<GoogleFontCatalogFamily[]> | null = null;

export function assertGoogleFontsUrl(value: string, origin: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GoogleFontError(
      "Google Fonts returned an invalid URL.",
      "google_font_url_invalid",
      502,
    );
  }
  if (
    url.origin !== origin ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new GoogleFontError(
      "Google Fonts returned an unsupported URL.",
      "google_font_url_invalid",
      502,
    );
  }
  return url;
}

export async function readBoundedGoogleFontsBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredSize = Number(contentLength);
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new GoogleFontError(
        "Google Fonts returned a file that is too large.",
        "google_font_response_too_large",
        413,
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new GoogleFontError(
      "Google Fonts returned an empty response.",
      "google_font_response_invalid",
      502,
    );
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new GoogleFontError(
          "Google Fonts returned a file that is too large.",
          "google_font_response_too_large",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = Buffer.allocUnsafe(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Reads a catalog variant key. The live catalog keys faces as `400` / `400i`;
 * the older API spelled them `regular` / `italic` / `700italic`.
 */
export function parseGoogleFontVariant(
  value: string,
): { weight: number; italic: boolean } | null {
  if (value === "regular") return { weight: 400, italic: false };
  if (value === "italic") return { weight: 400, italic: true };
  const match = /^(\d{1,4})(i|italic)?$/.exec(value);
  if (!match) return null;
  const weight = Number(match[1]);
  if (!Number.isInteger(weight) || weight < 1 || weight > 1000) return null;
  return { weight, italic: match.at(2) !== undefined };
}

export function isGoogleFontFamilyName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(value)
  );
}

type CatalogRecord = GoogleFontCatalogFamily & { popularity: number };

function parseCatalogEntry(value: unknown): CatalogRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (!isGoogleFontFamilyName(entry.family)) return null;
  const fonts = entry.fonts;
  if (!fonts || typeof fonts !== "object" || Array.isArray(fonts)) return null;
  const weights = new Set<number>();
  const italicWeights = new Set<number>();
  for (const key of Object.keys(fonts)) {
    const variant = parseGoogleFontVariant(key);
    if (!variant) continue;
    (variant.italic ? italicWeights : weights).add(variant.weight);
  }
  if (weights.size === 0 && italicWeights.size === 0) return null;
  const category =
    typeof entry.category === "string"
      ? entry.category.trim().slice(0, 40)
      : "";
  const popularity =
    typeof entry.popularity === "number" && Number.isFinite(entry.popularity)
      ? entry.popularity
      : Number.MAX_SAFE_INTEGER;
  const variable =
    Array.isArray(entry.axes) &&
    entry.axes.some(
      (axis) =>
        !!axis &&
        typeof axis === "object" &&
        (axis as Record<string, unknown>).tag === "wght",
    );
  const ascending = (left: number, right: number) => left - right;
  return {
    family: entry.family,
    category,
    weights: [...weights].sort(ascending),
    italicWeights: [...italicWeights].sort(ascending),
    variable,
    popularity,
  };
}

function catalogInvalid(): GoogleFontError {
  return new GoogleFontError(
    "Google Fonts returned an invalid catalog.",
    "google_font_catalog_invalid",
    502,
  );
}

async function fetchCatalog(
  runtime: GoogleFontsRuntime,
): Promise<GoogleFontCatalogFamily[]> {
  let response: Response;
  try {
    response = await runtime.fetch(
      GOOGLE_FONTS_CATALOG_URL,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      },
      {
        httpsOnly: true,
        maxRedirects: 0,
        assertUrlAllowed: (candidate) => {
          assertGoogleFontsUrl(
            candidate,
            new URL(GOOGLE_FONTS_CATALOG_URL).origin,
          );
        },
      } satisfies SsrfFetchOptions,
    );
  } catch (error) {
    if (error instanceof GoogleFontError) throw error;
    throw new GoogleFontError(
      "Google Fonts search is temporarily unavailable.",
      "google_font_search_unavailable",
      503,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new GoogleFontError(
      "Google Fonts search is temporarily unavailable.",
      "google_font_search_unavailable",
      503,
    );
  }

  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await readBoundedGoogleFontsBody(response, MAX_CATALOG_BYTES),
    );
    const start = text.indexOf("{");
    parsed = JSON.parse(start > 0 ? text.slice(start) : text) as unknown;
  } catch (error) {
    if (error instanceof GoogleFontError) throw error;
    throw catalogInvalid();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw catalogInvalid();
  }
  const rawEntries = (parsed as Record<string, unknown>).familyMetadataList;
  if (!Array.isArray(rawEntries) || rawEntries.length > MAX_CATALOG_FAMILIES) {
    throw catalogInvalid();
  }
  const records = rawEntries
    .map(parseCatalogEntry)
    .filter((entry): entry is CatalogRecord => entry !== null);
  // A catalog with no usable families is a broken response, not an empty library.
  if (records.length === 0) throw catalogInvalid();
  return records
    .sort((left, right) => left.popularity - right.popularity)
    .map(({ family, category, weights, italicWeights, variable }) => ({
      family,
      category,
      weights,
      italicWeights,
      variable,
    }));
}

/**
 * Google's public font catalog, most popular first. Cached for an hour and
 * shared by concurrent callers; a failure throws `GoogleFontError` and is
 * never cached, so the next call retries.
 */
export async function readGoogleFontCatalog(
  runtime: GoogleFontsRuntime = defaultRuntime,
): Promise<GoogleFontCatalogFamily[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.families;
  }
  if (catalogInflight) return catalogInflight;
  catalogInflight = fetchCatalog(runtime).then((families) => {
    catalogCache = { at: Date.now(), families };
    return families;
  });
  try {
    return await catalogInflight;
  } finally {
    catalogInflight = null;
  }
}

/** Case-insensitive family-name match, keeping catalog (popularity) order. */
export function filterGoogleFontCatalog(
  families: readonly GoogleFontCatalogFamily[],
  query: string,
): GoogleFontCatalogFamily[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...families];
  return families.filter((entry) =>
    entry.family.toLocaleLowerCase().includes(normalized),
  );
}
