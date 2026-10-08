import {
  compareAndSetAppState,
  deleteAppState,
  listAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import type { PrivateBlobHandle } from "@agent-native/core/private-blob";
import { nanoid } from "nanoid";

export interface ChunkedUploadSession {
  uploadType?: "reference" | "video";
  finalizingAt?: string;
  finalizationLeaseExpiresAt?: string;
  cleanupState?: "aborting";
  ownerEmail?: string;
  orgId?: string | null;
  filename: string;
  mimeType: string;
  declaredSize: number;
  chunks: Record<string, PrivateBlobHandle>;
  chunkSizes: Record<string, number>;
  createdAt: string;
  expiresAt: string;
}

const PREFIX = "slides-upload-chunks-";
const ORPHAN_PREFIX = "slides-upload-orphan-chunk-";
const key = (sessionId: string) => `${PREFIX}${sessionId}`;

export interface OrphanedChunkCleanup {
  version: 1;
  ownerEmail: string;
  orgId: string | null;
  uploadSessionId: string;
  chunkIndex: number;
  handle: PrivateBlobHandle;
  createdAt: string;
}

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

export async function compareAndSetChunkedUploadSession(
  sessionId: string,
  expectedSession: ChunkedUploadSession,
  nextSession: ChunkedUploadSession,
): Promise<boolean> {
  return compareAndSetAppState(
    key(sessionId),
    expectedSession as unknown as Record<string, unknown>,
    nextSession as unknown as Record<string, unknown>,
  );
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

export async function recordOrphanedChunkCleanup(
  cleanup: OrphanedChunkCleanup,
): Promise<string> {
  const cleanupKey = `${ORPHAN_PREFIX}${nanoid()}`;
  await writeAppState(
    cleanupKey,
    cleanup as unknown as Record<string, unknown>,
  );
  return cleanupKey;
}

export async function listOrphanedChunkCleanups(): Promise<
  Array<{ key: string; cleanup: OrphanedChunkCleanup }>
> {
  const entries = await listAppState(ORPHAN_PREFIX);
  return entries.map(({ key: entryKey, value }) => ({
    key: entryKey,
    cleanup: value as unknown as OrphanedChunkCleanup,
  }));
}

export async function deleteOrphanedChunkCleanup(key: string): Promise<void> {
  await deleteAppState(key);
}
