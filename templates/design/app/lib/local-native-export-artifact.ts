import { appBasePath } from "@agent-native/core/client/api-path";

export interface LocalNativeExportArtifact {
  artifactId: string;
  format:
    | "png"
    | "jpg"
    | "webp"
    | "avif"
    | "mp4"
    | "svg"
    | "pdf"
    | "zip"
    | "html";
  byteLength: number;
  sha256: string;
  expiresAt: string;
}

export class LocalNativeExportArtifactError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LocalNativeExportArtifactError";
  }
}

function isArtifact(value: unknown): value is LocalNativeExportArtifact {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.artifactId === "string" &&
    /^[a-f0-9-]{36}\.(?:png|jpg|webp|avif|mp4|svg|pdf|zip|html)$/.test(
      item.artifactId,
    ) &&
    ["png", "jpg", "webp", "avif", "mp4", "svg", "pdf", "zip", "html"].includes(
      item.format as string,
    ) &&
    item.artifactId.endsWith(`.${item.format}`) &&
    Number.isSafeInteger(item.byteLength) &&
    (item.byteLength as number) > 0 &&
    typeof item.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(item.sha256) &&
    typeof item.expiresAt === "string" &&
    Number.isFinite(Date.parse(item.expiresAt))
  );
}

export async function saveLocalNativeExportArtifact(args: {
  designId: string;
  blob: Blob;
  signal?: AbortSignal;
}): Promise<LocalNativeExportArtifact> {
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "video/mp4",
      "image/svg+xml",
      "application/pdf",
      "application/zip",
      "text/html",
    ].includes(args.blob.type)
  ) {
    throw new LocalNativeExportArtifactError("unsupported-format");
  }
  const url = `${appBasePath()}/api/qa-native-export-artifacts?designId=${encodeURIComponent(args.designId)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": args.blob.type },
      body: args.blob,
      signal: args.signal,
    });
  } catch (error) {
    if (args.signal?.aborted) throw error;
    throw new LocalNativeExportArtifactError("handoff-unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LocalNativeExportArtifactError("handoff-unreadable");
  }
  if (!response.ok) {
    const code =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "handoff-failed";
    throw new LocalNativeExportArtifactError(code);
  }
  if (!isArtifact(payload) || payload.byteLength !== args.blob.size) {
    throw new LocalNativeExportArtifactError("handoff-unreadable");
  }
  const expectedFormat = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/html": "html",
  }[args.blob.type];
  if (payload.format !== expectedFormat) {
    throw new LocalNativeExportArtifactError("handoff-unreadable");
  }
  return payload;
}
