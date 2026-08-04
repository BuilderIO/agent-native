/**
 * Catalog entries for the transactional emails Calendar sends.
 *
 * Registered from `server/plugins/transactional-emails.ts` so Dispatch can list
 * and preview them without the app having sent anything yet.
 */

import { defineTransactionalEmail } from "@agent-native/core/email-catalog";

import {
  renderBookingCancelledEmail,
  renderBookingCancelledHostEmail,
  renderBookingConfirmedEmail,
  renderBookingReceivedEmail,
} from "./booking-emails.js";
import { renderEventGuestNote } from "./event-guest-notifications.js";

/** Obviously-fake sample data — these render in a preview pane, never send. */
const SAMPLE_TITLE = "Intro call";
const SAMPLE_WHEN = "Tuesday, March 4, 2025, 10:00 AM - 10:30 AM PST";
const SAMPLE_HOST = "dana.hill@example.com";
const SAMPLE_GUEST = "sam.rivera@example.com";
const SAMPLE_GUEST_NAME = "Sam Rivera";
const SAMPLE_MANAGE_URL = "https://example.com/book/dana/manage/sample-token";
const SAMPLE_BOOK_AGAIN_URL = "https://example.com/book/dana/intro-call";
const SAMPLE_MEETING_LINK = "https://meet.example.com/sample-intro-call";

export const CALENDAR_BOOKING_CONFIRMED_EMAIL_ID = "calendar.booking-confirmed";
export const CALENDAR_BOOKING_RECEIVED_EMAIL_ID = "calendar.booking-received";
export const CALENDAR_BOOKING_CANCELLED_EMAIL_ID = "calendar.booking-cancelled";
export const CALENDAR_BOOKING_CANCELLED_HOST_EMAIL_ID =
  "calendar.booking-cancelled-host";
export const CALENDAR_EVENT_UPDATE_NOTE_EMAIL_ID = "calendar.event-update-note";
export const CALENDAR_EVENT_CANCELLATION_NOTE_EMAIL_ID =
  "calendar.event-cancellation-note";

let registered = false;

export function registerCalendarEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: CALENDAR_BOOKING_CONFIRMED_EMAIL_ID,
    name: "Booking confirmed (guest)",
    trigger:
      "A guest completes a booking on a public `/book/{username}/{slug}` page and the booking row is created.",
    recipient:
      "The email address the guest typed into the booking form (`booking.email`).",
    sender:
      "The configured EMAIL_FROM, with reply-to set to the booking link owner's address.",
    preview: () =>
      renderBookingConfirmedEmail({
        title: SAMPLE_TITLE,
        when: SAMPLE_WHEN,
        host: SAMPLE_HOST,
        manageUrl: SAMPLE_MANAGE_URL,
        meetingLink: SAMPLE_MEETING_LINK,
      }),
  });

  defineTransactionalEmail({
    id: CALENDAR_BOOKING_RECEIVED_EMAIL_ID,
    name: "New booking (host)",
    trigger:
      "Sent alongside the guest confirmation, immediately after a public booking is created.",
    recipient:
      "The owner of the booking link, looked up from the link's slug at send time.",
    sender:
      "The configured EMAIL_FROM, with reply-to set to the guest so the host can reply directly.",
    preview: () =>
      renderBookingReceivedEmail({
        title: SAMPLE_TITLE,
        when: SAMPLE_WHEN,
        attendeeName: SAMPLE_GUEST_NAME,
        attendee: SAMPLE_GUEST,
        manageUrl: SAMPLE_MANAGE_URL,
        meetingLink: SAMPLE_MEETING_LINK,
      }),
  });

  defineTransactionalEmail({
    id: CALENDAR_BOOKING_CANCELLED_EMAIL_ID,
    name: "Booking cancelled (guest)",
    trigger:
      "A booking that was not already cancelled is cancelled, either by the guest through the manage/cancel token link or by someone with access to the booking link.",
    recipient: "The guest address stored on the booking row.",
    sender:
      "The configured EMAIL_FROM, with reply-to set to the host when a host address could be resolved from the link slug.",
    preview: () =>
      renderBookingCancelledEmail({
        title: SAMPLE_TITLE,
        when: SAMPLE_WHEN,
        host: SAMPLE_HOST,
        bookAgainUrl: SAMPLE_BOOK_AGAIN_URL,
      }),
  });

  defineTransactionalEmail({
    id: CALENDAR_BOOKING_CANCELLED_HOST_EMAIL_ID,
    name: "Booking cancelled (host)",
    trigger:
      "Sent after the guest cancellation notice, and only when a host address could be resolved from the booking link slug.",
    recipient: "The booking link owner's address.",
    sender:
      "The configured EMAIL_FROM, with reply-to set to the guest who was booked.",
    preview: () =>
      renderBookingCancelledHostEmail({
        title: SAMPLE_TITLE,
        when: SAMPLE_WHEN,
        attendeeName: SAMPLE_GUEST_NAME,
        attendee: SAMPLE_GUEST,
      }),
  });

  defineTransactionalEmail({
    id: CALENDAR_EVENT_UPDATE_NOTE_EMAIL_ID,
    name: "Event update note",
    trigger:
      "`update-event` runs with a non-empty guest notification message. Google Calendar still sends its own update invite; this carries only the organizer's note.",
    recipient:
      "Every attendee on the event with a syntactically valid address, excluding the organizer's own `self` attendee row. One email per address.",
    sender:
      "The configured EMAIL_FROM, with reply-to set to the organizer running the update.",
    preview: () =>
      renderEventGuestNote({
        title: "Design review",
        organizer: "Dana Hill",
        message: "Moving this an hour later so the whole team can join.",
        when: SAMPLE_WHEN,
        kind: "update",
        htmlLink: "https://calendar.example.com/event/sample",
      }),
  });

  defineTransactionalEmail({
    id: CALENDAR_EVENT_CANCELLATION_NOTE_EMAIL_ID,
    name: "Event cancellation note",
    trigger:
      "`delete-event` runs with guest notification requested and a non-empty message. Google Calendar sends the cancellation itself; this carries only the organizer's note.",
    recipient:
      "Every attendee on the deleted event with a syntactically valid address, excluding the organizer's own `self` attendee row. One email per address.",
    sender:
      "The configured EMAIL_FROM, with reply-to set to the organizer running the deletion.",
    preview: () =>
      renderEventGuestNote({
        title: "Design review",
        organizer: "Dana Hill",
        message: "Cancelling this week — we will pick it up after the launch.",
        when: SAMPLE_WHEN,
        kind: "cancellation",
        appliesTo: "all events in the series",
      }),
  });
}
