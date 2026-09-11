import { Directory, File, Paths } from "expo-file-system";

const CAPTURE_DIRECTORY_NAME = "captures";
const ORPHAN_CAPTURE_RETENTION_MS = 24 * 60 * 60 * 1_000;

export interface RecoverableCaptureFile {
  captureId: string;
  kind: "meeting" | "video";
  localUri: string;
  mimeType: string;
  title: string;
}

interface PersistedCaptureFileLike {
  extension: string;
  modificationTime?: number | null;
  name: string;
  size: number;
  uri: string;
}

interface CaptureSweepOptions {
  minimumAgeMs?: number;
  nowMs?: number;
}

function safeExtension(mimeType: string, uri: string): string {
  if (/audio\/(?:mp4|m4a)/i.test(mimeType)) return "m4a";
  if (/video\/(?:mp4|quicktime)/i.test(mimeType)) return "mp4";
  if (/video\/webm/i.test(mimeType)) return "webm";
  const uriExtension = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(uri)?.[1];
  return uriExtension?.toLowerCase() || "bin";
}

function captureDirectory(): Directory {
  const directory = new Directory(Paths.document, CAPTURE_DIRECTORY_NAME);
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
  return directory;
}

export async function persistCaptureFile(
  uri: string,
  mimeType: string,
  captureId: string,
): Promise<string> {
  const source = new File(uri);
  if (!source.exists)
    throw new Error("The captured file is no longer available.");

  const safeCaptureId = captureId.trim().replace(/[^a-z0-9_-]/gi, "-");
  if (!safeCaptureId) throw new Error("The capture id is invalid.");
  const name = `${safeCaptureId}.${safeExtension(mimeType, uri)}`;
  const destination = new File(captureDirectory(), name);
  if (destination.exists) return destination.uri;
  await source.copy(destination);
  return destination.uri;
}

export function findOrphanedCaptureUris(
  persistedUris: string[],
  referencedUris: Iterable<string>,
): string[] {
  const referenced = new Set(referencedUris);
  return persistedUris.filter((uri) => !referenced.has(uri));
}

export function listRecoverableCaptureFiles(
  referencedUris: Iterable<string>,
): RecoverableCaptureFile[] {
  const referenced = new Set(referencedUris);
  return captureDirectory()
    .list()
    .filter((entry): entry is File => entry instanceof File)
    .flatMap((file) =>
      referenced.has(file.uri) ? [] : recoverableCaptureFromFile(file),
    );
}

export function recoverableCaptureFromFile(
  file: PersistedCaptureFileLike,
): RecoverableCaptureFile[] {
  if (file.size <= 0) return [];
  const extension = file.extension.toLowerCase();
  const captureId = file.name.slice(0, -(extension.length + 1));
  if (!captureId || !/^[a-z0-9_-]{8,200}$/i.test(captureId)) return [];
  if (extension === "m4a" || extension === "aac") {
    return [
      {
        captureId,
        kind: "meeting",
        localUri: file.uri,
        mimeType: extension === "aac" ? "audio/aac" : "audio/mp4",
        title: "Recovered audio capture",
      },
    ];
  }
  if (extension === "mp4" || extension === "webm") {
    return [
      {
        captureId,
        kind: "video",
        localUri: file.uri,
        mimeType: extension === "webm" ? "video/webm" : "video/mp4",
        title: "Recovered video capture",
      },
    ];
  }
  return [];
}

export function sweepOrphanedCaptureFiles(
  referencedUris: Iterable<string>,
  options: CaptureSweepOptions = {},
) {
  const files = captureDirectory()
    .list()
    .filter((entry): entry is File => entry instanceof File);
  const orphanedUris = new Set(
    findOrphanedCaptureUris(
      files.map((file) => file.uri),
      referencedUris,
    ),
  );
  const nowMs = options.nowMs ?? Date.now();
  const minimumAgeMs = options.minimumAgeMs ?? ORPHAN_CAPTURE_RETENTION_MS;
  const sweepableFiles = files.filter(
    (file) =>
      orphanedUris.has(file.uri) &&
      typeof file.modificationTime === "number" &&
      nowMs - file.modificationTime >= minimumAgeMs,
  );
  for (const file of sweepableFiles) {
    if (file.exists) file.delete();
  }
  return sweepableFiles.map((file) => file.uri);
}

export function removePersistedCaptureFile(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}
