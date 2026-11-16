import JSZip from "jszip";

/** Limits on one picked archive, after the plan's zip section. */
export interface ImportZipLimits {
  /** Bytes of the archive as picked. */
  compressedBytes: number;
  /** Bytes of every file it holds once inflated, nested archives included. */
  uncompressedBytes: number;
  /** Files it holds, nested archives' files included. */
  entries: number;
}

export const IMPORT_ZIP_LIMITS: ImportZipLimits = {
  compressedBytes: 50 * 1024 * 1024,
  uncompressedBytes: 200 * 1024 * 1024,
  entries: 500,
};

export type ImportZipErrorCode =
  | "too-large"
  | "too-many-entries"
  | "expands-too-large"
  | "unreadable";

export class ImportZipError extends Error {
  constructor(
    readonly code: ImportZipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportZipError";
  }
}

export interface ImportZipEntry {
  /** `/`-separated path inside the archive, never absolute or climbing out. */
  path: string;
  data: Uint8Array<ArrayBuffer>;
}

/** An archive file that was left out, named so the preview can list it. */
export interface ImportZipSkippedEntry {
  name: string;
  reason: "invalid-name" | "nested-archive";
}

interface ZipStream {
  on(event: "data", listener: (chunk: Uint8Array) => void): ZipStream;
  on(event: "end", listener: () => void): ZipStream;
  on(event: "error", listener: (error: unknown) => void): ZipStream;
  pause(): ZipStream;
  resume(): ZipStream;
}

/**
 * Reads a picked `.zip` into the files an import works with. Notion splits a
 * large export into an outer zip of `Part-N.zip` archives, so an archive at
 * the top of the outer one is opened, one level deep, and its files join the
 * outer ones at the same paths. macOS archive litter (`__MACOSX`,
 * `.DS_Store`) is left out quietly.
 * A path that is absolute or climbs out with `..` is refused by name.
 *
 * Files are inflated one at a time and counted as they stream, so an archive
 * that claims small sizes but inflates past the limit stops at the limit
 * instead of filling memory.
 */
export async function readImportZip(
  input: Blob | ArrayBuffer | Uint8Array,
  limits: ImportZipLimits = IMPORT_ZIP_LIMITS,
): Promise<{ entries: ImportZipEntry[]; skipped: ImportZipSkippedEntry[] }> {
  const size = input instanceof Blob ? input.size : input.byteLength;
  if (size > limits.compressedBytes) {
    throw new ImportZipError(
      "too-large",
      `The archive is larger than ${megabytes(limits.compressedBytes)} MB.`,
    );
  }
  const state = { entries: 0, bytes: 0 };
  const entries: ImportZipEntry[] = [];
  const skipped: ImportZipSkippedEntry[] = [];
  await readArchive(input, 0, limits, state, entries, skipped);
  return { entries, skipped };
}

async function readArchive(
  input: Blob | ArrayBuffer | Uint8Array,
  depth: number,
  limits: ImportZipLimits,
  state: { entries: number; bytes: number },
  entries: ImportZipEntry[],
  skipped: ImportZipSkippedEntry[],
): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new ImportZipError(
      "unreadable",
      "The archive can't be read as a zip file.",
    );
  }
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    const written = (file.unsafeOriginalName ?? file.name).replace(/\\/g, "/");
    if (isArchiveLitter(written)) continue;
    const path = archivePath(written);
    if (!path) {
      skipped.push({ name: written, reason: "invalid-name" });
      continue;
    }
    const nested = /\.zip$/i.test(path);
    // Notion's parts sit at the top of the outer archive. A zip deeper in is
    // a file someone attached to a page, not part of the export.
    if (nested && (depth > 0 || path.includes("/"))) {
      skipped.push({ name: path, reason: "nested-archive" });
      continue;
    }
    if (!nested && ++state.entries > limits.entries) {
      throw new ImportZipError(
        "too-many-entries",
        `The archive holds more than ${limits.entries} files.`,
      );
    }
    // A nested archive counts against the compressed limit, not the inflated
    // one: its own files are counted as it is read.
    const data = await inflate(
      file,
      nested ? limits.compressedBytes : limits.uncompressedBytes - state.bytes,
      () =>
        new ImportZipError(
          nested ? "too-large" : "expands-too-large",
          nested
            ? `An archive inside it is larger than ${megabytes(limits.compressedBytes)} MB.`
            : `The archive's files add up to more than ${megabytes(limits.uncompressedBytes)} MB.`,
        ),
    );
    if (nested) {
      await readArchive(data, depth + 1, limits, state, entries, skipped);
      continue;
    }
    state.bytes += data.byteLength;
    entries.push({ path, data });
  }
}

function inflate(
  file: JSZip.JSZipObject,
  budget: number,
  overBudget: () => ImportZipError,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    let settled = false;
    const stream = (
      file as unknown as { internalStream(type: "uint8array"): ZipStream }
    ).internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        if (settled) return;
        length += chunk.byteLength;
        if (length > budget) {
          settled = true;
          stream.pause();
          reject(overBudget());
          return;
        }
        chunks.push(chunk);
      })
      .on("error", () => {
        if (settled) return;
        settled = true;
        reject(
          new ImportZipError(
            "unreadable",
            `${file.name} in the archive can't be read.`,
          ),
        );
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        const data = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(data);
      })
      .resume();
  });
}

function isArchiveLitter(path: string): boolean {
  const segments = path.split("/");
  return (
    segments.includes("__MACOSX") || segments[segments.length - 1] === ".DS_Store"
  );
}

/** The archive path as an import path, or null when it is absolute or climbs out. */
function archivePath(written: string): string | null {
  if (/^(?:\/|[a-z]:)/i.test(written)) return null;
  const segments: string[] = [];
  for (const segment of written.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.length ? segments.join("/") : null;
}

function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}
