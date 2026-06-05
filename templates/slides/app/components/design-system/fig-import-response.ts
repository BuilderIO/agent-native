import type { DesignSystemData } from "../../../shared/api";

export interface FigImportResult {
  ok: boolean;
  suggestedTitle: string;
  data: DesignSystemData;
  customInstructions: string;
  preview: {
    gradients: string[];
    palette: { hex: string; name?: string; count: number }[];
    namedColors: Record<string, string>;
    thumbnailDataUrl: string | null;
    nodeCount: number;
    imageCount: number;
  };
}

export const MAX_FIG_UPLOAD_BYTES = 200 * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function summarizeUploadFailure(status: number, bodyText: string): string {
  if (status === 413) {
    return `File too large (max ${formatFileSize(MAX_FIG_UPLOAD_BYTES)}).`;
  }

  const trimmed = bodyText
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (trimmed) {
    return `Upload failed (${status}): ${trimmed.slice(0, 180)}`;
  }
  return `Upload failed (${status})`;
}

export async function readFigImportResponse(
  res: Response,
): Promise<FigImportResult> {
  const bodyText = await res.text();
  let json: unknown = null;

  if (bodyText) {
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(summarizeUploadFailure(res.status, bodyText));
    }
  }

  if (json && typeof json === "object" && "error" in json) {
    const error = (json as { error?: unknown }).error;
    throw new Error(
      typeof error === "string"
        ? error
        : summarizeUploadFailure(res.status, bodyText),
    );
  }

  if (!res.ok) {
    throw new Error(summarizeUploadFailure(res.status, bodyText));
  }

  return json as FigImportResult;
}
