import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function requireActor(): { ownerEmail: string; orgId: string | null } {
  const ownerEmail = getRequestUserEmail()?.trim().toLowerCase();
  if (!ownerEmail) throw new Error("Not authenticated");
  return { ownerEmail, orgId: getRequestOrgId() ?? null };
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function nextOffsetCursor(
  offset: number,
  limit: number,
  hasMore: boolean,
): string | undefined {
  return hasMore ? String(offset + limit) : undefined;
}
