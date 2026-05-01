export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  location: string;
  allDay: boolean;
  source: "local" | "google" | "ical";
  googleEventId?: string;
  accountEmail?: string;
  /** Set when this event belongs to an overlaid person's calendar */
  overlayEmail?: string;
  color?: string;
  /** User's RSVP status from Google Calendar */
  responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
  attendees?: Array<{
    email: string;
    displayName?: string;
    photoUrl?: string;
    responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
    organizer?: boolean;
    self?: boolean;
  }>;
  reminders?: Array<{ method: "popup" | "email"; minutes: number }>;
  recurrence?: string[]; // RRULE strings from Google Calendar
  recurringEventId?: string;
  hangoutLink?: string; // Google Meet link
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType: string;
      uri: string;
      label?: string;
      pin?: string;
      passcode?: string;
    }>;
    conferenceSolution?: { name: string; iconUri?: string };
  };
  attachments?: Array<{
    fileUrl: string;
    title: string;
    mimeType?: string;
    iconLink?: string;
    fileId?: string;
  }>;
  visibility?: "default" | "public" | "private" | "confidential";
  status?: "confirmed" | "tentative" | "cancelled";
  organizer?: { email: string; displayName?: string; self?: boolean };
  createdAt: string;
  updatedAt: string;
  /** Client-only: temp id preserved across optimistic→real swap to keep React keys stable */
  _tempId?: string;
}

export type DeleteEventScope = "single" | "all" | "thisAndFollowing";

export interface DeleteEventOptions {
  scope?: DeleteEventScope;
  sendUpdates?: "all" | "none";
  /** When true and user is not the organizer, decline instead of deleting */
  removeOnly?: boolean;
}

export interface OverlayPerson {
  email: string;
  name?: string;
  color: string;
}

export interface TimeSlot {
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface DaySchedule {
  enabled: boolean;
  slots: TimeSlot[];
}

export interface AvailabilityConfig {
  timezone: string;
  weeklySchedule: {
    monday: DaySchedule;
    tuesday: DaySchedule;
    wednesday: DaySchedule;
    thursday: DaySchedule;
    friday: DaySchedule;
    saturday: DaySchedule;
    sunday: DaySchedule;
  };
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  slotDurationMinutes: number;
  bookingPageSlug: string;
  /** Unique username for booking URLs, e.g. calendar.agent-native.com/book/{username}/{slug} */
  bookingUsername?: string;
}

export interface CustomField {
  id: string;
  label: string;
  type: "text" | "email" | "url" | "tel" | "textarea" | "select" | "checkbox";
  required: boolean;
  placeholder?: string;
  /** Regex pattern for validation (e.g. LinkedIn URL pattern) */
  pattern?: string;
  /** Custom error message when pattern doesn't match */
  patternError?: string;
  /** Options for select type fields */
  options?: string[];
}

export interface ConferencingConfig {
  type: "none" | "google_meet" | "zoom" | "custom";
  /** Meeting URL for zoom/custom types */
  url?: string;
}

export interface Booking {
  id: string;
  name: string;
  email: string;
  eventTitle: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  slug: string;
  notes?: string;
  /** Responses to custom fields, keyed by field ID */
  fieldResponses?: Record<string, string | boolean>;
  /** Meeting link (Zoom, Google Meet, or custom) */
  meetingLink?: string;
  /** Token for cancel/reschedule link (only returned to the booker) */
  cancelToken?: string;
  status: "confirmed" | "cancelled";
  createdAt: string;
}

export interface BookingLink {
  id: string;
  slug: string;
  title: string;
  description?: string;
  duration: number;
  /** Additional duration options the booker can choose from */
  durations?: number[];
  /** Custom fields shown on the booking form */
  customFields?: CustomField[];
  /** Video conferencing configuration */
  conferencing?: ConferencingConfig;
  color?: string;
  isActive: boolean;
  /** Sharing visibility: private (default), org, or public */
  visibility?: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
}

export interface GoogleAuthStatus {
  connected: boolean;
  accounts: Array<{ email: string; expiresAt?: string }>;
}

export interface ExternalCalendar {
  id: string;
  name: string;
  url: string;
  color: string;
}

export interface Settings {
  timezone: string;
  bookingPageTitle: string;
  bookingPageDescription: string;
  defaultEventDuration: number; // minutes
}

export type ApolloPersonResult = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  photo_url?: string;
  linkedin_url?: string;
  twitter_url?: string;
  github_url?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone_numbers?: { raw_number: string; type?: string }[];
  employment_history?: {
    organization_name?: string;
    title?: string;
    start_date?: string;
    end_date?: string;
    current?: boolean;
  }[];
  organization?: {
    name?: string;
    website_url?: string;
    linkedin_url?: string;
    logo_url?: string;
    industry?: string;
    estimated_num_employees?: number;
    short_description?: string;
    founded_year?: number;
  };
};
