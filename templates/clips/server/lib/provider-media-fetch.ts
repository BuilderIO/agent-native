/**
 * Fetches a recording's stored media from its provider for the same-origin
 * media routes, following redirects only to public addresses.
 */
import {
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
} from "@agent-native/core/extensions/url-safety";

const PROXIED_HEADER_NAMES = [
  "accept-ranges",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;
export const PROVIDER_MEDIA_FETCH_TIMEOUT_MS = 30_000;

export async function fetchProviderMedia(
  sourceUrl: string,
  rangeHeader: string | undefined,
): Promise<Response | { error: string; status: number }> {
  let currentUrl = sourceUrl;
  const dispatcher = (await createSsrfSafeDispatcher()) ?? undefined;

  for (let redirects = 0; redirects <= 4; redirects++) {
    if (await isBlockedExtensionUrlWithDns(currentUrl)) {
      return {
        status: 403,
        error: "Recording media URL points to a private/internal address",
      };
    }

    const headers = new Headers();
    if (rangeHeader?.startsWith("bytes=")) headers.set("Range", rangeHeader);

    const fetchOptions: RequestInit & { dispatcher?: unknown } = {
      headers,
      redirect: "manual",
    };
    if (dispatcher) fetchOptions.dispatcher = dispatcher;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      PROVIDER_MEDIA_FETCH_TIMEOUT_MS,
    );
    let upstream: Response;
    try {
      upstream = await fetch(currentUrl, {
        ...fetchOptions,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (upstream.status < 300 || upstream.status >= 400) return upstream;

    const location = upstream.headers.get("location");
    if (!location) return upstream;
    currentUrl = new URL(location, currentUrl).href;
  }

  return { status: 508, error: "Too many media redirects" };
}

export function providerResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const name of PROXIED_HEADER_NAMES) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }
  headers.set("Cache-Control", "private, max-age=0, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export function statusCodeForProviderFetchError(err: unknown): number {
  if (err instanceof Error && /^SSRF blocked:/i.test(err.message)) return 403;
  if (err instanceof Error && /abort|timeout/i.test(err.name)) return 504;
  return 502;
}

export function messageForProviderFetchError(err: unknown): string {
  if (err instanceof Error && /^SSRF blocked:/i.test(err.message)) {
    return "Recording media URL is blocked by server safety policy.";
  }
  if (err instanceof Error && /abort|timeout/i.test(err.name)) {
    return "Recording media fetch timed out.";
  }
  return "Recording media could not be fetched.";
}
