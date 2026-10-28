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
  weeklySchedule?: AvailabilityConfig["weeklySchedule"];
  timezone?: string;
}

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
export interface HostOverlayStatus {
  email: string;
  isOverlaidByOwner: boolean;
  reciprocal: boolean;
  hasWorkingHours: boolean;
  timezone?: string;
  displayName?: string;
}

export interface OverlayReciprocity {
  email: string;
  reciprocal: boolean;
  displayName?: string;
}

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
