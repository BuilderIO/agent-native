import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

const CATALOG_URL = "https://fonts.google.com/metadata/fonts";
const CSS_ORIGIN = "https://fonts.googleapis.com";
const FONT_ORIGIN = "https://fonts.gstatic.com";
const CATALOG_TTL_MS = 60 * 60 * 1000;
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const MAX_CSS_BYTES = 256 * 1024;
export const MAX_GOOGLE_FONT_BYTES = 8 * 1024 * 1024;
export const MAX_GOOGLE_FONT_RESULTS = 24;
const MAX_CATALOG_FAMILIES = 20_000;
const FONT_TIMEOUT_MS = 10_000;
const LEGACY_UA = "Mozilla/5.0";

const FONT_EXTENSIONS = ["ttf", "otf", "woff", "woff2"] as const;
export type GoogleFontExtension = (typeof FONT_EXTENSIONS)[number];

export type GoogleFontVariant =
  | "regular"
  | "italic"
  | `${100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900}`
  | `${100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900}italic`;

export type GoogleFont = {
  family: string;
  category: string;
  variants: GoogleFontVariant[];
};

export type DownloadedGoogleFont = {
  data: Buffer;
  extension: GoogleFontExtension;
  mimeType: string;
  family: string;
  variant: GoogleFontVariant;
};

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

type CatalogRecord = GoogleFont & { popularity: number };
let catalogCache: { at: number; entries: CatalogRecord[] } | null = null;
let catalogInflight: Promise<CatalogRecord[]> | null = null;

