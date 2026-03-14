import fs from "fs";
import path from "path";

const BUILDER_API = "https://builder.io/api/v1";
const BUILDER_CDN_PREFIX = "cdn.builder.io";
const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

// Concurrency limit for parallel image uploads
const MAX_CONCURRENT_UPLOADS = 5;
// Timeout for fetching external images (ms)
const FETCH_TIMEOUT_MS = 20_000;
const BUILDER_UPLOAD_RETRY_DELAYS_MS = [500, 1500];
const BUILDER_UPLOAD_TIMEOUT_MS = 120_000;

export class BuilderUploadError extends Error {
  status: number;
  code: string;
  responseBody: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; responseBody?: string } = {},
  ) {
    super(message);
    this.name = "BuilderUploadError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "builder_upload_failed";
    this.responseBody = options.responseBody ?? "";
  }
}

function summarizeBuilderResponse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Empty response body";

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed?.message === "string") return parsed.message;
    if (typeof parsed?.error === "string") return parsed.error;
    if (typeof parsed?.title === "string") return parsed.title;
  } catch {}

  return trimmed.replace(/\s+/g, " ").slice(0, 300);
}

function getBuilderUploadErrorCode(status: number): string {
  if (status === 400) return "builder_invalid_upload";
  if (status === 401 || status === 403) return "builder_auth_failed";
  if (status === 413) return "builder_file_too_large";
  if (status === 415) return "builder_unsupported_type";
  if (status >= 500) return "builder_upstream_error";
  return "builder_upload_failed";
}

function readBuilderAuthFromDisk(): { apiKey?: string; privateKey?: string } {
  const authFile = path.join(process.cwd(), "content", ".builder-auth.json");

  if (!fs.existsSync(authFile)) {
    throw new Error(
      "Builder connection required to upload media. Please connect your Builder.io account in the app settings.",
    );
  }

  return JSON.parse(fs.readFileSync(authFile, "utf-8"));
}

function resolveBuilderAuth(options?: {
  apiKey?: string;
  privateKey?: string;
}): { apiKey: string; privateKey: string } {
  let apiKey = options?.apiKey;
  let privateKey = options?.privateKey;

  if (!apiKey) apiKey = process.env.BUILDER_API_KEY || undefined;
  if (!privateKey) privateKey = process.env.BUILDER_PRIVATE_KEY || undefined;

  if (!apiKey || !privateKey) {
    const authData = readBuilderAuthFromDisk();
    if (!apiKey) apiKey = authData.apiKey;
    if (!privateKey) privateKey = authData.privateKey;
  }

  if (!apiKey || !privateKey) {
    throw new Error(
      "Invalid Builder authentication data. Please reconnect your account.",
    );
  }

  return { apiKey, privateKey };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeBuilderAssetUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const isBuilderCdnHost = parsed.hostname === BUILDER_CDN_PREFIX;
    if (!isBuilderCdnHost) return url;

    if (parsed.pathname.startsWith("/o/assets/")) {
      parsed.pathname = `/o/${encodeURIComponent(parsed.pathname.slice(3))}`;
      return parsed.toString();
    }
  } catch {
    return url;
  }

  return url;
}

async function parseBuilderUploadResponse(
  response: Response,
): Promise<{ url: string; responseBody: string }> {
  const text = await response.text();
  let data: any = null;

  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  const url = data?.url || data?.[0]?.url || data?.results?.[0]?.url;
  if (!url) {
    throw new BuilderUploadError(
      "Builder upload succeeded but no CDN URL was returned",
      {
        status: 502,
        code: "builder_missing_url",
        responseBody: text,
      },
    );
  }

  return {
    url: normalizeBuilderAssetUrl(url),
    responseBody: text,
  };
}

