import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { isAttachmentRef } from "@agent-native/core/private-blob";

const MAX_THREAD_UPLOADS = 50;
const MAX_WRITE_ATTEMPTS = 5;

export interface ThreadUpload {
  name: string;
  path: string;
}

function threadUploadsKey(threadId: string): string {
  return `slides-thread-uploads:${threadId}`;
}

function parseThreadUploads(value: unknown): ThreadUpload[] {
  const files = (value as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file: unknown) => {
    if (!file || typeof file !== "object") return [];
    const { name, path } = file as { name?: unknown; path?: unknown };
    return typeof name === "string" &&
      typeof path === "string" &&
      isAttachmentRef(path)
      ? [{ name, path }]
      : [];
  });
}

/**
 * Later turns replay an earlier attachment as its name alone, without the
 * upload reference it was saved under, so the thread keeps that mapping.
 */
export async function rememberThreadUploads(
  threadId: string,
  uploads: readonly ThreadUpload[],
): Promise<void> {
  const fresh = uploads.filter((upload) => isAttachmentRef(upload.path));
  if (fresh.length === 0) return;
  const key = threadUploadsKey(threadId);
  const freshPaths = new Set(fresh.map((upload) => upload.path));
  // Two turns can save uploads for one thread at once; a plain write would
  // drop the other turn's files, so each write lands only on what it read.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const current = await readAppState(key);
    const files = [
      ...parseThreadUploads(current).filter(
        (upload) => !freshPaths.has(upload.path),
      ),
      ...fresh,
    ].slice(-MAX_THREAD_UPLOADS);
    if (await compareAndSetAppState(key, current, { files })) return;
  }
  throw new Error(
    `Could not record this thread's uploads after ${MAX_WRITE_ATTEMPTS} concurrent updates.`,
  );
}

export async function readThreadUploads(
  threadId: string,
): Promise<ThreadUpload[]> {
  return parseThreadUploads(await readAppState(threadUploadsKey(threadId)));
}
