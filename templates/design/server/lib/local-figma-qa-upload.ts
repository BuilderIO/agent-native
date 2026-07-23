import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
]);

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
  if (!/^[a-f0-9-]{36}\.(?:png|jpg|webp|gif|avif)$/.test(assetId)) {
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

export function registerLocalFigmaQaUploadProvider(): void {
  registerFileUploadProvider(createLocalFigmaQaUploadProvider());
}
