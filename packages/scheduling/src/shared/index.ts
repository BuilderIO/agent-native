/**
 * Wire-level types shared between server, actions, and React client.
 * These are the primary stable contract of the package.
 */

export type SchedulingType =
  | "personal"
  | "collective"
  | "round-robin"
  | "managed";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "rejected"
  | "rescheduled";

export type LocationKind =
  | "builtin-video"
  | "zoom"
  | "google-meet"
  | "teams"
  | "phone"
  | "in-person"
  | "custom-link"
  | "attendee-phone"
  | "organizer-phone"
  | "attendee-choice";

export interface Location {
  kind: LocationKind;
  /** Provider credential id, if applicable */
  credentialId?: string;
  /** Meeting link override */
  link?: string;
  /** Street address for in-person */
  address?: string;
  /** Phone number for phone/organizer-phone */
  phone?: string;
  /** Display name shown in booking UI */
  label?: string;
}

export type PeriodType = "unlimited" | "rolling" | "range";

export interface BookingLimits {
  /** Max bookings in one day */
  perDay?: number;
  /** Max bookings in one week (starting on user's configured start of week) */
  perWeek?: number;
  /** Max bookings in one month */
  perMonth?: number;
  /** Max bookings in one year */
  perYear?: number;
}

export interface CustomField {
  id: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "email"
    | "phone"
    | "select"
    | "multiselect"
    | "boolean"
    | "radio";
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
  /** Default/preset value for this field */
  defaultValue?: string | number | boolean;
  /** Internal identifier stored on booking responses */
  name: string;
}

export interface RecurringEventRule {
  /** iCal RRULE format, e.g. "FREQ=WEEKLY;COUNT=4" */
  rrule: string;
  /** Max number of occurrences */
  count?: number;
  /** How occurrences are labeled on the booker ("Weekly for 4 weeks") */
  description?: string;
}

