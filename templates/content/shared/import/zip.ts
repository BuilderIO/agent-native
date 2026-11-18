import JSZip from "jszip";

export interface ImportZipLimits {
  compressedBytes: number;
  uncompressedBytes: number;
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
  path: string;
  data: Uint8Array<ArrayBuffer>;
}

export interface ImportZipUsage {
  entries: number;
  bytes: number;
  listed: number;
}

export function newImportZipUsage(): ImportZipUsage {
  return { entries: 0, bytes: 0, listed: 0 };
}

const LISTED_ENTRIES_PER_FILE = 10;

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

export async function readImportZip(
  input: Blob | ArrayBuffer | Uint8Array,
  limits: ImportZipLimits = IMPORT_ZIP_LIMITS,
  usage: ImportZipUsage = newImportZipUsage(),
): Promise<{ entries: ImportZipEntry[]; skipped: ImportZipSkippedEntry[] }> {
  const size = input instanceof Blob ? input.size : input.byteLength;
  if (size > limits.compressedBytes) {
    throw new ImportZipError(
      "too-large",
      `The archive is larger than ${megabytes(limits.compressedBytes)} MB.`,
    );
  }
  const read: ArchiveRead = {
    usage,
    archiveBytes: 0,
    entries: [],
    skipped: [],
  };
  await readArchive(input, 0, limits, read);
  return { entries: read.entries, skipped: read.skipped };
}

interface ArchiveRead {
  usage: ImportZipUsage;
  archiveBytes: number;
  entries: ImportZipEntry[];
  skipped: ImportZipSkippedEntry[];
}

async function readArchive(
  input: Blob | ArrayBuffer | Uint8Array,
  depth: number,
  limits: ImportZipLimits,
  read: ArchiveRead,
): Promise<void> {
  const { usage, entries, skipped } = read;
  const bytes =
    input instanceof Blob
      ? new Uint8Array(await input.arrayBuffer())
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  usage.listed += listedEntries(bytes);
  if (usage.listed > limits.entries * LISTED_ENTRIES_PER_FILE) {
    throw new ImportZipError(
      "too-many-entries",
      `The archive lists more than ${limits.entries * LISTED_ENTRIES_PER_FILE} entries.`,
    );
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
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
    if (nested && (depth > 0 || path.includes("/"))) {
      skipped.push({ name: path, reason: "nested-archive" });
      continue;
    }
    if (++usage.entries > limits.entries) {
      throw new ImportZipError(
        "too-many-entries",
        `The archive holds more than ${limits.entries} files.`,
      );
    }
    const data = await inflate(
      file,
      nested
        ? limits.compressedBytes - read.archiveBytes
        : limits.uncompressedBytes - usage.bytes,
      () =>
        new ImportZipError(
          nested ? "too-large" : "expands-too-large",
          nested
            ? `The archives inside it add up to more than ${megabytes(limits.compressedBytes)} MB.`
            : `The archive's files add up to more than ${megabytes(limits.uncompressedBytes)} MB.`,
        ),
    );
    if (nested) {
      read.archiveBytes += data.byteLength;
      await readArchive(data, depth + 1, limits, read);
      continue;
    }
    usage.bytes += data.byteLength;
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

function listedEntries(bytes: Uint8Array): number {
  let count = 0;
  for (
    let at = bytes.indexOf(0x50);
    at !== -1;
    at = bytes.indexOf(0x50, at + 1)
  ) {
    if (bytes[at + 1] === 0x4b && bytes[at + 2] === 1 && bytes[at + 3] === 2) {
      count++;
    }
  }
  return count;
}

function isArchiveLitter(path: string): boolean {
  const segments = path.split("/");
  return (
    segments.includes("__MACOSX") ||
    segments[segments.length - 1] === ".DS_Store"
  );
}

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
