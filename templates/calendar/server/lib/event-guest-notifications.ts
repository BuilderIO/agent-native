import {
  emailStrong,
  isEmailConfigured,
  renderEmail,
  sendEmail,
} from "@agent-native/core/server";

import type { CalendarEvent, DeleteEventScope } from "../../shared/api.js";
import {
  CALENDAR_EVENT_CANCELLATION_NOTE_EMAIL_ID,
  CALENDAR_EVENT_UPDATE_NOTE_EMAIL_ID,
} from "./emails.js";

export interface GuestNotificationResult {
  requested: boolean;
  recipientCount: number;
  sentCount: number;
  skippedReason?: "empty-message" | "no-recipients" | "email-not-configured";
  errors?: string[];
}

export type GuestNotificationKind = "update" | "cancellation";

function stripCrlf(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function messageParagraph(message: string): string {
  return escapeHtml(message.trim()).replace(/\r?\n/g, "<br />");
}

export function normalizeGuestNotificationMessage(
  message: string | undefined,
): string | undefined {
  const trimmed = message?.trim();
  return trimmed ? trimmed.slice(0, 4000) : undefined;
}

function guestRecipients(event: CalendarEvent): string[] {
  const recipients = new Set<string>();
  for (const attendee of event.attendees ?? []) {
    const email = stripCrlf(attendee.email).toLowerCase();
    if (!email || attendee.self || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      continue;
    }
    recipients.add(email);
  }
  return Array.from(recipients);
}

function safeTimeZone(event: CalendarEvent): string | undefined {
  const timeZone = event.startTimeZone || event.endTimeZone;
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return undefined;
  }
}

function formatWhen(event: CalendarEvent): string {
  const zone = safeTimeZone(event);
  const start = new Date(event.start);
  const end = new Date(event.end);
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    ...(zone ? { timeZone: zone } : {}),
  };

  if (event.allDay) {
    return new Intl.DateTimeFormat("en", dateOptions).format(start);
  }

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(zone ? { timeZone: zone } : {}),
  };

  return `${new Intl.DateTimeFormat("en", dateOptions).format(start)}, ${new Intl.DateTimeFormat("en", timeOptions).format(start)} - ${new Intl.DateTimeFormat("en", timeOptions).format(end)}`;
}

function scopeLabel(scope: DeleteEventScope | undefined): string | undefined {
  if (!scope || scope === "single") return undefined;
  if (scope === "all") return "all events in the series";
  return "this and following events";
}

export function renderEventGuestNote({
  title,
  organizer,
  message,
  when,
  kind,
  appliesTo,
  htmlLink,
}: {
  title: string;
  organizer: string;
  message: string;
  when: string;
  kind: GuestNotificationKind;
  appliesTo?: string;
  htmlLink?: string | null;
}) {
  const heading =
    kind === "cancellation" ? "Event cancellation note" : "Event update note";
  const subjectPrefix =
    kind === "cancellation" ? "Cancellation note" : "Update note";
  const eventAction = kind === "cancellation" ? "cancelling" : "updating";
  const paragraphs = [
    `${emailStrong(organizer)} added this note while ${eventAction} ${emailStrong(title)}.`,
    messageParagraph(message),
    `When: ${emailStrong(when)}.`,
  ];
  if (appliesTo) {
    paragraphs.push(`Applies to: ${emailStrong(appliesTo)}.`);
  }

  return {
    subject: `${subjectPrefix}: ${title}`,
    ...renderEmail({
      preheader: `${subjectPrefix}: ${title}`,
      heading,
      paragraphs,
      cta:
        kind === "update" && htmlLink
          ? { label: "Open in Google Calendar", url: htmlLink }
          : undefined,
      footer:
        "Google Calendar sends the calendar update separately. This message carries the organizer note.",
    }),
  };
}

export async function sendEventGuestNotificationNote({
  event,
  organizerEmail,
  message,
  kind,
  scope,
}: {
  event: CalendarEvent;
  organizerEmail: string;
  message?: string;
  kind: GuestNotificationKind;
  scope?: DeleteEventScope;
}): Promise<GuestNotificationResult> {
  const normalizedMessage = normalizeGuestNotificationMessage(message);
  if (!normalizedMessage) {
    return {
      requested: false,
      recipientCount: 0,
      sentCount: 0,
      skippedReason: "empty-message",
    };
  }

  const recipients = guestRecipients(event);
  if (recipients.length === 0) {
    return {
      requested: true,
      recipientCount: 0,
      sentCount: 0,
      skippedReason: "no-recipients",
    };
  }

  if (!(await isEmailConfigured())) {
    return {
      requested: true,
      recipientCount: recipients.length,
      sentCount: 0,
      skippedReason: "email-not-configured",
    };
  }

  const rendered = renderEventGuestNote({
    title: stripCrlf(event.title) || "Calendar event",
    organizer: stripCrlf(event.organizer?.displayName) || organizerEmail,
    message: normalizedMessage,
    when: formatWhen(event),
    kind,
    appliesTo: scopeLabel(scope),
    htmlLink: event.htmlLink,
  });

  let sentCount = 0;
  const errors: string[] = [];
  await Promise.all(
    recipients.map(async (to) => {
      try {
        await sendEmail({
          to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          replyTo: organizerEmail,
          templateId:
            kind === "cancellation"
              ? CALENDAR_EVENT_CANCELLATION_NOTE_EMAIL_ID
              : CALENDAR_EVENT_UPDATE_NOTE_EMAIL_ID,
        });
        sentCount += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }),
  );

  return {
    requested: true,
    recipientCount: recipients.length,
    sentCount,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
