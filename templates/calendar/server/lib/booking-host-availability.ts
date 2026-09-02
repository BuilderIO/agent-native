import { getUserSetting } from "@agent-native/core/settings";

import type {
  AvailabilityConfig,
  BookingLink,
  OverlayPerson,
} from "../../shared/api.js";
import { displayNameFromIdentifier } from "./booking-og-image.js";
import { safeBookingTimeZone } from "./booking-timezone.js";
import { getGoogleAccountTimezone } from "./google-calendar.js";

export interface EligibleHostAvailability {
  email: string;
  displayName?: string;
  /** Present only when the host has saved a working-hours schedule. */
  weeklySchedule?: AvailabilityConfig["weeklySchedule"];
  /**
   * Resolved from calendar-availability.timezone, then calendar-settings.
   * timezone, then the peer's connected Google account's own reported time
   * zone. Present only when one of those is a resolvable IANA time zone —
   * never defaulted, since guessing a peer's zone would be misleading (the
   * Google fallback is real provider data, not a guess).
   */
  timezone?: string;
}

export async function overlaysBack(
  candidateEmail: string,
  ownerEmail: string,
): Promise<boolean> {
  const candidateOverlay = (await getUserSetting(
    candidateEmail,
    "calendar-overlay-people",
  )) as { people: OverlayPerson[] } | null;
  return (candidateOverlay?.people ?? []).some(
    (person) => person.email.toLowerCase() === ownerEmail,
  );
}

/**
 * Cross-references booking-link hosts against the owner's calendar overlay
 * ("subscribed peer") list. Only hosts the owner has explicitly overlaid,
 * AND who have reciprocally overlaid the owner back, get their real
 * working-hours schedule and time zone used for hard-filtering — everyone
 * else keeps today's free/busy-only behavior. The reciprocal check matters
 * because overlay membership alone is just the owner's own setting: without
 * it, an owner could add any registered email with no relationship required
 * and have that stranger's private schedule and time zone read and enriched
 * onto an anonymous public booking link.
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
  const candidateEmails = Array.from(
    new Set(
      hostEmails
        .map((email) => email.toLowerCase())
        .filter((email) => email !== owner && overlayEmails.has(email)),
    ),
  );
  if (candidateEmails.length === 0) return [];

  const reciprocity = await Promise.all(
    candidateEmails.map((email) => overlaysBack(email, owner)),
  );
  const eligibleEmails = candidateEmails.filter(
    (_email, index) => reciprocity[index],
  );
  if (eligibleEmails.length === 0) return [];

  return Promise.all(
    eligibleEmails.map(async (email) => {
      const [config, calendarSettings] = await Promise.all([
        getUserSetting(
          email,
          "calendar-availability",
        ) as Promise<AvailabilityConfig | null>,
        getUserSetting(email, "calendar-settings") as Promise<{
          timezone?: string;
        } | null>,
      ]);
      const timezone =
        safeBookingTimeZone(config?.timezone) ||
        safeBookingTimeZone(calendarSettings?.timezone) ||
        (await getGoogleAccountTimezone(email)) ||
        undefined;

      // Without a resolvable time zone there's no correct zone to interpret
      // the schedule in — attaching it anyway would silently hard-filter
      // using the owner's zone instead of the peer's. Fall back to
      // free/busy-only for this host rather than guess.
      if (!config?.weeklySchedule || !timezone) {
        return { email, timezone };
      }
      return {
        email,
        weeklySchedule: config.weeklySchedule,
        timezone,
      };
    }),
  );
}
export type HostSchedulingStatus =
  | "not-overlaid"
  | "awaiting-reciprocal-overlay"
  | "missing-schedule"
  | "missing-timezone"
  | "active";

export interface HostSchedulingStatusResult {
  email: string;
  status: HostSchedulingStatus;
  /** Only set when status is "active" — the time zone whose hours are enforced. */
  timezone?: string;
}

/**
 * Reports, per required host, why their working hours would or would not be
 * applied on this booking link — the same eligibility chain
 * `getEligibleHostAvailability` enforces, but surfaced for the owner
 * managing the link instead of collapsed into a single filtered list.
 * "not-overlaid" and "awaiting-reciprocal-overlay" are the two halves of the
 * two-way overlay requirement; "missing-schedule" means the relationship is
 * fine but the peer never saved a `calendar-availability` schedule, and
 * "missing-timezone" means a schedule exists but no time zone could be
 * resolved to interpret it in (mirrors the same distinction
 * `getEligibleHostAvailability` draws).
 */
export async function getHostSchedulingStatus(
  ownerEmail: string | undefined,
  hostEmails: string[],
): Promise<HostSchedulingStatusResult[]> {
  if (!ownerEmail) return [];
  const owner = ownerEmail.toLowerCase();
  const emails = Array.from(
    new Set(
      hostEmails
        .map((email) => email.toLowerCase())
        .filter((email) => email !== owner),
    ),
  );
  if (emails.length === 0) return [];

  const overlayData = (await getUserSetting(
    ownerEmail,
    "calendar-overlay-people",
  )) as { people: OverlayPerson[] } | null;
  const overlayEmails = new Set(
    (overlayData?.people ?? []).map((person) => person.email.toLowerCase()),
  );

  return Promise.all(
    emails.map(async (email): Promise<HostSchedulingStatusResult> => {
      if (!overlayEmails.has(email)) {
        return { email, status: "not-overlaid" };
      }
      if (!(await overlaysBack(email, owner))) {
        return { email, status: "awaiting-reciprocal-overlay" };
      }
      const [config, calendarSettings] = await Promise.all([
        getUserSetting(
          email,
          "calendar-availability",
        ) as Promise<AvailabilityConfig | null>,
        getUserSetting(email, "calendar-settings") as Promise<{
          timezone?: string;
        } | null>,
      ]);
      if (!config?.weeklySchedule) {
        return { email, status: "missing-schedule" };
      }
      // Only resolve a time zone (including the Google account fallback,
      // the most expensive step) once we know there's a schedule for it to
      // interpret — a host with no saved schedule reports "missing-schedule"
      // either way, so there is nothing to gain by looking one up first.
      const timezone =
        safeBookingTimeZone(config.timezone) ||
        safeBookingTimeZone(calendarSettings?.timezone) ||
        (await getGoogleAccountTimezone(email)) ||
        undefined;
      if (!timezone) {
        return { email, status: "missing-timezone" };
      }
      return { email, status: "active", timezone };
    }),
  );
}

/**
 * Attaches the owner's time zone and builds the sanitized `publicHosts` list
 * for the public read response. Never attaches schedule windows — only the
 * resolved IANA time zone string, and only for hosts the caller already
 * determined are overlay-eligible. Drops the admin-only `hosts` field
 * entirely rather than leaving it on the response: it carries every
 * required host's raw email, which the public JSON must never expose
 * (visitors get a derived display label instead, via `publicHosts`).
 */
export function withHostTimezones(
  bookingLink: BookingLink,
  ownerTimezone: string,
  eligibleHosts: EligibleHostAvailability[],
): BookingLink {
  const hostTimezoneByEmail = new Map(
    eligibleHosts
      .filter((host) => host.timezone)
      .map((host) => [host.email.toLowerCase(), host.timezone as string]),
  );

  return {
    ...bookingLink,
    ownerTimezone,
    hosts: undefined,
    publicHosts: bookingLink.hosts?.map((host, index) => ({
      id: `host-${index}`,
      label:
        host.displayName || displayNameFromIdentifier(undefined, host.email),
      timezone: hostTimezoneByEmail.get(host.email.toLowerCase()),
    })),
  };
}
