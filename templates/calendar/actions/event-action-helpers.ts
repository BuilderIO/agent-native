import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import * as googleCalendar from "../server/lib/google-calendar.js";

export const cliBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export const eventTypeInput = z
  .enum(["default", "outOfOffice", "focusTime", "workingLocation"])
  .optional();

export const availabilityInput = z.enum(["opaque", "transparent"]).optional();

export const visibilityInput = z
  .enum(["default", "public", "private", "confidential"])
  .optional();

export const googleColorIdInput = z
  .enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"])
  .optional();

export const reminderMethodInput = z.enum(["popup", "email"]).optional();

export const reminderMinutesInput = z.coerce
  .number()
  .int()
  .min(0)
  .max(40320)
  .optional();

export const remindersInput = z
  .array(
    z.object({
      method: z.enum(["popup", "email"]),
      minutes: z.coerce.number().int().min(0).max(40320),
    }),
  )
  .max(5)
  .optional();

export const attachmentsInput = z
  .array(
    z.object({
      fileUrl: z.string().url(),
      title: z.string().min(1),
      mimeType: z.string().optional(),
      iconLink: z.string().url().optional(),
      fileId: z.string().optional(),
    }),
  )
  .max(25)
  .optional();

export const workingLocationTypeInput = z
  .enum(["homeOffice", "officeLocation", "customLocation"])
  .optional();

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

export function extractVideoLink(event: {
  location?: string;
  description?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
}): string | undefined {
  const conferenceLink = event.conferenceData?.entryPoints?.find(
    (entryPoint) => entryPoint.entryPointType === "video" && entryPoint.uri,
  )?.uri;
  if (conferenceLink) return conferenceLink;
  if (event.hangoutLink) return event.hangoutLink;

  const text = `${event.location || ""}\n${event.description || ""}`;
  return (
    text.match(/https?:\/\/[^\s<>"')]*zoom\.us\/[^\s<>"')]+/i)?.[0] ||
    text.match(/https?:\/\/meet\.google\.com\/[^\s<>"')]+/i)?.[0] ||
    text.match(/https?:\/\/teams\.microsoft\.com\/[^\s<>"')]+/i)?.[0]
  );
}

export function buildReminderOverrides(args: {
  reminders?: Array<{ method: "popup" | "email"; minutes: number }>;
  reminderMinutes?: number;
  reminderMethod?: "popup" | "email";
  useDefaultReminders?: boolean;
}): {
  reminders?: Array<{ method: "popup" | "email"; minutes: number }>;
  remindersUseDefault?: boolean;
} {
  if (args.useDefaultReminders !== undefined) {
    return args.useDefaultReminders
      ? { remindersUseDefault: true }
      : { remindersUseDefault: false, reminders: args.reminders ?? [] };
  }
  if (args.reminders !== undefined) {
    return { remindersUseDefault: false, reminders: args.reminders };
  }
  if (args.reminderMinutes !== undefined) {
    return {
      remindersUseDefault: false,
      reminders: [
        {
          method: args.reminderMethod ?? "popup",
          minutes: args.reminderMinutes,
        },
      ],
    };
  }
  return {};
}

export function buildStatusEventFields(args: {
  eventType?: "default" | "outOfOffice" | "focusTime" | "workingLocation";
  location?: string;
  title?: string;
  workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
  workingLocationLabel?: string;
}) {
  if (!args.eventType || args.eventType === "default") return {};
  if (args.eventType === "outOfOffice") {
    return {
      eventType: args.eventType,
      transparency: "opaque" as const,
      outOfOfficeProperties: {
        autoDeclineMode: "declineNone" as const,
      },
    };
  }
  if (args.eventType === "focusTime") {
    return {
      eventType: args.eventType,
      transparency: "opaque" as const,
      focusTimeProperties: {
        autoDeclineMode: "declineNone" as const,
        chatStatus: "doNotDisturb" as const,
      },
    };
  }

  const type = args.workingLocationType ?? "customLocation";
  const label =
    args.workingLocationLabel || args.location || args.title || "Working";
  return {
    eventType: args.eventType,
    transparency: "transparent" as const,
    visibility: "public" as const,
    workingLocationProperties:
      type === "homeOffice"
        ? { type, homeOffice: {} }
        : type === "officeLocation"
          ? { type, officeLocation: { label } }
          : { type, customLocation: { label } },
  };
}
