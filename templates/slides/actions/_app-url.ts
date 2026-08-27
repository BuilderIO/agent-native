import {
  getAppUrl,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";

const FALLBACK_SLIDES_APP_URL = "https://slides.agent-native.com";

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function configuredBaseUrl(): string | undefined {
  const candidates = [
    process.env.WORKSPACE_GATEWAY_URL,
    process.env.APP_URL,
    process.env.URL,
    process.env.DEPLOY_URL,
    process.env.BETTER_AUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ];

  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    return normalizeUrl(candidate);
  }

  return undefined;
}

export function getSlidesAppUrl(): string {
  const baseUrl = configuredBaseUrl();
  if (!baseUrl) return FALLBACK_SLIDES_APP_URL;
  return withConfiguredAppBasePath(baseUrl);
}

export function getDeckUrl(deckId: string): string {
  return `${getSlidesAppUrl()}/deck/${deckId}`;
}

/**
 * Canonical URL for a signed-in person opening a deck. HTTP action calls use
 * the framework's request-aware resolver so mounted and self-hosted apps keep
 * their actual public origin; non-request callers retain the legacy fallback.
 */
export function getDeckAppUrl(
  deckId: string,
  requestHeaders?: Headers,
): string {
  if (!requestHeaders) return getDeckUrl(deckId);
  return getAppUrl(
    { req: { headers: requestHeaders } } as never,
    `/deck/${deckId}`,
  );
}

export function getExportUrl(filename: string): string {
  return `${getSlidesAppUrl()}/api/exports/${filename}`;
}