async function executeBuilderUploadRequest(
  uploadUrl: string,
  requestInit: RequestInit,
  context: {
    filename: string;
    mimeType?: string;
    size?: number;
    sourceUrl?: string;
  },
  retries = 0,
): Promise<string> {
  let lastError: BuilderUploadError | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      BUILDER_UPLOAD_TIMEOUT_MS,
    );

    console.info("[builder-upload] Starting upload", {
      ...context,
      attempt: attempt + 1,
      retries: retries + 1,
      timeoutMs: BUILDER_UPLOAD_TIMEOUT_MS,
    });

    try {
      const response = await fetch(uploadUrl, {
        ...requestInit,
        signal: controller.signal,
      });

      if (response.ok) {
        const { url, responseBody } =
          await parseBuilderUploadResponse(response);
        console.info("[builder-upload] Upload succeeded", {
          ...context,
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          url,
        });
        if (!url) {
          console.error("[builder-upload] Upload succeeded without a URL", {
            ...context,
            response: responseBody,
          });
        }
        return url;
      }

      const text = await response.text();
      const summary = summarizeBuilderResponse(text);
      lastError = new BuilderUploadError(
        `Builder rejected the upload (${response.status}): ${summary}`,
        {
          status: response.status,
          code: getBuilderUploadErrorCode(response.status),
          responseBody: text,
        },
      );

      const shouldRetry = response.status >= 500 && attempt < retries;

      console.error("[builder-upload] Upload failed", {
        ...context,
        status: response.status,
        response: summary,
        attempt: attempt + 1,
        retries: retries + 1,
        durationMs: Date.now() - startedAt,
        retrying: shouldRetry,
      });

      if (!shouldRetry) {
        throw lastError;
      }
    } catch (error) {
      if (error instanceof BuilderUploadError) {
        throw error;
      }

      const isAbortError =
        error instanceof Error && error.name === "AbortError";
      lastError = isAbortError
        ? new BuilderUploadError(
            `Builder upload timed out after ${Math.round(BUILDER_UPLOAD_TIMEOUT_MS / 1000)}s`,
            {
              status: 504,
              code: "builder_upload_timeout",
            },
          )
        : new BuilderUploadError(
            `Builder upload request failed: ${error instanceof Error ? error.message : String(error)}`,
            {
              status: 502,
              code: "builder_upload_request_failed",
              responseBody:
                error instanceof Error ? error.message : String(error),
            },
          );

      const shouldRetry = attempt < retries;

      console.error("[builder-upload] Upload request failed", {
        ...context,
        attempt: attempt + 1,
        retries: retries + 1,
        durationMs: Date.now() - startedAt,
        retrying: shouldRetry,
        code: lastError.code,
        error: lastError.message,
      });

      if (!shouldRetry) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }

    const retryDelay =
      BUILDER_UPLOAD_RETRY_DELAYS_MS[attempt] ??
      BUILDER_UPLOAD_RETRY_DELAYS_MS[
        BUILDER_UPLOAD_RETRY_DELAYS_MS.length - 1
      ] ??
      1500;
    await sleep(retryDelay);
  }

  throw lastError ?? new BuilderUploadError("Builder upload failed");
}

/** Check if a URL is already on Builder CDN */
function isBuilderCdnUrl(url: string): boolean {
  return url.includes(BUILDER_CDN_PREFIX);
}

/** Check if URL is a data URI */
function isDataUri(url: string): boolean {
  return url.startsWith("data:");
}

function getLocalMediaPathname(url: string): string | null {
  if (url.startsWith("/api/projects/") && url.includes("/media/")) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (
      parsed.pathname.startsWith("/api/projects/") &&
      parsed.pathname.includes("/media/")
    ) {
      return parsed.pathname;
    }
  } catch {}

  return null;
}

/** Check if a URL is a local project media URL */
function isLocalMediaUrl(url: string): boolean {
  return getLocalMediaPathname(url) !== null;
}

/** Guess MIME type from URL/filename extension */
function guessMimeType(url: string): string {
  const cleanUrl = url.split("?")[0].split("#")[0];
  const ext = path.extname(cleanUrl).toLowerCase();
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };
  return types[ext] || "image/png";
}

/** Extract a reasonable filename from a URL */
function filenameFromUrl(url: string): string {
  try {
    const cleanUrl = url.split("?")[0].split("#")[0];
    const segments = cleanUrl.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "image";
    // Decode percent-encoded characters and clean up
    const decoded = decodeURIComponent(last);
    return decoded.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  } catch {
    return "image.png";
  }
}

/**
 * Read a local project media file from disk.
 * URL format: /api/projects/<workspace>/<project>/media/<filename>
 */
function readLocalMediaFile(
  url: string,
): { buffer: Buffer; mimeType: string } | null {
  const pathname = getLocalMediaPathname(url);
  if (!pathname) return null;

  // Parse: /api/projects/workspace/project/media/filename
  const match = pathname.match(/^\/api\/projects\/(.+?)\/media\/(.+)$/);
  if (!match) return null;

  const [, projectSlug, filename] = match;
  const safeName = path.basename(filename);
  const filePath = path.join(PROJECTS_DIR, projectSlug, "media", safeName);

  if (!fs.existsSync(filePath)) {
    // Try reading from metadata JSON for the CDN URL fallback
    const metaPath = filePath + ".json";
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        if (meta.url && isBuilderCdnUrl(meta.url)) {
          // Already has a CDN URL in metadata — return null so we use that URL directly
          return null;
        }
      } catch {}
    }
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  const mimeType = guessMimeType(safeName);
  return { buffer, mimeType };
}

