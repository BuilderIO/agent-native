import type {
  FileUploadProvider,
  FileUploadInput,
  FileUploadResult,
  ResumableUploadSession,
  ResumableChunkResult,
} from "./types.js";

const DEFAULT_BUILDER_APP_HOST = "https://builder.io";

/** Files larger than this are routed through the GCS signed-URL flow. */
const LARGE_FILE_THRESHOLD_BYTES = 30 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120_000;
// A flat 2-minute abort kills slow-but-progressing uploads: a 136MB screen
// recording on a ~2 Mbit/s uplink legitimately needs >10 minutes and used to
// die with "This operation was aborted" mid-PUT. Body-carrying requests scale
// the window with payload size (budgeting ~0.1 MB/s) so the timeout only
// catches genuinely hung connections; metadata calls keep the flat timeout.
const UPLOAD_TIMEOUT_PER_MB_MS = 10_000;
const UPLOAD_TIMEOUT_MAX_MS = 30 * 60_000;
const SMALL_FILE_RETRY_DELAYS_MS = [600, 1800];

function uploadTimeoutForBytes(byteLength: number): number {
  const scaled =
    UPLOAD_TIMEOUT_MS + (byteLength / (1024 * 1024)) * UPLOAD_TIMEOUT_PER_MB_MS;
  return Math.min(UPLOAD_TIMEOUT_MAX_MS, Math.round(scaled));
}

function builderUploadHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    DEFAULT_BUILDER_APP_HOST
  );
}

function makeBody(bytes: Uint8Array, mimeType: string): BodyInit {
  return typeof Blob !== "undefined"
    ? new Blob([bytes as unknown as BlobPart], { type: mimeType })
    : (bytes as unknown as BodyInit);
}

function shouldUseSignedUrlUpload(
  bytes: Uint8Array,
  mimeType: string,
): boolean {
  return (
    bytes.byteLength > LARGE_FILE_THRESHOLD_BYTES || /^video\//i.test(mimeType)
  );
}

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * PUT a large body over node:https instead of fetch.
 *
 * Node's fetch (undici) enforces a ~300s headers timeout by default, and for
 * a signed-URL PUT the response headers only arrive after the entire body has
 * been uploaded — so any upload slower than ~5 minutes dies with a bare
 * "fetch failed" (observed: a 165MB recording on a ~2 Mbit/s uplink failing
 * at 5.5 minutes despite the scaled abort budget below allowing 30). The raw
 * node:https request has no per-phase deadline; the scaled timeout here is
 * the only guard. Falls back to fetch on runtimes without node:https.
 */
async function putLargeBody(
  uploadUrl: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
  mimeType: string,
  timeoutMs: number,
): Promise<Response> {
  let nodeHttp: typeof import("node:http") | null = null;
  let nodeHttps: typeof import("node:https") | null = null;
  try {
    nodeHttp = await import("node:http");
    nodeHttps = await import("node:https");
  } catch {
    nodeHttp = null;
    nodeHttps = null;
  }
  if (!nodeHttp || !nodeHttps) {
    return fetchWithTimeout(
      uploadUrl,
      { method: "PUT", headers, body: makeBody(bytes, mimeType) },
      timeoutMs,
    );
  }
  const target = new URL(uploadUrl);
  const lib = target.protocol === "http:" ? nodeHttp : nodeHttps;
  const headerEntries = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() !== "content-length",
  );
  if (!headerEntries.some(([key]) => key.toLowerCase() === "content-type")) {
    headerEntries.push(["Content-Type", mimeType]);
  }
  headerEntries.push(["Content-Length", String(bytes.byteLength)]);
  return new Promise<Response>((resolve, reject) => {
    const req = lib.request(
      target,
      { method: "PUT", headers: Object.fromEntries(headerEntries) },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 500;
          const nullBody = status === 204 || status === 205 || status === 304;
          resolve(
            new Response(nullBody ? null : Buffer.concat(chunks), {
              status,
              headers: Object.fromEntries(
                Object.entries(res.headers).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === "string",
                ),
              ),
            }),
          );
        });
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => {
      req.destroy(
        new Error(
          `GCS upload timed out after ${Math.round(timeoutMs / 1000)}s`,
        ),
      );
    }, timeoutMs);
    req.on("response", () => clearTimeout(timer));
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end(
      Buffer.from(
        bytes.buffer as ArrayBuffer,
        bytes.byteOffset,
        bytes.byteLength,
      ),
    );
  });
}

