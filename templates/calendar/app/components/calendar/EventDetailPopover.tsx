import { sendToAgentChat, useT } from "@agent-native/core/client";
import { ExtensionSlot } from "@agent-native/core/client/extensions";
import type {
  CalendarEvent,
  FindTimeSlot,
  UpdateEventScope,
} from "@shared/api";
import {
  IconX,
  IconClock,
  IconMapPin,
  IconUser,
  IconVideo,
  IconRefresh,
  IconBell,
  IconChevronRight,
  IconLayoutSidebarRight,
  IconFileText,
  IconExternalLink,
  IconAlignLeft,
  IconPlus,
  IconBrandZoom,
  IconMessage,
  IconPalette,
  IconPaperclip,
  IconCalendarTime,
} from "@tabler/icons-react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";

import { ResearchMeetingButton } from "@/components/calendar/ApolloPanel";
import {
  AttendeeAutocomplete,
  type AttendeeRecipient,
} from "@/components/calendar/AttendeeAutocomplete";
import { EventAttendeesSection } from "@/components/calendar/EventAttendeesSection";
import {
  RenderedDescription,
  AutoGrowTextarea,
} from "@/components/calendar/EventDescription";
import {
  AttachmentControls,
  EventColorSwatches,
  ReminderControls,
} from "@/components/calendar/EventOptionControls";
import { FindTimeTakeover } from "@/components/calendar/FindTimePanel";
import { useGuestNotificationPrompt } from "@/components/calendar/GuestNotificationDialog";
import { WorkingLocationEditor } from "@/components/calendar/WorkingLocationEditor";
import { useCalendarContext } from "@/components/layout/AppLayout";
import { TimezoneCombobox } from "@/components/TimezoneCombobox";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useEvent, useUpdateEvent } from "@/hooks/use-events";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useViewPreferences } from "@/hooks/use-view-preferences";
import { useConnectZoom, useZoomStatus } from "@/hooks/use-zoom-auth";
import { defaultColorForAccount } from "@/lib/calendar-view-preferences";
import { shouldShowEventAccountSelector } from "@/lib/event-account-selection";
import { getGoogleEventColorHex } from "@/lib/event-colors";
import {
  attachmentsToDrafts,
  buildRecurrenceRules,
  buildReminderPayload,
  dateTimeInTimezoneToIso,
  formatRecurrenceText,
  formatReminderText,
  getEventEndValidationMessage,
  getLocalTimezone,
  getRecurrencePreset,
  normalizeAllDayEditEndDate,
  remindersToDraftState,
  resolveTimeEditScope,
  type AttachmentDraft,
  type RecurrencePreset,
  type ReminderDraft,
  type ReminderMode,
  validateAttachmentDrafts,
} from "@/lib/event-form-utils";
import { isOutOfOfficeEvent } from "@/lib/out-of-office";
import {
  createEventDetailPopoverToken,
  markPopoverInteractOutside,
  setEventDetailPopoverOpen,
} from "@/lib/popover-click-guard";
import { shortcutModifierLabel } from "@/lib/utils";
import {
  buildWorkingLocationUpdate,
  createWorkingLocationDisplayLabels,
  getWorkingLocationTitle,
  isWorkingLocationEvent,
  type WorkingLocationSelection,
} from "@/lib/working-location";

const ZOOM_AFTER_CONNECT_EVENT_ID_KEY = "calendar.zoomAfterConnectEventId";
const ZOOM_AFTER_CONNECT_MAX_AGE_MS = 10 * 60 * 1000;
const EMPTY_CONNECTED_ACCOUNTS: Array<{ email: string }> = [];

function buildEventDetailSlotContext(event: CalendarEvent) {
  return {
    eventId: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    startTimeZone: event.startTimeZone,
    endTimeZone: event.endTimeZone,
    location: event.location,
    accountEmail: event.accountEmail,
    attendees: (event.attendees ?? []).map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus,
      organizer: attendee.organizer,
      optional: attendee.optional,
      timeZone: attendee.timeZone,
      self: attendee.self,
    })),
  };
}

function getStoredZoomAfterConnectEventId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(
      ZOOM_AFTER_CONNECT_EVENT_ID_KEY,
    );
    if (!stored) return null;
    const parsed = JSON.parse(stored) as {
      eventId?: unknown;
      startedAt?: unknown;
    };
    if (
      typeof parsed.eventId === "string" &&
      typeof parsed.startedAt === "number" &&
      Date.now() - parsed.startedAt < ZOOM_AFTER_CONNECT_MAX_AGE_MS
    ) {
      return parsed.eventId;
    }
    window.sessionStorage.removeItem(ZOOM_AFTER_CONNECT_EVENT_ID_KEY);
    return null;
  } catch {
    return null;
  }
}

function setStoredZoomAfterConnectEventId(eventId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (eventId) {
      window.sessionStorage.setItem(
        ZOOM_AFTER_CONNECT_EVENT_ID_KEY,
        JSON.stringify({ eventId, startedAt: Date.now() }),
      );
    } else {
      window.sessionStorage.removeItem(ZOOM_AFTER_CONNECT_EVENT_ID_KEY);
    }
  } catch {
    // Storage can be unavailable in locked-down browsers; in-memory state still
    // handles the normal popup path.
  }
}