function assertGoogleOrigin(value: string, origin: string): URL {
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

async function readBoundedBody(
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
    while (true) {
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

function parseVariant(value: string): GoogleFontVariant | null {
  if (value === "regular" || value === "italic") return value;
  if (/^(?:100|200|300|400|500|600|700|800|900)(?:italic)?$/.test(value)) {
    return value as GoogleFontVariant;
  }
  return null;
}

function isGoogleFontFamily(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(value)
  );
}

function parseCatalogEntry(value: unknown): CatalogRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (!isGoogleFontFamily(entry.family)) return null;
  const fonts = entry.fonts;
  if (!fonts || typeof fonts !== "object" || Array.isArray(fonts)) return null;
  const variants = Object.keys(fonts)
    .map(parseVariant)
    .filter((variant): variant is GoogleFontVariant => variant !== null);
  if (variants.length === 0) return null;
  const category =
    typeof entry.category === "string"
      ? entry.category.trim().slice(0, 40)
      : "";
  const popularity =
    typeof entry.popularity === "number" && Number.isFinite(entry.popularity)
      ? entry.popularity
      : Number.MAX_SAFE_INTEGER;
  return {
    family: entry.family,
    category,
    variants: [...new Set(variants)].slice(0, 64),
    popularity,
  };
}

async function loadCatalog(
  runtime: GoogleFontsRuntime,
): Promise<CatalogRecord[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.entries;
  }
  if (catalogInflight) return catalogInflight;

  catalogInflight = (async () => {
    let response: Response;
    try {
      response = await runtime.fetch(
        CATALOG_URL,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(FONT_TIMEOUT_MS),
        },
        {
          httpsOnly: true,
          maxRedirects: 0,
          assertUrlAllowed: (candidate) => {
            assertGoogleOrigin(candidate, new URL(CATALOG_URL).origin);
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
        await readBoundedBody(response, MAX_CATALOG_BYTES),
      );
      const start = text.indexOf("{");
      parsed = JSON.parse(start > 0 ? text.slice(start) : text) as unknown;
    } catch (error) {
      if (error instanceof GoogleFontError) throw error;
      throw new GoogleFontError(
        "Google Fonts returned an invalid catalog.",
        "google_font_catalog_invalid",
        502,
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new GoogleFontError(
        "Google Fonts returned an invalid catalog.",
        "google_font_catalog_invalid",
        502,
      );
    }
    const rawEntries = (parsed as Record<string, unknown>).familyMetadataList;
    if (
      !Array.isArray(rawEntries) ||
      rawEntries.length > MAX_CATALOG_FAMILIES
    ) {
      throw new GoogleFontError(
        "Google Fonts returned an invalid catalog.",
        "google_font_catalog_invalid",
        502,
      );
    }
    const entries = rawEntries
      .map(parseCatalogEntry)
      .filter((entry): entry is CatalogRecord => entry !== null);
    catalogCache = { at: Date.now(), entries };
    return entries;
  })();

  try {
    return await catalogInflight;
  } finally {
    catalogInflight = null;
  }
}

function normalizeQuery(query: string): string {
  const normalized = query.trim();
  if (!normalized || normalized.length > 120) {
    throw new GoogleFontError(
      "Search for a font with a query up to 120 characters.",
      "google_font_query_invalid",
      400,
    );
  }
  return normalized.toLocaleLowerCase();
}

export async function searchGoogleFonts(
  query: string,
  runtime: GoogleFontsRuntime = defaultRuntime,
): Promise<GoogleFont[]> {
  const normalized = normalizeQuery(query);
  const entries = await loadCatalog(runtime);
  return entries
    .filter((entry) => entry.family.toLocaleLowerCase().includes(normalized))
    .sort((left, right) => left.popularity - right.popularity)
    .slice(0, MAX_GOOGLE_FONT_RESULTS)
    .map(({ family, category, variants }) => ({ family, category, variants }));
}

function variantCssStyle(variant: GoogleFontVariant): string {
  if (variant === "regular") return "400";
  if (variant === "italic") return "400italic";
  return variant;
}

function parseFontUrl(css: string): {
  url: string;
  extension: GoogleFontExtension;
} {
  const matches = [
    ...css.matchAll(/url\(\s*(["']?)(https:\/\/[^\s)"']+)\1\s*\)/gi),
  ];
  const accepted: Array<{ url: string; extension: GoogleFontExtension }> = [];
  for (const match of matches) {
    const rawUrl = match[2];
    if (!rawUrl || rawUrl.length > 2_048) continue;
    try {
      const url = assertGoogleOrigin(rawUrl, FONT_ORIGIN);
      if (url.hash) continue;
      const extension = url.pathname.split(".").at(-1)?.toLowerCase() as
        | GoogleFontExtension
        | undefined;
      if (extension && FONT_EXTENSIONS.includes(extension)) {
        accepted.push({ url: url.toString(), extension });
      }
    } catch {
      continue;
    }
  }
  if (accepted.length === 0) {
    throw new GoogleFontError(
      "Google Fonts did not provide a supported font file.",
      "google_font_file_unavailable",
      502,
    );
  }
  return accepted[0]!;
}

function fontMimeType(extension: GoogleFontExtension): string {
  switch (extension) {
    case "otf":
      return "font/otf";
    case "ttf":
      return "font/ttf";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
  }
}

function isAllowedFontFile(
  data: Uint8Array,
  extension: GoogleFontExtension,
  contentType: string,
): boolean {
  const mime = contentType.split(";")[0]?.trim().toLowerCase();
  const acceptedMime = new Set([
    fontMimeType(extension),
    ...(extension === "ttf" ? ["application/x-font-ttf"] : []),
    ...(extension === "otf"
      ? ["application/vnd.ms-opentype", "application/x-font-opentype"]
      : []),
    ...(extension === "woff" ? ["application/font-woff"] : []),
  ]);
  if (mime !== "application/octet-stream" && !acceptedMime.has(mime ?? "")) {
    return false;
  }
  const bytes = Buffer.from(data);
  switch (extension) {
    case "woff2":
      return bytes.toString("ascii", 0, 4) === "wOF2";
    case "woff":
      return bytes.toString("ascii", 0, 4) === "wOFF";
    case "otf":
      return bytes.toString("ascii", 0, 4) === "OTTO";
    case "ttf":
      return (
        bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])) ||
        ["true", "typ1"].includes(bytes.toString("ascii", 0, 4))
      );
  }
}

export async function downloadGoogleFont(
  family: string,
  variant: string,
  runtime: GoogleFontsRuntime = defaultRuntime,
): Promise<DownloadedGoogleFont> {
  if (!isGoogleFontFamily(family)) {
    throw new GoogleFontError(
      "The selected font family is invalid.",
      "google_font_family_invalid",
      400,
    );
  }
  const normalizedVariant = parseVariant(variant);
  if (!normalizedVariant) {
    throw new GoogleFontError(
      "The selected font variant is invalid.",
      "google_font_variant_invalid",
      400,
    );
  }
  const entries = await loadCatalog(runtime);
  const entry = entries.find((candidate) => candidate.family === family);
  if (!entry || !entry.variants.includes(normalizedVariant)) {
    throw new GoogleFontError(
      "The selected font variant is not in the Google Fonts catalog.",
      "google_font_variant_unavailable",
      404,
    );
  }

  const cssUrl = new URL("/css", CSS_ORIGIN);
  cssUrl.searchParams.set(
    "family",
    `${family}:${variantCssStyle(normalizedVariant)}`,
  );
  let cssResponse: Response;
  try {
    cssResponse = await runtime.fetch(
      cssUrl.toString(),
      {
        headers: { Accept: "text/css", "user-agent": LEGACY_UA },
        signal: AbortSignal.timeout(FONT_TIMEOUT_MS),
      },
      {
        httpsOnly: true,
        maxRedirects: 0,
        assertUrlAllowed: (candidate) => {
          assertGoogleOrigin(candidate, CSS_ORIGIN);
        },
      } satisfies SsrfFetchOptions,
    );
  } catch (error) {
    if (error instanceof GoogleFontError) throw error;
    throw new GoogleFontError(
      "The selected Google Font could not be resolved.",
      "google_font_file_unavailable",
      502,
    );
  }
  if (!cssResponse.ok) {
    await cssResponse.body?.cancel();
    throw new GoogleFontError(
      "The selected Google Font could not be resolved.",
      "google_font_file_unavailable",
      502,
    );
  }
  const css = new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundedBody(cssResponse, MAX_CSS_BYTES),
  );
  const resolved = parseFontUrl(css);

  let fontResponse: Response;
  try {
    fontResponse = await runtime.fetch(
      resolved.url,
      {
        headers: { Accept: fontMimeType(resolved.extension) },
        signal: AbortSignal.timeout(FONT_TIMEOUT_MS),
      },
      {
        httpsOnly: true,
        maxRedirects: 0,
        assertUrlAllowed: (candidate) => {
          assertGoogleOrigin(candidate, FONT_ORIGIN);
        },
      } satisfies SsrfFetchOptions,
    );
  } catch (error) {
    if (error instanceof GoogleFontError) throw error;
    throw new GoogleFontError(
      "The selected Google Font could not be downloaded.",
      "google_font_download_failed",
      502,
    );
  }
  if (!fontResponse.ok) {
    await fontResponse.body?.cancel();
    throw new GoogleFontError(
      "The selected Google Font could not be downloaded.",
      "google_font_download_failed",
      502,
    );
  }
  const contentType = fontResponse.headers.get("content-type") ?? "";
  const data = await readBoundedBody(fontResponse, MAX_GOOGLE_FONT_BYTES);
  if (
    !data.length ||
    !isAllowedFontFile(data, resolved.extension, contentType)
  ) {
    throw new GoogleFontError(
      "Google Fonts returned an unsupported font file.",
      "google_font_file_invalid",
      502,
    );
  }
  return {
    data,
    extension: resolved.extension,
    mimeType: fontMimeType(resolved.extension),
    family,
    variant: normalizedVariant,
  };
}