function setStableUrlQueryParam(url: URL): void {
  // Stable URLs let Builder compress asynchronously without changing the media URL.
  url.searchParams.set("stableUrl", "true");
}

function setRecordAssetQueryParam(
  url: URL,
  recordAsset: boolean | undefined,
): void {
  if (recordAsset === false) {
    url.searchParams.set("record", "false");
  }
}

async function assertOk(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${label} (${res.status}): ${body || res.statusText}`);
  }
}

// GCS requires non-final resumable chunks to be multiples of 256 KiB.
const RESUMABLE_FINALIZE_CHUNK_BYTES = 8 * 1024 * 1024;

/** Open a GCS resumable session for a Builder signed upload. */
async function startResumableGcsSession(
  privateKey: string,
  filename: string,
  mimeType: string,
  maxBytes: number,
): Promise<{ sessionUri: string; assetId: string }> {
  const { uploadUrl, assetId, requiredHeaders } = await requestBuilderSignedUrl(
    privateKey,
    filename,
    mimeType,
    maxBytes,
    true,
  );
  const initHeaders: Record<string, string> = {
    "Content-Type": mimeType,
    "x-goog-resumable": "start",
  };
  const contentLengthRange = requiredHeaders?.["x-goog-content-length-range"];
  if (contentLengthRange)
    initHeaders["x-goog-content-length-range"] = contentLengthRange;

  const initRes = await fetchWithTimeout(uploadUrl, {
    method: "POST",
    headers: initHeaders,
    body: new Uint8Array(0),
  });
  if (!initRes.ok) {
    const body = await initRes.text().catch(() => "");
    throw new Error(
      `GCS resumable session initiation failed (${initRes.status}): ${body}`,
    );
  }
  const sessionUri = initRes.headers.get("location");
  if (!sessionUri)
    throw new Error(
      "GCS did not return a Location header for the resumable session",
    );
  return { sessionUri, assetId };
}

/**
 * PUT one resumable chunk with bounded time and transient-error retries.
 * 308 means "chunk accepted, more expected"; 2xx closes the object.
 */
async function relayResumableChunk(
  sessionUri: string,
  contentRange: string,
  bytes: Uint8Array,
  options?: { mimeType?: string },
): Promise<ResumableChunkResult> {
  const MAX_ATTEMPTS = 4;
  const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
  const delayMs = (attempt: number) => Math.min(2000, 300 * 2 ** (attempt - 1));

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const headers: Record<string, string> = {
        "Content-Range": contentRange,
      };
      if (options?.mimeType) headers["Content-Type"] = options.mimeType;
      const res = await fetchWithTimeout(
        sessionUri,
        {
          method: "PUT",
          headers,
          body: bytes as unknown as BodyInit,
        },
        uploadTimeoutForBytes(bytes.byteLength),
      );
      if (res.status === 308 || res.ok)
        return { ok: true, status: res.status } satisfies ResumableChunkResult;
      if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
        await res.text().catch(() => "");
        console.warn(
          `[builder-resumable] transient ${res.status} on attempt ${attempt}, retrying`,
        );
        await new Promise((r) => setTimeout(r, delayMs(attempt)));
        continue;
      }
      return { ok: false, status: res.status } satisfies ResumableChunkResult;
    } catch (err) {
      lastError = err;
      if (attempt >= MAX_ATTEMPTS) break;
      console.warn(
        `[builder-resumable] network error on attempt ${attempt}:`,
        err instanceof Error ? err.message : String(err),
      );
      await new Promise((r) => setTimeout(r, delayMs(attempt)));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("GCS PUT failed after retries");
}

async function uploadLargeFileViaSignedUrl(
  input: FileUploadInput,
  privateKey: string,
  bareMimeType: string,
  bytes: Uint8Array,
): Promise<FileUploadResult> {
  const name = input.filename ?? "upload";
  const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1);

  console.log(
    `[builder-upload] large-file path: ${name} ${mb}MB ${bareMimeType}`,
  );

  // Chunked resumable upload instead of one monolithic PUT. A single PUT of a
  // multi-hundred-MB recording is all-or-nothing: on a slow or flaky uplink
  // one stall anywhere in a 10-30 minute transfer kills the whole finalize
  // (observed: a 73MB upload dying at its 849s budget on a ~0.7 Mbit/s day).
  // Resumable chunks bound each request to ~8MB with per-chunk retries, so a
  // transient stall costs one chunk, not the transfer.
  const total = bytes.byteLength;
  let session: { sessionUri: string; assetId: string } | null = null;
  try {
    session = await startResumableGcsSession(
      privateKey,
      name,
      bareMimeType,
      total,
    );
  } catch (err) {
    console.warn(
      `[builder-upload] resumable session unavailable, falling back to single PUT:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (session) {
    const { sessionUri, assetId } = session;
    const chunkCount = Math.ceil(total / RESUMABLE_FINALIZE_CHUNK_BYTES);
    console.log(
      `[builder-upload] step 2 [${assetId}]: resumable PUT ${mb}MB in ${chunkCount} chunks`,
    );
    for (
      let offset = 0;
      offset < total;
      offset += RESUMABLE_FINALIZE_CHUNK_BYTES
    ) {
      const end = Math.min(offset + RESUMABLE_FINALIZE_CHUNK_BYTES, total);
      const result = await relayResumableChunk(
        sessionUri,
        `bytes ${offset}-${end - 1}/${total}`,
        bytes.subarray(offset, end),
        { mimeType: bareMimeType },
      );
      if (!result.ok) {
        throw new Error(
          `GCS upload failed (${result.status}) at bytes ${offset}-${end - 1}/${total}`,
        );
      }
      const chunkIndex =
        Math.floor(offset / RESUMABLE_FINALIZE_CHUNK_BYTES) + 1;
      if (chunkIndex % 5 === 0 || end === total) {
        console.log(
          `[builder-upload] step 2 [${assetId}]: ${chunkIndex}/${chunkCount} chunks (${((end / total) * 100).toFixed(0)}%)`,
        );
      }
    }
    console.log(`[builder-upload] step 2 ok [${assetId}]: resumable complete`);
    console.log(
      `[builder-upload] step 3: registering asset - ${assetId}, ${input.filename}`,
    );
    const { url, id } = await completeBuilderUpload(
      privateKey,
      assetId,
      input.filename,
      { stableUrl: input.stableUrl, recordAsset: input.recordAsset },
    );
    console.log(`[builder-upload] done [${assetId}]: ${url}`);
    return { url, id, provider: "builder" };
  }

  // Fallback — single signed-URL PUT (kept for providers/responses without
  // resumable support).
  console.log(`[builder-upload] step 1: requesting signed URL`);
  const { uploadUrl, assetId, requiredHeaders } = await requestBuilderSignedUrl(
    privateKey,
    name,
    bareMimeType,
    bytes.byteLength,
  );
  console.log(`[builder-upload] step 1 ok: assetId=${assetId}`);

  // Step 2 — PUT bytes directly to GCS. Only requiredHeaders; no Authorization
  // (signed URL carries its own auth — extra signed headers break the signature).
  console.log(`[builder-upload] step 2 [${assetId}]: PUT ${mb}MB to GCS`);
  const step2Res = await putLargeBody(
    uploadUrl,
    requiredHeaders,
    bytes,
    bareMimeType,
    uploadTimeoutForBytes(bytes.byteLength),
  );
  await assertOk(step2Res, "GCS upload failed");
  console.log(
    `[builder-upload] step 2 ok [${assetId}]: GCS ${step2Res.status} etag=${step2Res.headers.get("etag") ?? "none"}`,
  );

  // Step 3 — register the asset and get the CDN URL.
  console.log(
    `[builder-upload] step 3: registering asset - ${assetId}, ${input.filename}`,
  );
  const { url, id } = await completeBuilderUpload(
    privateKey,
    assetId,
    input.filename,
    {
      stableUrl: input.stableUrl,
      recordAsset: input.recordAsset,
    },
  );
  console.log(`[builder-upload] done [${assetId}]: ${url}`);
  return { url, id, provider: "builder" };
}

