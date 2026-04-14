import type { H3Event } from "h3";
import { getSession } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export function parseDocumentFavorite(
  value: boolean | number | string | null | undefined,
): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "t";
  }
  return false;
}

export function getCurrentOwnerEmail(): string {
  return getRequestUserEmail() || "local@localhost";
}

export async function getEventOwnerEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
}
