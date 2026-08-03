import type { CalendarEvent } from "@shared/api";

export type EventMeetingLink = {
  url: string;
  type: "zoom" | "meet" | "teams" | "link";
  label?: string;
  pin?: string;
  passcode?: string;
};

export function getMeetingType(url: string): EventMeetingLink["type"] {
  if (url.includes("zoom.us")) return "zoom";
  if (url.includes("meet.google.com")) return "meet";
  if (url.includes("teams.microsoft.com")) return "teams";
  return "link";
}

/** Extract a Zoom, Meet, or Teams link from the provider data or event text. */
export function extractMeetingLink(
  event: CalendarEvent,
): EventMeetingLink | null {
  if (event.meetingLink) {
    return { url: event.meetingLink, type: getMeetingType(event.meetingLink) };
  }

  const videoEntry = event.conferenceData?.entryPoints?.find(
    (entryPoint) => entryPoint.entryPointType === "video",
  );
  if (videoEntry) {
    return {
      url: videoEntry.uri,
      type: getMeetingType(videoEntry.uri),
      label: videoEntry.label || undefined,
      pin: videoEntry.pin || undefined,
      passcode: videoEntry.passcode || undefined,
    };
  }

  if (event.hangoutLink) {
    return { url: event.hangoutLink, type: "meet" };
  }

  const text = `${event.location || ""} ${event.description || ""}`;
  const zoom = text.match(/https?:\/\/[^\s]*zoom\.us\/j\/[^\s)"]*/i);
  if (zoom) return { url: zoom[0], type: "zoom" };
  const meet = text.match(/https?:\/\/meet\.google\.com\/[^\s)"]*/i);
  if (meet) return { url: meet[0], type: "meet" };
  const teams = text.match(/https?:\/\/teams\.microsoft\.com\/[^\s)"]*/i);
  if (teams) return { url: teams[0], type: "teams" };
  return null;
}
