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
    calendarExternalIds: string[];
    start: Date;
    end: Date;
  }): Promise<BusyInterval[]>;

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

  updateEvent(opts: {
    credentialId: string;
    externalId: string;
    booking: Booking;
  }): Promise<{ iCalSequence: number }>;

  deleteEvent(opts: {
    credentialId: string;
    externalId: string;
  }): Promise<void>;
}

export interface VideoProvider {
  kind: string;
  label: string;

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

  createMeeting(opts: { credentialId?: string; booking: Booking }): Promise<{
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
