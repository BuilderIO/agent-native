import AsyncStorage from "@react-native-async-storage/async-storage";

export const CLIPS_SESSION_TOKEN_KEY = "agent-native:session-token:clips";
export const CLIPS_SESSION_OWNER_KEY = "agent-native:session-owner:clips";

export interface ClipsSession {
  token: string;
  ownerKey: string;
}

function clean(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

export function clipsSessionOwnerKey(
  email: string,
  orgId?: string | null,
): string {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Clips session is missing its owner");
  return JSON.stringify([normalizedEmail, orgId?.trim() || null]);
}

export async function getClipsSession(): Promise<ClipsSession | null> {
  const entries = await AsyncStorage.multiGet([
    CLIPS_SESSION_TOKEN_KEY,
    CLIPS_SESSION_OWNER_KEY,
  ]);
  const token = clean(entries[0]?.[1]);
  const ownerKey = clean(entries[1]?.[1]);
  return token && ownerKey ? { token, ownerKey } : null;
}

export async function saveClipsSession(
  token: string,
  email: string,
  orgId?: string | null,
): Promise<ClipsSession> {
  const session = {
    token: token.trim(),
    ownerKey: clipsSessionOwnerKey(email, orgId),
  };
  if (!session.token) throw new Error("Clips session token is missing");
  await AsyncStorage.multiSet([
    [CLIPS_SESSION_TOKEN_KEY, session.token],
    [CLIPS_SESSION_OWNER_KEY, session.ownerKey],
  ]);
  return session;
}

export async function clearClipsSession(): Promise<void> {
  await AsyncStorage.multiRemove([
    CLIPS_SESSION_TOKEN_KEY,
    CLIPS_SESSION_OWNER_KEY,
  ]);
}
