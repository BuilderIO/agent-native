import {
  deleteAppState,
  listAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import type { PrivateBlobHandle } from "@agent-native/core/private-blob";

export interface ChunkedUploadSession {
  filename: string;
  mimeType: string;
  declaredSize: number;
  chunks: Record<string, PrivateBlobHandle>;
  chunkSizes: Record<string, number>;
  createdAt: string;
  expiresAt: string;
}

const PREFIX = "slides-upload-chunks-";
const key = (sessionId: string) => `${PREFIX}${sessionId}`;

export async function createChunkedUploadSession(
  sessionId: string,
  session: ChunkedUploadSession,
): Promise<void> {
  await writeAppState(
    key(sessionId),
    session as unknown as Record<string, unknown>,
  );
}

export async function getChunkedUploadSession(
  sessionId: string,
): Promise<ChunkedUploadSession | null> {
  const raw = await readAppState(key(sessionId));
  if (!raw || typeof raw !== "object") return null;
  return raw as unknown as ChunkedUploadSession;
}

export async function listChunkedUploadSessions(): Promise<
  Array<{ sessionId: string; session: ChunkedUploadSession }>
> {
  const entries = await listAppState(PREFIX);
  return entries.map(({ key: entryKey, value }) => ({
    sessionId: entryKey.slice(PREFIX.length),
    session: value as unknown as ChunkedUploadSession,
  }));
}

export async function deleteChunkedUploadSession(
  sessionId: string,
): Promise<void> {
  await deleteAppState(key(sessionId));
}
