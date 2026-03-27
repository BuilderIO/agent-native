export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  location: string;
  allDay: boolean;
  source: "local" | "google";
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
  visibility?: "default" | "public" | "private" | "confidential";
  status?: "confirmed" | "tentative" | "cancelled";
  createdAt: string;
  updatedAt: string;
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
  status: "confirmed" | "cancelled";
  createdAt: string;
}

export interface BookingLink {
  id: string;
  slug: string;
  title: string;
  description?: string;
  duration: number;
  color?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleAuthStatus {
  connected: boolean;
  accounts: Array<{ email: string; expiresAt?: string }>;
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
