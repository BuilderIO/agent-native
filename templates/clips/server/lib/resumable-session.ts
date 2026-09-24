import {
  compareAndSetAppState,
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";

export interface StoredResumableSession {
  providerId: string;
  sessionId: string;
  meta: Record<string, unknown>;
  bytesUploaded: number;
  lastCommittedIndex?: number;
  providerClosed?: boolean;
}

export async function compareAndSetResumableSession(
  recordingId: string,
  expected: StoredResumableSession,
  next: StoredResumableSession,
  generationId?: string | null,
): Promise<boolean> {
  return compareAndSetAppState(
    key(recordingId, generationId),
    expected as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
  );
}

const key = (recordingId: string, generationId?: string | null) =>
  generationId
    ? `resumable-session-${recordingId}-${generationId}`
    : `resumable-session-${recordingId}`;

export async function getResumableSession(
  recordingId: string,
  generationId?: string | null,
): Promise<StoredResumableSession | null> {
  const raw = await readAppState(key(recordingId, generationId));
  if (!raw || typeof raw !== "object") return null;
  return raw as unknown as StoredResumableSession;
}

export async function setResumableSession(
  recordingId: string,
  session: StoredResumableSession,
  generationId?: string | null,
): Promise<void> {
  await writeAppState(
    key(recordingId, generationId),
    session as unknown as Record<string, unknown>,
  );
}

export async function deleteResumableSession(
  recordingId: string,
  generationId?: string | null,
): Promise<void> {
  await deleteAppState(key(recordingId, generationId));
}
