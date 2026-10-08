import { parseUploadResponse, type ImportResult } from "@/lib/design-import";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";

/** Server fallback and token-free image-hydration ceiling. Browser-local `.fig`
 * imports do not use this raw-file cap. */
export const MAX_FIG_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_FIG_UPLOAD_MB = MAX_FIG_UPLOAD_BYTES / 1024 / 1024;

const FIG_CHUNK_BYTES = 3 * 1024 * 1024;

export type FigUploadValidationError = "invalid-extension" | "too-large";

export function validateFigUploadFile(
  file: Pick<File, "name" | "size">,
  options?: { maxBytes?: number | null },
): FigUploadValidationError | null {
  if (!file.name.toLowerCase().endsWith(".fig")) return "invalid-extension";
  const maxBytes =
    options?.maxBytes === undefined ? MAX_FIG_UPLOAD_BYTES : options.maxBytes;
  if (maxBytes !== null && file.size > maxBytes) return "too-large";
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

function postMultipart<T extends ImportResult>({
  designId,
  file,
  hydrateFileIds,
  fallbackErrorMessage,
  onProgress,
}: {
  designId: string;
  file: File;
  hydrateFileIds?: string[];
  fallbackErrorMessage: string;
  onProgress?: (progress: DesignFileUploadProgress) => void;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("designId", designId);
    if (hydrateFileIds) form.append("hydrateFileIds", hydrateFileIds.join(","));
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
      void parseUploadResponse<T>(
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

class ChunkStorageUnavailableError extends Error {}

async function postFigChunks<T extends ImportResult>({
  designId,
  file,
  hydrateFileIds,
  fallbackErrorMessage,
  onProgress,
}: {
  designId: string;
  file: File;
  hydrateFileIds?: string[];
  fallbackErrorMessage: string;
  onProgress?: (progress: DesignFileUploadProgress) => void;
}): Promise<T> {
  const uploadId = crypto.randomUUID().replace(/-/g, "");
  const total = file.size;
  const chunkCount = Math.ceil(total / FIG_CHUNK_BYTES);
  let last: T | undefined;

  for (let index = 0; index < chunkCount; index++) {
    const start = index * FIG_CHUNK_BYTES;
    const end = Math.min(start + FIG_CHUNK_BYTES, total);
    const isFinal = end === total;
    const params = new URLSearchParams({
      designId,
      uploadId,
      index: String(index),
      isFinal: isFinal ? "1" : "0",
    });
    if (index === 0) {
      params.set("declaredSize", String(total));
      params.set("filename", file.name);
      if (hydrateFileIds) {
        params.set("hydrateFileIds", hydrateFileIds.join(","));
      }
    }

    const response = await fetch(
      `/api/import-design-file?${params.toString()}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(start, end),
      },
    ).catch(() => {
      throw new Error(fallbackErrorMessage);
    });

    const text = await response.text().catch(() => {
      throw new Error(fallbackErrorMessage);
    });
    if (response.status === 503 && /"storageUnavailable":true/.test(text)) {
      throw new ChunkStorageUnavailableError(text);
    }
    last = await parseUploadResponse<T>(
      {
        ok: response.ok,
        status: response.status,
        text: async () => text,
      },
      fallbackErrorMessage,
    );
    if (last?.error) return last;
    onProgress?.({
      loaded: end,
      total,
      percent: Math.min(100, Math.round((end / total) * 100)),
    });
  }

  if (!last) throw new Error(fallbackErrorMessage);
  return last;
}

async function uploadFig<T extends ImportResult>(options: {
  designId: string;
  file: File;
  hydrateFileIds?: string[];
  fallbackErrorMessage: string;
  onProgress?: (progress: DesignFileUploadProgress) => void;
}): Promise<T> {
  if (options.file.size <= MAX_UPLOAD_BYTES) return postMultipart<T>(options);
  try {
    return await postFigChunks<T>(options);
  } catch (error) {
    if (error instanceof ChunkStorageUnavailableError) {
      return postMultipart<T>(options);
    }
    throw error;
  }
}

export function uploadDesignFile(
  options: UploadDesignFileOptions,
): Promise<ImportResult> {
  return uploadFig<ImportResult>(options);
}

export interface FigHydrationResult extends ImportResult {
  importKind?: "fig-hydrate";
  results?: Array<{
    fileId: string;
    resolved: number;
    missing: number;
    skipped: number;
  }>;
  totalResolved?: number;
  totalMissing?: number;
}

export interface HydrateImagesFromFigOptions {
  designId: string;
  file: File;
  fileIds: string[];
  fallbackErrorMessage: string;
  onProgress?: (progress: DesignFileUploadProgress) => void;
}

export function hydrateImagesFromFig({
  fileIds,
  ...options
}: HydrateImagesFromFigOptions): Promise<FigHydrationResult> {
  return uploadFig<FigHydrationResult>({ ...options, hydrateFileIds: fileIds });
}
