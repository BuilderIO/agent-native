import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { imageSize } from "image-size";
import JSZip from "jszip";
import { parseFragment } from "parse5";

export const MAX_NATIVE_RASTER_BYTES = 16 * 1024 * 1024;
export const MAX_NATIVE_MP4_BYTES = 100 * 1024 * 1024;
export const MAX_NATIVE_DOCUMENT_BYTES = 40 * 1024 * 1024;
const MAX_STORED_BYTES = 200 * 1024 * 1024;
const MAX_STORED_FILES = 8;
const ARTIFACT_TTL_MS = 60 * 60 * 1000;
const ARTIFACT_NAME =
  /^[a-f0-9-]{36}\.(?:png|jpg|webp|avif|mp4|svg|pdf|zip|html)$/;

let storageOperation: Promise<void> = Promise.resolve();
let pendingStores = 0;

export class LocalNativeArtifactError extends Error {
  constructor(
    readonly code:
      | "invalid-format"
      | "invalid-size"
      | "storage-capacity"
      | "storage-unavailable",
  ) {
    super(code);
    this.name = "LocalNativeArtifactError";
  }
}

export function localNativeArtifactRoot(appCwd = process.cwd()): string {
  const resolved = path.resolve(appCwd);
  if (
    path.basename(resolved) !== "design" ||
    path.basename(path.dirname(resolved)) !== "templates"
  ) {
    throw new LocalNativeArtifactError("storage-unavailable");
  }
  return path.resolve(
    resolved,
    "../../.tmp/shaders-mvp/native-export-artifacts",
  );
}

