import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  clearSessionToken,
  getSessionToken,
  saveSessionToken,
} from "./session-token-store";

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
  const [token, ownerKeyValue] = await Promise.all([
    getSessionToken(CLIPS_SESSION_TOKEN_KEY),
    AsyncStorage.getItem(CLIPS_SESSION_OWNER_KEY),
  ]);
  const ownerKey = clean(ownerKeyValue);
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
  await saveSessionToken(session.token, CLIPS_SESSION_TOKEN_KEY);
  await AsyncStorage.setItem(CLIPS_SESSION_OWNER_KEY, session.ownerKey);
  return session;
}

export async function clearClipsSession(): Promise<void> {
  await Promise.all([
    clearSessionToken(CLIPS_SESSION_TOKEN_KEY),
    AsyncStorage.removeItem(CLIPS_SESSION_OWNER_KEY),
  ]);
}
