
import { defineTransactionalEmail } from "@agent-native/core/email-catalog";

import {
  renderBookingCancelledEmail,
  renderBookingCancelledHostEmail,
  renderBookingConfirmedEmail,
  renderBookingReceivedEmail,
} from "./booking-emails.js";
import { renderEventGuestNote } from "./event-guest-notifications.js";
import { renderOverlayRequestEmail } from "./overlay-request-emails.js";

const SAMPLE_TITLE = "Intro call";
const SAMPLE_WHEN = "Tuesday, March 4, 2025, 10:00 AM - 10:30 AM PST";
const SAMPLE_HOST = "dana.hill@example.com";
const SAMPLE_GUEST = "sam.rivera@example.com";
const SAMPLE_GUEST_NAME = "Sam Rivera";
const SAMPLE_MANAGE_URL = "https://example.com/book/dana/manage/sample-token";
const SAMPLE_BOOK_AGAIN_URL = "https://example.com/book/dana/intro-call";
const SAMPLE_MEETING_LINK = "https://meet.example.com/sample-intro-call";
const SAMPLE_REQUESTER_NAME = "Dana Hill";
const SAMPLE_APP_LINK =
  "https://example.com/_agent-native/open?app=calendar&view=calendar";

export const CALENDAR_BOOKING_CONFIRMED_EMAIL_ID = "calendar.booking-confirmed";
export const CALENDAR_BOOKING_RECEIVED_EMAIL_ID = "calendar.booking-received";
export const CALENDAR_BOOKING_CANCELLED_EMAIL_ID = "calendar.booking-cancelled";
export const CALENDAR_BOOKING_CANCELLED_HOST_EMAIL_ID =
  "calendar.booking-cancelled-host";
export const CALENDAR_EVENT_UPDATE_NOTE_EMAIL_ID = "calendar.event-update-note";
export const CALENDAR_EVENT_CANCELLATION_NOTE_EMAIL_ID =
  "calendar.event-cancellation-note";
export const CALENDAR_OVERLAY_REQUEST_EMAIL_ID = "calendar.overlay-request";

let registered = false;

export function registerCalendarEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: CALENDAR_OVERLAY_REQUEST_EMAIL_ID,
    name: "Calendar access request",
    trigger:
      "The owner of a booking link clicks Send request on a host whose working hours are not being applied. Only fires for a peer already in the owner's `calendar-overlay-people` who has not added the owner back, and is rate-limited to one request per peer per hour and 20 per owner per day.",
    recipientLabel: "Booking link co-host",
    recipient:
      "The peer the owner has overlaid but who has not reciprocally overlaid the owner.",
    senderLabel: "Default, reply-to requester",
    sender:
      "The configured EMAIL_FROM, with reply-to set to the booking link owner who requested access.",
    preview: () =>
      renderOverlayRequestEmail({
        requesterName: SAMPLE_REQUESTER_NAME,
        requesterEmail: SAMPLE_HOST,
        appLink: SAMPLE_APP_LINK,
      }),
  });

  defineTransactionalEmail({
    id: CALENDAR_BOOKING_CONFIRMED_EMAIL_ID,
    name: "Booking confirmed (guest)",
    trigger:
      "A guest completes a booking on a public `/book/{username}/{slug}` page and the booking row is created.",
    recipientLabel: "Booking guest",
    recipient:
      "The email address the guest typed into the booking form (`booking.email`).",
    senderLabel: "Default, reply-to host",
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
    recipientLabel: "Booking link owner",
    recipient:
      "The owner of the booking link, looked up from the link's slug at send time.",
    senderLabel: "Default, reply-to guest",
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
    recipientLabel: "Booking guest",
    recipient: "The guest address stored on the booking row.",
    senderLabel: "Default, reply-to host",
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
    recipientLabel: "Booking link owner",
    recipient: "The booking link owner's address.",
    senderLabel: "Default, reply-to guest",
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
    recipientLabel: "Event attendees",
    recipient:
      "Every attendee on the event with a syntactically valid address, excluding the organizer's own `self` attendee row. One email per address.",
    senderLabel: "Default, reply-to organizer",
    sender:
      "The configured EMAIL_FROM, with reply-to set to the organizer running the update.",
    preview: () =>
      renderEventGuestNote({
        title: "Design review",
        organizer: "Dana Hill",
        message: "Moving this an hour later so the whole team can join.",
        when: SAMPLE_WHEN,
        kind: "update",
        calendarLink:
          "https://calendar.example.com/_agent-native/open?app=calendar&view=calendar&eventId=google-sample&date=2026-05-21",
      }),
  });

  defineTransactionalEmail({
    id: CALENDAR_EVENT_CANCELLATION_NOTE_EMAIL_ID,
    name: "Event cancellation note",
    trigger:
      "`delete-event` runs with guest notification requested and a non-empty message. Google Calendar sends the cancellation itself; this carries only the organizer's note.",
    recipientLabel: "Event attendees",
    recipient:
      "Every attendee on the deleted event with a syntactically valid address, excluding the organizer's own `self` attendee row. One email per address.",
    senderLabel: "Default, reply-to organizer",
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
