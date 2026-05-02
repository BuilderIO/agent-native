import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import * as googleCalendar from "../server/lib/google-calendar.js";

export const cliBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export function requireActionUserEmail(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return email;
}

export function normalizeGoogleEventId(id: string): string {
  return id.startsWith("google-") ? id.slice("google-".length) : id;
}

export async function resolveOwnedAccountEmail(
  requestedAccountEmail: string | undefined,
  ownerEmail: string,
): Promise<string> {
  const status = await googleCalendar.getAuthStatus(ownerEmail);
  if (!requestedAccountEmail) {
    if (status.accounts.length === 1) {
      return status.accounts[0].email;
    }
    if (status.accounts.length > 1) {
      throw new Error(
        "Multiple Google Calendar accounts are connected. Pass accountEmail from list-events/search-events.",
      );
    }
    return ownerEmail;
  }
  if (requestedAccountEmail === ownerEmail) {
    return ownerEmail;
  }
  const isOwned = status.accounts.some(
    (account) => account.email === requestedAccountEmail,
  );
  if (!isOwned) throw new Error("Account not owned by current user");
  return requestedAccountEmail;
}

export function normalizeRecurrence(
  recurrence: string | string[] | undefined,
): string[] | undefined {
  if (recurrence === undefined) return undefined;
  if (Array.isArray(recurrence)) {
    return recurrence.map((rule) => rule.trim()).filter(Boolean);
  }
  const trimmed = recurrence.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\r?\n/)
    .map((rule) => rule.trim())
    .filter(Boolean);
}