function formatDuration(start: string, end: string): string {
  const totalMinutes = differenceInMinutes(parseISO(end), parseISO(start));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function formatTimeShort(dateStr: string): string {
  const d = parseISO(dateStr);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12} ${period}`;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Extract a Zoom/Meet/Teams link from location or description */
function extractMeetingLink(event: CalendarEvent): {
  url: string;
  type: "zoom" | "meet" | "teams" | "link";
  label?: string;
  pin?: string;
  passcode?: string;
} | null {
  if (event.meetingLink) {
    return { url: event.meetingLink, type: getMeetingType(event.meetingLink) };
  }

  // Check conferenceData first
  if (event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === "video",
    );
    if (videoEntry) {
      let type: "zoom" | "meet" | "teams" | "link" = "link";
      if (videoEntry.uri.includes("zoom.us")) type = "zoom";
      else if (videoEntry.uri.includes("meet.google.com")) type = "meet";
      else if (videoEntry.uri.includes("teams.microsoft.com")) type = "teams";
      return {
        url: videoEntry.uri,
        type,
        label: videoEntry.label || undefined,
        pin: videoEntry.pin || undefined,
        passcode: videoEntry.passcode || undefined,
      };
    }
  }

  // Fall back to the legacy hangoutLink (Google Meet)
  if (event.hangoutLink) {
    return { url: event.hangoutLink, type: "meet" };
  }

  // Fall back to text matching
  const text = `${event.location || ""} ${event.description || ""}`;
  const zoom = text.match(/https?:\/\/[^\s]*zoom\.us\/j\/[^\s)"]*/i);
  if (zoom) return { url: zoom[0], type: "zoom" };
  const meet = text.match(/https?:\/\/meet\.google\.com\/[^\s)"]*/i);
  if (meet) return { url: meet[0], type: "meet" };
  const teams = text.match(/https?:\/\/teams\.microsoft\.com\/[^\s)"]*/i);
  if (teams) return { url: teams[0], type: "teams" };
  return null;
}

function getMeetingLabel(
  type: "zoom" | "meet" | "teams" | "link",
  t: ReturnType<typeof useT>,
): string {
  switch (type) {
    case "zoom":
      return t("eventForm.joinZoom");
    case "meet":
      return t("eventForm.joinMeet");
    case "teams":
      return t("eventForm.joinTeams");
    default:
      return t("eventForm.joinMeeting");
  }
}

function getMeetingType(url: string): "zoom" | "meet" | "teams" | "link" {
  if (url.includes("zoom.us")) return "zoom";
  if (url.includes("meet.google.com")) return "meet";
  if (url.includes("teams.microsoft.com")) return "teams";
  return "link";
}

function MeetingLinkSkeleton({ provider }: { provider: "meet" | "zoom" }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-label={t("eventForm.addingMeetingLink", {
        provider:
          provider === "zoom" ? t("eventForm.zoom") : t("eventForm.googleMeet"),
      })}
      className="relative flex w-full items-center justify-center rounded-xl bg-[#4965E0] px-4 py-2"
    >
      <Skeleton className="mr-2 h-5 w-5 rounded-full bg-white/25" />
      <Skeleton className="h-4 w-24 bg-white/30" />
      <span className="absolute right-4 hidden items-center gap-1 sm:flex">
        <Skeleton className="h-4 w-4 rounded bg-white/20" />
        <Skeleton className="h-5 w-5 rounded bg-white/20" />
      </span>
    </div>
  );
}

type AvailabilityValue = "opaque" | "transparent";
type VisibilityValue = "default" | "public" | "private";
type ReminderValue =
  | "default"
  | "none"
  | "0"
  | "10"
  | "30"
  | "60"
  | "1440"
  | "custom";

type EventUpdatePatch = Partial<CalendarEvent> & {
  addGoogleMeet?: boolean;
  addZoom?: boolean;
  addAttendees?: CalendarEvent["attendees"];
  scope?: UpdateEventScope;
  workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
  workingLocationLabel?: string;
};

function mergeAttendeesForPrompt(
  existing: CalendarEvent["attendees"] | undefined,
  additions: CalendarEvent["attendees"] | undefined,
): CalendarEvent["attendees"] | undefined {
  if (!additions || additions.length === 0) return existing;
  const merged = new Map<
    string,
    NonNullable<CalendarEvent["attendees"]>[number]
  >();

  for (const attendee of existing ?? []) {
    const email = attendee.email.trim();
    if (!email) continue;
    merged.set(email.toLowerCase(), attendee);
  }

  for (const attendee of additions) {
    const email = attendee.email.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    const current = merged.get(key);
    merged.set(key, {
      ...current,
      email,
      displayName: attendee.displayName ?? current?.displayName,
      photoUrl: attendee.photoUrl ?? current?.photoUrl,
      optional:
        attendee.optional === true
          ? true
          : attendee.optional === false
            ? undefined
            : current?.optional,
    });
  }

  return Array.from(merged.values());
}

function getReminderValue(event: CalendarEvent): ReminderValue {
  if (event.remindersUseDefault !== false) return "default";
  if (!event.reminders || event.reminders.length === 0) return "none";
  if (event.reminders.length > 1) return "custom";
  const minutes = String(event.reminders[0].minutes);
  return ["0", "10", "30", "60", "1440"].includes(minutes)
    ? (minutes as ReminderValue)
    : "custom";
}

function getReminderUpdate(value: ReminderValue): Partial<CalendarEvent> {
  if (value === "default") return { remindersUseDefault: true };
  if (value === "none") return { remindersUseDefault: false, reminders: [] };
  if (value === "custom") return {};
  return {
    remindersUseDefault: false,
    reminders: [{ method: "popup", minutes: Number(value) }],
  };
}

/** Check if a string looks like a URL */
function isUrl(str: string): boolean {
  return /^https?:\/\//i.test(str.trim());
}

/** Convert ISO date string to local date input value (YYYY-MM-DD) */
function toDateInputValue(iso: string): string {
  const d = parseISO(iso);
  return format(d, "yyyy-MM-dd");
}

function toAllDayEndDateInputValue(iso: string): string {
  const d = parseISO(iso);
  return format(new Date(d.getTime() - 1), "yyyy-MM-dd");
}

/** Convert ISO date string to local time input value (HH:mm) */
function toTimeInputValue(iso: string): string {
  const d = parseISO(iso);
  return format(d, "HH:mm");
}

function formatEventDateRange(start: string, end: string, allDay?: boolean) {
  const startDate = parseISO(start);
  const endDate = parseISO(end);
  const displayEndDate = allDay ? new Date(endDate.getTime() - 1) : endDate;
  const startLabel = format(startDate, "EEE MMM d");
  const endLabel = format(displayEndDate, "EEE MMM d");
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function DraftEventAccountSelect({
  event,
  onAccountChange,
}: {
  event: CalendarEvent;
  onAccountChange: (accountEmail: string) => void;
}) {
  const t = useT();
  const googleStatus = useGoogleAuthStatus();
  const connectedAccounts =
    googleStatus.data?.accounts ?? EMPTY_CONNECTED_ACCOUNTS;
  const connectedAccountEmails = useMemo(
    () => connectedAccounts.map((account) => account.email),
    [connectedAccounts],
  );
  const { prefs: viewPrefs } = useViewPreferences();

  if (
    !shouldShowEventAccountSelector(connectedAccounts) ||
    !event.accountEmail
  ) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 py-1.5">
      <IconCalendarTime className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Select value={event.accountEmail} onValueChange={onAccountChange}>
        <SelectTrigger
          aria-label={t("navigation.calendar")}
          className="h-8 flex-1 text-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {connectedAccounts.map((account) => (
              <SelectItem key={account.email} value={account.email}>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        viewPrefs.accountColors[account.email] ??
                        viewPrefs.singleColor ??
                        defaultColorForAccount(
                          account.email,
                          connectedAccountEmails,
                        ),
                    }}
                  />
                  <span className="truncate">{account.email}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

interface EventDetailPopoverProps {
  event: CalendarEvent;
  children: React.ReactNode;
  onDelete: (eventId: string) => void;
  isDraft?: boolean;
  /** When true, the popover opens immediately and title is focused for editing */
  defaultOpen?: boolean;
  /** Called when the title is changed and should be persisted */
  onTitleSave?: (eventId: string, title: string, accountEmail?: string) => void;
  /** Called when the popover is dismissed for a new event (to clean up if no title was set) */
  onDismissNew?: (eventId: string, accountEmail?: string) => void;
  /** Called after the popover's visible open state changes through its normal lifecycle. */
  onOpenChange?: (open: boolean) => void;
  onDraftUpdate?: (
    eventId: string,
    updates: Partial<CalendarEvent> & {
      addGoogleMeet?: boolean;
      addZoom?: boolean;
      workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
      workingLocationLabel?: string;
    },
  ) => void;
  onDraftCreate?: (
    eventId: string,
    updates?: Partial<CalendarEvent> & {
      addGoogleMeet?: boolean;
      addZoom?: boolean;
    },
  ) => void;
  onDraftDiscard?: (eventId: string) => void;
}

export function EventDetailPopover({
  event,
  children,
  onDelete,
  isDraft = false,
  defaultOpen = false,
  onTitleSave,
  onDismissNew,
  onOpenChange,
  onDraftUpdate,
  onDraftCreate,
  onDraftDiscard,
}: EventDetailPopoverProps) {
  const t = useT();
  const workingLocationLabels = createWorkingLocationDisplayLabels(t);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(defaultOpen);
  const [editingTitle, setEditingTitle] = useState(
    defaultOpen ? event.title : "",
  );
  const [isEditingTitle, setIsEditingTitle] = useState(defaultOpen);
  const isNewEventRef = useRef(defaultOpen);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const popoverTokenRef = useRef<symbol | null>(null);
  if (!popoverTokenRef.current) {
    popoverTokenRef.current = createEventDetailPopoverToken();
  }
  const {
    eventDetailSidebar,
    sidebarEvent,
    setEventDetailSidebar,
    setSidebarEvent,
    setFocusedEvent,
  } = useCalendarContext();
  const isWorkingLocation = isWorkingLocationEvent(event);
  const isOutOfOffice = isOutOfOfficeEvent(event);
  const isSingleDayWorkingLocation = isWorkingLocation && event.allDay;
  const editableLocationValue = event.location || "";

  // Inline editing state
  const [editingField, setEditingField] = useState<string | null>(null);
  const [findTimeOpen, setFindTimeOpen] = useState(false);
  const [editDescription, setEditDescription] = useState(
    event.description || "",
  );
  const [editLocation, setEditLocation] = useState(editableLocationValue);
  const [editDate, setEditDate] = useState(() => toDateInputValue(event.start));
  const [editEndDate, setEditEndDate] = useState(() =>
    event.allDay
      ? toAllDayEndDateInputValue(event.end)
      : toDateInputValue(event.end),
  );
  const [editStartTime, setEditStartTime] = useState(() =>
    toTimeInputValue(event.start),
  );
  const [editEndTime, setEditEndTime] = useState(() =>
    toTimeInputValue(event.end),
  );
  const [editTimezone, setEditTimezone] = useState(
    event.startTimeZone || getLocalTimezone(),
  );
  const [editReminderMode, setEditReminderMode] = useState<ReminderMode>(
    () => remindersToDraftState(event).mode,
  );
  const [editReminders, setEditReminders] = useState<ReminderDraft[]>(
    () => remindersToDraftState(event).reminders,
  );
  const [editAttachments, setEditAttachments] = useState<AttachmentDraft[]>(
    () => attachmentsToDrafts(event.attachments),
  );
  const [editMeetingLink, setEditMeetingLink] = useState("");
  const [editTimeScope, setEditTimeScope] =
    useState<UpdateEventScope>("single");
  const [editRecurrencePreset, setEditRecurrencePreset] =
    useState<RecurrencePreset>(() => getRecurrencePreset(event.recurrence));
  const [pendingVideoProvider, setPendingVideoProvider] = useState<
    "meet" | "zoom" | null
  >(null);
  const [zoomAfterConnectEventId, setZoomAfterConnectEventId] = useState<
    string | null
  >(() => getStoredZoomAfterConnectEventId());
  const isOverlay = !!event.overlayEmail;
  const ownerLabel = event.ownerName || event.overlayEmail;

  const updateEvent = useUpdateEvent();
  const masterEventId =
    open && event.recurringEventId ? `google-${event.recurringEventId}` : "";
  const masterEvent = useEvent(masterEventId);
  const recurrenceRules =
    event.recurrence && event.recurrence.length > 0
      ? event.recurrence
      : masterEvent.data?.recurrence;
  const isRecurringEvent = !!(
    event.recurringEventId || recurrenceRules?.length
  );
  const recurrenceLoading =
    isRecurringEvent && !recurrenceRules?.length && masterEvent.isLoading;
  const canEditRecurrence = !isDraft && !isOverlay && !!recurrenceRules?.length;
  const { promptGuestNotification, guestNotificationDialog } =
    useGuestNotificationPrompt();
  const zoomStatus = useZoomStatus();
  const connectZoom = useConnectZoom();
  const locationRef = useRef<HTMLInputElement>(null);
  const meetingLinkRef = useRef<HTMLInputElement>(null);

  // Sync editing state when the event changes (incl. live agent/other-user
  // edits picked up by polling). Skip the field the user is actively editing so
  // an incoming update never yanks text out from under in-progress typing —
  // that field re-adopts the authoritative value once the user finishes (which
  // closes the inline editor and flips `editingField` away).
  useEffect(() => {
    if (editingField !== "description")
      setEditDescription(event.description || "");
    if (editingField !== "location") setEditLocation(editableLocationValue);
    if (editingField !== "time") {
      setEditDate(toDateInputValue(event.start));
      setEditEndDate(
        event.allDay
          ? toAllDayEndDateInputValue(event.end)
          : toDateInputValue(event.end),
      );
      setEditStartTime(toTimeInputValue(event.start));
      setEditEndTime(toTimeInputValue(event.end));
      setEditTimezone(event.startTimeZone || getLocalTimezone());
      setEditTimeScope("single");
    }
    if (editingField !== "reminders") {
      const reminderState = remindersToDraftState(event);
      setEditReminderMode(reminderState.mode);
      setEditReminders(reminderState.reminders);
    }
    if (editingField !== "attachments") {
      setEditAttachments(attachmentsToDrafts(event.attachments));
    }
    setFindTimeOpen(false);
    // `editingField` is intentionally omitted: re-running this effect when the
    // user merely opens an inline editor would re-seed the other fields and is
    // unnecessary — we only want to resync when the underlying event changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    event.id,
    event.description,
    event.location,
    event.workingLocationProperties,
    event.start,
    event.end,
    event.allDay,
    event.startTimeZone,
    event.reminders,
    event.remindersUseDefault,
    event.attachments,
    editableLocationValue,
  ]);

  useEffect(() => {
    setEditRecurrencePreset(getRecurrencePreset(recurrenceRules));
  }, [recurrenceRules]);

  // When defaultOpen changes to true (new event created), open the popover
  useEffect(() => {
    if (defaultOpen) {
      setOpen(true);
      setIsEditingTitle(true);
      isNewEventRef.current = true;
      setEditingTitle((current) => {
        const hasDraft = current.trim().length > 0 && current !== "(No title)";
        if (hasDraft && current !== event.title) return current;
        return event.title === "(No title)" ? "" : event.title;
      });
    }
  }, [defaultOpen, event.title]);

  // Focus title input when editing starts
  useEffect(() => {
    if (isEditingTitle && open) {
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
  }, [isEditingTitle, open]);

  // Focus field inputs when editing starts
  useEffect(() => {
    if (!editingField) return;
    requestAnimationFrame(() => {
      if (editingField === "location") locationRef.current?.focus();
      else if (editingField === "meetingLink") meetingLinkRef.current?.focus();
    });
  }, [editingField]);

  const meetingLink = extractMeetingLink(event);
  // On a draft, a chosen provider isn't created until the event is saved. Show
  // it as already attached (with a remove control) rather than as a placeholder.
  const pendingConferenceProvider =
    !meetingLink && isDraft ? event.pendingConferenceProvider : undefined;
  const availabilityValue: AvailabilityValue =
    event.transparency === "transparent" ? "transparent" : "opaque";
  const visibilityValue: VisibilityValue =
    event.visibility === "public" || event.visibility === "private"
      ? event.visibility
      : "default";
  const reminderValue = getReminderValue(event);
  // Save a field update
  const saveField = useCallback(
    (updates: EventUpdatePatch) => {
      if (!event.id) return false;
      if (isDraft) {
        const { scope: _scope, ...draftUpdates } = updates;
        onDraftUpdate?.(event.id, draftUpdates);
        return true;
      }
      void (async () => {
        const { scope: _scope, addAttendees, ...notificationUpdates } = updates;
        const promptUpdates = addAttendees
          ? {
              ...notificationUpdates,
              attendees: mergeAttendeesForPrompt(event.attendees, addAttendees),
            }
          : notificationUpdates;
        const shouldChooseGuestScope =
          isRecurringEvent &&
          ("attendees" in updates || "addAttendees" in updates);
        const guestNotification = await promptGuestNotification({
          event,
          action: "update",
          updates: promptUpdates,
          recurrenceScope: shouldChooseGuestScope
            ? { enabled: true, defaultScope: "single" }
            : undefined,
        });
        if (!guestNotification) return;
        updateEvent.mutate({
          id: event.id,
          accountEmail: event.accountEmail,
          ...updates,
          ...guestNotification,
        });
      })();
      return true;
    },
    [
      event,
      isDraft,
      isRecurringEvent,
      onDraftUpdate,
      promptGuestNotification,
      updateEvent,
    ],
  );

  const handleAvailabilityChange = useCallback(
    (value: AvailabilityValue) => {
      saveField({ transparency: value });
    },
    [saveField],
  );

  const handleVisibilityChange = useCallback(
    (value: VisibilityValue) => {
      saveField({ visibility: value });
    },
    [saveField],
  );

  const handleReminderChange = useCallback(
    (value: ReminderValue) => {
      if (value === "custom") {
        const reminderState = remindersToDraftState(event);
        setEditReminderMode(
          reminderState.mode === "default" ? "custom" : reminderState.mode,
        );
        setEditReminders(reminderState.reminders);
        setEditingField("reminders");
        return;
      }
      const updates = getReminderUpdate(value);
      if (Object.keys(updates).length > 0) saveField(updates);
    },
    [event, saveField],
  );

  const handleSaveReminders = useCallback(() => {
    const saved = saveField(
      buildReminderPayload(editReminderMode, editReminders),
    );
    setEditingField(null);
    return saved;
  }, [editReminderMode, editReminders, saveField]);

  const handleSaveAttachments = useCallback(() => {
    const result = validateAttachmentDrafts(editAttachments);
    if (result.error) {
      toast.error(result.error);
      return false;
    }
    const saved = saveField({ attachments: result.attachments });
    setEditingField(null);
    return saved;
  }, [editAttachments, saveField]);

  const handleColorChange = useCallback(
    (nextColorId: string | undefined) => {
      if (!nextColorId) return;
      saveField({
        colorId: nextColorId,
        color: getGoogleEventColorHex(nextColorId),
      });
    },
    [saveField],
  );

  const handleDraftDescription = useCallback(() => {
    sendToAgentChat({
      message: t("eventForm.ai.descriptionMessage", {
        title: event.title,
      }),
      context: t("eventForm.ai.existingDescriptionContext", {
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        timezone: event.startTimeZone || getLocalTimezone(),
        location: event.location || t("eventForm.ai.none"),
        attendees:
          (event.attendees ?? [])
            .map((attendee) => attendee.email)
            .join(", ") || t("eventForm.ai.none"),
        description: event.description || t("eventForm.ai.empty"),
      }),
      submit: true,
    });
  }, [event, t]);

  const handleAddGoogleMeet = useCallback(() => {
    if (!event.id || updateEvent.isPending) return;
    if (isDraft) {
      onDraftUpdate?.(event.id, { addGoogleMeet: true, addZoom: false });
      return;
    }
    setPendingVideoProvider("meet");
    void (async () => {
      const updates = { addGoogleMeet: true };
      const guestNotification = await promptGuestNotification({
        event,
        action: "update",
        updates,
      });
      if (!guestNotification) {
        setPendingVideoProvider(null);
        return;
      }
      updateEvent.mutate(
        {
          id: event.id,
          accountEmail: event.accountEmail,
          ...updates,
          ...guestNotification,
        },
        {
          onSuccess: () => toast(t("eventForm.googleMeetAdded")),
          onError: () => toast.error(t("eventForm.googleMeetAddFailed")),
          onSettled: () => setPendingVideoProvider(null),
        },
      );
    })();
  }, [event, isDraft, onDraftUpdate, promptGuestNotification, updateEvent]);

  const addZoomToConnectedEvent = useCallback(() => {
    if (!event.id || updateEvent.isPending) return;

    if (isDraft) {
      onDraftUpdate?.(event.id, { addZoom: true, addGoogleMeet: false });
      return;
    }

    setPendingVideoProvider("zoom");
    void (async () => {
      const updates = { addZoom: true };
      const guestNotification = await promptGuestNotification({
        event,
        action: "update",
        updates,
      });
      if (!guestNotification) {
        setPendingVideoProvider(null);
        return;
      }
      updateEvent.mutate(
        {
          id: event.id,
          accountEmail: event.accountEmail,
          ...updates,
          ...guestNotification,
        },
        {
          onSuccess: () => toast(t("eventForm.zoomAdded")),
          onError: (error) =>
            toast.error(
              error instanceof Error
                ? error.message
                : t("eventForm.zoomAddFailed"),
            ),
          onSettled: () => setPendingVideoProvider(null),
        },
      );
    })();
  }, [event, isDraft, onDraftUpdate, promptGuestNotification, t, updateEvent]);

  useEffect(() => {
    if (
      !zoomStatus.data?.connected ||
      !zoomAfterConnectEventId ||
      zoomAfterConnectEventId !== event.id ||
      updateEvent.isPending
    ) {
      return;
    }

    setZoomAfterConnectEventId(null);
    setStoredZoomAfterConnectEventId(null);
    addZoomToConnectedEvent();
  }, [
    addZoomToConnectedEvent,
    event.id,
    updateEvent.isPending,
    zoomAfterConnectEventId,
    zoomStatus.data?.connected,
  ]);

  const handleAddZoom = useCallback(() => {
    if (!event.id || updateEvent.isPending || connectZoom.isPending) return;

    if (zoomStatus.data?.connected) {
      addZoomToConnectedEvent();
      return;
    }

    if (zoomStatus.data?.configured === false) {
      toast.error(t("eventForm.zoomNotConfiguredDeployment"));
      return;
    }

    setZoomAfterConnectEventId(event.id);
    setStoredZoomAfterConnectEventId(event.id);
    connectZoom.mutate(undefined, {
      onSuccess: () => toast(t("eventForm.zoomConnectionOpened")),
      onError: (error) => {
        setZoomAfterConnectEventId(null);
        setStoredZoomAfterConnectEventId(null);
        toast.error(
          error instanceof Error
            ? error.message
            : t("eventForm.zoomConnectFailed"),
        );
      },
    });
  }, [
    addZoomToConnectedEvent,
    connectZoom,
    event,
    t,
    updateEvent,
    zoomStatus.data?.configured,
    zoomStatus.data?.connected,
  ]);

  const handleRemovePendingConference = useCallback(() => {
    if (!event.id) return;
    onDraftUpdate?.(event.id, { addGoogleMeet: false, addZoom: false });
  }, [event.id, onDraftUpdate]);

  const handleSaveDescription = useCallback(() => {
    const trimmed = editDescription.trim();
    let saved = false;
    if (trimmed !== (event.description || "").trim()) {
      saved = saveField({ description: trimmed });
    }
    setEditingField(null);
    return saved;
  }, [editDescription, event.description, saveField]);

  const handleSaveLocation = useCallback(() => {
    const trimmed = editLocation.trim();
    const locationContainsMeetingLink =
      !!meetingLink && event.location?.includes(meetingLink.url);
    if (locationContainsMeetingLink && !trimmed) {
      setEditLocation(editableLocationValue);
      setEditingField(null);
      return false;
    }
    let saved = false;
    const currentValue = (event.location || "").trim();
    if (trimmed !== currentValue.trim()) {
      const updates: EventUpdatePatch = { location: trimmed };
      if (
        locationContainsMeetingLink &&
        meetingLink &&
        !event.description?.includes(meetingLink.url)
      ) {
        const label =
          meetingLink.type === "zoom"
            ? t("eventForm.zoom")
            : getMeetingLabel(meetingLink.type, t);
        updates.description = event.description?.trim()
          ? `${event.description.trim()}\n\n${label}: ${meetingLink.url}`
          : `${label}: ${meetingLink.url}`;
      }
      saved = saveField(updates);
    }
    setEditingField(null);
    return saved;
  }, [
    editLocation,
    editableLocationValue,
    event.description,
    event.location,
    meetingLink,
    saveField,
    t,
  ]);

  const handleSaveWorkingLocation = useCallback(
    (selection: WorkingLocationSelection) => {
      const update = buildWorkingLocationUpdate(event, selection);
      if (isDraft) {
        const { id: _id, scope: _scope, ...draftUpdate } = update;
        onDraftUpdate?.(event.id, draftUpdate);
        return;
      }
      updateEvent.mutate(update, {
        onError: () => toast.error(t("calendarView.failedUpdateEvent")),
      });
    },
    [event, isDraft, onDraftUpdate, t, updateEvent],
  );

  const handleSaveTime = useCallback(() => {
    const normalizedEndDate = normalizeAllDayEditEndDate(
      isSingleDayWorkingLocation,
      editDate,
      editEndDate,
    );
    const allDayEnd = new Date(`${normalizedEndDate}T00:00:00`);
    allDayEnd.setDate(allDayEnd.getDate() + 1);
    const newStart = event.allDay
      ? new Date(`${editDate}T00:00:00`).toISOString()
      : dateTimeInTimezoneToIso(editDate, editStartTime, editTimezone);
    const newEnd = event.allDay
      ? allDayEnd.toISOString()
      : dateTimeInTimezoneToIso(editEndDate, editEndTime, editTimezone);
    if (new Date(newEnd).getTime() <= new Date(newStart).getTime()) {
      toast.error(
        getEventEndValidationMessage({
          allDay: event.allDay ?? false,
          startDate: editDate,
          endDate: editEndDate,
          startTime: editStartTime,
          endTime: editEndTime,
        }),
      );
      return false;
    }
    let saved = false;
    if (newStart !== event.start || newEnd !== event.end) {
      saved = saveField({
        start: newStart,
        end: newEnd,
        allDay: event.allDay,
        startTimeZone: event.allDay ? undefined : editTimezone,
        endTimeZone: event.allDay ? undefined : editTimezone,
        scope: resolveTimeEditScope(
          isRecurringEvent,
          isSingleDayWorkingLocation,
          editTimeScope,
        ),
      });
    }
    setEditTimeScope("single");
    setEditingField(null);
    return saved;
  }, [
    editDate,
    editEndDate,
    editStartTime,
    editEndTime,
    editTimezone,
    event.start,
    event.end,
    event.allDay,
    isSingleDayWorkingLocation,
    isRecurringEvent,
    editTimeScope,
    saveField,
  ]);

  const schedulingAttendees = useMemo(
    () =>
      (event.attendees ?? [])
        .filter((attendee) => {
          const email = attendee.email.toLowerCase();
          return !attendee.self && email !== event.accountEmail?.toLowerCase();
        })
        .map((attendee) => ({
          email: attendee.email,
          displayName: attendee.displayName,
          photoUrl: attendee.photoUrl,
          optional: attendee.optional === true ? true : undefined,
        })),
    [event.accountEmail, event.attendees],
  );
  const findTimeTimezone =
    editTimezone || event.startTimeZone || getLocalTimezone();
  const findTimeDurationMinutes = Math.max(
    5,
    differenceInMinutes(parseISO(event.end), parseISO(event.start)),
  );

  const handleSelectFindTimeSlot = useCallback(
    (slot: FindTimeSlot) => {
      setEditDate(toDateInputValue(slot.start));
      setEditEndDate(toDateInputValue(slot.end));
      setEditStartTime(toTimeInputValue(slot.start));
      setEditEndTime(toTimeInputValue(slot.end));
      setEditTimezone(findTimeTimezone);
      setEditingField(null);
      setFindTimeOpen(false);
      saveField({
        start: slot.start,
        end: slot.end,
        allDay: false,
        startTimeZone: findTimeTimezone,
        endTimeZone: findTimeTimezone,
        scope: isRecurringEvent ? editTimeScope : "single",
      });
    },
    [editTimeScope, findTimeTimezone, isRecurringEvent, saveField],
  );

  const handleSaveRecurrence = useCallback(() => {
    const recurrence = buildRecurrenceRules(
      editRecurrencePreset,
      masterEvent.data?.start || event.start,
      masterEvent.data?.startTimeZone || event.startTimeZone || editTimezone,
    );
    if (!recurrence) {
      toast.error(t("eventForm.customRepeatGoogleCalendar"));
      return;
    }
    saveField({ recurrence, scope: "all" });
    setEditingField(null);
  }, [
    editRecurrencePreset,
    editTimezone,
    event.start,
    event.startTimeZone,
    masterEvent.data?.start,
    masterEvent.data?.startTimeZone,
    saveField,
  ]);

  const handleAddAttendee = useCallback(
    (attendee: AttendeeRecipient) => {
      const email = attendee.email.trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

      const existing = event.attendees || [];
      if (existing.some((a) => a.email.toLowerCase() === email)) return;

      const attendeeUpdate = {
        email,
        displayName: attendee.displayName,
        photoUrl: attendee.photoUrl,
        ...(attendee.optional === true ? { optional: true as const } : {}),
      };

      if (isDraft) {
        saveField({ attendees: [...existing, attendeeUpdate] });
      } else {
        saveField({ addAttendees: [attendeeUpdate] });
      }
    },
    [event.attendees, isDraft, saveField],
  );

  const handleToggleAttendeeOptional = useCallback(
    (email: string, optional: boolean) => {
      const existing = event.attendees || [];
      const key = email.trim().toLowerCase();
      if (!existing.some((attendee) => attendee.email.toLowerCase() === key)) {
        return;
      }
      saveField({
        attendees: existing.map((attendee) =>
          attendee.email.toLowerCase() === key
            ? {
                ...attendee,
                optional: optional ? true : undefined,
              }
            : attendee,
        ),
      });
    },
    [event.attendees, saveField],
  );

  const handleSaveMeetingLink = useCallback(() => {
    const url = editMeetingLink.trim();
    let saved = false;
    if (url) {
      // Save meeting link as location if no location exists, otherwise as description addendum
      if (!event.location) {
        saved = saveField({ location: url });
        setEditLocation(url);
      } else {
        const desc = event.description ? `${event.description}\n\n${url}` : url;
        saved = saveField({ description: desc });
        setEditDescription(desc);
      }
    }
    setEditMeetingLink("");
    setEditingField(null);
    return saved;
  }, [editMeetingLink, event.location, event.description, saveField]);

  // If in sidebar mode, clicking the trigger opens the sidebar instead of popover
  const handleTriggerClick = useCallback(() => {
    setFocusedEvent(event);
    if (eventDetailSidebar && !isNewEventRef.current && !isDraft) {
      setSidebarEvent(event);
    }
  }, [eventDetailSidebar, event, isDraft, setSidebarEvent, setFocusedEvent]);

  const handlePinToSidebar = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      requestAnimationFrame(() => {
        setSidebarEvent(event);
        setEventDetailSidebar(true);
      });
    },
    [event, setEventDetailSidebar, setSidebarEvent],
  );

  const handleCreateDraft = useCallback(() => {
    if (!onDraftCreate) return;
    const updates =
      isEditingTitle && editingTitle.trim()
        ? { title: editingTitle.trim() }
        : undefined;
    if (updates) {
      onTitleSave?.(event.id, updates.title, event.accountEmail);
      setIsEditingTitle(false);
      isNewEventRef.current = false;
    }
    onDraftCreate(event.id, updates);
  }, [editingTitle, event, isEditingTitle, onDraftCreate, onTitleSave]);

  // Keyboard shortcut: Cmd+J to join meeting when popover is open
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "j" && meetingLink) {
        e.preventDefault();
        window.open(meetingLink.url, "_blank");
      }
    },
    [open, meetingLink],
  );

  useEffect(() => {
    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  const locationIsUrl = event.location ? isUrl(event.location) : false;
  const locationIsMeetingLink =
    meetingLink && event.location?.includes(meetingLink.url);
  const recurrenceText = recurrenceLoading
    ? t("eventForm.loadingRepeat")
    : formatRecurrenceText(recurrenceRules) ||
      (isRecurringEvent ? t("eventForm.repeats") : null);
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      const isPopoverSuppressed =
        eventDetailSidebar && !isNewEventRef.current && !isDraft;
      if (newOpen && isPopoverSuppressed) return;
      if (!newOpen && open) {
        const trimmedTitle = editingTitle.trim();
        let savedPendingChange = false;
        // Popover is closing — handle saves
        if (isEditingTitle) {
          if (trimmedTitle && trimmedTitle !== "(No title)") {
            onTitleSave?.(event.id, trimmedTitle, event.accountEmail);
            isNewEventRef.current = false;
            savedPendingChange = true;
          }
          setIsEditingTitle(false);
        }
        // Save any pending field edits before deciding whether an untouched
        // new draft should be discarded.
        if (editingField === "description") {
          savedPendingChange = handleSaveDescription() || savedPendingChange;
        } else if (editingField === "location") {
          savedPendingChange = handleSaveLocation() || savedPendingChange;
        } else if (editingField === "time") {
          savedPendingChange = handleSaveTime() || savedPendingChange;
        } else if (editingField === "meetingLink") {
          savedPendingChange = handleSaveMeetingLink() || savedPendingChange;
        } else if (editingField === "reminders") {
          savedPendingChange = handleSaveReminders() || savedPendingChange;
        } else if (editingField === "attachments") {
          savedPendingChange = handleSaveAttachments() || savedPendingChange;
        }
        if (
          isNewEventRef.current &&
          !savedPendingChange &&
          (!trimmedTitle || trimmedTitle === "(No title)") &&
          onDismissNew
        ) {
          onDismissNew(event.id, event.accountEmail);
        }

        setEditingField(null);
        isNewEventRef.current = false;
      }
      setOpen(newOpen);
    },
    [
      open,
      isEditingTitle,
      editingTitle,
      event.id,
      event.accountEmail,
      onTitleSave,
      onDismissNew,
      editingField,
      handleSaveDescription,
      handleSaveLocation,
      handleSaveTime,
      handleSaveMeetingLink,
      handleSaveReminders,
      handleSaveAttachments,
      eventDetailSidebar,
      isDraft,
    ],
  );

  const popoverOpen =
    eventDetailSidebar && !isNewEventRef.current && !isDraft ? false : open;
  const sidebarDetailsOpen =
    eventDetailSidebar &&
    !isNewEventRef.current &&
    !isDraft &&
    sidebarEvent?.id === event.id &&
    sidebarEvent.accountEmail === event.accountEmail;
  const detailsOpen = popoverOpen || sidebarDetailsOpen;
  const previousDetailsOpenRef = useRef(false);

  useEffect(() => {
    if (previousDetailsOpenRef.current === detailsOpen) return;
    previousDetailsOpenRef.current = detailsOpen;
    onOpenChange?.(detailsOpen);
  }, [detailsOpen, onOpenChange]);

  useEffect(() => {
    const token = popoverTokenRef.current;
    if (!token) return;
    setEventDetailPopoverOpen(token, popoverOpen);
    return () => setEventDetailPopoverOpen(token, false);
  }, [popoverOpen]);

  return (
    <Popover open={popoverOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild onClick={handleTriggerClick}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        align={isMobile ? "center" : "start"}
        side={isMobile ? "bottom" : "right"}
        sideOffset={isMobile ? 6 : 8}
        collisionPadding={12}
        className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 sm:w-[420px]"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (isEditingTitle) {
            requestAnimationFrame(() => titleInputRef.current?.focus());
          }
        }}
        onInteractOutside={(e) => {
          if (findTimeOpen) {
            e.preventDefault();
            return;
          }
          // Don't close if clicking inside an Apollo popover (portaled to body)
          const target = e.target as HTMLElement;
          if (
            target.closest("[data-apollo-popover]") ||
            target.closest("[data-attendee-autocomplete]")
          ) {
            e.preventDefault();
            return;
          }
          // Mark that a popover was dismissed so the grid suppresses time-slot creation
          markPopoverInteractOutside(e.target);
        }}
      >
        <TooltipProvider>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>
                {isWorkingLocation
                  ? t("eventForm.workingLocation")
                  : isOutOfOffice
                    ? t("eventForm.outOfOffice")
                    : isDraft
                      ? t("eventForm.draftEvent")
                      : t("eventForm.event")}
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              {!isDraft && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={handlePinToSidebar}
                    >
                      <IconLayoutSidebarRight className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{t("eventForm.openInSidebar")}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => handleOpenChange(false)}
              >
                <IconX className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 pt-4 pb-1">
              {/* Title — always editable */}
              {isEditingTitle && !isWorkingLocation ? (
                <input
                  ref={titleInputRef}
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const trimmed = editingTitle.trim();
                      if (trimmed && trimmed !== "(No title)") {
                        onTitleSave?.(event.id, trimmed, event.accountEmail);
                        isNewEventRef.current = false;
                      }
                      setIsEditingTitle(false);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      if (isNewEventRef.current && onDismissNew) {
                        handleOpenChange(false);
                      } else {
                        setEditingTitle(event.title);
                        setIsEditingTitle(false);
                      }
                    } else if (
                      (e.key === "Backspace" || e.key === "Delete") &&
                      editingTitle === "" &&
                      isNewEventRef.current &&
                      onDismissNew
                    ) {
                      e.preventDefault();
                      handleOpenChange(false);
                    }
                    e.stopPropagation();
                  }}
                  onBlur={() => {
                    const trimmed = editingTitle.trim();
                    if (
                      trimmed &&
                      trimmed !== "(No title)" &&
                      trimmed !== event.title
                    ) {
                      onTitleSave?.(event.id, trimmed, event.accountEmail);
                      isNewEventRef.current = false;
                    }
                    setIsEditingTitle(false);
                  }}
                  placeholder={t("eventForm.addTitle")}
                  className="w-full text-lg font-semibold text-foreground leading-tight mb-4 bg-transparent border-none outline-none placeholder:text-muted-foreground/50 focus:ring-0"
                />
              ) : (
                <h2
                  className={`mb-4 -mx-0.5 rounded px-0.5 text-lg font-semibold leading-tight text-foreground ${!isOverlay && !isWorkingLocation ? "cursor-text hover:bg-muted/50" : ""}`}
                  onClick={() => {
                    if (isOverlay || isWorkingLocation) return;
                    setEditingTitle(event.title);
                    setIsEditingTitle(true);
                  }}
                >
                  {getWorkingLocationTitle(event, workingLocationLabels)}
                </h2>
              )}
            </div>

            <div className="px-4 space-y-1">
              {isDraft && (
                <DraftEventAccountSelect
                  event={event}
                  onAccountChange={(accountEmail) =>
                    onDraftUpdate?.(event.id, { accountEmail })
                  }
                />
              )}

              {/* Time — editable */}
              {editingField === "time" ? (
                <div className="flex items-start gap-3 py-1.5">
                  <IconClock className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 space-y-2">
                    <div
                      className={`grid gap-2 ${
                        isSingleDayWorkingLocation
                          ? "grid-cols-1"
                          : "grid-cols-2"
                      }`}
                    >
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => {
                          const next = e.target.value;
                          setEditDate(next);
                          setEditEndDate((current) =>
                            // i18n-ignore -- this expression selects a date; it is not visible copy.
                            isSingleDayWorkingLocation
                              ? next
                              : current < next
                                ? next
                                : current,
                          );
                        }}
                        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                        aria-label={t("eventForm.startDate")}
                      />
                      {!isSingleDayWorkingLocation && (
                        <input
                          type="date"
                          min={editDate}
                          value={editEndDate}
                          onChange={(e) =>
                            setEditEndDate(e.target.value || editDate)
                          }
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                          aria-label={t("eventForm.endDate")}
                        />
                      )}
                    </div>
                    {!event.allDay && (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={editStartTime}
                          onChange={(e) => setEditStartTime(e.target.value)}
                          className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                        />
                        <span className="text-muted-foreground/50 text-xs">
                          &rarr;
                        </span>
                        <input
                          type="time"
                          value={editEndTime}
                          onChange={(e) => setEditEndTime(e.target.value)}
                          className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                        />
                      </div>
                    )}
                    {!event.allDay && (
                      <TimezoneCombobox
                        id={`event-timezone-${event.id}`}
                        value={editTimezone}
                        onChange={setEditTimezone}
                      />
                    )}
                    {isRecurringEvent &&
                      !isDraft &&
                      !isSingleDayWorkingLocation && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {t("eventForm.applyTo")}
                          </span>
                          <Select
                            value={editTimeScope}
                            onValueChange={(value) =>
                              setEditTimeScope(value as UpdateEventScope)
                            }
                          >
                            <SelectTrigger className="h-7 flex-1 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="single">
                                {isWorkingLocation
                                  ? t("eventForm.thisDayOnly")
                                  : t("eventForm.thisEvent")}
                              </SelectItem>
                              <SelectItem value="all">
                                {isWorkingLocation
                                  ? t("eventForm.allDays")
                                  : t("eventForm.allEvents")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => {
                          setEditDate(toDateInputValue(event.start));
                          setEditEndDate(
                            event.allDay
                              ? toAllDayEndDateInputValue(event.end)
                              : toDateInputValue(event.end),
                          );
                          setEditStartTime(toTimeInputValue(event.start));
                          setEditEndTime(toTimeInputValue(event.end));
                          setEditTimezone(
                            event.startTimeZone || getLocalTimezone(),
                          );
                          setEditTimeScope("single");
                          setEditingField(null);
                        }}
                      >
                        {t("eventForm.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleSaveTime}
                      >
                        {t("eventForm.save")}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className={`flex items-start gap-3 py-1.5 rounded-md px-0 -mx-0 ${!isOverlay ? "cursor-pointer hover:bg-muted/50" : ""}`}
                  onClick={() => {
                    if (isOverlay) return;
                    setEditingField("time");
                  }}
                >
                  <IconClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    {event.allDay ? (
                      <div>
                        <span className="text-foreground">
                          {t("eventForm.allDay")}
                        </span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {formatEventDateRange(
                            event.start,
                            event.end,
                            event.allDay,
                          )}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-foreground font-medium">
                            {formatTimeShort(event.start)}
                          </span>
                          <span className="text-muted-foreground/50 mx-0.5">
                            &rarr;
                          </span>
                          <span className="text-foreground font-medium">
                            {formatTimeShort(event.end)}
                          </span>
                          <span className="text-muted-foreground/50 text-xs ml-1">
                            {formatDuration(event.start, event.end)}
                          </span>
                        </div>
                        <div className="text-muted-foreground text-xs mt-0.5">
                          {formatEventDateRange(event.start, event.end)}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {!event.allDay && !isOverlay && !isWorkingLocation && (
                <div className="flex items-center gap-3 py-1">
                  <div className="h-4 w-4 shrink-0" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => setFindTimeOpen(true)}
                  >
                    <IconCalendarTime className="h-3.5 w-3.5" />
                    {t("eventForm.findTime")}
                  </Button>
                </div>
              )}

              {!event.allDay && !isOverlay && !isWorkingLocation && (
                <FindTimeTakeover
                  open={findTimeOpen}
                  onOpenChange={setFindTimeOpen}
                  title={t("eventForm.findTime")}
                  subtitle={event.title}
                  date={editDate || toDateInputValue(event.start)}
                  timezone={findTimeTimezone}
                  durationMinutes={findTimeDurationMinutes}
                  attendees={schedulingAttendees}
                  accountEmail={event.accountEmail}
                  selectedStart={event.start}
                  selectedEnd={event.end}
                  ignoreStart={event.start}
                  ignoreEnd={event.end}
                  onSelectSlot={handleSelectFindTimeSlot}
                  onAddAttendee={handleAddAttendee}
                />
              )}

              {/* Recurrence */}
              {editingField === "recurrence" ? (
                <div className="flex items-start gap-3 py-1.5">
                  <IconRefresh className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 space-y-2">
                    <Select
                      value={editRecurrencePreset}
                      onValueChange={(value) =>
                        setEditRecurrencePreset(value as RecurrencePreset)
                      }
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          {t("eventForm.doesNotRepeat")}
                        </SelectItem>
                        <SelectItem value="daily">
                          {t("eventForm.daily")}
                        </SelectItem>
                        <SelectItem value="weekdays">
                          {t("eventForm.everyWeekday")}
                        </SelectItem>
                        <SelectItem value="weekly">
                          {t("eventForm.weekly")}
                        </SelectItem>
                        <SelectItem value="monthly">
                          {t("eventForm.monthly")}
                        </SelectItem>
                        <SelectItem value="yearly">
                          {t("eventForm.yearly")}
                        </SelectItem>
                        {editRecurrencePreset === "custom" && (
                          <SelectItem value="custom" disabled>
                            {t("eventForm.customSchedule")}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => {
                          setEditRecurrencePreset(
                            getRecurrencePreset(recurrenceRules),
                          );
                          setEditingField(null);
                        }}
                      >
                        {t("eventForm.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleSaveRecurrence}
                        disabled={editRecurrencePreset === "custom"}
                      >
                        {t("eventForm.save")}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : recurrenceText ? (
                <button
                  type="button"
                  className={`group flex w-full items-center gap-3 rounded-md py-1.5 text-left ${canEditRecurrence ? "cursor-pointer hover:bg-muted/50" : ""}`}
                  onClick={() => {
                    if (!canEditRecurrence) return;
                    setEditRecurrencePreset(
                      getRecurrencePreset(recurrenceRules),
                    );
                    setEditingField("recurrence");
                  }}
                >
                  <IconRefresh className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {recurrenceText}
                  </span>
                  {canEditRecurrence && (
                    <IconChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </button>
              ) : null}

              {isWorkingLocation && (
                <WorkingLocationEditor
                  event={event}
                  isRecurring={isRecurringEvent}
                  readOnly={isOverlay}
                  disabled={updateEvent.isPending}
                  onSave={handleSaveWorkingLocation}
                />
              )}
            </div>

            {!isWorkingLocation && (
              <>
                {/* Separator */}
                <div className="mx-4 my-2 border-t border-border/50" />

                {/* Attendees — always shown */}
                {event.attendees && event.attendees.length > 0 ? (
                  <EventAttendeesSection
                    event={event}
                    canEditOptional={!isOverlay}
                    onToggleOptional={handleToggleAttendeeOptional}
                  />
                ) : !isOverlay ? (
                  <div className="px-4 py-1">
                    <div className="flex items-start gap-3">
                      <IconUser className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground/60">
                        {t("eventForm.noGuests")}
                      </span>
                    </div>
                  </div>
                ) : null}

                {/* Add guest input */}
                {!isOverlay && (
                  <div className="px-4 py-1">
                    <div className="flex items-center gap-3">
                      <IconPlus className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                      <AttendeeAutocomplete
                        selectedEmails={(event.attendees || []).map(
                          (attendee) => attendee.email,
                        )}
                        onAdd={handleAddAttendee}
                        placeholder={t("eventForm.addGuests")}
                        variant="inline"
                        showChips={false}
                        showAddButton
                        inputClassName="text-foreground placeholder:text-muted-foreground/40"
                      />
                    </div>
                  </div>
                )}

                {/* Research Meeting button */}
                {event.attendees && event.attendees.length > 0 && (
                  <>
                    <div className="mx-4 my-2 border-t border-border/50" />
                    <div className="px-4 py-1">
                      <ResearchMeetingButton event={event} />
                    </div>
                  </>
                )}

                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="px-4 py-1">
                  <ExtensionSlot
                    id="calendar.event-detail.bottom"
                    context={buildEventDetailSlotContext(event)}
                    showEmptyAffordance
                  />
                </div>
              </>
            )}

            {/* Meeting link */}
            {!isWorkingLocation &&
              (meetingLink ? (
                <>
                  <div className="mx-4 my-2 border-t border-border/50" />
                  <div className="px-4 py-1.5">
                    <a
                      href={meetingLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center w-full rounded-xl bg-[#4965E0] hover:bg-[#5A75F0] text-white font-semibold py-2 px-4 text-[15px] relative"
                    >
                      <IconVideo className="h-5 w-5 mr-2 opacity-80" />
                      <span>{getMeetingLabel(meetingLink.type, t)}</span>
                      <span className="absolute right-4 hidden items-center gap-1 opacity-50 sm:flex">
                        <kbd className="text-xs font-normal">
                          {shortcutModifierLabel()}
                        </kbd>
                        <kbd className="inline-flex h-5 w-5 items-center justify-center rounded bg-white/20 text-[11px] font-medium">
                          J
                        </kbd>
                      </span>
                    </a>
                    {(meetingLink.pin || meetingLink.passcode) && (
                      <div className="mt-1.5 text-xs text-muted-foreground/60">
                        {meetingLink.pin && (
                          <span>
                            {t("eventForm.pin", { pin: meetingLink.pin })}
                          </span>
                        )}
                        {meetingLink.pin && meetingLink.passcode && (
                          <span className="mx-1">&middot;</span>
                        )}
                        {meetingLink.passcode && (
                          <span>
                            {t("eventForm.passcode", {
                              passcode: meetingLink.passcode,
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : pendingConferenceProvider ? (
                <>
                  <div className="mx-4 my-2 border-t border-border/50" />
                  <div className="px-4 py-1.5">
                    <div className="flex w-full items-center rounded-xl bg-[#4965E0] py-2 pl-4 pr-2 text-white">
                      {pendingConferenceProvider === "zoom" ? (
                        <IconBrandZoom className="mr-2 h-5 w-5 opacity-90" />
                      ) : (
                        <IconVideo className="mr-2 h-5 w-5 opacity-90" />
                      )}
                      <span className="text-[15px] font-semibold">
                        {pendingConferenceProvider === "zoom"
                          ? t("eventForm.zoom")
                          : t("eventForm.googleMeet")}
                      </span>
                      <button
                        type="button"
                        onClick={handleRemovePendingConference}
                        aria-label={`Remove ${
                          pendingConferenceProvider === "zoom"
                            ? t("eventForm.zoom")
                            : t("eventForm.googleMeet")
                        }`}
                        className="ml-auto rounded-md p-1 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
                      >
                        <IconX className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground/60">
                      {t("eventForm.conferencingLinkOnSave")}
                    </p>
                  </div>
                </>
              ) : !isOverlay ? (
                <>
                  <div className="mx-4 my-2 border-t border-border/50" />
                  {editingField === "meetingLink" ? (
                    <div className="px-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <IconVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <input
                          ref={meetingLinkRef}
                          value={editMeetingLink}
                          onChange={(e) => setEditMeetingLink(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveMeetingLink();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditMeetingLink("");
                              setEditingField(null);
                            }
                            e.stopPropagation();
                          }}
                          onBlur={handleSaveMeetingLink}
                          placeholder={t("eventForm.pasteMeetingLink")}
                          className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:ring-0"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-1.5">
                      {pendingVideoProvider ? (
                        <MeetingLinkSkeleton provider={pendingVideoProvider} />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 flex-1 justify-center gap-1.5 px-2 text-xs"
                            disabled={updateEvent.isPending}
                            onClick={handleAddGoogleMeet}
                          >
                            <IconVideo className="h-3.5 w-3.5" />
                            {t("eventForm.meet")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 flex-1 justify-center gap-1.5 px-2 text-xs"
                            disabled={
                              updateEvent.isPending || connectZoom.isPending
                            }
                            onClick={handleAddZoom}
                          >
                            <IconBrandZoom className="h-3.5 w-3.5" />
                            {t("eventForm.zoom")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 flex-1 justify-center gap-1.5 px-2 text-xs text-muted-foreground"
                            onClick={() => setEditingField("meetingLink")}
                          >
                            <IconPlus className="h-3.5 w-3.5" />
                            {t("eventForm.pasteLink")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : null)}

            {/* Attachments */}
            {!isOverlay && !isWorkingLocation && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                {editingField === "attachments" ? (
                  <div className="px-4 py-1.5">
                    <div className="mb-2 flex items-center gap-3">
                      <IconPaperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {t("eventForm.attachments")}
                      </span>
                    </div>
                    <AttachmentControls
                      idPrefix={`event-${event.id}`}
                      attachments={editAttachments}
                      onChange={setEditAttachments}
                    />
                    <div className="mt-2 flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => {
                          setEditAttachments(
                            attachmentsToDrafts(event.attachments),
                          );
                          setEditingField(null);
                        }}
                      >
                        {t("eventForm.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleSaveAttachments}
                      >
                        {t("eventForm.save")}
                      </Button>
                    </div>
                  </div>
                ) : event.attachments && event.attachments.length > 0 ? (
                  <div className="px-4 py-1.5 space-y-1">
                    {event.attachments.map((att, i) => (
                      <a
                        key={i}
                        href={att.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50 group"
                      >
                        {att.iconLink ? (
                          <img
                            src={att.iconLink}
                            alt=""
                            className="h-4 w-4 shrink-0"
                          />
                        ) : (
                          <IconFileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate text-foreground">
                          {att.title}
                        </span>
                        <IconExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </a>
                    ))}
                    <button
                      type="button"
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      onClick={() => {
                        setEditAttachments(
                          attachmentsToDrafts(event.attachments),
                        );
                        setEditingField("attachments");
                      }}
                    >
                      <IconPlus className="h-4 w-4" />
                      {t("eventForm.addAttachment")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-1.5 text-sm text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground"
                    onClick={() => {
                      setEditAttachments([attachmentsToDrafts(undefined)[0]]);
                      setEditingField("attachments");
                    }}
                  >
                    <IconPaperclip className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    {t("eventForm.addAttachment")}
                  </button>
                )}
              </>
            )}

            {!isWorkingLocation && (
              <>
                {/* Location — always shown, editable */}
                <div className="mx-4 my-2 border-t border-border/50" />
                {editingField === "location" ? (
                  <div className="flex items-start gap-3 px-4 py-1.5">
                    <IconMapPin className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      ref={locationRef}
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSaveLocation();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditLocation(editableLocationValue);
                          setEditingField(null);
                        }
                        e.stopPropagation();
                      }}
                      onBlur={handleSaveLocation}
                      placeholder={t("eventForm.addLocation")}
                      className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:ring-0"
                    />
                  </div>
                ) : event.location && !locationIsMeetingLink ? (
                  <div
                    className={`flex items-start gap-3 px-4 py-1.5 ${!isOverlay ? "cursor-pointer hover:bg-muted/50 rounded-md" : ""}`}
                    onClick={() => {
                      if (isOverlay) return;
                      setEditingField("location");
                    }}
                  >
                    <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    {locationIsUrl ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a
                            href={event.location}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline truncate block max-w-full"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {event.location}
                          </a>
                        </TooltipTrigger>
                        <TooltipContent>{event.location}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {event.location}
                      </span>
                    )}
                  </div>
                ) : locationIsMeetingLink && meetingLink ? (
                  <>
                    <div className="flex items-start gap-3 px-4 py-1.5 rounded-md">
                      <IconVideo className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <a
                          href={meetingLink.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-full truncate text-sm text-primary hover:underline"
                        >
                          {getMeetingLabel(meetingLink.type, t)}
                        </a>
                        <div className="text-xs text-muted-foreground">
                          {t("eventForm.savedAsVideoLink")}
                        </div>
                      </div>
                    </div>
                    {!isOverlay && (
                      <div
                        className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-muted/50 rounded-md"
                        onClick={() => {
                          setEditLocation(editableLocationValue);
                          setEditingField("location");
                        }}
                      >
                        <IconMapPin className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                        <span className="text-sm text-muted-foreground/40">
                          {t("eventForm.addLocation")}
                        </span>
                      </div>
                    )}
                  </>
                ) : !isOverlay ? (
                  <div
                    className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-muted/50 rounded-md"
                    onClick={() => {
                      setEditLocation(
                        locationIsMeetingLink ? "" : editableLocationValue,
                      );
                      setEditingField("location");
                    }}
                  >
                    <IconMapPin className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    <span className="text-sm text-muted-foreground/40">
                      {t("eventForm.addLocation")}
                    </span>
                  </div>
                ) : null}
              </>
            )}

            {/* Description — always shown for editable events; hidden for overlay events with no description */}
            {!isWorkingLocation && (!isOverlay || event.description) && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="px-4 py-1.5">
                  <div className="flex items-start gap-3">
                    <IconAlignLeft className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      {!isOverlay && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mb-1 h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                          onClick={handleDraftDescription}
                        >
                          <IconMessage className="h-3 w-3" />
                          {t("eventForm.askAi")}
                        </Button>
                      )}
                      {isOverlay ? (
                        event.description ? (
                          <RenderedDescription
                            description={event.description}
                          />
                        ) : null
                      ) : editingField === "description" ||
                        !event.description ? (
                        <AutoGrowTextarea
                          value={editDescription}
                          onChange={setEditDescription}
                          onBlur={handleSaveDescription}
                          onSubmit={handleSaveDescription}
                          onEscape={() => {
                            setEditDescription(event.description || "");
                            setEditingField(null);
                          }}
                          autoFocus={editingField === "description"}
                        />
                      ) : (
                        <RenderedDescription
                          description={event.description}
                          editable
                          onClick={() => setEditingField("description")}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Reminders */}
            {!isWorkingLocation &&
              (!isOverlay && editingField === "reminders" ? (
                <>
                  <div className="mx-4 my-2 border-t border-border/50" />
                  <div className="px-4 py-1.5">
                    <div className="mb-2 flex items-center gap-3">
                      <IconBell className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {t("eventForm.eventAlerts")}
                      </span>
                    </div>
                    <ReminderControls
                      idPrefix={`event-${event.id}`}
                      mode={editReminderMode}
                      reminders={editReminders}
                      onModeChange={setEditReminderMode}
                      onRemindersChange={setEditReminders}
                    />
                    <div className="mt-2 flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => {
                          const reminderState = remindersToDraftState(event);
                          setEditReminderMode(reminderState.mode);
                          setEditReminders(reminderState.reminders);
                          setEditingField(null);
                        }}
                      >
                        {t("eventForm.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleSaveReminders}
                      >
                        {t("eventForm.save")}
                      </Button>
                    </div>
                  </div>
                </>
              ) : event.reminders && event.reminders.length > 0 ? (
                <>
                  <div className="mx-4 my-2 border-t border-border/50" />
                  <div className="flex items-start gap-3 px-4 py-1.5">
                    <IconBell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="space-y-0.5">
                      {event.reminders.map((r, i) => (
                        <div key={i} className="text-sm text-muted-foreground">
                          {formatReminderText(r.minutes)}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null)}

            {/* Availability, visibility, and alerts */}
            {!isWorkingLocation &&
              (!isOverlay ? (
                <>
                  <div className="mx-4 my-2 border-t border-border/50" />
                  <div className="px-4 py-1.5">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">
                          {t("eventForm.showAs")}
                        </span>
                        <Select
                          value={availabilityValue}
                          onValueChange={(value) =>
                            handleAvailabilityChange(value as AvailabilityValue)
                          }
                          disabled={updateEvent.isPending}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="opaque">
                              {t("eventForm.busy")}
                            </SelectItem>
                            <SelectItem value="transparent">
                              {t("eventForm.free")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">
                          {t("eventForm.visibility")}
                        </span>
                        <Select
                          value={visibilityValue}
                          onValueChange={(value) =>
                            handleVisibilityChange(value as VisibilityValue)
                          }
                          disabled={updateEvent.isPending}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">
                              {t("eventForm.default")}
                            </SelectItem>
                            <SelectItem value="public">
                              {t("eventForm.public")}
                            </SelectItem>
                            <SelectItem value="private">
                              {t("eventForm.private")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">
                          {t("eventForm.alerts")}
                        </span>
                        <Select
                          value={reminderValue}
                          onValueChange={(value) =>
                            handleReminderChange(value as ReminderValue)
                          }
                          disabled={updateEvent.isPending}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">
                              {t("eventForm.default")}
                            </SelectItem>
                            <SelectItem value="none">
                              {t("eventForm.none")}
                            </SelectItem>
                            <SelectItem value="0">
                              {t("eventForm.atStart")}
                            </SelectItem>
                            <SelectItem value="10">10 min</SelectItem>
                            <SelectItem value="30">30 min</SelectItem>
                            <SelectItem value="60">1 hour</SelectItem>
                            <SelectItem value="1440">1 day</SelectItem>
                            <SelectItem value="custom">
                              {t("eventForm.customEllipsis")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <IconPalette className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <EventColorSwatches
                        value={event.colorId}
                        onChange={handleColorChange}
                      />
                    </div>
                  </div>
                </>
              ) : event.status || event.visibility ? (
                <>
                  <div className="mx-4 my-2 border-t border-border/50" />
                  <div className="flex items-center gap-3 px-4 py-1.5 text-sm text-muted-foreground">
                    <div className="h-4 w-4 shrink-0" />
                    <span>
                      {event.transparency === "transparent"
                        ? t("eventForm.free")
                        : t("eventForm.busy")}
                      {event.visibility && event.visibility !== "default"
                        ? ` · ${event.visibility} visibility`
                        : ""}
                    </span>
                  </div>
                </>
              ) : null)}

            {/* Overlay person badge */}
            {event.overlayEmail && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="flex items-center gap-3 px-4 py-1.5">
                  <span
                    aria-hidden="true"
                    className="ml-1 size-2 shrink-0 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: event.ownerColor }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {t("eventForm.viewingOwnerCalendar", {
                      owner: ownerLabel,
                    })}
                  </span>
                </div>
              </>
            )}

            {/* Bottom padding */}
            <div className="h-3" />
          </div>

          {/* Actions */}
          {!isOverlay && (
            <div className="shrink-0 border-t border-border px-4 py-2.5 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                onClick={() => {
                  if (isDraft) onDraftDiscard?.(event.id);
                  else onDelete(event.id);
                  handleOpenChange(false);
                }}
              >
                {isDraft ? t("eventForm.discard") : t("eventForm.delete")}
              </Button>
              {event.htmlLink && !isDraft && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="ml-auto gap-1.5 text-xs"
                >
                  <a
                    href={event.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <IconExternalLink className="h-3.5 w-3.5" />
                    {t("eventForm.googleCalendar")}
                  </a>
                </Button>
              )}
              {isDraft && (
                <Button
                  size="sm"
                  className="ml-auto text-xs"
                  onClick={handleCreateDraft}
                >
                  {event.attendees?.length
                    ? t("eventForm.createAndSend")
                    : t("eventForm.createEvent")}
                </Button>
              )}
            </div>
          )}
        </TooltipProvider>
      </PopoverContent>
      {guestNotificationDialog}
    </Popover>
  );
}
