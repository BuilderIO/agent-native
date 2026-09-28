import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";

import type { AspectRatio } from "./aspect-ratios";
import { buildDeckPptxBlob } from "./export-pptx-client";
import { retargetPptxForGoogleSlides } from "./pptx-google-slides";

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
): Promise<DeckPptxFile> {
  const res = await fetch(`${appBasePath()}/api/exports/pptx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deckId }),
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
): Promise<GoogleSlidesExportResult> {
  if (!(await googleDriveIsConnected())) {
    return {
      url: null,
      requiresConnection: true,
      reason: "No connected Google account.",
    };
  }

  const { blob, filename } = buildPptx
    ? await buildPptx().then(async (file) => ({
        ...file,
        blob: await retargetPptxForGoogleSlides(file.blob),
      }))
    : await buildDeckPptxBlob(deckTitle, slides, aspectRatio, {
        target: "google-slides",
      });

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
