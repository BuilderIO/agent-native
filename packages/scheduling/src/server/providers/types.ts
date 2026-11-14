import type { BusyInterval, Booking } from "../../shared/index.js";

export interface CalendarProvider {
  kind: string;

  label: string;

  startOAuth(opts: {
    redirectUri: string;
    state: string;
  }): Promise<{ authUrl: string }>;

  completeOAuth(opts: {
    credentialId: string;
    userEmail: string;
    code: string;
    redirectUri: string;
  }): Promise<{
    externalEmail: string;
    calendars: { externalId: string; name: string; primary: boolean }[];
  }>;

  listCalendars(opts: {
    credentialId: string;
  }): Promise<{ externalId: string; name: string; primary: boolean }[]>;

  getBusy(opts: {
    credentialId: string;
    /**
     * Provider-facing secrets for a `workspace:` calendar ref, resolved by the
     * host's scoped resolver. A legacy credential id arrives without them and the
     * provider reads it as it always has.
     */
    credentials?: Record<string, string>;
    calendarExternalIds: string[];
    start: Date;
    end: Date;
  }): Promise<BusyInterval[]>;

  createEvent(opts: {
    credentialId: string;
    credentials?: Record<string, string>;
    calendarExternalId: string;
    booking: Booking;
    includeConference?: boolean;
    /**
     * The host's reminder choice for this booking, in minutes before the start.
     * `null` means the host turned reminders off for this event; `undefined` means
     * the event type did not set one and the provider keeps its own default.
     */
    reminderOverride?: number[] | null;
  }): Promise<{
    externalId: string;
    meetingUrl?: string;
    icalUid?: string;
  }>;

  updateEvent(opts: {
    credentialId: string;
    credentials?: Record<string, string>;
    externalId: string;
    booking: Booking;
    reminderOverride?: number[] | null;
  }): Promise<{ iCalSequence: number }>;

  deleteEvent(opts: {
    credentialId: string;
    credentials?: Record<string, string>;
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

  createMeeting(opts: {
    credentialId?: string;
    /**
     * Provider-facing secrets for a `workspace:` location ref, resolved by the
     * host's scoped resolver. A legacy credential id arrives without them and the
     * provider reads it as it always has.
     */
    credentials?: Record<string, string>;
    booking: Booking;
  }): Promise<{
    meetingUrl: string;
    meetingId: string;
    meetingPassword?: string;
  }>;

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
