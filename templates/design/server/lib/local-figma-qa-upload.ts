import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  PrivateBlobError,
  registerPrivateBlobProvider,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import {
  registerFileUploadProvider,
  type FileUploadProvider,
} from "@agent-native/core/server";

const QA_UPLOAD_FLAG = "AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS";
const MAX_QA_ASSET_BYTES = 16 * 1024 * 1024;
const QA_UPLOAD_ROOT = path.resolve(
  "node_modules/.cache/agent-native-design/figma-qa-assets",
);

const MIME_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["image/svg+xml", "svg"],
]);
const QA_ASSET_ROUTE = "/api/qa-figma-import-assets/";
const QA_ASSET_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:png|jpg|webp|gif|avif|svg)$/;

export class LocalFigmaQaExportAssetError extends Error {
  constructor(
    readonly code:
      | "invalid-reference"
      | "forbidden"
      | "unavailable"
      | "unreadable"
      | "limit"
      | "mismatch"
      | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "LocalFigmaQaExportAssetError";
  }
}

export function isLocalFigmaQaAssetUrl(url: string): boolean {
  return url.startsWith(QA_ASSET_ROUTE);
}

function hasExpectedImageSignature(
  mimeType: string,
  bytes: Uint8Array,
): boolean {
  if (mimeType === "image/png")
    return (
      bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (byte, index) => bytes[index] === byte,
      ) &&
      String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR"
    );
  if (mimeType === "image/jpeg")
    return (
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  if (mimeType === "image/webp")
    return (
      bytes.length >= 16 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
    );
  if (mimeType === "image/gif")
    return (
      bytes.length >= 6 &&
      ["GIF87a", "GIF89a"].includes(
        String.fromCharCode(...bytes.subarray(0, 6)),
      )
    );
  if (mimeType === "image/avif")
    return (
      bytes.length >= 16 &&
      String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" &&
      ["avif", "avis"].includes(String.fromCharCode(...bytes.subarray(8, 12)))
    );
  return false;
}

function localQaReadFailure(
  error: unknown,
  message: string,
): LocalFigmaQaExportAssetError {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return new LocalFigmaQaExportAssetError(
    code === "ENOENT" || code === "ENOTDIR" ? "unavailable" : "unreadable",
    message,
  );
}

export async function readLocalFigmaQaAssetForExport(
  url: string,
  ownerEmail: string | null | undefined,
  options: { rootDir?: string; maxBytes?: number } = {},
): Promise<{ mimeType: string; bytes: Uint8Array }> {
  if (!isLocalFigmaQaAssetUrl(url))
    throw new LocalFigmaQaExportAssetError(
      "invalid-reference",
      "Not a local QA asset URL.",
    );
  if (!isLocalFigmaQaUploadEnabled())
    throw new LocalFigmaQaExportAssetError(
      "unavailable",
      "Local QA asset storage is disabled.",
    );
  if (!ownerEmail?.trim())
    throw new LocalFigmaQaExportAssetError(
      "forbidden",
      "Local QA asset export requires an authenticated owner.",
    );
  const assetId = url.slice(QA_ASSET_ROUTE.length);
  if (!QA_ASSET_ID.test(assetId))
    throw new LocalFigmaQaExportAssetError(
      "invalid-reference",
      "Local QA asset URL is malformed.",
    );
  const mimeType = localFigmaQaAssetMimeType(assetId);
  if (!mimeType)
    throw new LocalFigmaQaExportAssetError(
      "invalid-reference",
      "Local QA asset type is unknown.",
    );
  if (mimeType === "image/svg+xml")
    throw new LocalFigmaQaExportAssetError(
      "unsupported",
      "Local QA SVG cannot be embedded without its route isolation.",
    );
  const rootDir = options.rootDir ?? QA_UPLOAD_ROOT;
  const filepath = localFigmaQaAssetPath(ownerEmail, assetId, rootDir);
  if (!filepath)
    throw new LocalFigmaQaExportAssetError(
      "invalid-reference",
      "Local QA asset path is unsafe.",
    );
  let real: string;
  try {
    real = await realpath(filepath);
  } catch (error) {
    throw localQaReadFailure(
      error,
      "Local QA asset is unavailable for this owner.",
    );
  }
  let realRoot: string;
  let ownerRoot: string;
  try {
    realRoot = await realpath(rootDir);
    ownerRoot = await realpath(ownerDirectory(ownerEmail, rootDir));
  } catch (error) {
    throw localQaReadFailure(
      error,
      "Local QA asset owner storage is unreadable.",
    );
  }
  if (ownerRoot !== ownerDirectory(ownerEmail, realRoot))
    throw new LocalFigmaQaExportAssetError(
      "forbidden",
      "Local QA asset owner directory is not isolated.",
    );
  if (real !== path.join(ownerRoot, assetId))
    throw new LocalFigmaQaExportAssetError(
      "forbidden",
      "Local QA asset leaves its owner directory.",
    );
  let details;
  try {
    details = await stat(real);
  } catch (error) {
    throw localQaReadFailure(error, "Local QA asset changed before export.");
  }
  const maxBytes = options.maxBytes ?? 1_000_000;
  if (!details.isFile() || details.size < 1 || details.size > maxBytes)
    throw new LocalFigmaQaExportAssetError(
      "limit",
      "Local QA asset exceeds export size limits.",
    );
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(real));
  } catch (error) {
    throw localQaReadFailure(error, "Local QA asset changed during export.");
  }
  if (
    bytes.byteLength !== details.size ||
    !hasExpectedImageSignature(mimeType, bytes)
  )
    throw new LocalFigmaQaExportAssetError(
      "mismatch",
      "Local QA asset bytes do not match its image type.",
    );
  return { mimeType, bytes };
}

export function isLocalFigmaQaUploadEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.NODE_ENV !== "production" &&
    /^(?:1|true)$/i.test(env[QA_UPLOAD_FLAG] ?? "")
  );
}

function ownerDirectory(ownerEmail: string, rootDir = QA_UPLOAD_ROOT): string {
  const ownerKey = createHash("sha256")
    .update(ownerEmail.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
  return path.join(rootDir, ownerKey);
}

export function localFigmaQaAssetPath(
  ownerEmail: string,
  assetId: string,
  rootDir = QA_UPLOAD_ROOT,
): string | null {
  if (!/^[a-f0-9-]{36}\.(?:png|jpg|webp|gif|avif|svg)$/.test(assetId)) {
    return null;
  }
  const ownerRoot = ownerDirectory(ownerEmail, rootDir);
  const resolved = path.resolve(ownerRoot, assetId);
  return resolved.startsWith(`${path.resolve(ownerRoot)}${path.sep}`)
    ? resolved
    : null;
}

export function localFigmaQaAssetMimeType(assetId: string): string | null {
  const extension = path.extname(assetId).slice(1);
  for (const [mimeType, candidate] of MIME_EXTENSIONS) {
    if (candidate === extension) return mimeType;
  }
  return null;
}

export function createLocalFigmaQaUploadProvider(options?: {
  rootDir?: string;
  enabled?: () => boolean;
}): FileUploadProvider {
  const rootDir = options?.rootDir ?? QA_UPLOAD_ROOT;
  const enabled = options?.enabled ?? isLocalFigmaQaUploadEnabled;
  return {
    id: "design-local-figma-qa",
    name: "Design local Figma QA storage",
    isConfigured: enabled,
    upload: async ({ data, mimeType, ownerEmail }) => {
      if (!enabled()) {
        throw new Error("Local Figma QA storage is not enabled.");
      }
      if (!ownerEmail?.trim()) {
        throw new Error(
          "Local Figma QA storage requires an authenticated owner.",
        );
      }
      const extension = MIME_EXTENSIONS.get(
        (mimeType ?? "").split(";", 1)[0]!.trim().toLowerCase(),
      );
      if (!extension) {
        throw new Error("Local Figma QA storage accepts image assets only.");
      }
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_QA_ASSET_BYTES) {
        throw new Error("Local Figma QA asset size is outside the safe limit.");
      }

      const assetId = `${randomUUID()}.${extension}`;
      const ownerRoot = ownerDirectory(ownerEmail, rootDir);
      const filepath = localFigmaQaAssetPath(ownerEmail, assetId, rootDir);
      if (!filepath)
        throw new Error("Could not allocate a safe QA asset path.");
      await mkdir(ownerRoot, { recursive: true, mode: 0o700 });
      await writeFile(filepath, bytes, { flag: "wx", mode: 0o600 });
      return {
        id: assetId,
        url: `/api/qa-figma-import-assets/${assetId}`,
        provider: "design-local-figma-qa",
      };
    },
  };
}

export function createLocalFigmaQaPrivateBlobProvider(options?: {
  rootDir?: string;
  enabled?: () => boolean;
}): PrivateBlobProvider {
  const rootDir = path.join(options?.rootDir ?? QA_UPLOAD_ROOT, "private");
  const enabled = options?.enabled ?? isLocalFigmaQaUploadEnabled;
  const blobPath = (id: string) => {
    if (!/^[a-f0-9-]{36}\.blob$/.test(id)) {
      throw new Error("Invalid local QA private blob id.");
    }
    return path.join(rootDir, id);
  };
  return {
    id: "design-local-figma-qa-private",
    name: "Design local QA private blobs",
    isConfigured: enabled,
    put: async ({ data, mimeType, metadata }) => {
      if (!enabled()) throw new Error("Local QA private blobs are disabled.");
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const id = `${randomUUID()}.blob`;
      await mkdir(rootDir, { recursive: true, mode: 0o700 });
      await writeFile(blobPath(id), bytes, { flag: "wx", mode: 0o600 });
      return {
        id,
        provider: "design-local-figma-qa-private",
        opaque: true,
        encrypted: false,
        mimeType,
        size: bytes.byteLength,
        createdAt: new Date().toISOString(),
        metadata,
      };
    },
    read: async (handle) => {
      const filepath = blobPath(handle.id);
      let data: Uint8Array;
      try {
        data = new Uint8Array(await readFile(filepath));
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
          throw new PrivateBlobError(
            "Local QA private blob was not found.",
            "not_found",
          );
        throw new PrivateBlobError(
          "Local QA private blob could not be read.",
          "unavailable",
          { cause: error },
        );
      }
      return {
        data,
        mimeType: handle.mimeType,
        metadata: handle.metadata,
        handle,
      };
    },
    delete: async (handle) => {
      await rm(blobPath(handle.id), { force: true });
      return { deleted: true, provider: handle.provider };
    },
  };
}

export function registerLocalFigmaQaUploadProvider(): void {
  registerFileUploadProvider(createLocalFigmaQaUploadProvider());
  registerPrivateBlobProvider(createLocalFigmaQaPrivateBlobProvider());
}
