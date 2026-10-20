import type { FileUploadProvider } from "@agent-native/core/server";

const PROVIDER_ID = "design-e2e-https-storage";
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

function storageUrl(): URL | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.E2E_ATTACHMENT_STORAGE_ENABLED !== "1"
  ) {
    return null;
  }
  try {
    const url = new URL(process.env.E2E_ATTACHMENT_STORAGE_URL ?? "");
    return url.protocol === "https:" && url.hostname === "127.0.0.1"
      ? url
      : null;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function createE2EAttachmentStorageProvider(): FileUploadProvider {
  return {
    id: PROVIDER_ID,
    name: "Design E2E HTTPS attachment storage",
    isConfigured: () => storageUrl() !== null,
    isOwnedUrl: (value) => {
      const base = storageUrl();
      if (!base) return false;
      try {
        const url = new URL(value);
        return (
          url.origin === base.origin &&
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          /^\/objects\/[a-f0-9-]{36}$/.test(url.pathname)
        );
      } catch (error) {
        if (error instanceof TypeError) return false;
        throw error;
      }
    },
    upload: async ({ data, mimeType, ownerEmail }) => {
      const base = storageUrl();
      if (!base) throw new Error("Design E2E HTTPS storage is disabled.");
      if (!ownerEmail?.trim()) {
        throw new Error("Design E2E HTTPS storage requires an owner.");
      }
      const bytes = Buffer.from(data);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new Error("Design E2E upload size is outside the stub limit.");
      }
      let response: Response;
      try {
        response = await fetch(new URL("/uploads", base), {
          method: "POST",
          headers: {
            "content-type": mimeType ?? "application/octet-stream",
          },
          body: bytes,
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new Error("Design E2E HTTPS storage upload failed.");
      }
      if (!response.ok) {
        throw new Error("Design E2E HTTPS storage rejected the upload.");
      }
      const result = (await response.json()) as { id?: unknown };
      if (typeof result.id !== "string" || !/^[a-f0-9-]{36}$/.test(result.id)) {
        throw new Error(
          "Design E2E HTTPS storage returned an invalid object id.",
        );
      }
      return {
        id: result.id,
        url: new URL(`/objects/${result.id}`, base).href,
        provider: PROVIDER_ID,
      };
    },
  };
}
