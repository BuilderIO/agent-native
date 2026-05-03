import { withConfiguredAppBasePath } from "@agent-native/core/server";

const FALLBACK_SLIDES_APP_URL = "https://slides.agent-native.com";

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function configuredBaseUrl(): string | undefined {
  const candidates = [
    process.env.APP_URL,
    process.env.WORKSPACE_GATEWAY_URL,
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

export function getExportUrl(filename: string): string {
  return `${getSlidesAppUrl()}/api/exports/${filename}`;
}
