export interface CollabUser {
  name: string;
  email: string;
  color: string;
  avatarUrl?: string;
}

export type PresencePayload = Record<string, unknown>;

export interface OtherPresence {
  clientId: number;
  user: CollabUser;
  presence: PresencePayload;
  isAgent: boolean;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export type RecentEditDescriptor =
  | { kind: "text"; quote: string }
  | { kind: "selector"; selector: string }
  | { kind: "paths"; paths: string[] }
  | { kind: "doc" }
  | { kind: string; [key: string]: unknown };

export interface RecentEdit {
  descriptor: RecentEditDescriptor;
  label?: string;
  at: number;
}

export interface AttributedRecentEdit extends RecentEdit {
  clientId: number;
  user: OtherPresence["user"];
  isAgent: boolean;
}

export const RECENT_EDITS_MAX = 5;
export const RECENT_EDIT_TTL_MS = 10_000;

const CURSOR_COLORS = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#a3e635",
  "#34d399",
  "#22d3ee",
  "#60a5fa",
  "#14b8a6",
  "#f472b6",
  "#e879f9",
];

export function emailToColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

export function emailToName(email: string): string {
  const local = email.split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function normalizeCollabEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function dedupeCollabUsersByEmail(users: CollabUser[]): CollabUser[] {
  const byEmail = new Map<string, CollabUser>();
  for (const user of users) {
    const email = normalizeCollabEmail(user.email);
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, {
      name: user.name || emailToName(email),
      email,
      color: user.color || emailToColor(email),
    });
  }
  return Array.from(byEmail.values());
}
