import type { BusyInterval } from "../../shared/index.js";
import { BookingLifecycleError } from "../booking-service.js";
import { WORKSPACE_CALENDAR_PREFIX } from "../calendar-credentials.js";
import type { CalendarProvider } from "./types.js";

/**
 * A calendar provider over the host's own owner-bound calendar bridge.
 *
 * The workspace keeps the provider grant, so the app never holds a raw token it could
 * read itself: it hands the package one `dispatch` function that re-verifies the
 * owner/org boundary and performs a single Calendar v3 request for a connection. This
 * adapter is what turns that into the `CalendarProvider` contract the booking and
 * availability code already speak, which is the half that was missing: without a
 * registered provider, a connected calendar was invisible to conflict checks and
 * destination writes.
 */
export interface WorkspaceCalendarDispatchRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface WorkspaceCalendarDispatchResponse {
  status: number;
  body: unknown;
}

export type WorkspaceCalendarDispatch = (
  connectionId: string,
  request: WorkspaceCalendarDispatchRequest,
) => Promise<WorkspaceCalendarDispatchResponse>;

export interface WorkspaceCalendarProviderConfig {
  /** Performs one Calendar v3 request for a connection the host has re-authorized. */
  dispatch: WorkspaceCalendarDispatch;
  /** The provider kind this adapter registers as; defaults to `google_calendar`. */
  kind?: string;
  label?: string;
}

function connectionIdFromRef(credentialId: string): string {
  if (!credentialId.startsWith(WORKSPACE_CALENDAR_PREFIX)) {
    throw new BookingLifecycleError(
      "That calendar connection is not available.",
      502,
      "calendar_credential_unavailable",
    );
  }
  const connectionId = credentialId
    .slice(WORKSPACE_CALENDAR_PREFIX.length)
    .trim();
  if (!connectionId) {
    throw new BookingLifecycleError(
      "That calendar connection is not available.",
      502,
      "calendar_credential_unavailable",
    );
  }
  return connectionId;
}

