import fs from "fs";
import path from "path";

import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  setResponseStatus,
  readMultipartFormData,
} from "h3";
import { nanoid } from "nanoid";

import {
  SLIDES_REFERENCE_FILE_ERROR_LABEL,
  isSlidesReferenceFileExtension,
} from "../../shared/upload-types";
import { tenantUploadDir } from "../lib/tenant-files.js";
import { canSaveAsUploadedAsset, uploadImageAsset } from "./assets.js";

export const MAX_REFERENCE_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FIG_REFERENCE_FILE_BYTES = 200 * 1024 * 1024;
const FIG_LOCAL_COPY_SIGNATURE = new Uint8Array([
  0x66, 0x69, 0x67, 0x2d, 0x6b, 0x69, 0x77, 0x69,
]);

export interface UploadedReferenceFile {
  path: string;
  url?: string;
  originalName: string;
  filename: string;
  type: string;
  size: number;
}

function safeFilename(originalName: string): string | null {
  const ext = path.extname(originalName).toLowerCase();
  if (!isSlidesReferenceFileExtension(ext)) return null;
  // Filename uniqueness comes from nanoid (~21 chars, ~126 bits of entropy),
  // not `Date.now()` — second-resolution timestamps are guessable and let
  // someone with the per-tenant URL prefix probe the upload window. The
  // tenant subdir already namespaces by user; nanoid makes the leaf
  // unguessable too. (audit 10 medium / audit 01 medium).
  return `${nanoid()}${ext}`;
}

function ascii(data: Uint8Array, start: number, end: number): string {
  return Buffer.from(data.subarray(start, end)).toString("ascii");
}

export function maxReferenceFileBytes(
  originalName: string | undefined,
): number {
  return path.extname(originalName ?? "").toLowerCase() === ".fig"
    ? MAX_FIG_REFERENCE_FILE_BYTES
    : MAX_REFERENCE_FILE_BYTES;
}

function formatMaxFileSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function hasExpectedSignature(ext: string, data: Uint8Array): boolean {
  if (ext === ".pdf") {
    return ascii(data, 0, 5) === "%PDF-";
  }
  if (ext === ".pptx" || ext === ".docx") {
    return data[0] === 0x50 && data[1] === 0x4b;
  }
  if (ext === ".fig") {
    const isZip = data[0] === 0x50 && data[1] === 0x4b;
    const isLocalCopy = FIG_LOCAL_COPY_SIGNATURE.every(
      (byte, index) => data[index] === byte,
    );
    return isZip || isLocalCopy;
  }
  if (ext === ".png") {
    return (
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    );
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (ext === ".gif") {
    const header = ascii(data, 0, 6);
    return header === "GIF87a" || header === "GIF89a";
  }
  if (ext === ".webp") {
    return ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP";
  }
  if (ext === ".svg") {
    const head = Buffer.from(
      data.subarray(0, Math.min(data.length, 8192)),
    ).toString("utf8");
    const normalized = head.replace(/^\uFEFF/, "").trimStart();
    return (
      /^<svg(?:\s|>)/i.test(normalized) ||
      /^<\?xml\b[\s\S]{0,4096}<svg(?:\s|>)/i.test(normalized)
    );
  }
  return !data.subarray(0, 4096).includes(0);
}

function pathForAgent(absPath: string): string {
  const relative = path.relative(process.cwd(), absPath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return absPath;
}

export async function saveUploadedReferenceFile(args: {
  email: string;
  originalName: string;
  data: Uint8Array;
  type?: string;
}): Promise<UploadedReferenceFile> {
  const filename = safeFilename(args.originalName);
  if (!filename) {
    throw new Error(
      `Unsupported file type. Allowed: ${SLIDES_REFERENCE_FILE_ERROR_LABEL}.`,
    );
  }
  const ext = path.extname(filename).toLowerCase();
  if (!hasExpectedSignature(ext, args.data)) {
    throw new Error(`File contents do not match ${ext} upload type`);
  }
  const uploadDir = tenantUploadDir(args.email);
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const destPath = path.join(uploadDir, filename);
  await fs.promises.writeFile(destPath, args.data);
  // For images, also push to the file-upload provider so the agent can embed
  // a hosted URL (in slide HTML, chat replies, etc.). For non-image reference
  // files (PPTX, DOCX, PDF), the on-disk path is what the agent uses via
  // shell — no provider URL is required.
  let url: string | undefined;
  if (
    canSaveAsUploadedAsset({
      originalName: args.originalName,
      data: args.data,
    })
  ) {
    try {
      url = (
        await uploadImageAsset({
          email: args.email,
          originalName: args.originalName,
          data: args.data,
          type: args.type,
        })
      ).url;
    } catch {
      // No provider configured or upload failed — the agent still has the
      // on-disk path. The caller's UI can prompt the user to connect a
      // provider if it needs a public URL.
      url = undefined;
    }
  }
  return {
    path: pathForAgent(destPath),
    url,
    originalName: args.originalName,
    filename,
    type: args.type || "application/octet-stream",
    size: args.data.length,
  };
}

// Upload one or more files
export const uploadFiles = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const parts = await readMultipartFormData(event);
  const fileParts =
    parts?.filter((p) => (p.name === "files" || p.name === "file") && p.data) ??
    [];

  if (fileParts.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No files uploaded" };
  }

  const MAX_FILES = 20;

  if (fileParts.length > MAX_FILES) {
    setResponseStatus(event, 413);
    return { error: `Too many files (max ${MAX_FILES})` };
  }

  const oversized = fileParts.find(
    (p) => p.data.length > maxReferenceFileBytes(p.filename),
  );
  if (oversized) {
    const limit = maxReferenceFileBytes(oversized.filename);
    setResponseStatus(event, 413);
    return { error: `File too large (max ${formatMaxFileSize(limit)})` };
  }

  let results;
  try {
    results = await Promise.all(
      fileParts.map(async (part) => {
        return saveUploadedReferenceFile({
          email: session.email,
          originalName: part.filename || "upload",
          data: part.data,
          type: part.type,
        });
      }),
    );
  } catch (err) {
    setResponseStatus(event, 400);
    return { error: err instanceof Error ? err.message : "Invalid upload" };
  }

  return results;
});
