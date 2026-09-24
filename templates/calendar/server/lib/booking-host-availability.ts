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

/**
 * Resolves a peer's saved working-hours schedule and time zone, shared by
 * `getEligibleHostAvailability` and `getHostOverlayStatuses` so the
 * timezone-fallback order (calendar-availability, then calendar-settings,
 * then the peer's connected Google account) lives in one place.
 */
async function resolvePeerScheduleAndTimezone(email: string): Promise<{
  weeklySchedule?: AvailabilityConfig["weeklySchedule"];
  timezone?: string;
}> {
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

  // Without a resolvable time zone there's no correct zone to interpret the
  // schedule in — attaching it anyway would silently hard-filter using the
  // owner's zone instead of the peer's. Fall back to free/busy-only
  // (schedule omitted) rather than guess.
  if (!config?.weeklySchedule || !timezone) {
    return { timezone };
  }
  return { weeklySchedule: config.weeklySchedule, timezone };
}

async function overlaysBack(
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
      const { weeklySchedule, timezone } =
        await resolvePeerScheduleAndTimezone(email);
      return weeklySchedule
        ? { email, weeklySchedule, timezone }
        : { email, timezone };
    }),
  );
}
/**
 * Per-host report of *why* a booking-link host's real working hours are or
 * aren't being applied, for the booking-link editor.
 *
 * `reciprocal` and `hasWorkingHours` are deliberately separate booleans rather
 * than one "working hours applied" flag. "The peer hasn't added you back" and
 * "the peer added you back but never saved a schedule" look identical in the
 * final availability result, but only the first is something the owner can act
 * on — the second is the peer's own to fix. Collapsing them would leave the UI
 * unable to tell the owner which one they're looking at.
 */
export interface HostOverlayStatus {
  email: string;
  isOverlaidByOwner: boolean;
  reciprocal: boolean;
  hasWorkingHours: boolean;
  timezone?: string;
  displayName?: string;
}

/**
 * Whether each overlaid peer has added the owner back, with no claim about
 * their saved schedule.
 *
 * Separate from `HostOverlayStatus` on purpose: it costs one settings read per
 * peer and no network calls, which is what makes it usable on a surface that
 * renders on every page. Because the shape omits `hasWorkingHours` entirely,
 * "not evaluated" can't be mistaken for "evaluated and false".
 */
export interface OverlayReciprocity {
  email: string;
  reciprocal: boolean;
  displayName?: string;
}

/**
 * Resolves the owner's overlay list and narrows `emails` to the members of it.
 * Shared by both status readers so the overlay-list-only contract — the thing
 * that stops either of them becoming a probe for arbitrary addresses — is
 * enforced in exactly one place.
 */
async function resolveOverlayCandidates(
  ownerEmail: string | undefined,
  emails: string[],
): Promise<{
  candidates: string[];
  overlayByEmail: Map<string, OverlayPerson>;
}> {
  const empty = { candidates: [], overlayByEmail: new Map() };
  if (!ownerEmail || emails.length === 0) return empty;

  const overlayData = (await getUserSetting(
    ownerEmail,
    "calendar-overlay-people",
  )) as { people: OverlayPerson[] } | null;
  const overlayByEmail = new Map(
    (overlayData?.people ?? []).map((person) => [
      person.email.toLowerCase(),
      person,
    ]),
  );
  if (overlayByEmail.size === 0) return empty;

  const owner = ownerEmail.toLowerCase();
  const candidates = Array.from(
    new Set(
      emails
        .map((email) => email.toLowerCase())
        .filter((email) => email !== owner && overlayByEmail.has(email)),
    ),
  );
  return { candidates, overlayByEmail };
}

export async function getOverlayReciprocity(
  ownerEmail: string | undefined,
  emails: string[],
): Promise<OverlayReciprocity[]> {
  const { candidates, overlayByEmail } = await resolveOverlayCandidates(
    ownerEmail,
    emails,
  );
  if (candidates.length === 0) return [];

  const owner = (ownerEmail as string).toLowerCase();
  const reciprocity = await Promise.all(
    candidates.map((email) => overlaysBack(email, owner)),
  );
  return candidates.map((email, index) => ({
    email,
    reciprocal: reciprocity[index],
    displayName: overlayByEmail.get(email)?.name,
  }));
}

/**
 * Reports overlay status for booking-link hosts, mirroring the eligibility
 * rules `getEligibleHostAvailability` applies.
 *
 * Only ever returns rows for emails already in the owner's own
 * `calendar-overlay-people`. That filter is the function's contract, not an
 * optimization: widening it would turn this into an oracle for probing whether
 * arbitrary addresses have a Calendar account and a saved schedule.
 */
export async function getHostOverlayStatuses(
  ownerEmail: string | undefined,
  hostEmails: string[],
): Promise<HostOverlayStatus[]> {
  const { candidates: candidateEmails, overlayByEmail } =
    await resolveOverlayCandidates(ownerEmail, hostEmails);
  if (candidateEmails.length === 0) return [];

  const owner = (ownerEmail as string).toLowerCase();
  const reciprocity = await Promise.all(
    candidateEmails.map((email) => overlaysBack(email, owner)),
  );

  return Promise.all(
    candidateEmails.map(async (email, index) => {
      const displayName = overlayByEmail.get(email)?.name;
      // A non-reciprocal peer's schedule can never be applied, so reading it
      // would cost two settings reads and a possible Google round-trip to
      // produce a value nothing can use.
      if (!reciprocity[index]) {
        return {
          email,
          isOverlaidByOwner: true,
          reciprocal: false,
          hasWorkingHours: false,
          displayName,
        };
      }
      const { weeklySchedule, timezone } =
        await resolvePeerScheduleAndTimezone(email);
      return {
        email,
        isOverlaidByOwner: true,
        reciprocal: true,
        hasWorkingHours: Boolean(weeklySchedule && timezone),
        timezone,
        displayName,
      };
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
