import { getUserSetting } from "@agent-native/core/settings";

import type { CalendarEvent } from "../../shared/api.js";
import { createZoomMeeting, getZoomStatus } from "./zoom.js";

const DEFAULT_TIMEZONE = "America/New_York";
const ZOOM_LINK_RE = /https?:\/\/[^\s<>"')]*zoom\.us\/[^\s<>"')]+/i;
const VIDEO_MEETING_HOST_RE =
  /(^|\.)((meet\.google|zoom|teams\.microsoft|webex|gotomeeting|bluejeans|whereby)\.com|chime\.aws)$/i;
const VIDEO_MEETING_LINK_RE = /https?:\/\/[^\s<>"')]+/gi;

type EventForVideo = Pick<
  CalendarEvent,
  "title" | "description" | "location" | "start" | "end"
>;

type CalendarSettings = {
  timezone?: string;
};

type EventWithConferencing = Partial<
  Pick<
    CalendarEvent,
    | "attendees"
    | "conferenceData"
    | "description"
    | "eventType"
    | "hangoutLink"
    | "location"
    | "meetingLink"
  >
>;

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

async function getCalendarTimezone(ownerEmail: string): Promise<string> {
  const settings = (await getUserSetting(
    ownerEmail,
    "calendar-settings",
  )) as CalendarSettings | null;
  return settings?.timezone || DEFAULT_TIMEZONE;
}

export function extractZoomMeetingLink(
  event: Pick<CalendarEvent, "description" | "location">,
): string | undefined {
  const text = `${event.location || ""}\n${event.description || ""}`;
  const match = text.match(ZOOM_LINK_RE);
  return match ? trimTrailingPunctuation(match[0]) : undefined;
}

export function hasExplicitMeetingLink(event: EventWithConferencing): boolean {
  if (event.meetingLink || event.hangoutLink) return true;
  if (
    event.conferenceData?.entryPoints?.some(
      (entryPoint) => entryPoint.entryPointType === "video" && entryPoint.uri,
    )
  ) {
    return true;
  }

  const text = `${event.location || ""}\n${event.description || ""}`;
  for (const match of text.matchAll(VIDEO_MEETING_LINK_RE)) {
    try {
      const url = new URL(trimTrailingPunctuation(match[0]));
      if (VIDEO_MEETING_HOST_RE.test(url.hostname)) return true;
    } catch {
      // Ignore malformed free-text URL fragments.
    }
  }
  return false;
}

function hasInvitedGuests(event: EventWithConferencing): boolean {
  return (
    event.attendees?.some((attendee) => {
      const email = attendee.email?.trim();
      return !!email && attendee.self !== true && attendee.organizer !== true;
    }) ?? false
  );
}

export function shouldAutoAddGoogleMeet(
  event: EventWithConferencing,
  opts?: { addGoogleMeet?: boolean; addZoom?: boolean },
): boolean {
  if (opts?.addGoogleMeet !== undefined) return opts.addGoogleMeet;
  if (opts?.addZoom === true) return false;
  if ((event.eventType ?? "default") !== "default") return false;
  if (!hasInvitedGuests(event)) return false;
  return !hasExplicitMeetingLink(event);
}

export function buildMeetingLinkPatch(
  event: Pick<CalendarEvent, "description" | "location">,
  meetingLink: string,
): Partial<Pick<CalendarEvent, "description" | "location">> {
  if (
    event.location?.includes(meetingLink) ||
    event.description?.includes(meetingLink)
  ) {
    return {};
  }

  if (!event.location?.trim()) {
    return { location: meetingLink };
  }

  const description = event.description || "";
  return {
    description: description.trim()
      ? `${description}\n\nZoom: ${meetingLink}`
      : `Zoom: ${meetingLink}`,
  };
}

export async function createZoomMeetingForEvent(
  ownerEmail: string,
  event: EventForVideo,
): Promise<string> {
  const status = await getZoomStatus(ownerEmail);
  if (!status.configured) {
    throw new Error(
      "Zoom OAuth is not configured for this deployment. Set ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET before adding Zoom meetings.",
    );
  }
  if (!status.connected) {
    throw new Error("Zoom is not connected. Connect Zoom in Settings first.");
  }

  const zoomResult = await createZoomMeeting({
    hostEmail: ownerEmail,
    title: event.title || "Calendar event",
    description: event.description || "",
    startTime: event.start,
    endTime: event.end,
    timezone: await getCalendarTimezone(ownerEmail),
  });

  if (!zoomResult?.meetingUrl) {
    throw new Error("Zoom is connected, but no Zoom meeting could be created.");
  }

  return zoomResult.meetingUrl;
}

export async function prepareZoomMeetingPatch(
  ownerEmail: string,
  event: EventForVideo,
): Promise<{
  meetingLink: string;
  patch: Partial<Pick<CalendarEvent, "description" | "location">>;
  alreadyPresent: boolean;
}> {
  const existing = extractZoomMeetingLink(event);
  if (existing) {
    return { meetingLink: existing, patch: {}, alreadyPresent: true };
  }

  const meetingLink = await createZoomMeetingForEvent(ownerEmail, event);
  return {
    meetingLink,
    patch: buildMeetingLinkPatch(event, meetingLink),
    alreadyPresent: false,
  };
}
