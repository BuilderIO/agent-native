import { callAction } from "@agent-native/core/client/hooks";

export async function uploadNativeTexture(
  designId: string,
  fileId: string,
  data: string,
  filename: string,
  idempotencyKey: string,
): Promise<{ url: string }> {
  const result = await callAction("upload-design-native-texture", {
    designId,
    fileId,
    data,
    filename,
    idempotencyKey,
  });
  if (
    !result ||
    typeof result !== "object" ||
    !("url" in result) ||
    typeof result.url !== "string"
  )
    throw new Error(
      "Native texture upload did not return a readable image reference.",
    );
  return { url: result.url };
}

export function createNativeTextureUploader(designId: string, fileId: string) {
  return async (data: string, filename: string): Promise<{ url: string }> => {
    if (!crypto.subtle)
      throw new Error("Native texture upload needs a secure browser context.");
    const scopeAndBytes = new TextEncoder().encode(
      `${designId}\0${fileId}\0${data}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", scopeAndBytes);
    const idempotencyKey = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    return uploadNativeTexture(
      designId,
      fileId,
      data,
      filename,
      idempotencyKey,
    );
  };
}
