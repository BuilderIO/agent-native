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

async function uploadLargeFileViaSignedUrl(
  input: FileUploadInput,
  authorization: string,
  apiKey: string | undefined,
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
    authorization,
    apiKey,
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
    authorization,
    apiKey,
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
  authorization: string,
  apiKey: string | undefined,
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
  if (apiKey) url.searchParams.set("apiKey", apiKey);
  const res = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: {
      Authorization: authorization,
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
  authorization: string,
  apiKey: string | undefined,
  assetId: string,
  filename: string | undefined,
  options?: { stableUrl?: boolean; recordAsset?: boolean },
): Promise<{ url: string; id?: string }> {
  const host = builderUploadHost();
  const url = new URL("/api/v1/upload/complete", host);
  if (apiKey) url.searchParams.set("apiKey", apiKey);
  if (options?.stableUrl) {
    setStableUrlQueryParam(url);
  }
  setRecordAssetQueryParam(url, options?.recordAsset);
  const res = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: {
      Authorization: authorization,
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
 * Builder gates every `/api/v1/upload/*` endpoint on `builder:assets:write`.
 * Legacy `bpk-` keys skip that check, which is why uploads kept working for
 * older connections while OAuth-only ones could not upload at all.
 */
async function assetAuthorization(): Promise<{
  authorization: string;
  apiKey?: string;
}> {
  const [auth, { BUILDER_ASSETS_WRITE_SCOPE }] = await Promise.all([
    import("../server/builder-api-auth.js"),
    import("../server/builder-oauth.js"),
  ]);
  const authorization = await auth.resolveBuilderApiAuthorization(
    BUILDER_ASSETS_WRITE_SCOPE,
  );
  if (!/^Bearer\s+btk-/i.test(authorization)) return { authorization };

  const { resolveBuilderCredentialsDetailed } =
    await import("../server/credential-provider.js");
  const credentials = await resolveBuilderCredentialsDetailed();
  const privateKey = credentials.privateKey?.trim();
  const publicKey = credentials.publicKey?.trim();
  if (!privateKey || !publicKey) {
    throw new Error(
      "Builder personal access token connection is missing its space id. Reconnect Builder.io to continue.",
    );
  }
  const authorized = authorization.replace(/^Bearer\s+/i, "").trim();
  if (privateKey !== authorized) {
    throw new Error(
      "Builder credential scope mismatch: the connection holding the upload space is not the one authorized for this request. Reconnect Builder.io to continue.",
    );
  }
  return { authorization, apiKey: publicKey };
}

/**
 * Built-in Builder.io file upload provider.
 * Uses the same Builder connection as the browser/background-agent flows, so
 * connecting Builder once (via the sidebar "Connect Builder" action)
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
    const { authorization, apiKey } = await assetAuthorization();

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
        authorization,
        apiKey,
        bareMimeType,
        bytes,
      );
    }

    console.log(
      `[builder-upload] small-file path: ${filename ?? "upload"} ${mb}MB ${bareMimeType}`,
    );

    const url = new URL("/api/v1/upload", builderUploadHost());
    if (apiKey) url.searchParams.set("apiKey", apiKey);
    if (filename) url.searchParams.set("name", filename);
    if (input.stableUrl) {
      setStableUrlQueryParam(url);
    }
    setRecordAssetQueryParam(url, input.recordAsset);

    const response = await uploadSmallFile(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
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

  delete: async ({ url }) => {
    const assetUrl = new URL(url);
    if (assetUrl.hostname !== "cdn.builder.io") return false;
    assetUrl.search = "";
    assetUrl.hash = "";

    const { resolveBuilderCredentials } =
      await import("../server/credential-provider.js");
    const credentials = await resolveBuilderCredentials();
    if (!credentials.privateKey || !credentials.publicKey) return false;

    const deleteUrl = new URL(
      "/api/v1/assets/by-url",
      "https://cdn.builder.io",
    );
    deleteUrl.searchParams.set("url", assetUrl.toString());
    deleteUrl.searchParams.set("apiKey", credentials.publicKey);
    const response = await fetchWithTimeout(deleteUrl.toString(), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${credentials.privateKey}` },
    });
    if (response.ok) return true;
    if (response.status === 404) return false;
    await assertOk(response, "Builder.io asset delete failed");
    return false;
  },

  resumable: {
    async startSession(filename, mimeType, maxBytes) {
      const { authorization, apiKey } = await assetAuthorization();

      console.log(
        `[builder-resumable] starting session: ${filename} ${mimeType} ${maxBytes} bytes`,
      );
      const { uploadUrl, assetId, requiredHeaders } =
        await requestBuilderSignedUrl(
          authorization,
          apiKey,
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
      const { authorization, apiKey } = await assetAuthorization();

      const assetId = session.meta.assetId as string;
      console.log(`[builder-resumable] completing upload: assetId=${assetId}`);
      const { url } = await completeBuilderUpload(
        authorization,
        apiKey,
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

    async abortSession(session) {
      const response = await fetchWithTimeout(session.sessionId, {
        method: "DELETE",
        headers: { "Content-Length": "0" },
        body: new Uint8Array(0),
      });
      // GCS returns 499 for a successful JSON API cancellation. A session
      // that is already gone is also fully cleaned up from this retry's point
      // of view, so treat its terminal 404/410 responses as success.
      if (
        response.ok ||
        response.status === 404 ||
        response.status === 410 ||
        response.status === 499
      ) {
        return;
      }
      const body = await response.text();
      throw new Error(
        `GCS resumable session cancellation failed (${response.status}): ${body || response.statusText}`,
      );
    },
  },
};
