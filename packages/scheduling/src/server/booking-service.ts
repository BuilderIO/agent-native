import { eq } from "drizzle-orm";

import type {
  Booking,
  Attendee,
  Location,
  EventType,
} from "../shared/index.js";
import { assertSlotAvailable } from "./availability-engine.js";
import {
  insertBooking,
  getBookingByUid,
  updateBookingStatus,
  markAttendeeNoShow,
  addBookingReference,
} from "./bookings-repo.js";
import { getSchedulingContext } from "./context.js";
import { getEventTypeById } from "./event-types-repo.js";
import {
  onBookingCreated,
  onBookingCancelled,
  onBookingRescheduled,
} from "./hooks.js";
import { getCalendarProvider, getVideoProvider } from "./providers/registry.js";

export interface CreateBookingInput {
  eventType: EventType;
  hostEmail: string;
  startTime: string;
  endTime: string;
  timezone: string;
  title?: string;
  description?: string;
  location?: Location;
  attendee: Attendee;
  guests?: Attendee[];
  customResponses?: Record<string, any>;
  iCalUid?: string;
  iCalSequence?: number;
  orgId?: string;
  fromReschedule?: string;
  requireZoomMeeting?: boolean;
}

export class BookingLifecycleError extends Error {
  constructor(
    message: string,
    readonly statusCode: 409 | 502,
    readonly errorCode:
      | "zoom_meeting_review_required"
      | "video_meeting_cleanup_failed"
      | "video_meeting_creation_failed",
  ) {
    super(message);
  }
}

export async function createBooking(
  input: CreateBookingInput,
): Promise<Booking> {
  const eventType = input.eventType;
  const title =
    input.title ??
    eventType.eventName?.replace("{attendeeName}", input.attendee.name) ??
    `${eventType.title} with ${input.attendee.name}`;
  const attendees: Attendee[] = [input.attendee, ...(input.guests ?? [])];
  await assertSlotAvailable({
    hostEmail: input.hostEmail,
    startTime: input.startTime,
    endTime: input.endTime,
    beforeEventBuffer: eventType.beforeEventBuffer,
    afterEventBuffer: eventType.afterEventBuffer,
    excludeBookingUid: input.fromReschedule,
  });
  const booking = await insertBooking({
    eventTypeId: eventType.id,
    hostEmail: input.hostEmail,
    title,
    description: input.description,
    startTime: input.startTime,
    endTime: input.endTime,
    timezone: input.timezone,
    status: eventType.requiresConfirmation ? "pending" : "confirmed",
    location: input.location ?? eventType.locations[0],
    attendees,
    customResponses: input.customResponses,
    iCalUid: input.iCalUid,
    iCalSequence: input.iCalSequence,
    fromReschedule: input.fromReschedule,
    ownerEmail: input.hostEmail,
    orgId: input.orgId,
  });

  let usableZoomMeeting = false;

  if (booking.location && isVideoKind(booking.location.kind)) {
    const provider = getVideoProvider(
      videoProviderKindFor(booking.location.kind),
    );
    if (provider) {
      try {
        const meeting = await provider.createMeeting({
          credentialId: booking.location.credentialId,
          booking,
        });
        if (meeting.meetingId && booking.location.credentialId) {
          await addBookingReference(booking.id, {
            type: provider.kind,
            externalId: meeting.meetingId,
            meetingUrl: meeting.meetingUrl,
            meetingPassword: meeting.meetingPassword,
            credentialId: booking.location.credentialId,
          });
          usableZoomMeeting =
            provider.kind === "zoom_video" && Boolean(meeting.meetingUrl);
        }
      } catch {
        if (input.requireZoomMeeting) {
          throw new BookingLifecycleError(
            "Replacement Zoom meeting could not be confirmed. The original booking remains active, and the replacement reservation needs host review.",
            502,
            "video_meeting_creation_failed",
          );
        }
        // Continue without the video link; the host can fix on the booking detail page
      }
    }
  }

  if (input.requireZoomMeeting && !usableZoomMeeting) {
    throw new BookingLifecycleError(
      "Replacement Zoom meeting could not be confirmed. The original booking remains active, and the replacement reservation needs host review.",
      502,
      "video_meeting_creation_failed",
    );
  }

  await writeToDestinationCalendars(booking);

  await onBookingCreated(booking);

  const final = await getBookingByUid(booking.uid);
  if (!final) throw new Error("Booking disappeared after creation");
  return final;
}

