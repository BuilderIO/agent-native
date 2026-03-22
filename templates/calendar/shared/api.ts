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
  color?: string;
  createdAt: string;
  updatedAt: string;
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
