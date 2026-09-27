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
  credentialId?: string;
  link?: string;
  address?: string;
  phone?: string;
  label?: string;
}

export type PeriodType = "unlimited" | "rolling" | "range";

export interface BookingLimits {
  perDay?: number;
  perWeek?: number;
  perMonth?: number;
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
  defaultValue?: string | number | boolean;
  name: string;
}

export interface RecurringEventRule {
  rrule: string;
  count?: number;
  description?: string;
}

export interface EventType {
  id: string;
  title: string;
  slug: string;
  description?: string;
  length: number;
  durations?: number[];
  hidden: boolean;
  position: number;
  schedulingType: SchedulingType;
  ownerEmail?: string;
  teamId?: string;
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
  start: string;
  end: string;
  available: boolean;
  seatsRemaining?: number;
  hostEmail?: string;
}

export interface AvailabilityInterval {
  startTime: string;
  endTime: string;
}

export interface WeeklyAvailability {
  day: number;
  intervals: AvailabilityInterval[];
}

export interface DateOverride {
  date: string;
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
  start: string;
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

export type RoundRobinStrategy =
  | "lowest-recent-bookings"
  | "weighted"
  | "calibrated";