export async function rescheduleBooking(input: {
  uid: string;
  newStartTime: string;
  newEndTime: string;
  reason?: string;
  rescheduledBy?: "attendee" | "host";
  zoomMeetingResolved?: boolean;
}): Promise<Booking> {
  const original = await getBookingByUid(input.uid);
  if (!original) throw new Error(`Booking ${input.uid} not found`);
  const eventType = await getEventTypeById(original.eventTypeId);
  if (!eventType) throw new Error("Event type missing");
  requireZoomMeetingResolution(original, input.zoomMeetingResolved);

  const attendee = original.attendees[0];
  const guests = original.attendees.slice(1);
  const newBooking = await createBooking({
    eventType,
    hostEmail: original.hostEmail,
    startTime: input.newStartTime,
    endTime: input.newEndTime,
    timezone: original.timezone,
    title: original.title,
    description: original.description,
    location: original.location,
    attendee,
    guests,
    customResponses: original.customResponses,
    iCalUid: original.iCalUid,
    iCalSequence: original.iCalSequence + 1,
    fromReschedule: input.uid,
    requireZoomMeeting: original.location?.kind === "zoom",
  });

  try {
    await deleteVideoMeetings(original);
  } catch (error) {
    try {
      await cancelBooking({ uid: newBooking.uid });
    } catch (rollbackError) {
      const cleanupMessage =
        rollbackError instanceof Error
          ? rollbackError.message
          : "unknown error";
      throw new BookingLifecycleError(
        `The existing meeting could not be canceled, and the replacement booking could not be fully rolled back: ${cleanupMessage}`,
        502,
        "video_meeting_cleanup_failed",
      );
    }
    throw error;
  }

  await updateBookingStatus(input.uid, "rescheduled", {
    reschedulingReason: input.reason,
  });

  for (const ref of original.references) {
    const provider = getCalendarProvider(ref.type);
    if (provider?.updateEvent && ref.credentialId) {
      try {
        await provider.updateEvent({
          credentialId: ref.credentialId,
          externalId: ref.externalId,
          booking: newBooking,
        });
      } catch {
        // Event may have been deleted manually; fall through
      }
    }
  }

  await onBookingRescheduled(original, newBooking);
  return newBooking;
}

export async function cancelBooking(input: {
  uid: string;
  reason?: string;
  cancelledBy?: "attendee" | "host";
  zoomMeetingResolved?: boolean;
}): Promise<Booking> {
  const booking = await getBookingByUid(input.uid);
  if (!booking) throw new Error(`Booking ${input.uid} not found`);
  requireZoomMeetingResolution(booking, input.zoomMeetingResolved);
  await deleteVideoMeetings(booking);

  await updateBookingStatus(input.uid, "cancelled", {
    cancellationReason: input.reason,
  });

  for (const ref of booking.references) {
    const calProvider = getCalendarProvider(ref.type);
    if (calProvider?.deleteEvent && ref.credentialId) {
      try {
        await calProvider.deleteEvent({
          credentialId: ref.credentialId,
          externalId: ref.externalId,
        });
      } catch {}
    }
  }

  await onBookingCancelled(booking);
  return (await getBookingByUid(input.uid))!;
}

function requireZoomMeetingResolution(
  booking: Booking,
  zoomMeetingResolved?: boolean,
): void {
  if (
    booking.location?.kind === "zoom" &&
    !booking.references.some((ref) => ref.type === "zoom_video") &&
    zoomMeetingResolved !== true
  ) {
    throw new BookingLifecycleError(
      "Zoom meeting needs host review; cancel it in Zoom, then confirm it was resolved",
      409,
      "zoom_meeting_review_required",
    );
  }
}

async function deleteVideoMeetings(booking: Booking): Promise<void> {
  for (const ref of booking.references) {
    const provider = getVideoProvider(ref.type);
    if (!provider) {
      if (ref.type.endsWith("_video") || ref.type === "google_meet") {
        throw new BookingLifecycleError(
          `${ref.type} provider is unavailable to cancel this meeting`,
          502,
          "video_meeting_cleanup_failed",
        );
      }
      continue;
    }
    if (!provider.deleteMeeting) {
      throw new BookingLifecycleError(
        `${provider.label} does not support meeting cancellation`,
        502,
        "video_meeting_cleanup_failed",
      );
    }
    try {
      await provider.deleteMeeting({
        credentialId: ref.credentialId,
        meetingId: ref.externalId,
      });
    } catch (error) {
      throw new BookingLifecycleError(
        `${provider.label} meeting could not be canceled${error instanceof Error ? `: ${error.message}` : ""}`,
        502,
        "video_meeting_cleanup_failed",
      );
    }
  }
}

export async function markNoShow(
  uid: string,
  attendeeEmail: string,
): Promise<void> {
  const booking = await getBookingByUid(uid);
  if (!booking) throw new Error(`Booking ${uid} not found`);
  await markAttendeeNoShow(booking.id, attendeeEmail);
}

function isVideoKind(kind: string): boolean {
  return ["builtin-video", "zoom", "google-meet", "teams"].includes(kind);
}

function videoProviderKindFor(kind: string): string {
  if (kind === "builtin-video") return "builtin_video";
  if (kind === "zoom") return "zoom_video";
  if (kind === "google-meet") return "google_meet";
  if (kind === "teams") return "teams_video";
  return kind;
}

async function writeToDestinationCalendars(booking: Booking): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const destinations = await db
    .select()
    .from(schema.destinationCalendars)
    .where(eq(schema.destinationCalendars.userEmail, booking.hostEmail));
  for (const dest of destinations) {
    if (dest.eventTypeId && dest.eventTypeId !== booking.eventTypeId) continue;
    const provider = getCalendarProvider(dest.integration);
    if (!provider) continue;
    try {
      const result = await provider.createEvent({
        credentialId: dest.credentialId,
        calendarExternalId: dest.externalId,
        booking,
        includeConference:
          booking.location?.kind === "google-meet" &&
          dest.integration === "google_calendar",
      });
      await addBookingReference(booking.id, {
        type: dest.integration,
        externalId: result.externalId,
        meetingUrl: result.meetingUrl,
        credentialId: dest.credentialId,
      });
    } catch {
      // Calendar write failed; booking still exists locally
    }
  }
}
