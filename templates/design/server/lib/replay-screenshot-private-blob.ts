import type { PrivateBlobHandle } from "@agent-native/core/private-blob";

const PUBLIC_UPLOAD_HANDLE_PREFIX = "public-upload:v1:";
const PUBLIC_UPLOAD_PROVIDER_PREFIX = "public-upload:";

export function isValidReplayScreenshotBlobHandle(
  value: unknown,
): value is PrivateBlobHandle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const handle = value as Partial<PrivateBlobHandle>;
  if (
    typeof handle.id !== "string" ||
    !handle.id ||
    typeof handle.provider !== "string" ||
    !handle.provider ||
    handle.opaque !== true ||
    typeof handle.encrypted !== "boolean"
  ) {
    return false;
  }

  const fallbackId = handle.id.startsWith(PUBLIC_UPLOAD_HANDLE_PREFIX);
  const fallbackProvider = handle.provider.startsWith(
    PUBLIC_UPLOAD_PROVIDER_PREFIX,
  );
  return fallbackId || fallbackProvider
    ? fallbackId && fallbackProvider && handle.encrypted
    : true;
}
