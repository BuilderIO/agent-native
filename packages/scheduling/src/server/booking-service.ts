/**
 * Booking lifecycle — create, reschedule, cancel — wired to providers and
 * workflow hooks.
 *
 * The booking flow:
 *   1. Load event type and resolve host (1:1, round-robin).
 *   2. Validate requested slot against availability engine.
 *   3. Insert the booking row + attendees.
 *   4. For each video/calendar provider, create external events and attach
 *      references to the booking.
 *   5. Emit lifecycle event → workflows materialize scheduled reminders.
 */
import type {
  Booking,
  Attendee,
  Location,
  EventType,
} from "../shared/index.js";
import {
  insertBooking,
  getBookingByUid,
  updateBookingStatus,
  markAttendeeNoShow,
  addBookingReference,
} from "./bookings-repo.js";
import { getEventTypeById } from "./event-types-repo.js";
import { getCalendarProvider, getVideoProvider } from "./providers/registry.js";
import {
  onBookingCreated,
  onBookingCancelled,
  onBookingRescheduled,
} from "./hooks.js";
import { getSchedulingContext } from "./context.js";
import { eq } from "drizzle-orm";

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
  orgId?: string;
  /** If set, we're rescheduling from this booking uid */
  fromReschedule?: string;
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
    fromReschedule: input.fromReschedule,
    ownerEmail: input.hostEmail,
    orgId: input.orgId,
  });

  // Create video meeting if location is a video kind
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
        if (meeting.meetingUrl) {
          await addBookingReference(booking.id, {
            type: provider.kind,
            externalId: meeting.meetingId,
            meetingUrl: meeting.meetingUrl,
            meetingPassword: meeting.meetingPassword,
            credentialId: booking.location.credentialId,
          });
        }
      } catch (err) {
        // Continue without the video link; the host can fix on the booking detail page
      }
    }
  }

  // Write to destination calendar
  await writeToDestinationCalendars(booking);

  // Fire workflow hooks
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
}): Promise<Booking> {
  const original = await getBookingByUid(input.uid);
  if (!original) throw new Error(`Booking ${input.uid} not found`);
  const eventType = await getEventTypeById(original.eventTypeId);
  if (!eventType) throw new Error("Event type missing");

  // Mark old as rescheduled
  await updateBookingStatus(input.uid, "rescheduled", {
    reschedulingReason: input.reason,
  });

  // Create new booking linked back to the original
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
    fromReschedule: input.uid,
  });

  // Update external calendar events (PATCH, not delete+create)
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
}): Promise<Booking> {
  const booking = await getBookingByUid(input.uid);
  if (!booking) throw new Error(`Booking ${input.uid} not found`);
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
    const videoProvider = getVideoProvider(ref.type);
    if (videoProvider?.deleteMeeting) {
      try {
        await videoProvider.deleteMeeting({
          credentialId: ref.credentialId,
          meetingId: ref.externalId,
        });
      } catch {}
    }
  }

  await onBookingCancelled(booking);
  return (await getBookingByUid(input.uid))!;
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
  return ["cal-video", "zoom", "google-meet", "teams"].includes(kind);
}

function videoProviderKindFor(kind: string): string {
  if (kind === "cal-video") return "cal_video";
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