export interface LocalNativeArtifactMetadata {
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

function ownerKey(email: string, designId: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .update("\0")
    .update(designId)
    .digest("hex")
    .slice(0, 24);
}

export function localNativeArtifactPath(
  email: string,
  designId: string,
  artifactId: string,
  root = localNativeArtifactRoot(),
): string | null {
  if (!ARTIFACT_NAME.test(artifactId)) return null;
  return path.join(root, ownerKey(email, designId), artifactId);
}

async function checkStaticSvg(
  source: string,
  allowEmbeddedSvg: boolean,
): Promise<void> {
  if (/<!(?:DOCTYPE|ENTITY)\b|<\?/i.test(source)) {
    throw new LocalNativeArtifactError("invalid-format");
  }
  const tree = parseFragment(source);
  const elements = tree.childNodes.filter((node) => "tagName" in node);
  if (elements.length !== 1 || elements[0]?.tagName !== "svg") {
    throw new LocalNativeArtifactError("invalid-format");
  }
  const visit = async (node: (typeof elements)[number]): Promise<void> => {
    if (
      /^(?:script|foreignObject|iframe|object|embed|a|style|animate|animateMotion|animateTransform|set)$/i.test(
        node.tagName,
      )
    ) {
      throw new LocalNativeArtifactError("invalid-format");
    }
    for (const attr of node.attrs) {
      if (/^on/i.test(attr.name) || /javascript:|@import/i.test(attr.value)) {
        throw new LocalNativeArtifactError("invalid-format");
      }
      const withoutLocalUrls = attr.value.replace(
        /url\(\s*(['"]?)(#[A-Za-z_][\w.:-]*)\1\s*\)/gi,
        "",
      );
      if (/url\s*\(/i.test(withoutLocalUrls)) {
        throw new LocalNativeArtifactError("invalid-format");
      }
      if (!/^(?:href|xlink:href)$/i.test(attr.name)) continue;
      if (/^#[A-Za-z_][\w.:-]*$/.test(attr.value)) continue;
      if (node.tagName !== "image") {
        throw new LocalNativeArtifactError("invalid-format");
      }
      const match =
        /^data:(image\/(?:png|jpeg|webp|avif|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
          attr.value,
        );
      if (!match || match[2]!.length % 4 !== 0) {
        throw new LocalNativeArtifactError("invalid-format");
      }
      const embedded = Buffer.from(match[2]!, "base64");
      if (embedded.toString("base64") !== match[2]) {
        throw new LocalNativeArtifactError("invalid-format");
      }
      if (match[1] === "image/svg+xml") {
        if (!allowEmbeddedSvg || embedded.byteLength > 1_000_000) {
          throw new LocalNativeArtifactError("invalid-format");
        }
        let nested: string;
        try {
          nested = new TextDecoder("utf-8", { fatal: true }).decode(embedded);
        } catch {
          throw new LocalNativeArtifactError("invalid-format");
        }
        await checkStaticSvg(nested, false);
      } else {
        await checkBytes(embedded, match[1]!);
      }
    }
    for (const child of node.childNodes ?? []) {
      if ("tagName" in child) await visit(child);
    }
  };
  await visit(elements[0]!);
}

async function checkBytes(
  bytes: Uint8Array,
  mimeType: string,
): Promise<LocalNativeArtifactMetadata["format"]> {
  const rasterFormats = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/avif": "avif",
  } as const;
  const format = rasterFormats[mimeType as keyof typeof rasterFormats];
  if (format) {
    if (bytes.byteLength < 24 || bytes.byteLength > MAX_NATIVE_RASTER_BYTES) {
      throw new LocalNativeArtifactError("invalid-size");
    }
    const header = Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      Math.min(bytes.byteLength, 32),
    );
    const ascii = (start: number, end: number) =>
      header.toString("ascii", start, end);
    const signed =
      format === "png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every(
            (byte, index) => header[index] === byte,
          ) && ascii(12, 16) === "IHDR"
        : format === "jpg"
          ? header[0] === 255 && header[1] === 216 && header[2] === 255
          : format === "webp"
            ? ascii(0, 4) === "RIFF" &&
              ascii(8, 12) === "WEBP" &&
              ["VP8 ", "VP8L", "VP8X"].includes(ascii(12, 16)) &&
              header.readUInt32LE(4) + 8 === bytes.byteLength
            : ascii(4, 8) === "ftyp" &&
              header.readUInt32BE(0) >= 16 &&
              header.readUInt32BE(0) <= bytes.byteLength &&
              (ascii(8, 12) === "avif" || ascii(8, 12) === "avis");
    if (!signed) {
      throw new LocalNativeArtifactError("invalid-format");
    }
    let dimensions: ReturnType<typeof imageSize>;
    try {
      dimensions = imageSize(bytes);
    } catch {
      throw new LocalNativeArtifactError("invalid-format");
    }
    const { width, height } = dimensions;
    if (
      dimensions.type !== format ||
      !width ||
      !height ||
      width > 4096 ||
      height > 4096 ||
      width * height > 8_300_000
    ) {
      throw new LocalNativeArtifactError("invalid-format");
    }
    return format;
  }
  if (mimeType === "video/mp4") {
    if (bytes.byteLength < 16 || bytes.byteLength > MAX_NATIVE_MP4_BYTES) {
      throw new LocalNativeArtifactError("invalid-size");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const boxSize = view.getUint32(0);
    if (
      boxSize < 16 ||
      boxSize > bytes.byteLength ||
      Buffer.from(bytes.buffer, bytes.byteOffset + 4, 4).toString("ascii") !==
        "ftyp"
    ) {
      throw new LocalNativeArtifactError("invalid-format");
    }
    return "mp4";
  }
  if (mimeType === "image/svg+xml") {
    if (bytes.byteLength < 32 || bytes.byteLength > MAX_NATIVE_DOCUMENT_BYTES) {
      throw new LocalNativeArtifactError("invalid-size");
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new LocalNativeArtifactError("invalid-format");
    }
    await checkStaticSvg(source, true);
    return "svg";
  }
  if (mimeType === "text/html") {
    if (
      bytes.byteLength < 256 ||
      bytes.byteLength > MAX_NATIVE_DOCUMENT_BYTES
    ) {
      throw new LocalNativeArtifactError("invalid-size");
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new LocalNativeArtifactError("invalid-format");
    }
    if (
      !/^\s*<!doctype html\b/i.test(source) ||
      !/<html\b/i.test(source) ||
      !/data-agent-native-static-fallback\b/.test(source) ||
      !/src="data:image\/png;base64,[A-Za-z0-9+/=]+"/.test(source) ||
      !/data-agent-native-native-shader-runtime\b/.test(source) ||
      !/application\/x-agent-native-effects/.test(source)
    ) {
      throw new LocalNativeArtifactError("invalid-format");
    }
    return "html";
  }
  if (mimeType === "application/pdf") {
    if (bytes.byteLength < 32 || bytes.byteLength > MAX_NATIVE_DOCUMENT_BYTES) {
      throw new LocalNativeArtifactError("invalid-size");
    }
    const head = Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      Math.min(bytes.byteLength, 16),
    ).toString("ascii");
    const tail = Buffer.from(
      bytes.buffer,
      bytes.byteOffset + Math.max(0, bytes.byteLength - 1024),
      Math.min(bytes.byteLength, 1024),
    ).toString("ascii");
    if (!/^%PDF-1\.[0-9]/.test(head) || !/%%EOF\s*$/.test(tail)) {
      throw new LocalNativeArtifactError("invalid-format");
    }
    return "pdf";
  }
  if (mimeType === "application/zip") {
    if (bytes.byteLength < 64 || bytes.byteLength > MAX_NATIVE_DOCUMENT_BYTES) {
      throw new LocalNativeArtifactError("invalid-size");
    }
    const header = Buffer.from(bytes.buffer, bytes.byteOffset, 4);
    if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new LocalNativeArtifactError("invalid-format");
    }
    let archive: JSZip;
    try {
      archive = await JSZip.loadAsync(bytes);
    } catch {
      throw new LocalNativeArtifactError("invalid-format");
    }
    const expected = [
      "design.html",
      "Design.tsx",
      "design.css",
      "tailwind.css",
      "design-preview.png",
      "README.md",
    ];
    const files = Object.values(archive.files);
    if (
      files.length !== expected.length ||
      files.some((file) => file.dir || !expected.includes(file.name))
    ) {
      throw new LocalNativeArtifactError("invalid-format");
    }
    return "zip";
  }
  throw new LocalNativeArtifactError("invalid-format");
}

async function listArtifacts(root: string) {
  const entries: Array<{ filepath: string; size: number; modifiedMs: number }> =
    [];
  for (const owner of await readdir(root, { withFileTypes: true })) {
    if (!owner.isDirectory() || !/^[a-f0-9]{24}$/.test(owner.name)) continue;
    const ownerDir = path.join(root, owner.name);
    for (const entry of await readdir(ownerDir, { withFileTypes: true })) {
      if (!entry.isFile() || !ARTIFACT_NAME.test(entry.name)) continue;
      const filepath = path.join(ownerDir, entry.name);
      const info = await stat(filepath);
      entries.push({ filepath, size: info.size, modifiedMs: info.mtimeMs });
    }
  }
  return entries;
}

export async function storeLocalNativeExportArtifact(args: {
  email: string;
  designId: string;
  mimeType: string;
  bytes: Uint8Array;
  root?: string;
  now?: number;
}): Promise<LocalNativeArtifactMetadata> {
  const format = await checkBytes(args.bytes, args.mimeType);
  const root = args.root ?? localNativeArtifactRoot();
  if (pendingStores >= 2) {
    throw new LocalNativeArtifactError("storage-capacity");
  }
  pendingStores += 1;
  const now = args.now ?? Date.now();
  let release!: () => void;
  const previous = storageOperation;
  storageOperation = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const existing = await listArtifacts(root);
    const live = [];
    for (const item of existing) {
      if (item.modifiedMs + ARTIFACT_TTL_MS <= now) {
        await rm(item.filepath, { force: true });
      } else {
        live.push(item);
      }
    }
    if (
      live.length >= MAX_STORED_FILES ||
      live.reduce((total, item) => total + item.size, 0) +
        args.bytes.byteLength >
        MAX_STORED_BYTES
    ) {
      throw new LocalNativeArtifactError("storage-capacity");
    }

    const artifactId = `${randomUUID()}.${format}`;
    const filepath = localNativeArtifactPath(
      args.email,
      args.designId,
      artifactId,
      root,
    );
    if (!filepath) throw new LocalNativeArtifactError("storage-unavailable");
    await mkdir(path.dirname(filepath), { recursive: true, mode: 0o700 });
    await writeFile(filepath, args.bytes, { flag: "wx", mode: 0o600 });
    const expiry = setTimeout(() => {
      void rm(filepath, { force: true }).catch((error: unknown) => {
        console.error("Local native export artifact expiry failed", error);
      });
    }, ARTIFACT_TTL_MS);
    expiry.unref();
    return {
      artifactId,
      format,
      byteLength: args.bytes.byteLength,
      sha256: createHash("sha256").update(args.bytes).digest("hex"),
      expiresAt: new Date(now + ARTIFACT_TTL_MS).toISOString(),
    };
  } finally {
    pendingStores -= 1;
    release();
  }
}
