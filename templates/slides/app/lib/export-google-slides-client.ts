import { appBasePath } from "@agent-native/core/client/api-path";

import type { AspectRatio } from "./aspect-ratios";
import { buildDeckPptxBlob } from "./export-pptx-client";

interface GoogleSlidesExportSlide {
  id: string;
  notes?: string;
}

export type GoogleSlidesExportResult =
  | { url: string }
  /** Drive was unavailable, so the PPTX was downloaded for a manual import. */
  | { url: null; downloaded: true; reason: string }
  /** The export action should send the user through Google OAuth first. */
  | { url: null; requiresConnection: true; reason: string };

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Creates a native Google Slides deck in the user's Drive when their Google
 * account is connected. A missing connection is returned to the caller so the
 * export action can launch OAuth; other Drive failures still fall back to a
 * manual PPTX import with the reason reported rather than swallowed.
 */
export async function exportDeckToGoogleSlides(
  deckTitle: string,
  slides: GoogleSlidesExportSlide[],
  aspectRatio?: AspectRatio,
): Promise<GoogleSlidesExportResult> {
  const { blob, filename } = await buildDeckPptxBlob(
    deckTitle,
    slides,
    aspectRatio,
  );

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("title", deckTitle);

  const res = await fetch(`${appBasePath()}/api/exports/google-slides`, {
    method: "POST",
    body: form,
  });

  const payload = (await res.json().catch(() => null)) as {
    url?: string;
    error?: string;
    code?: string;
  } | null;

  if (res.ok && payload?.url) return { url: payload.url };

  if (payload?.code === "google-not-connected") {
    return {
      url: null,
      requiresConnection: true,
      reason: payload.error ?? "No connected Google account.",
    };
  }

  triggerBlobDownload(blob, filename);
  return {
    url: null,
    downloaded: true,
    reason: payload?.error ?? `HTTP ${res.status}`,
  };
}
