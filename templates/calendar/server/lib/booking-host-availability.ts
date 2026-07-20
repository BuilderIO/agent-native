import { getUserSetting } from "@agent-native/core/settings";

import type {
  AvailabilityConfig,
  OverlayPerson,
} from "../../shared/api.js";
import { safeBookingTimeZone } from "./booking-timezone.js";

export interface EligibleHostAvailability {
  email: string;
  displayName?: string;
  /** Present only when the host has saved a working-hours schedule. */
  weeklySchedule?: AvailabilityConfig["weeklySchedule"];
  /** Present only when the host has a resolvable time zone. */
  timezone?: string;
}

/**
 * Cross-references booking-link hosts against the owner's calendar overlay
 * ("subscribed peer") list. Only hosts the owner has explicitly overlaid get
 * their real working-hours schedule and time zone used for hard-filtering —
 * everyone else keeps today's free/busy-only behavior.
 */
export async function getEligibleHostAvailability(
  ownerEmail: string | undefined,
  hostEmails: string[],
): Promise<EligibleHostAvailability[]> {
  if (!ownerEmail || hostEmails.length === 0) return [];

  const overlayData = (await getUserSetting(
    ownerEmail,
    "calendar-overlay-people",
  )) as { people: OverlayPerson[] } | null;
  const overlayEmails = new Set(
    (overlayData?.people ?? []).map((person) => person.email.toLowerCase()),
  );
  if (overlayEmails.size === 0) return [];

  const owner = ownerEmail.toLowerCase();
  const eligibleEmails = Array.from(
    new Set(
      hostEmails
        .map((email) => email.toLowerCase())
        .filter((email) => email !== owner && overlayEmails.has(email)),
    ),
  );
  if (eligibleEmails.length === 0) return [];

  return Promise.all(
    eligibleEmails.map(async (email) => {
      const config = (await getUserSetting(
        email,
        "calendar-availability",
      )) as AvailabilityConfig | null;
      if (!config?.weeklySchedule) {
        return { email };
      }
      return {
        email,
        weeklySchedule: config.weeklySchedule,
        timezone: safeBookingTimeZone(config.timezone),
      };
    }),
  );
}
