import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  GOOGLE_FONTS_CSS_ORIGIN,
  GOOGLE_FONTS_FILE_ORIGIN,
  GoogleFontError,
  type GoogleFontCatalogFamily,
  type GoogleFontsRuntime,
  assertGoogleFontsUrl,
  filterGoogleFontCatalog,
  isGoogleFontFamilyName,
  parseGoogleFontVariant,
  readBoundedGoogleFontsBody,
  readGoogleFontCatalog,
} from "@agent-native/core/server";

export { GoogleFontError, type GoogleFontsRuntime };

const CSS_ORIGIN = GOOGLE_FONTS_CSS_ORIGIN;
const FONT_ORIGIN = GOOGLE_FONTS_FILE_ORIGIN;
const MAX_CSS_BYTES = 256 * 1024;
export const MAX_GOOGLE_FONT_BYTES = 8 * 1024 * 1024;
export const MAX_GOOGLE_FONT_RESULTS = 24;
const FONT_TIMEOUT_MS = 10_000;
const LEGACY_UA = "Mozilla/5.0";

const FONT_EXTENSIONS = ["ttf", "otf", "woff", "woff2"] as const;
export type GoogleFontExtension = (typeof FONT_EXTENSIONS)[number];

type GoogleFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export type GoogleFontVariant =
  | "regular"
  | "italic"
  | `${GoogleFontWeight}`
  | `${GoogleFontWeight}italic`;

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

type SsrfFetchOptions = Parameters<typeof ssrfSafeFetch>[2];

const defaultRuntime: GoogleFontsRuntime = { fetch: ssrfSafeFetch };

const assertGoogleOrigin = assertGoogleFontsUrl;
const readBoundedBody = readBoundedGoogleFontsBody;

function isLegacyWeight(weight: number): weight is GoogleFontWeight {
  return weight >= 100 && weight <= 900 && weight % 100 === 0;
}

function variantName(
  weight: GoogleFontWeight,
  italic: boolean,
): GoogleFontVariant {
  if (weight === 400) return italic ? "italic" : "regular";
  return italic ? `${weight}italic` : `${weight}`;
}

function legacyVariants(entry: GoogleFontCatalogFamily): GoogleFontVariant[] {
  const variants: GoogleFontVariant[] = [];
  for (const weight of entry.weights) {
    if (isLegacyWeight(weight)) variants.push(variantName(weight, false));
  }
  for (const weight of entry.italicWeights) {
    if (isLegacyWeight(weight)) variants.push(variantName(weight, true));
  }
  return variants;
}

function parseVariant(value: string): GoogleFontVariant | null {
  const parsed = parseGoogleFontVariant(value);
  if (!parsed || !isLegacyWeight(parsed.weight)) return null;
  return variantName(parsed.weight, parsed.italic);
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
  return normalized;
}

export async function searchGoogleFonts(
  query: string,
  runtime: GoogleFontsRuntime = defaultRuntime,
): Promise<GoogleFont[]> {
  const normalized = normalizeQuery(query);
  const families = await readGoogleFontCatalog(runtime);
  return filterGoogleFontCatalog(families, normalized)
    .map((entry) => ({
      family: entry.family,
      category: entry.category,
      variants: legacyVariants(entry),
    }))
    .filter((entry) => entry.variants.length > 0)
    .slice(0, MAX_GOOGLE_FONT_RESULTS);
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
  if (!isGoogleFontFamilyName(family)) {
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
  const entries = await readGoogleFontCatalog(runtime);
  const entry = entries.find((candidate) => candidate.family === family);
  if (!entry || !legacyVariants(entry).includes(normalizedVariant)) {
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
