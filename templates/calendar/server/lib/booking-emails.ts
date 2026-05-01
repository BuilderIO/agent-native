import {
  emailLink,
  emailStrong,
  isEmailConfigured,
  renderEmail,
  sendEmail,
} from "@agent-native/core/server";
import type { Booking } from "../../shared/api.js";

function stripCrlf(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function formatWhen(startIso: string, endIso: string, timeZone?: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const zone = timeZone || "UTC";
  const dateFormatter = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: zone,
  });
  const timeFormatter = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
    timeZoneName: "short",
  });

  return `${dateFormatter.format(start)}, ${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
}

function bookingTitle(booking: Booking) {
  return stripCrlf(booking.eventTitle) || "Meeting";
}

async function sendBestEffort(
  label: string,
  args: Parameters<typeof sendEmail>[0],
) {
  if (!isEmailConfigured()) return;
  try {
    await sendEmail(args);
  } catch (error) {
    console.warn(`[calendar booking email] failed to send ${label}:`, error);
  }
}

export async function sendBookingConfirmationEmails({
  booking,
  hostEmail,
  manageUrl,
  timeZone,
}: {
  booking: Booking;
  hostEmail: string;
  manageUrl: string;
  timeZone?: string;
}) {
  const title = bookingTitle(booking);
  const when = formatWhen(booking.start, booking.end, timeZone);
  const host = stripCrlf(hostEmail);
  const attendee = stripCrlf(booking.email);
  const attendeeName = stripCrlf(booking.name) || "there";

  const attendeeParagraphs = [
    `You're booked for ${emailStrong(title)} with ${emailStrong(host)}.`,
    `Time: ${emailStrong(when)}.`,
  ];
  if (booking.meetingLink) {
    attendeeParagraphs.push(
      `Meeting link: ${emailLink("Join meeting", booking.meetingLink)}.`,
    );
  }

  const attendeeEmail = renderEmail({
    preheader: `You're booked for ${title} on ${when}.`,
    heading: "Your meeting is booked",
    paragraphs: attendeeParagraphs,
    cta: { label: "Manage booking", url: manageUrl },
    footer:
      "Use the manage link if you need to cancel or reschedule this meeting.",
  });

  await sendBestEffort("attendee confirmation", {
    to: attendee,
    subject: `Confirmed: ${title}`,
    html: attendeeEmail.html,
    text: attendeeEmail.text,
    replyTo: host,
  });

  const hostEmailMessage = renderEmail({
    preheader: `${attendeeName} booked ${title} on ${when}.`,
    heading: "New booking",
    paragraphs: [
      `${emailStrong(attendeeName)} booked ${emailStrong(title)}.`,
      `Time: ${emailStrong(when)}.`,
      `Guest: ${emailStrong(attendee)}.`,
      ...(booking.meetingLink
        ? [`Meeting link: ${emailLink("Join meeting", booking.meetingLink)}.`]
        : []),
    ],
    cta: { label: "View booking", url: manageUrl },
    footer: "This booking was created from your calendar booking link.",
  });

  await sendBestEffort("host notification", {
    to: host,
    subject: `New booking: ${title}`,
    html: hostEmailMessage.html,
    text: hostEmailMessage.text,
    replyTo: attendee,
  });
}

export async function sendBookingCancellationEmails({
  booking,
  hostEmail,
  bookAgainUrl,
  timeZone,
}: {
  booking: Booking;
  hostEmail?: string;
  bookAgainUrl?: string;
  timeZone?: string;
}) {
  const title = bookingTitle(booking);
  const when = formatWhen(booking.start, booking.end, timeZone);
  const host = stripCrlf(hostEmail);
  const attendee = stripCrlf(booking.email);
  const attendeeName = stripCrlf(booking.name) || "The guest";

  const attendeeEmail = renderEmail({
    preheader: `${title} on ${when} was cancelled.`,
    heading: "Your meeting was cancelled",
    paragraphs: [
      `${emailStrong(title)} with ${emailStrong(host || "the host")} has been cancelled.`,
      `Original time: ${emailStrong(when)}.`,
    ],
    cta: bookAgainUrl
      ? { label: "Book another time", url: bookAgainUrl }
      : undefined,
    footer: "If this was unexpected, contact the meeting host.",
  });

  await sendBestEffort("attendee cancellation", {
    to: attendee,
    subject: `Cancelled: ${title}`,
    html: attendeeEmail.html,
    text: attendeeEmail.text,
    replyTo: host || undefined,
  });

  if (!host) return;

  const hostEmailMessage = renderEmail({
    preheader: `${attendeeName}'s booking for ${title} was cancelled.`,
    heading: "Booking cancelled",
    paragraphs: [
      `${emailStrong(attendeeName)}'s booking for ${emailStrong(title)} was cancelled.`,
      `Original time: ${emailStrong(when)}.`,
      `Guest: ${emailStrong(attendee)}.`,
    ],
    footer: "No further action is needed.",
  });

  await sendBestEffort("host cancellation notification", {
    to: host,
    subject: `Cancelled booking: ${title}`,
    html: hostEmailMessage.html,
    text: hostEmailMessage.text,
    replyTo: attendee,
  });
}
