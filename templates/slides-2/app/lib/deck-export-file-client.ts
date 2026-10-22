import { appBasePath } from "@agent-native/core/client/api-path";

export interface DeckExportFile {
  blob: Blob;
  filename: string;
}

export function deckExportFallbackFilename(
  deckTitle: string,
  extension: ".html" | ".pptx",
): string {
  const safeTitle = deckTitle.replace(/[^a-zA-Z0-9_-]/g, "-") || "deck";
  return `${safeTitle}${extension}`;
}

function filenameFromDisposition(
  value: string | null,
  fallbackFilename: string,
): string {
  return value?.match(/filename="?([^\"]+)"?/i)?.[1] ?? fallbackFilename;
}

async function fetchDeckExportFile(
  format: "html" | "pptx",
  deckId: string,
  fallbackError: string,
  fallbackFilename: string,
  exportPurpose?: "google_slides",
): Promise<DeckExportFile> {
  const response = await fetch(`${appBasePath()}/api/exports/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deckId,
      ...(format === "pptx" && exportPurpose ? { exportPurpose } : {}),
    }),
  });
  if (!response.ok) {
    // coercion-ok: HTTP status records failure; the optional error body may not be JSON.
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(payload?.error || payload?.message || fallbackError);
  }

  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(
      response.headers.get("content-disposition"),
      fallbackFilename,
    ),
  };
}

export function fetchDeckPptxFromServer(
  deckId: string,
  fallbackError: string,
  exportPurpose?: "google_slides",
  fallbackFilename = "deck.pptx",
): Promise<DeckExportFile> {
  return fetchDeckExportFile(
    "pptx",
    deckId,
    fallbackError,
    fallbackFilename,
    exportPurpose,
  );
}

export function fetchDeckHtmlFromServer(
  deckId: string,
  fallbackError: string,
  fallbackFilename: string,
): Promise<DeckExportFile> {
  return fetchDeckExportFile("html", deckId, fallbackError, fallbackFilename);
}
