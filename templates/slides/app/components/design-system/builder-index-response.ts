export interface BuilderIndexResult {
  ok: boolean;
  source: "builder";
  suggestedTitle: string;
  projectId: string;
  jobId: string;
  designSystemId: string;
  builderUrl: string;
  status: "in-progress";
  localDesignSystemId?: string;
  uploadedFileCount?: number;
  instructions?: string;
  builderConnectUrl?: string;
}

export const MAX_BUILDER_INDEX_UPLOAD_BYTES = 512 * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function isHtmlErrorPage(bodyText: string): boolean {
  return /<!doctype\s+html\b|<html\b/i.test(bodyText);
}

function summarizeUploadFailure(
  status: number,
  bodyText: string,
  contentType?: string | null,
): string {
  if (status === 413) {
    return `File too large (max ${formatFileSize(MAX_BUILDER_INDEX_UPLOAD_BYTES)}).`;
  }

  if (
    contentType?.toLowerCase().includes("text/html") ||
    isHtmlErrorPage(bodyText)
  ) {
    return `Upload failed (${status})`;
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

export async function readBuilderIndexResponse(
  res: Response,
): Promise<BuilderIndexResult> {
  const bodyText = await res.text();
  let json: unknown = null;

  if (bodyText) {
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(
        summarizeUploadFailure(
          res.status,
          bodyText,
          res.headers.get("Content-Type"),
        ),
      );
    }
  }

  if (json && typeof json === "object" && "error" in json) {
    const error = (json as { error?: unknown; builderConnectUrl?: unknown })
      .error;
    throw new Error(
      typeof error === "string" && !isHtmlErrorPage(error)
        ? error
        : summarizeUploadFailure(
            res.status,
            typeof error === "string" ? error : bodyText,
            res.headers.get("Content-Type"),
          ),
    );
  }

  if (!res.ok) {
    throw new Error(
      summarizeUploadFailure(
        res.status,
        bodyText,
        res.headers.get("Content-Type"),
      ),
    );
  }

  return json as BuilderIndexResult;
}
