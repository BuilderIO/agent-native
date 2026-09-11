/**
 * Minimal iCalendar (RFC 5545) generator for booking confirmation emails and
 * the `/booking/:uid.ics` download endpoint.
 *
 * Not exhaustive — just enough for Apple Mail / Outlook / Gmail to render
 * the event card correctly and for Add-to-Calendar buttons to work.
 */
import type { Booking } from "../shared/index.js";

export function buildIcs(booking: Booking, organizerName: string): string {
  const dtStart = toIcsDate(new Date(booking.startTime));
  const dtEnd = toIcsDate(new Date(booking.endTime));
  const dtStamp = toIcsDate(new Date());
  const summary = escapeIcs(booking.title);
  const desc = escapeIcs(
    [
      booking.description,
      booking.location?.link ? `Join: ${booking.location.link}` : "",
      booking.location?.address ? `Where: ${booking.location.address}` : "",
    ]
      .filter(Boolean)
      .join("\\n"),
  );
  const attendees = booking.attendees
    .map(
      (a) =>
        `ATTENDEE;CN=${escapeIcs(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:${a.email}`,
    )
    .join("\n");
  const location = booking.location?.address
    ? `LOCATION:${escapeIcs(booking.location.address)}`
    : booking.location?.link
      ? `LOCATION:${escapeIcs(booking.location.link)}`
      : "";

  const cancelled = booking.status === "cancelled";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//agent-native//scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:" + (cancelled ? "CANCEL" : "REQUEST"),
    "BEGIN:VEVENT",
    `UID:${booking.iCalUid}`,
    `SEQUENCE:${booking.iCalSequence}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    desc && `DESCRIPTION:${desc}`,
    location,
    `ORGANIZER;CN=${escapeIcs(organizerName)}:mailto:${booking.hostEmail}`,
    attendees,
    cancelled ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

function toIcsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function escapeIcs(s: string): string {
  return (s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function addToGoogleCalendarUrl(booking: Booking): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: booking.title,
    dates: `${toIcsDate(new Date(booking.startTime))}/${toIcsDate(new Date(booking.endTime))}`,
    details: booking.description ?? "",
    location: booking.location?.link ?? booking.location?.address ?? "",
  });
  return `https://www.google.com/calendar/render?${params}`;
}

export function addToOutlookWebUrl(booking: Booking): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    startdt: booking.startTime,
    enddt: booking.endTime,
    subject: booking.title,
    body: booking.description ?? "",
    location: booking.location?.link ?? booking.location?.address ?? "",
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}
