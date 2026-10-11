import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";

import type { AspectRatio } from "./aspect-ratios";
import { buildDeckPptxBlob } from "./export-pptx-client";
import { retargetPptxForGoogleSlides } from "./pptx-google-slides";
import {
  browserExportErrorType,
  trackBrowserDeckExported,
  type BrowserDeckExportFacts,
} from "./slides-relay-tracking";

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

export interface DeckPptxFile {
  blob: Blob;
  filename: string;
}

async function googleDriveIsConnected(): Promise<boolean> {
  const response = await fetch(
    new URL(
      agentNativePath("/_agent-native/google-docs/status"),
      window.location.origin,
    ),
    { credentials: "same-origin" },
  );
  const payload = (await response.json()) as {
    connected?: boolean;
    error?: string;
    message?: string;
  } | null;
  if (!response.ok || !payload || typeof payload.connected !== "boolean") {
    throw new Error(
      payload?.message ||
        payload?.error ||
        `Could not check Google Drive (${response.status})`,
    );
  }
  return payload.connected === true;
}

export async function fetchDeckPptxFromServer(
  deckId: string,
  fallbackError: string,
  exportPurpose?: "google_slides",
): Promise<DeckPptxFile> {
  const res = await fetch(`${appBasePath()}/api/exports/pptx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deckId,
      ...(exportPurpose ? { exportPurpose } : {}),
    }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(payload?.error || payload?.message || fallbackError);
  }
  const disposition = res.headers.get("content-disposition");
  return {
    blob: await res.blob(),
    filename: disposition?.match(/filename="?([^"]+)"?/i)?.[1] ?? "deck.pptx",
  };
}

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

export async function exportDeckToGoogleSlides(
  deckTitle: string,
  slides: GoogleSlidesExportSlide[],
  aspectRatio?: AspectRatio,
  buildPptx?: () => Promise<DeckPptxFile>,
  analytics?: BrowserDeckExportFacts,
): Promise<GoogleSlidesExportResult> {
  const renderLocation = buildPptx ? "server" : "browser";
  let connected: boolean;
  try {
    connected = await googleDriveIsConnected();
  } catch (error) {
    // No export happened, so this failure is unambiguous and nothing else
    // reports it.
    if (analytics) {
      trackBrowserDeckExported("google_slides", {
        ...analytics,
        slideCount: slides.length,
        renderLocation,
        status: "failed",
        errorType: "connection_check_failed",
      });
    }
    throw error;
  }
  if (!connected) {
    // Same outcome the upload route records when it detects this itself.
    if (analytics) {
      trackBrowserDeckExported("google_slides", {
        ...analytics,
        slideCount: slides.length,
        renderLocation,
        status: "failed",
        errorType: "google_not_connected",
      });
    }
    return {
      url: null,
      requiresConnection: true,
      reason: "No connected Google account.",
    };
  }

  let built: DeckPptxFile;
  try {
    built = buildPptx
      ? await buildPptx().then(async (file) => ({
          ...file,
          blob: await retargetPptxForGoogleSlides(file.blob),
        }))
      : await buildDeckPptxBlob(deckTitle, slides, aspectRatio, {
          target: "google-slides",
        });
  } catch (error) {
    // The upload route reports every export that reaches it.
    if (analytics) {
      trackBrowserDeckExported("google_slides", {
        ...analytics,
        slideCount: slides.length,
        renderLocation,
        status: "failed",
        errorType: browserExportErrorType(error),
      });
    }
    throw error;
  }
  const { blob, filename } = built;

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("title", deckTitle);
  if (analytics?.deckId) {
    form.append("deckId", analytics.deckId);
    form.append("renderLocation", renderLocation);
  }

  // A rejected upload doesn't prove the route never ran (the response can be
  // lost after Drive accepted the file), so it is left to the route's own
  // event; an export with no outcome counts as failed_unknown downstream.
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
