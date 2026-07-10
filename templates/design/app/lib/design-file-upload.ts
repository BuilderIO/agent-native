import { parseUploadResponse, type ImportResult } from "@/lib/design-import";

export const MAX_FIG_UPLOAD_BYTES = 50 * 1024 * 1024;

export type FigUploadValidationError = "invalid-extension" | "too-large";

export function validateFigUploadFile(
  file: Pick<File, "name" | "size">,
): FigUploadValidationError | null {
  if (!file.name.toLowerCase().endsWith(".fig")) return "invalid-extension";
  if (file.size > MAX_FIG_UPLOAD_BYTES) return "too-large";
  return null;
}

export interface DesignFileUploadProgress {
  loaded: number;
  total: number;
  percent: number | null;
}

export interface UploadDesignFileOptions {
  designId: string;
  file: File;
  fallbackErrorMessage: string;
  onProgress?: (progress: DesignFileUploadProgress) => void;
}

/**
 * Uploads an import file through the template's authenticated multipart route.
 * XMLHttpRequest is intentional here: unlike fetch, it exposes upload progress
 * for large local .fig files. Keep the route and transport details inside this
 * boundary rather than duplicating them in React components.
 */
export function uploadDesignFile({
  designId,
  file,
  fallbackErrorMessage,
  onProgress,
}: UploadDesignFileOptions): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("designId", designId);
    form.append("file", file, file.name);

    xhr.open(
      "POST",
      `/api/import-design-file?designId=${encodeURIComponent(designId)}`,
      true,
    );
    xhr.withCredentials = true;
    xhr.timeout = 5 * 60 * 1000;

    xhr.upload.addEventListener("progress", (event) => {
      const total = event.lengthComputable ? event.total : 0;
      onProgress?.({
        loaded: event.loaded,
        total,
        percent:
          total > 0
            ? Math.min(100, Math.round((event.loaded / total) * 100))
            : null,
      });
    });

    xhr.addEventListener("load", () => {
      void parseUploadResponse<ImportResult>(
        {
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          text: async () => xhr.responseText,
        },
        fallbackErrorMessage,
      ).then(resolve, reject);
    });
    xhr.addEventListener("error", () =>
      reject(new Error(fallbackErrorMessage)),
    );
    xhr.addEventListener("timeout", () =>
      reject(new Error(fallbackErrorMessage)),
    );
    xhr.addEventListener("abort", () =>
      reject(new Error(fallbackErrorMessage)),
    );
    xhr.send(form);
  });
}
