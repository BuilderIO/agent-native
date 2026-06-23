export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  /** IANA timezone for timed starts, e.g. America/New_York. */
  startTimeZone?: string;
  /** IANA timezone for timed ends, e.g. America/New_York. */
  endTimeZone?: string;
  location: string;
  allDay: boolean;
  source: "local" | "google" | "ical";
  googleEventId?: string;
  /** Absolute Google Calendar web URL for Google events */
  htmlLink?: string;
  accountEmail?: string;
  /** Set when this event belongs to an overlaid person's calendar */
  overlayEmail?: string;
  /** Client-only marker for overlaid calendar ownership */
  ownerColor?: string;
  /** Client-only display name for the overlaid calendar owner */
  ownerName?: string;
  color?: string;
  /** Google Calendar event color id (1-11). */
  colorId?: string;
  /** User's RSVP status from Google Calendar */
  responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
  /** Google Calendar free/busy visibility; transparent means the event is free */
  transparency?: "opaque" | "transparent";
  /** Native Google Calendar event type. Non-default types cannot be changed after creation. */
  eventType?:
    | "default"
    | "birthday"
    | "focusTime"
    | "fromGmail"
    | "outOfOffice"
    | "workingLocation";
  attendees?: Array<{
    email: string;
    displayName?: string;
    photoUrl?: string;
    /** Google Calendar RSVP note/comment from the attendee */
    comment?: string;
    responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
    organizer?: boolean;
    self?: boolean;
  }>;
  reminders?: Array<{ method: "popup" | "email"; minutes: number }>;
  /** Whether this event uses the calendar's default reminder policy. */
  remindersUseDefault?: boolean;
  recurrence?: string[]; // RRULE strings from Google Calendar
  recurringEventId?: string;
  hangoutLink?: string; // Google Meet link
  /** Meeting URL stored in location/description for non-Google providers such as Zoom */
  meetingLink?: string;
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
  /**
   * Client-only hint set on a draft event when the user has chosen to add a
   * video conference that will be provisioned when the event is created. Lets
   * the UI show the conferencing row as already attached instead of a
   * "will be added later" placeholder. Never sent to or returned by the server.
   */
  pendingConferenceProvider?: "meet" | "zoom";
  attachments?: Array<{
    fileUrl: string;
    title: string;
    mimeType?: string;
    iconLink?: string;
    fileId?: string;
  }>;
  visibility?: "default" | "public" | "private" | "confidential";
  status?: "confirmed" | "tentative" | "cancelled";
  outOfOfficeProperties?: {
    autoDeclineMode?:
      | "declineNone"
      | "declineAllConflictingInvitations"
      | "declineOnlyNewConflictingInvitations";
    declineMessage?: string;
  };
  focusTimeProperties?: {
    autoDeclineMode?:
      | "declineNone"
      | "declineAllConflictingInvitations"
      | "declineOnlyNewConflictingInvitations";
    declineMessage?: string;
    chatStatus?: "available" | "doNotDisturb";
  };
  workingLocationProperties?: {
    type?: "homeOffice" | "officeLocation" | "customLocation";
    homeOffice?: unknown;
    officeLocation?: {
      buildingId?: string;
      deskId?: string;
      floorId?: string;
      floorSectionId?: string;
      label?: string;
    };
    customLocation?: {
      label?: string;
    };
  };
  organizer?: { email: string; displayName?: string; self?: boolean };
  createdAt: string;
  updatedAt: string;
  /** Client-only: temp id preserved across optimistic→real swap to keep React keys stable */
  _tempId?: string;
}

export interface CalendarEventDraft {
  id: string;
  title?: string;
  description?: string;
  start?: string;
  end?: string;
  startTimeZone?: string;
  endTimeZone?: string;
  location?: string;
  allDay?: boolean;
  eventType?: "default" | "outOfOffice" | "focusTime" | "workingLocation";
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private" | "confidential";
  colorId?: string;
  reminders?: CalendarEvent["reminders"];
  remindersUseDefault?: boolean;
  attachments?: CalendarEvent["attachments"];
  attendees?: CalendarEvent["attendees"];
  addGoogleMeet?: boolean;
  addZoom?: boolean;
  accountEmail?: string;
  workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
  workingLocationLabel?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FindTimeParticipant {
  email: string;
  displayName?: string;
  role: "organizer" | "attendee";
}

export interface FindTimeBusyBlock {
  participantEmail: string;
  participantName?: string;
  start: string;
  end: string;
  title?: string;
}

export interface FindTimeSlot {
  start: string;
  end: string;
  date: string;
  durationMinutes: number;
  availableParticipantEmails: string[];
  unavailableParticipantEmails: string[];
}

export interface FindTimeResult {
  range: {
    from: string;
    to: string;
    timezone: string;
    durationMinutes: number;
    slotStepMinutes: number;
  };
  googleConnected: boolean;
  participants: FindTimeParticipant[];
  busy: FindTimeBusyBlock[];
  slots: FindTimeSlot[];
  errors?: Array<{ email: string; error: string }>;
  message?: string;
}

export type DeleteEventScope = "single" | "all" | "thisAndFollowing";
export type UpdateEventScope = "single" | "all";

export interface DeleteEventOptions {
  scope?: DeleteEventScope;
  sendUpdates?: "all" | "none";
  notificationMessage?: string;
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

export interface BookingHost {
  email: string;
  displayName?: string;
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
  /** Google Calendar event created for this booking, if any */
  googleEventId?: string;
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
  /** Required co-hosts in addition to the booking link owner */
  hosts?: BookingHost[];
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
  accounts: Array<{ email: string; expiresAt?: string; photoUrl?: string }>;
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
