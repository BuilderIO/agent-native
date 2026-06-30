import {
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
}

const key = (recordingId: string) => `resumable-session-${recordingId}`;

export async function getResumableSession(
  recordingId: string,
): Promise<StoredResumableSession | null> {
  const raw = await readAppState(key(recordingId));
  if (!raw || typeof raw !== "object") return null;
  return raw as unknown as StoredResumableSession;
}

export async function setResumableSession(
  recordingId: string,
  session: StoredResumableSession,
): Promise<void> {
  await writeAppState(
    key(recordingId),
    session as unknown as Record<string, unknown>,
  );
}

export async function deleteResumableSession(
  recordingId: string,
): Promise<void> {
  await deleteAppState(key(recordingId));
}