/**
 * Look up the CDN URL from a local media file's metadata JSON.
 * Returns the CDN URL if available, null otherwise.
 */
function getCdnUrlFromMetadata(localUrl: string): string | null {
  const pathname = getLocalMediaPathname(localUrl);
  if (!pathname) return null;

  const match = pathname.match(/^\/api\/projects\/(.+?)\/media\/(.+)$/);
  if (!match) return null;

  const [, projectSlug, filename] = match;
  const safeName = path.basename(filename);
  const metaPath = path.join(
    PROJECTS_DIR,
    projectSlug,
    "media",
    `${safeName}.json`,
  );

  if (!fs.existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    if (meta.url && isBuilderCdnUrl(meta.url)) {
      return normalizeBuilderAssetUrl(meta.url);
    }
  } catch {}

  return null;
}

/** Fetch an external image URL and return its buffer */
async function fetchExternalImage(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Builder-Content-Workspace/1.0" },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType =
      response.headers.get("content-type") || guessMimeType(url);
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: contentType.split(";")[0].trim(),
    };
  } catch {
    return null;
  }
}

/** Run async tasks with a concurrency limit */
async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  let i = 0;

  async function runNext(): Promise<void> {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    runNext(),
  );
  await Promise.all(workers);
  return results;
}

export type ReuploadResult = {
  reuploaded: number;
  failed: number;
  skipped: number;
  details: { original: string; cdnUrl?: string; error?: string }[];
};

/**
 * Scan Builder blocks and data for non-CDN image URLs.
 * Download each image and reupload to Builder CDN.
 * Mutates the blocks/data in place, replacing URLs.
 *
 * Non-blocking: individual image failures don't prevent the sync.
 */