export interface EventType {
  id: string;
  title: string;
  slug: string;
  description?: string;
  length: number;
  /** Optional additional duration choices */
  durations?: number[];
  hidden: boolean;
  position: number;
  schedulingType: SchedulingType;
  /** If personal, the owner; if team, null (team event types) */
  ownerEmail?: string;
  teamId?: string;
  /** Default schedule ID if not set at event level */
  scheduleId?: string;
  locations: Location[];
  customFields: CustomField[];
  minimumBookingNotice: number;
  beforeEventBuffer: number;
  afterEventBuffer: number;
  slotInterval: number | null;
  periodType: PeriodType;
  periodDays?: number;
  periodStartDate?: string;
  periodEndDate?: string;
  seatsPerTimeSlot?: number;
  requiresConfirmation: boolean;
  disableGuests: boolean;
  hideCalendarNotes: boolean;
  successRedirectUrl?: string;
  bookingLimits?: BookingLimits;
  lockTimeZoneToggle: boolean;
  color?: string;
  eventName?: string;
  recurringEvent?: RecurringEventRule;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface Slot {
  /** ISO 8601 start time in UTC */
  start: string;
  /** ISO 8601 end time in UTC */
  end: string;
  /** True if this slot can still be booked (not full for seated events) */
  available: boolean;
  /** Seats remaining, for seated events */
  seatsRemaining?: number;
  /** Assigned host for round-robin events (email) */
  hostEmail?: string;
}

export interface AvailabilityInterval {
  /** "HH:MM" in schedule's timezone */
  startTime: string;
  /** "HH:MM" in schedule's timezone */
  endTime: string;
}

export interface WeeklyAvailability {
  /** 0=Sunday … 6=Saturday, ISO-like */
  day: number;
  intervals: AvailabilityInterval[];
}

export interface DateOverride {
  /** YYYY-MM-DD in schedule's timezone */
  date: string;
  /** Empty array = fully blocked */
  intervals: AvailabilityInterval[];
}

export interface Schedule {
  id: string;
  name: string;
  timezone: string;
  ownerEmail: string;
  weeklyAvailability: WeeklyAvailability[];
  dateOverrides: DateOverride[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Attendee {
  email: string;
  name: string;
  timezone?: string;
  locale?: string;
  noShow?: boolean;
}

export interface BookingReference {
  type: string;
  externalId: string;
  meetingUrl?: string;
  meetingPassword?: string;
  credentialId?: string;
}

export interface Booking {
  id: string;
  uid: string;
  eventTypeId: string;
  hostEmail: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: BookingStatus;
  location?: Location;
  attendees: Attendee[];
  references: BookingReference[];
  customResponses?: Record<string, any>;
  cancellationReason?: string;
  reschedulingReason?: string;
  cancelToken?: string;
  rescheduleToken?: string;
  fromReschedule?: string;
  iCalUid: string;
  iCalSequence: number;
  recurringEventId?: string;
  paid?: boolean;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface Host {
  userEmail: string;
  eventTypeId: string;
  scheduleId?: string;
  isFixed: boolean;
  weight: number;
  priority: number;
}

export interface BusyInterval {
  /** ISO 8601 UTC */
  start: string;
  /** ISO 8601 UTC */
  end: string;
  source?: string;
}

export interface Team {
  id: string;
  slug: string;
  name: string;
  logoUrl?: string;
  brandColor?: string;
  darkBrandColor?: string;
  bio?: string;
  hideBranding: boolean;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export type TeamRole = "owner" | "admin" | "member";

export interface TeamMember {
  teamId: string;
  userEmail: string;
  role: TeamRole;
  accepted: boolean;
  joinedAt?: string;
}

export type WorkflowTrigger =
  | "new-booking"
  | "before-event"
  | "after-event"
  | "reschedule"
  | "cancellation"
  | "no-show";

export type WorkflowStepAction =
  | "email-host"
  | "email-attendee"
  | "email-address"
  | "sms-attendee"
  | "sms-host"
  | "sms-number"
  | "webhook";

export interface WorkflowStep {
  id: string;
  order: number;
  action: WorkflowStepAction;
  /** Minutes from trigger; negative = before (for before-event), positive = after */
  offsetMinutes: number;
  sendTo?: string;
  emailSubject?: string;
  emailBody?: string;
  smsBody?: string;
  webhookUrl?: string;
  template?: string;
}

export interface Workflow {
  id: string;
  name: string;
  trigger: WorkflowTrigger;
  ownerEmail?: string;
  teamId?: string;
  activeOnEventTypeIds: string[];
  steps: WorkflowStep[];
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RoutingFormFieldType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "select"
  | "multi";

export interface RoutingFormField {
  id: string;
  name: string;
  label: string;
  type: RoutingFormFieldType;
  required: boolean;
  options?: string[];
}

export interface RoutingFormRule {
  id: string;
  /** Array of `{fieldId, op, value}` expressions ANDed together */
  conditions: {
    fieldId: string;
    op: "equals" | "not-equals" | "contains" | "starts-with" | "in";
    value: string | string[];
  }[];
  action:
    | { kind: "event-type"; eventTypeId: string; teamId?: string }
    | { kind: "external-url"; url: string }
    | { kind: "custom-message"; message: string };
}

export interface RoutingForm {
  id: string;
  name: string;
  description?: string;
  ownerEmail?: string;
  teamId?: string;
  fields: RoutingFormField[];
  rules: RoutingFormRule[];
  /** Action taken when no rules match */
  fallback:
    | { kind: "event-type"; eventTypeId: string }
    | { kind: "external-url"; url: string }
    | { kind: "custom-message"; message: string };
  createdAt: string;
  updatedAt: string;
}

export interface HashedLink {
  id: string;
  hash: string;
  eventTypeId: string;
  expiresAt?: string;
  isSingleUse: boolean;
  usedAt?: string;
}

/** Round-robin assignment strategy */
export type RoundRobinStrategy =
  | "lowest-recent-bookings"
  | "weighted"
  | "calibrated";
