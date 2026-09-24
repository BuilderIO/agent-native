import { appApiPath } from "@agent-native/core/client/api-path";
import type { DesignSystemFileUploadResult } from "@agent-native/toolkit/design-system-creation";

export async function uploadDesignSystemSourceFile(
  file: File,
  options: { signal?: AbortSignal; failureMessage: string },
): Promise<DesignSystemFileUploadResult> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(appApiPath("/api/design-system-source-upload"), {
    method: "POST",
    body,
    signal: options.signal,
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(options.failureMessage);
  }
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : options.failureMessage;
    throw new Error(message);
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("handle" in data) ||
    !data.handle ||
    typeof data.handle !== "object" ||
    !("kind" in data.handle) ||
    data.handle.kind !== "stored-file" ||
    !("path" in data.handle) ||
    typeof data.handle.path !== "string" ||
    !data.handle.path.trim() ||
    !("name" in data) ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    !("mimeType" in data) ||
    typeof data.mimeType !== "string" ||
    !data.mimeType.trim() ||
    !("size" in data) ||
    data.size !== file.size
  )
    throw new Error(options.failureMessage);
  return {
    handle: { kind: "stored-file", path: data.handle.path },
    name: data.name,
    mimeType: data.mimeType,
    size: data.size,
  };
}