async function requestBuilderSignedUrl(
  privateKey: string,
  filename: string,
  mimeType: string,
  size: number,
  resumable = false,
): Promise<{
  uploadUrl: string;
  assetId: string;
  requiredHeaders: Record<string, string>;
}> {
  const host = builderUploadHost();
  const url = new URL("/api/v1/upload/signed-url", host);
  const res = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${privateKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: filename,
      contentType: mimeType,
      size,
      resumable,
    }),
  });
  await assertOk(res, "Builder.io signed-URL request failed");
  const json = (await res.json()) as {
    uploadUrl?: string;
    assetId?: string;
    requiredHeaders?: Record<string, string>;
  };
  if (!json.uploadUrl || !json.assetId || !json.requiredHeaders) {
    throw new Error(
      `Builder.io signed-URL response missing required fields: ${JSON.stringify(Object.keys(json))}`,
    );
  }
  return {
    uploadUrl: json.uploadUrl,
    assetId: json.assetId,
    requiredHeaders: json.requiredHeaders,
  };
}

async function completeBuilderUpload(
  privateKey: string,
  assetId: string,
  filename: string | undefined,
  options?: { stableUrl?: boolean; recordAsset?: boolean },
): Promise<{ url: string; id?: string }> {
  const host = builderUploadHost();
  const url = new URL("/api/v1/upload/complete", host);
  if (options?.stableUrl) {
    setStableUrlQueryParam(url);
  }
  setRecordAssetQueryParam(url, options?.recordAsset);
  const res = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${privateKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assetId,
      name: filename,
      ...(options?.recordAsset === false ? { record: false } : {}),
    }),
  });
  await assertOk(res, "Builder.io upload complete failed");
  const json = (await res.json()) as { url?: string; id?: string };
  if (!json.url) throw new Error("Builder.io upload/complete returned no URL");
  return { url: json.url, id: json.id };
}

