import type {
  FileUploadProvider,
  FileUploadInput,
  FileUploadResult,
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
  const host = builderUploadHost();
  const authHeader = { Authorization: `Bearer ${privateKey}` };
  const name = input.filename ?? "upload";
  const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1);

  console.log(
    `[builder-upload] large-file path: ${name} ${mb}MB ${bareMimeType}`,
  );

  // Step 1 — request a signed URL.
  console.log(`[builder-upload] step 1: requesting signed URL`);
  const step1Res = await fetchWithTimeout(
    new URL("/api/v1/upload/signed-url", host).toString(),
    {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: name,
        contentType: bareMimeType,
        size: bytes.byteLength,
      }),
    },
  );
  await assertOk(step1Res, "Builder.io signed-URL request failed");

  const step1Json = (await step1Res.json()) as {
    uploadUrl?: string;
    assetId?: string;
    expiresAt?: string;
    requiredHeaders?: Record<string, string>;
  };
  const { uploadUrl, assetId, requiredHeaders } = step1Json;
  if (!uploadUrl || !assetId || !requiredHeaders) {
    throw new Error(
      `Builder.io signed-URL response missing required fields: ${JSON.stringify(Object.keys(step1Json))}`,
    );
  }
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
  const step3Res = await fetchWithTimeout(
    new URL("/api/v1/upload/complete", host).toString(),
    {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, name: input.filename }),
    },
  );
  await assertOk(step3Res, "Builder.io upload complete failed");

  const { url, id } = (await step3Res.json()) as { url?: string; id?: string };
  if (!url) throw new Error("Builder.io upload/complete returned no URL");

  console.log(`[builder-upload] done [${assetId}]: ${url}`);
  return { url, id, provider: "builder" };
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
  upload: async ({ data, filename, mimeType }: FileUploadInput) => {
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

    if (bytes.byteLength > LARGE_FILE_THRESHOLD_BYTES) {
      return uploadLargeFileViaSignedUrl(
        { data, filename, mimeType },
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
};
