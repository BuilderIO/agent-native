import {
  emailLink,
  emailStrong,
  isEmailConfigured,
  renderEmail,
  sendEmail,
} from "@agent-native/core/server";

import type { Booking } from "../../shared/api.js";
import {
  DEFAULT_BOOKING_TIMEZONE,
  safeBookingTimeZone,
} from "./booking-timezone.js";
import {
  CALENDAR_BOOKING_CANCELLED_EMAIL_ID,
  CALENDAR_BOOKING_CANCELLED_HOST_EMAIL_ID,
  CALENDAR_BOOKING_CONFIRMED_EMAIL_ID,
  CALENDAR_BOOKING_RECEIVED_EMAIL_ID,
} from "./emails.js";

function stripCrlf(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, " ").trim();
}

export function formatBookingWhen(
  startIso: string,
  endIso: string,
  timeZone?: string,
) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const zone = safeBookingTimeZone(timeZone) || DEFAULT_BOOKING_TIMEZONE;
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
  if (!(await isEmailConfigured())) return;
  try {
    await sendEmail(args);
  } catch (error) {
    console.warn(`[calendar booking email] failed to send ${label}:`, error);
  }
}

export function renderBookingConfirmedEmail({
  title,
  when,
  host,
  manageUrl,
  meetingLink,
}: {
  title: string;
  when: string;
  host: string;
  manageUrl: string;
  meetingLink?: string | null;
}) {
  const paragraphs = [
    `You're booked for ${emailStrong(title)} with ${emailStrong(host)}.`,
    `Time: ${emailStrong(when)}.`,
  ];
  if (meetingLink) {
    paragraphs.push(`Meeting link: ${emailLink("Join meeting", meetingLink)}.`);
  }

  return {
    subject: `Confirmed: ${title}`,
    ...renderEmail({
      preheader: `You're booked for ${title} on ${when}.`,
      heading: "Your meeting is booked",
      paragraphs,
      cta: { label: "Manage booking", url: manageUrl },
      footer:
        "Use the manage link if you need to cancel or reschedule this meeting.",
    }),
  };
}

export function renderBookingReceivedEmail({
  title,
  when,
  attendeeName,
  attendee,
  manageUrl,
  meetingLink,
}: {
  title: string;
  when: string;
  attendeeName: string;
  attendee: string;
  manageUrl: string;
  meetingLink?: string | null;
}) {
  return {
    subject: `New booking: ${title}`,
    ...renderEmail({
      preheader: `${attendeeName} booked ${title} on ${when}.`,
      heading: "New booking",
      paragraphs: [
        `${emailStrong(attendeeName)} booked ${emailStrong(title)}.`,
        `Time: ${emailStrong(when)}.`,
        `Guest: ${emailStrong(attendee)}.`,
        ...(meetingLink
          ? [`Meeting link: ${emailLink("Join meeting", meetingLink)}.`]
          : []),
      ],
      cta: { label: "View booking", url: manageUrl },
      footer: "This booking was created from your calendar booking link.",
    }),
  };
}

export function renderBookingCancelledEmail({
  title,
  when,
  host,
  bookAgainUrl,
}: {
  title: string;
  when: string;
  host: string;
  bookAgainUrl?: string;
}) {
  return {
    subject: `Cancelled: ${title}`,
    ...renderEmail({
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
    }),
  };
}

export function renderBookingCancelledHostEmail({
  title,
  when,
  attendeeName,
  attendee,
}: {
  title: string;
  when: string;
  attendeeName: string;
  attendee: string;
}) {
  return {
    subject: `Cancelled booking: ${title}`,
    ...renderEmail({
      preheader: `${attendeeName}'s booking for ${title} was cancelled.`,
      heading: "Booking cancelled",
      paragraphs: [
        `${emailStrong(attendeeName)}'s booking for ${emailStrong(title)} was cancelled.`,
        `Original time: ${emailStrong(when)}.`,
        `Guest: ${emailStrong(attendee)}.`,
      ],
      footer: "No further action is needed.",
    }),
  };
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
  const when = formatBookingWhen(booking.start, booking.end, timeZone);
  const host = stripCrlf(hostEmail);
  const attendee = stripCrlf(booking.email);
  const attendeeName = stripCrlf(booking.name) || "there";

  await sendBestEffort("attendee confirmation", {
    to: attendee,
    ...renderBookingConfirmedEmail({
      title,
      when,
      host,
      manageUrl,
      meetingLink: booking.meetingLink,
    }),
    replyTo: host,
    templateId: CALENDAR_BOOKING_CONFIRMED_EMAIL_ID,
  });

  await sendBestEffort("host notification", {
    to: host,
    ...renderBookingReceivedEmail({
      title,
      when,
      attendeeName,
      attendee,
      manageUrl,
      meetingLink: booking.meetingLink,
    }),
    replyTo: attendee,
    templateId: CALENDAR_BOOKING_RECEIVED_EMAIL_ID,
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
  const when = formatBookingWhen(booking.start, booking.end, timeZone);
  const host = stripCrlf(hostEmail);
  const attendee = stripCrlf(booking.email);
  const attendeeName = stripCrlf(booking.name) || "The guest";

  await sendBestEffort("attendee cancellation", {
    to: attendee,
    ...renderBookingCancelledEmail({ title, when, host, bookAgainUrl }),
    replyTo: host || undefined,
    templateId: CALENDAR_BOOKING_CANCELLED_EMAIL_ID,
  });

  if (!host) return;

  await sendBestEffort("host cancellation notification", {
    to: host,
    ...renderBookingCancelledHostEmail({
      title,
      when,
      attendeeName,
      attendee,
    }),
    replyTo: attendee,
    templateId: CALENDAR_BOOKING_CANCELLED_HOST_EMAIL_ID,
  });
}