// Retry transient 5xx once with backoff. Builder.io's upload service
// occasionally returns a bodyless 500 ("Internal Error") on the first
// attempt — usually GCS write hiccups that succeed on retry.
async function uploadSmallFile(
  url: URL,
  init: RequestInit,
  byteLength: number,
): Promise<Response> {
  let response: Response | null = null;
  let lastErrorBody = "";

  for (
    let attempt = 0;
    attempt <= SMALL_FILE_RETRY_DELAYS_MS.length;
    attempt++
  ) {
    const retryDelay = SMALL_FILE_RETRY_DELAYS_MS[attempt]; // undefined on last attempt
    try {
      response = await fetchWithTimeout(
        url.toString(),
        init,
        uploadTimeoutForBytes(byteLength),
      );
    } catch (err) {
      if (!retryDelay) throw err;
      await new Promise((r) => setTimeout(r, retryDelay));
      continue;
    }
    if (response.ok) return response;
    lastErrorBody = await response.text().catch(() => "");
    const isTransient = response.status >= 500 && response.status !== 501;
    if (!isTransient || !retryDelay) break;
    await new Promise((r) => setTimeout(r, retryDelay));
  }

  const status = response?.status ?? 0;
  const statusText = response?.statusText ?? "no response";
  throw new Error(
    `Builder.io upload failed (${status}): ${lastErrorBody || statusText}`,
  );
}

/**
 * Built-in Builder.io file upload provider.
 * Uses the same BUILDER_PRIVATE_KEY as the browser/background-agent flows,
 * so connecting Builder once (via the sidebar "Connect Builder" action)
 * automatically enables file uploads.
 *
 * Upload API: https://www.builder.io/c/docs/upload-api
 */
