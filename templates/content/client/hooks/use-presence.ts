export interface PresenceUser {
  userId: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  lastSeen: number;
}

/**
 * Presence tracking stub. Returns an empty viewer list.
 * The original implementation used Firestore for real-time presence,
 * which has been removed.
 */
export function usePresence(_filePath: string | null): PresenceUser[] {
  return [];
}
