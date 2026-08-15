import {
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import type { PrivateBlobHandle } from "@agent-native/core/private-blob";

export interface ChunkedUploadSession {
  filename: string;
  mimeType: string;
  declaredSize: number;
  chunks: Record<string, PrivateBlobHandle>;
}

const key = (sessionId: string) => `slides-upload-chunks-${sessionId}`;

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

export async function setChunkedUploadSession(
  sessionId: string,
  session: ChunkedUploadSession,
): Promise<void> {
  await writeAppState(
    key(sessionId),
    session as unknown as Record<string, unknown>,
  );
}

export async function deleteChunkedUploadSession(
  sessionId: string,
): Promise<void> {
  await deleteAppState(key(sessionId));
}
