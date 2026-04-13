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
    const privateKey = process.env.BUILDER_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("BUILDER_PRIVATE_KEY is not set");
    }

    const url = new URL("/api/v1/upload", builderUploadHost());
    if (filename) url.searchParams.set("name", filename);

    const buffer =
      data instanceof Uint8Array ? data : new Uint8Array(data as any);
    const bytes = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    const body =
      typeof Blob !== "undefined"
        ? new Blob([bytes], {
            type: mimeType || "application/octet-stream",
          })
        : (bytes as unknown as BodyInit);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${privateKey}`,
        "Content-Type": mimeType || "application/octet-stream",
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Builder.io upload failed (${response.status}): ${text || response.statusText}`,
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