export async function reuploadBlockImages(
  blocks: any[],
  data: Record<string, any>,
  options: { apiKey: string; privateKey: string },
): Promise<ReuploadResult> {
  const result: ReuploadResult = {
    reuploaded: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  // Collect all image URLs that need processing
  type ImageRef = {
    url: string;
    apply: (cdnUrl: string) => void;
  };

  const refs: ImageRef[] = [];

  // 1. Scan Image component blocks
  function scanBlocks(blockList: any[]) {
    for (const block of blockList) {
      if (
        block?.component?.name === "Image" &&
        block.component.options?.image
      ) {
        const url = block.component.options.image;
        refs.push({
          url,
          apply: (cdnUrl) => {
            block.component.options.image = cdnUrl;
          },
        });
      }

      if (
        block?.component?.name === "Video" &&
        block.component.options?.video
      ) {
        const url = block.component.options.video;
        refs.push({
          url,
          apply: (cdnUrl) => {
            block.component.options.video = cdnUrl;
          },
        });
      }

      // Scan Text blocks for inline <img> tags
      if (block?.component?.name === "Text" && block.component.options?.text) {
        const text: string = block.component.options.text;
        const imgRegex = /<img\s+[^>]*src="([^"]+)"[^>]*>/g;
        let match: RegExpExecArray | null;
        const replacements: { original: string; url: string }[] = [];

        while ((match = imgRegex.exec(text)) !== null) {
          const imgUrl = match[1];
          replacements.push({ original: match[0], url: imgUrl });
        }

        for (const rep of replacements) {
          refs.push({
            url: rep.url,
            apply: (cdnUrl) => {
              block.component.options.text =
                block.component.options.text.replace(rep.url, cdnUrl);
            },
          });
        }
      }

      // Recurse into child blocks
      if (Array.isArray(block?.children)) {
        scanBlocks(block.children);
      }
    }
  }

  scanBlocks(blocks);

  // 2. Check hero image (data.image)
  if (data.image && typeof data.image === "string") {
    refs.push({
      url: data.image,
      apply: (cdnUrl) => {
        data.image = cdnUrl;
      },
    });
  }

  // 3. Filter to only non-CDN URLs and group duplicate references
  const refsByUrl = new Map<string, ImageRef[]>();
  for (const ref of refs) {
    const url = ref.url?.trim();

    if (!url) {
      result.skipped++;
      continue;
    }
    if (isBuilderCdnUrl(url)) {
      result.skipped++;
      continue;
    }
    if (isDataUri(url)) {
      result.skipped++;
      continue;
    }

    refsByUrl.set(url, [...(refsByUrl.get(url) || []), ref]);
  }

  const toProcess = Array.from(refsByUrl.entries()).map(
    ([url, groupedRefs]) => ({
      url,
      refs: groupedRefs,
    }),
  );

  for (const item of toProcess) {
    if (isLocalMediaUrl(item.url)) {
      const existingCdnUrl = getCdnUrlFromMetadata(item.url);
      if (existingCdnUrl) {
        for (const ref of item.refs) {
          ref.apply(existingCdnUrl);
        }
        result.reuploaded++;
        result.details.push({ original: item.url, cdnUrl: existingCdnUrl });
      }
    }
  }

  const pending = toProcess.filter(
    (item) => !(isLocalMediaUrl(item.url) && getCdnUrlFromMetadata(item.url)),
  );

  if (pending.length === 0) {
    return result;
  }

  console.log(
    `[builder-upload] Reuploading ${pending.length} non-CDN image(s) to Builder CDN…`,
  );

  // 4. Process each unique image URL once
  const tasks = pending.map((item) => async () => {
    try {
      let imageData: { buffer: Buffer; mimeType: string } | null = null;

      if (isLocalMediaUrl(item.url)) {
        imageData = readLocalMediaFile(item.url);
      } else {
        imageData = await fetchExternalImage(item.url);
      }

      if (!imageData) {
        result.failed++;
        result.details.push({
          original: item.url,
          error: "Could not read or fetch image",
        });
        console.warn(`[builder-upload] ⚠ Failed to fetch: ${item.url}`);
        return;
      }

      const filename = filenameFromUrl(item.url);
      const cdnUrl = await uploadBufferToBuilderCDN(
        filename,
        imageData.buffer,
        imageData.mimeType,
        options,
      );

      for (const ref of item.refs) {
        ref.apply(cdnUrl);
      }
      result.reuploaded++;
      result.details.push({ original: item.url, cdnUrl });
      console.log(`[builder-upload] ✓ Reuploaded: ${item.url} → ${cdnUrl}`);
    } catch (err: any) {
      result.failed++;
      result.details.push({
        original: item.url,
        error: err.message || "Upload failed",
      });
      console.warn(
        `[builder-upload] ⚠ Reupload failed for ${item.url}: ${err.message}`,
      );
    }
  });

  await parallelLimit(tasks, MAX_CONCURRENT_UPLOADS);

  console.log(
    `[builder-upload] Reupload complete: ${result.reuploaded} succeeded, ${result.failed} failed, ${result.skipped} skipped`,
  );

  return result;
}

export async function uploadUrlToBuilderCDN(
  filename: string,
  sourceUrl: string,
  options?: { apiKey?: string; privateKey?: string; retries?: number },
): Promise<string> {
  const { apiKey, privateKey } = resolveBuilderAuth(options);
  const uploadUrl = `${BUILDER_API}/upload?apiKey=${apiKey}&name=${encodeURIComponent(filename)}&url=${encodeURIComponent(sourceUrl)}`;

  return executeBuilderUploadRequest(
    uploadUrl,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${privateKey}`,
        Accept: "application/json",
      },
    },
    {
      filename,
      sourceUrl,
    },
    options?.retries ?? 0,
  );
}

export async function uploadBufferToBuilderCDN(
  filename: string,
  buffer: Buffer | Uint8Array,
  mimeType: string,
  options?: { apiKey?: string; privateKey?: string; retries?: number },
): Promise<string> {
  const { apiKey, privateKey } = resolveBuilderAuth(options);
  const uploadUrl = `${BUILDER_API}/upload?apiKey=${apiKey}&name=${encodeURIComponent(filename)}`;
  const resolvedMimeType =
    mimeType === "image/svg+xml" ? "image/svg+xml" : mimeType;

  return executeBuilderUploadRequest(
    uploadUrl,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${privateKey}`,
        Accept: "application/json",
        "Content-Type": resolvedMimeType,
        "Content-Length": buffer.length.toString(),
      },
      body: buffer as unknown as BodyInit,
    },
    {
      filename,
      mimeType: resolvedMimeType,
      size: buffer.length,
    },
    options?.retries ?? 0,
  );
}
