import type { FileUploadProvider } from "./types.js";

const DEFAULT_BUILDER_APP_HOST = "https://builder.io";

function builderUploadHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    DEFAULT_BUILDER_APP_HOST
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
  upload: async ({ data, filename, mimeType }) => {
    const { resolveBuilderPrivateKey } =
      await import("../server/credential-provider.js");
    const privateKey = await resolveBuilderPrivateKey();
    if (!privateKey) {
      throw new Error("BUILDER_PRIVATE_KEY is not set");
    }

    const url = new URL("/api/v1/upload", builderUploadHost());
    if (filename) url.searchParams.set("name", filename);

    // Strip any media-type parameters (e.g. `;codecs=avc1,opus` from
    // MediaRecorder blobs) — Builder's upload API parses the body as raw
    // binary only when Content-Type is a bare MIME type. A parameterized
    // Content-Type falls through to the multipart/base64 paths which look
    // for an `image` field, and returns "No image specified" when it
    // doesn't find one.
    const bareMimeType = (mimeType || "application/octet-stream")
      .split(";")[0]
      .trim();

    const buffer =
      data instanceof Uint8Array ? data : new Uint8Array(data as any);
    const bytes = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    const body =
      typeof Blob !== "undefined"
        ? new Blob([bytes], { type: bareMimeType })
        : (bytes as unknown as BodyInit);

    // Retry transient 5xx once with backoff. Builder.io's upload service
    // occasionally returns a bodyless 500 ("Internal Error") on the first
    // attempt — usually GCS write hiccups that succeed on retry. We bound
    // it tight so a deterministic 500 surfaces quickly to the caller.
    const RETRY_DELAYS_MS = [600, 1800];
    let response: Response | null = null;
    let lastErrorBody = "";
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${privateKey}`,
          "Content-Type": bareMimeType,
        },
        body,
      });
      if (response.ok) break;
      const isTransient = response.status >= 500 && response.status !== 501;
      const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
      if (!isTransient || isLastAttempt) {
        lastErrorBody = await response.text().catch(() => "");
        break;
      }
      lastErrorBody = await response.text().catch(() => "");
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }

    if (!response || !response.ok) {
      const status = response?.status ?? 0;
      const statusText = response?.statusText ?? "no response";
      throw new Error(
        `Builder.io upload failed (${status}): ${lastErrorBody || statusText}`,
      );
    }

    const json = (await response.json().catch(() => ({}))) as {
      url?: string;
      id?: string;
    };
    if (!json.url) {
      throw new Error("Builder.io upload returned no URL");
    }

    return { url: json.url, id: json.id, provider: "builder" };
  },
};