function eventBody(input: {
  booking: {
    title: string;
    description?: string | null;
    startTime: string;
    endTime: string;
    timezone?: string | null;
    attendees?: { email: string; name?: string | null }[];
    iCalUid?: string | null;
    iCalSequence?: number | null;
  };
  reminderOverride?: number[] | null;
  includeConference?: boolean;
}): Record<string, unknown> {
  const { booking } = input;
  const body: Record<string, unknown> = {
    summary: booking.title,
    start: {
      dateTime: booking.startTime,
      ...(booking.timezone ? { timeZone: booking.timezone } : {}),
    },
    end: {
      dateTime: booking.endTime,
      ...(booking.timezone ? { timeZone: booking.timezone } : {}),
    },
    ...(booking.description ? { description: booking.description } : {}),
    ...(booking.attendees?.length
      ? {
          attendees: booking.attendees.map((a) => ({
            email: a.email,
            ...(a.name ? { displayName: a.name } : {}),
          })),
        }
      : {}),
    ...(booking.iCalUid
      ? { iCalUID: booking.iCalUid, sequence: booking.iCalSequence ?? 0 }
      : {}),
  };
  // The host's reminder choice travels with the event; `null` means "no reminders
  // for this one", while an absent override leaves the provider's own default alone.
  if (input.reminderOverride !== undefined) {
    body.reminders =
      input.reminderOverride === null
        ? { useDefault: false }
        : {
            useDefault: false,
            overrides: input.reminderOverride.map((minutes) => ({
              method: "popup",
              minutes,
            })),
          };
  }
  if (input.includeConference) {
    body.conferenceDataVersion = 1;
    body.conferenceData = {
      createRequest: {
        requestId: `scheduling-${input.booking.iCalUid ?? input.booking.startTime}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return body;
}

export function createWorkspaceCalendarProvider(
  config: WorkspaceCalendarProviderConfig,
): CalendarProvider {
  const kind = config.kind ?? "google_calendar";
  const label = config.label ?? "Google Calendar";

  async function call<T>(
    credentialId: string,
    request: WorkspaceCalendarDispatchRequest,
  ): Promise<T> {
    const connectionId = connectionIdFromRef(credentialId);
    const response = await config.dispatch(connectionId, request);
    if (response.status === 401 || response.status === 403) {
      throw new BookingLifecycleError(
        "That calendar connection is not available.",
        502,
        "calendar_credential_unavailable",
      );
    }
    if (response.status >= 400) {
      throw new BookingLifecycleError(
        `The calendar request failed (${response.status}).`,
        502,
        "calendar_write_failed",
      );
    }
    return response.body as T;
  }

  return {
    kind,
    label,

    // A workspace connection is connected through the workspace, not through a
    // second OAuth app here, so these say that plainly instead of pretending.
    async startOAuth() {
      throw new BookingLifecycleError(
        "Calendar connections are managed in the workspace, not from here.",
        409,
        "calendar_credential_unavailable",
      );
    },

    async completeOAuth() {
      throw new BookingLifecycleError(
        "Calendar connections are managed in the workspace, not from here.",
        409,
        "calendar_credential_unavailable",
      );
    },

    async listCalendars({ credentialId }) {
      const resp = await call<{
        items?: { id?: string; summary?: string; primary?: boolean }[];
      }>(credentialId, { method: "GET", path: "/users/me/calendarList" });
      return (resp.items ?? [])
        .filter(
          (item): item is { id: string; summary?: string; primary?: boolean } =>
            typeof item.id === "string" && item.id.length > 0,
        )
        .map((item) => ({
          externalId: item.id,
          name: item.summary ?? item.id,
          primary: Boolean(item.primary),
        }));
    },

    async getBusy({ credentialId, calendarExternalIds, start, end }) {
      const resp = await call<{
        calendars?: Partial<
          Record<
            string,
            { busy?: { start: string; end: string }[]; errors?: unknown[] }
          >
        >;
      }>(credentialId, {
        method: "POST",
        path: "/freeBusy",
        body: {
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          items: calendarExternalIds.map((id) => ({ id })),
        },
      });
      const busy: BusyInterval[] = [];
      for (const calendarId of calendarExternalIds) {
        const entry = resp.calendars?.[calendarId];
        if (entry?.errors?.length) {
          // An unreadable calendar is not an empty one.
          throw new BookingLifecycleError(
            "That calendar could not be checked.",
            502,
            "calendar_write_failed",
          );
        }
        for (const interval of entry?.busy ?? []) {
          busy.push({
            start: interval.start,
            end: interval.end,
            source: `${kind}:${calendarId}`,
          });
        }
      }
      return busy;
    },

    async createEvent(opts) {
      const resp = await call<{
        id?: string;
        hangoutLink?: string;
        iCalUID?: string;
      }>(opts.credentialId, {
        method: "POST",
        path: `/calendars/${encodeURIComponent(opts.calendarExternalId)}/events`,
        ...(opts.includeConference
          ? { query: { conferenceDataVersion: 1 } }
          : {}),
        body: eventBody({
          booking: opts.booking,
          ...(opts.reminderOverride === undefined
            ? {}
            : { reminderOverride: opts.reminderOverride }),
          ...(opts.includeConference === undefined
            ? {}
            : { includeConference: opts.includeConference }),
        }),
      });
      if (!resp.id) {
        throw new BookingLifecycleError(
          "The calendar did not confirm the new event.",
          502,
          "calendar_write_failed",
        );
      }
      // The booking keeps one string for a reference and a cancel needs both ids, so
      // the reference this provider persists is `<calendar>/<event>`; deleteEvent reads
      // it back apart.
      return {
        externalId: calendarRefFor(opts.calendarExternalId, resp.id),
        ...(resp.hangoutLink ? { meetingUrl: resp.hangoutLink } : {}),
        ...(resp.iCalUID ? { icalUid: resp.iCalUID } : {}),
      };
    },

    async updateEvent(opts) {
      const resp = await call<{ sequence?: number }>(opts.credentialId, {
        method: "PATCH",
        path: `/calendars/${encodeURIComponent(calendarIdFromExternal(opts.externalId))}/events/${encodeURIComponent(eventIdFromExternal(opts.externalId))}`,
        body: eventBody({
          booking: opts.booking,
          ...(opts.reminderOverride === undefined
            ? {}
            : { reminderOverride: opts.reminderOverride }),
        }),
      });
      return { iCalSequence: resp.sequence ?? opts.booking.iCalSequence };
    },

    async deleteEvent(opts) {
      const response = await config.dispatch(
        connectionIdFromRef(opts.credentialId),
        {
          method: "DELETE",
          path: `/calendars/${encodeURIComponent(calendarIdFromExternal(opts.externalId))}/events/${encodeURIComponent(eventIdFromExternal(opts.externalId))}`,
        },
      );
      // 404 and 410 mean the event is already gone, which is what a cancel wants.
      if (
        response.status >= 400 &&
        response.status !== 404 &&
        response.status !== 410
      ) {
        throw new BookingLifecycleError(
          `The calendar event could not be removed (${response.status}).`,
          502,
          "calendar_delete_failed",
        );
      }
    },
  };
}

/**
 * A reference stored for a created event is `<calendarId>/<eventId>`: a cancel has to
 * name both, and the booking only keeps one string.
 */
export function calendarRefFor(
  calendarExternalId: string,
  eventExternalId: string,
): string {
  return `${calendarExternalId}/${eventExternalId}`;
}

function calendarIdFromExternal(externalId: string): string {
  const index = externalId.indexOf("/");
  return index === -1 ? "primary" : externalId.slice(0, index);
}

function eventIdFromExternal(externalId: string): string {
  const index = externalId.indexOf("/");
  return index === -1 ? externalId : externalId.slice(index + 1);
}
