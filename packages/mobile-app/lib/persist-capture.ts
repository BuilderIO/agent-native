import { Directory, File, Paths } from "expo-file-system";

const CAPTURE_DIRECTORY_NAME = "captures";

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
): Promise<string> {
  const source = new File(uri);
  if (!source.exists)
    throw new Error("The captured file is no longer available.");

  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExtension(mimeType, uri)}`;
  const destination = new File(captureDirectory(), name);
  await source.copy(destination);
  return destination.uri;
}

export function removePersistedCaptureFile(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}
