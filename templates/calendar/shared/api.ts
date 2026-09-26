export interface CalendarEvent {
  id: string;
  title: string;
  titleIsGenerated?: boolean;
  description: string;
  start: string;
  end: string;
  startTimeZone?: string;
  endTimeZone?: string;
  location: string;
  allDay: boolean;
  source: "local" | "google" | "ical";
  sourceId?: string;
  googleEventId?: string;
  htmlLink?: string;
  accountEmail?: string;
  calendarSourceKey?: string;
  canonicalKey?: string;
  calendarId?: string;
  calendarName?: string;
  calendarColor?: string;
  calendarAccessRole?: GoogleCalendarSource["accessRole"];
  calendarPrimary?: boolean;
  calendarReadOnly?: boolean;
  overlayEmail?: string;
  ownerColor?: string;
  ownerName?: string;
  color?: string;
  colorId?: string;
  responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
  transparency?: "opaque" | "transparent";
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
    comment?: string;
    responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
    organizer?: boolean;
    self?: boolean;
    optional?: boolean;
    additionalGuests?: number;
    timeZone?: string;
  }>;
  reminders?: Array<{ method: "popup" | "email"; minutes: number }>;
  remindersUseDefault?: boolean;
  recurrence?: string[];
  recurringEventId?: string;
  hangoutLink?: string;
  meetingLink?: string;
  meetingLinkPending?: boolean;
  videoConferenceError?: "zoom";
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
  _tempId?: string;
  _replacedId?: string;
}

type CalendarAttendee = NonNullable<CalendarEvent["attendees"]>[number];

function additionalGuestCount(attendee: CalendarAttendee): number {
  return typeof attendee.additionalGuests === "number" &&
    Number.isFinite(attendee.additionalGuests) &&
    attendee.additionalGuests > 0
    ? Math.floor(attendee.additionalGuests)
    : 0;
}

export function getCalendarAttendeeCount(
  attendees: CalendarEvent["attendees"],
): number {
  return (attendees ?? []).reduce(
    (count, attendee) => count + 1 + additionalGuestCount(attendee),
    0,
  );
}

export function getCalendarGuestCount(
  attendees: CalendarEvent["attendees"],
): number {
  return (attendees ?? []).reduce(
    (count, attendee) =>
      count + (attendee.self ? 0 : 1) + additionalGuestCount(attendee),
    0,
  );
}

export function getCalendarAttendeeStatusCounts(
  attendees: CalendarEvent["attendees"],
): Record<string, number> {
  return (attendees ?? []).reduce<Record<string, number>>(
    (counts, attendee) => {
      const status = attendee.responseStatus ?? "unknown";
      counts[status] =
        (counts[status] ?? 0) + 1 + additionalGuestCount(attendee);
      return counts;
    },
    {},
  );
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
  fullDay?: boolean;
  eventType?: "default" | "outOfOffice" | "focusTime" | "workingLocation";
  outOfOfficeProperties?: CalendarEvent["outOfOfficeProperties"];
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private" | "confidential";
  colorId?: string;
  reminders?: CalendarEvent["reminders"];
  remindersUseDefault?: boolean;
  recurrence?: CalendarEvent["recurrence"];
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
  removeOnly?: boolean;
}

export interface OverlayPerson {
  email: string;
  name?: string;
  color: string;
}

export interface TimeSlot {
  start: string;
  end: string;
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
  bookingUsername?: string;
}

export interface CustomField {
  id: string;
  label: string;
  type: "text" | "email" | "url" | "tel" | "textarea" | "select" | "checkbox";
  required: boolean;
  placeholder?: string;
  pattern?: string;
  patternError?: string;
  options?: string[];
}

export interface ConferencingConfig {
  type: "none" | "google_meet" | "zoom" | "custom";
  url?: string;
}

export interface BookingHost {
  email: string;
  displayName?: string;
}

export interface HostOverlayStatusResult {
  email: string;
  reciprocal: boolean;
  hasWorkingHours: boolean;
  timezone?: string;
  displayName?: string;
  requestSentAt?: string;
}

export interface OverlayReciprocityResult {
  email: string;
  reciprocal: boolean;
  displayName?: string;
}

export interface SendOverlayRequestResult {
  email: string;
  requestSentAt: string | null;
  emailSent: boolean;
  skippedReason?: "email-not-configured" | "send-in-progress";
}

export interface PublicBookingHost {
  id: string;
  label: string;
  timezone?: string;
}

export interface Booking {
  id: string;
  name: string;
  email: string;
  additionalGuestEmails?: string[];
  eventTitle: string;
  start: string;
  end: string;
  slug: string;
  notes?: string;
  fieldResponses?: Record<string, string | boolean>;
  meetingLink?: string;
  meetingLinkPending?: boolean;
  googleEventId?: string;
  /** Token for cancel/reschedule link (only returned to the booker) */
  cancelToken?: string;
  zoomNeedsReview?: boolean;
  zoomCancellationNeedsReview?: boolean;
  status: "confirmed" | "cancelled";
  createdAt: string;
}

export interface BookingLink {
  id: string;
  slug: string;
  title: string;
  description?: string;
  duration: number;
  durations?: number[];
  hosts?: BookingHost[];
  publicHosts?: PublicBookingHost[];
  customFields?: CustomField[];
  conferencing?: ConferencingConfig;
  color?: string;
  isActive: boolean;
  visibility?: "private" | "org" | "public";
  ownerTimezone?: string;
  ownerName?: string;
  accessRole?: "owner" | "admin" | "editor" | "commenter" | "viewer";
  createdAt: string;
  updatedAt: string;
}

export interface GoogleAuthStatus {
  configured?: boolean;
  connected: boolean;
  accounts: Array<{
    email: string;
    expiresAt?: string;
    photoUrl?: string;
    shared?: boolean;
  }>;
}

export interface GoogleCalendarSource {
  sourceKey: string;
  canonicalKey: string;
  accountEmail: string;
  calendarId: string;
  name: string;
  color?: string;
  selected: boolean;
  primary: boolean;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  readOnly: boolean;
  sourcePaths?: Array<{
    sourceKey: string;
    accountEmail: string;
    accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
    primary: boolean;
  }>;
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
  defaultEventDuration: number;
  weekStart: import("./calendar-week.js").CalendarWeekStart;
  eventRules?: { accept?: string; decline?: string; hide?: string };
  hiddenEventKeys?: string[];
  eventRuleActivity?: CalendarEventRuleActivity[];
}

export interface CalendarEventRuleActivity {
  id: string;
  eventId: string;
  accountEmail: string;
  title: string;
  action: "accepted" | "declined" | "hidden";
  occurredAt: string;
  hiddenEventKey?: string;
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
