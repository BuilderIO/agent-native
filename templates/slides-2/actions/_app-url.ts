import {
  resolveAppRuntimeUrl,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";

const FALLBACK_SLIDES_2_APP_URL = "https://slides-2.agent-native.com";

export function getSlidesAppUrl(): string {
  const baseUrl = resolveAppRuntimeUrl();
  if (!baseUrl) return FALLBACK_SLIDES_2_APP_URL;
  return withConfiguredAppBasePath(baseUrl);
}

export function getDeckUrl(deckId: string): string {
  return `${getSlidesAppUrl()}/deck/${deckId}`;
}

export function getExportUrl(
  filename: string,
  options?: {
    deckId?: string;
    includeNotes?: boolean;
    exportRevision?: string;
  },
): string {
  const url = new URL(
    `${getSlidesAppUrl()}/api/exports/${encodeURIComponent(filename)}`,
  );
  if (options?.deckId) url.searchParams.set("deckId", options.deckId);
  if (options?.includeNotes !== undefined) {
    url.searchParams.set("includeNotes", String(options.includeNotes));
  }
  if (options?.exportRevision) {
    url.searchParams.set("exportRevision", options.exportRevision);
  }
  return url.toString();
}
