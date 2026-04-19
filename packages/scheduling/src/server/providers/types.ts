/**
 * Pluggable provider interfaces for calendar reads and video-meeting writes.
 *
 * Consumers register providers via the registry. Each provider owns its own
 * OAuth/credential lifecycle; this package is agnostic to how the tokens
 * are stored (typically in core `oauth_tokens`).
 */
import type { BusyInterval, Booking } from "../../shared/index.js";

export interface CalendarProvider {
  /** Unique provider slug, e.g. "google_calendar" */
  kind: string;

  /** Human-friendly display name, e.g. "Google Calendar" */
  label: string;

  /**
   * Start the OAuth flow — return an authorization URL for the user to visit.
   * `redirectUri` is the server's OAuth callback path for this provider.
   */
  startOAuth(opts: {
    redirectUri: string;
    state: string;
  }): Promise<{ authUrl: string }>;

  /** Complete the OAuth flow with the received code; persist the credential. */
  completeOAuth(opts: {
    credentialId: string;
    userEmail: string;
    code: string;
    redirectUri: string;
  }): Promise<{
    externalEmail: string;
    calendars: { externalId: string; name: string; primary: boolean }[];
  }>;

  /** List the calendars the user has access to (for Selected Calendars UI). */
  listCalendars(opts: {
    credentialId: string;
  }): Promise<{ externalId: string; name: string; primary: boolean }[]>;

  /** Read busy intervals across the user's selected calendars. */
  getBusy(opts: {
    credentialId: string;
    calendarExternalIds: string[];
    start: Date;
    end: Date;
  }): Promise<BusyInterval[]>;

  /** Create a calendar event; return the external id. */
  createEvent(opts: {
    credentialId: string;
    calendarExternalId: string;
    booking: Booking;
    includeConference?: boolean;
  }): Promise<{
    externalId: string;
    meetingUrl?: string;
    icalUid?: string;
  }>;

  /** Update (e.g. after reschedule). Returns the new iCalSequence. */
  updateEvent(opts: {
    credentialId: string;
    externalId: string;
    booking: Booking;
  }): Promise<{ iCalSequence: number }>;

  /** Delete/cancel an event. */
  deleteEvent(opts: {
    credentialId: string;
    externalId: string;
  }): Promise<void>;
}

export interface VideoProvider {
  kind: string;
  label: string;

  /**
   * Start the OAuth flow — optional. Present on providers like Zoom /
   * Microsoft Teams that require a user's OAuth grant to create meetings on
   * their behalf. Zero-OAuth providers (the built-in video provider, or
   * Google Meet which piggy-backs on the Google Calendar scope) omit this.
   */
  startOAuth?(opts: {
    redirectUri: string;
    state: string;
  }): Promise<{ authUrl: string }>;

  /**
   * Complete the OAuth flow — optional. Paired with `startOAuth`. Consumers
   * call this from their OAuth callback handler to exchange the `code` for
   * tokens and return identifying info so a `scheduling_credentials` row
   * can be written.
   */
  completeOAuth?(opts: {
    credentialId: string;
    userEmail: string;
    code: string;
    redirectUri: string;
  }): Promise<{
    externalEmail?: string;
    externalAccountId: string;
    displayName?: string;
  }>;

  /** Create a meeting room for a booking. */
  createMeeting(opts: { credentialId?: string; booking: Booking }): Promise<{
    meetingUrl: string;
    meetingId: string;
    meetingPassword?: string;
  }>;

  /** Delete the meeting when the booking is cancelled. */
  deleteMeeting?(opts: {
    credentialId?: string;
    meetingId: string;
  }): Promise<void>;
}

export interface SmsProvider {
  kind: string;
  label: string;
  sendSms(opts: { to: string; body: string; from?: string }): Promise<void>;
}
