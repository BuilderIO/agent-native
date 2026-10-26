import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

const SVGL_API_ORIGIN = "https://api.svgl.app";
const MAX_RESULTS = 24;
const MAX_SEARCH_RESPONSE_BYTES = 512 * 1024;
export const MAX_SVGL_LOGO_BYTES = 512 * 1024;
const SVGL_TIMEOUT_MS = 10_000;

export type SvglRoute = string | { light: string; dark: string };

export interface SvglLogo {
  id: number;
  title: string;
  category: string | string[];
  route: SvglRoute;
}

export class SvglError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "SvglError";
  }
}

type SsrfFetchOptions = Parameters<typeof ssrfSafeFetch>[2];

export interface SvglRuntime {
  fetch: typeof ssrfSafeFetch;
}

const defaultRuntime: SvglRuntime = { fetch: ssrfSafeFetch };

function assertHttpsHost(value: string, host: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SvglError(
      "The SVGL logo URL is invalid.",
      "svgl_invalid_url",
      400,
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    (url.hostname !== host && !url.hostname.endsWith(`.${host}`))
  ) {
    throw new SvglError(
      "Only HTTPS URLs from the SVGL library are allowed.",
      "svgl_invalid_url",
      400,
    );
  }

  return url;
}

function assertSvglApiUrl(value: string): void {
  const url = assertHttpsHost(value, "api.svgl.app");
  if (url.hostname !== "api.svgl.app") {
    throw new SvglError(
      "The SVGL API redirected to an unsupported host.",
      "svgl_invalid_url",
      400,
    );
  }
}

export function normalizeSvglSvgUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = assertHttpsHost(value, "svgl.app");
    if (
      url.hostname !== "svgl.app" ||
      !url.pathname.toLowerCase().endsWith(".svg") ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    // coercion-ok: Invalid third-party logo URLs become absent and are filtered from search results.
    return null;
  }
}

function normalizeCategory(value: unknown): string | string[] | null {
  if (typeof value === "string") {
    const category = value.trim().slice(0, 80);
    return category || null;
  }
  if (!Array.isArray(value)) return null;
  const categories = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 5);
  return categories.length > 0 ? categories : null;
}

function parseRoute(value: unknown): SvglRoute | null {
  const single = normalizeSvglSvgUrl(value);
  if (single) return single;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const variants = value as Record<string, unknown>;
  const light = normalizeSvglSvgUrl(variants.light);
  const dark = normalizeSvglSvgUrl(variants.dark);
  return light && dark ? { light, dark } : null;
}

function parseLogo(value: unknown): SvglLogo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const route = parseRoute(item.route);
  const category = normalizeCategory(item.category);
  if (
    !Number.isSafeInteger(item.id) ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    !route ||
    !category
  ) {
    return null;
  }
  return {
    id: item.id as number,
    title: item.title.trim().slice(0, 120),
    category,
    route,
  };
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredSize = Number(contentLength);
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new SvglError(
        "The SVGL response exceeded the supported size.",
        "svgl_response_too_large",
        413,
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) {
      throw new SvglError(
        "The SVGL response exceeded the supported size.",
        "svgl_response_too_large",
        413,
      );
    }
    return body;
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
        throw new SvglError(
          "The SVGL response exceeded the supported size.",
          "svgl_response_too_large",
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

async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await readBoundedBody(response, MAX_SEARCH_RESPONSE_BYTES),
    );
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SvglError) throw error;
    throw new SvglError(
      "SVGL returned an invalid search response.",
      "svgl_response_invalid",
      502,
    );
  }
}

function normalizeQuery(query: string): string {
  const normalized = query.trim();
  if (!normalized || normalized.length > 120) {
    throw new SvglError(
      "Search for a logo with a query up to 120 characters.",
      "svgl_invalid_query",
      400,
    );
  }
  return normalized;
}

export async function searchSvglLogos(
  query: string,
  runtime: SvglRuntime = defaultRuntime,
): Promise<SvglLogo[]> {
  const url = new URL(SVGL_API_ORIGIN);
  url.searchParams.set("search", normalizeQuery(query));
  url.searchParams.set("limit", String(MAX_RESULTS));

  let response: Response;
  try {
    response = await runtime.fetch(
      url.toString(),
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(SVGL_TIMEOUT_MS),
      },
      {
        httpsOnly: true,
        maxRedirects: 1,
        assertUrlAllowed: (candidate) => assertSvglApiUrl(candidate),
      } satisfies SsrfFetchOptions,
    );
  } catch (error) {
    if (error instanceof SvglError) throw error;
    throw new SvglError(
      "SVGL logo search is temporarily unavailable.",
      "svgl_search_unavailable",
      503,
    );
  }

  if (response.status === 404) {
    await response.body?.cancel();
    return [];
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SvglError(
      "SVGL logo search is temporarily unavailable.",
      "svgl_search_unavailable",
      response.status === 429 ? 503 : 502,
    );
  }

  const payload = await readJson(response);
  if (!Array.isArray(payload)) {
    throw new SvglError(
      "SVGL returned an invalid search response.",
      "svgl_response_invalid",
      502,
    );
  }
  return payload
    .flatMap((item) => {
      const result = parseLogo(item);
      return result ? [result] : [];
    })
    .slice(0, MAX_RESULTS);
}

export async function fetchSvglLogoSvg(
  route: string,
  runtime: SvglRuntime = defaultRuntime,
): Promise<Buffer> {
  const url = normalizeSvglSvgUrl(route);
  if (!url) {
    throw new SvglError(
      "Choose an SVG logo returned by SVGL.",
      "svgl_invalid_url",
      400,
    );
  }

  let response: Response;
  try {
    response = await runtime.fetch(
      url,
      {
        headers: { Accept: "image/svg+xml" },
        signal: AbortSignal.timeout(SVGL_TIMEOUT_MS),
      },
      {
        httpsOnly: true,
        maxRedirects: 2,
        assertUrlAllowed: (candidate) => {
          if (!normalizeSvglSvgUrl(candidate)) {
            throw new SvglError(
              "The SVGL logo redirected to an unsupported URL.",
              "svgl_invalid_url",
              400,
            );
          }
        },
      },
    );
  } catch (error) {
    if (error instanceof SvglError) throw error;
    throw new SvglError(
      "The SVGL logo could not be downloaded.",
      "svgl_download_failed",
      502,
    );
  }

  if (response.status === 404) {
    await response.body?.cancel();
    throw new SvglError(
      "The selected SVGL logo is no longer available.",
      "svgl_logo_not_found",
      404,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SvglError(
      "The SVGL logo could not be downloaded.",
      "svgl_download_failed",
      502,
    );
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
  if (contentType && contentType !== "image/svg+xml") {
    await response.body?.cancel();
    throw new SvglError(
      "SVGL did not return an SVG logo.",
      "svgl_response_invalid",
      502,
    );
  }

  return readBoundedBody(response, MAX_SVGL_LOGO_BYTES);
}
