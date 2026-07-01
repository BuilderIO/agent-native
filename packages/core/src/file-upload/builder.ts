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
const SMALL_FILE_RETRY_DELAYS_MS = [600, 1800];

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

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

async function assertOk(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${label} (${res.status}): ${body || res.statusText}`);
  }
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

  // Step 1 — request a signed URL.
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
  const step2Res = await fetchWithTimeout(uploadUrl, {
    method: "PUT",
    headers: requiredHeaders,
    body: makeBody(bytes, bareMimeType),
  });
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
    { skipCompressionWait: input.skipCompressionWait },
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
  options?: { skipCompressionWait?: boolean },
): Promise<{ url: string; id?: string }> {
  const host = builderUploadHost();
  const url = new URL("/api/v1/upload/complete", host);
  if (options?.skipCompressionWait) {
    url.searchParams.set("skipCompressionWait", "true");
  }
  const res = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${privateKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ assetId, name: filename }),
  });
  await assertOk(res, "Builder.io upload complete failed");
  const json = (await res.json()) as { url?: string; id?: string };
  if (!json.url) throw new Error("Builder.io upload/complete returned no URL");
  return { url: json.url, id: json.id };
}

// Retry transient 5xx once with backoff. Builder.io's upload service
// occasionally returns a bodyless 500 ("Internal Error") on the first
// attempt — usually GCS write hiccups that succeed on retry.
async function uploadSmallFile(url: URL, init: RequestInit): Promise<Response> {
  let response: Response | null = null;
  let lastErrorBody = "";

  for (
    let attempt = 0;
    attempt <= SMALL_FILE_RETRY_DELAYS_MS.length;
    attempt++
  ) {
    const retryDelay = SMALL_FILE_RETRY_DELAYS_MS[attempt]; // undefined on last attempt
    try {
      response = await fetchWithTimeout(url.toString(), init);
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
    if (input.skipCompressionWait) {
      url.searchParams.set("skipCompressionWait", "true");
    }

    const response = await uploadSmallFile(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${privateKey}`,
        "Content-Type": bareMimeType,
      },
      body: makeBody(bytes, bareMimeType),
    });

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
      const { uploadUrl, assetId, requiredHeaders } =
        await requestBuilderSignedUrl(
          privateKey,
          filename,
          mimeType,
          maxBytes,
          true,
        );
      console.log(`[builder-resumable] session step 1 ok: assetId=${assetId}`);

      const initHeaders: Record<string, string> = {
        "Content-Type": mimeType,
        "x-goog-resumable": "start",
      };
      const contentLengthRange =
        requiredHeaders?.["x-goog-content-length-range"];
      if (contentLengthRange)
        initHeaders["x-goog-content-length-range"] = contentLengthRange;

      console.log(`[builder-resumable] session step 2: initiating GCS session`);
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

      console.log(`[builder-resumable] session ready: assetId=${assetId}`);
      return {
        sessionId: sessionUri,
        meta: { assetId, filename, mimeType },
      } satisfies ResumableUploadSession;
    },

    async relayChunk(session, contentRange, bytes, options) {
      const sessionUri = session.sessionId;
      const MAX_ATTEMPTS = 4;
      const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
      const delayMs = (attempt: number) =>
        Math.min(2000, 300 * 2 ** (attempt - 1));

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const headers: Record<string, string> = {
            "Content-Range": contentRange,
          };
          if (options?.mimeType) headers["Content-Type"] = options.mimeType;
          const res = await fetch(sessionUri, {
            method: "PUT",
            headers,
            body: bytes as unknown as BodyInit,
          });
          if (res.status === 308 || res.ok)
            return {
              ok: true,
              status: res.status,
            } satisfies ResumableChunkResult;
          if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
            await res.text().catch(() => "");
            console.warn(
              `[builder-resumable] transient ${res.status} on attempt ${attempt}, retrying`,
            );
            await new Promise((r) => setTimeout(r, delayMs(attempt)));
            continue;
          }
          return {
            ok: false,
            status: res.status,
          } satisfies ResumableChunkResult;
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
          skipCompressionWait:
            options?.skipCompressionWait ||
            session.meta.skipCompressionWait === true,
        },
      );
      console.log(`[builder-resumable] upload complete: ${url}`);
      return url;
    },
  },
};