export const builderFileUploadProvider: FileUploadProvider = {
  id: "builder",
  name: "Builder.io",
  isConfigured: () => !!process.env.BUILDER_PRIVATE_KEY,
  upload: async (input: FileUploadInput) => {
    const { data, filename, mimeType } = input;
    const { resolveBuilderPrivateKey } =
      await import("../server/credential-provider.js");
    const privateKey = await resolveBuilderPrivateKey();
    if (!privateKey) {
      throw new Error("BUILDER_PRIVATE_KEY is not set");
    }

    // Strip any media-type parameters (e.g. `;codecs=avc1,opus` from
    // MediaRecorder blobs) — Builder's upload API parses the body as raw
    // binary only when Content-Type is a bare MIME type. A parameterized
    // Content-Type falls through to the multipart/base64 paths which look
    // for an `image` field, and returns "No image specified" when it
    // doesn't find one.
    const bareMimeType = (mimeType || "application/octet-stream")
      .split(";")[0]
      .trim();

    const bytes =
      data instanceof Uint8Array ? data : new Uint8Array(data as any);
    const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1);

    if (shouldUseSignedUrlUpload(bytes, bareMimeType)) {
      return uploadLargeFileViaSignedUrl(
        input,
        privateKey,
        bareMimeType,
        bytes,
      );
    }

    console.log(
      `[builder-upload] small-file path: ${filename ?? "upload"} ${mb}MB ${bareMimeType}`,
    );

    const url = new URL("/api/v1/upload", builderUploadHost());
    if (filename) url.searchParams.set("name", filename);
    if (input.stableUrl) {
      setStableUrlQueryParam(url);
    }
    setRecordAssetQueryParam(url, input.recordAsset);

    const response = await uploadSmallFile(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${privateKey}`,
          "Content-Type": bareMimeType,
        },
        body: makeBody(bytes, bareMimeType),
      },
      bytes.byteLength,
    );

    const json = (await response.json().catch(() => ({}))) as {
      url?: string;
      id?: string;
    };
    if (!json.url) throw new Error("Builder.io upload returned no URL");

    console.log(`[builder-upload] done: ${json.url}`);
    return { url: json.url, id: json.id, provider: "builder" };
  },

  resumable: {
    async startSession(filename, mimeType, maxBytes) {
      const { resolveBuilderPrivateKey } =
        await import("../server/credential-provider.js");
      const privateKey = await resolveBuilderPrivateKey();
      if (!privateKey) throw new Error("BUILDER_PRIVATE_KEY is not set");

      console.log(
        `[builder-resumable] starting session: ${filename} ${mimeType} ${maxBytes} bytes`,
      );
      const { sessionUri, assetId } = await startResumableGcsSession(
        privateKey,
        filename,
        mimeType,
        maxBytes,
      );
      console.log(`[builder-resumable] session ready: assetId=${assetId}`);
      return {
        sessionId: sessionUri,
        meta: { assetId, filename, mimeType },
      } satisfies ResumableUploadSession;
    },

    async relayChunk(session, contentRange, bytes, options) {
      return relayResumableChunk(
        session.sessionId,
        contentRange,
        bytes,
        options,
      );
    },

    async completeSession(session, filename, options) {
      const { resolveBuilderPrivateKey } =
        await import("../server/credential-provider.js");
      const privateKey = await resolveBuilderPrivateKey();
      if (!privateKey) throw new Error("BUILDER_PRIVATE_KEY is not set");

      const assetId = session.meta.assetId as string;
      console.log(`[builder-resumable] completing upload: assetId=${assetId}`);
      const { url } = await completeBuilderUpload(
        privateKey,
        assetId,
        filename,
        {
          stableUrl: options?.stableUrl || session.meta.stableUrl === true,
          recordAsset:
            options?.recordAsset ??
            (session.meta.recordAsset === false ? false : undefined),
        },
      );
      console.log(`[builder-resumable] upload complete: ${url}`);
      return url;
    },
  },
};
