import { useState, useEffect, useCallback, useRef } from "react";
import { markPopoverInteractOutside } from "@/lib/popover-click-guard";
import { format, parseISO, differenceInMinutes } from "date-fns";
import {
  IconX,
  IconClock,
  IconMapPin,
  IconUser,
  IconVideo,
  IconGlobe,
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
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import type { CalendarEvent, UpdateEventScope } from "@shared/api";
import { ResearchMeetingButton } from "@/components/calendar/ApolloPanel";
import { EventAttendeesSection } from "@/components/calendar/EventAttendeesSection";
import {
  AttendeeAutocomplete,
  type AttendeeRecipient,
} from "@/components/calendar/AttendeeAutocomplete";
import { useCalendarContext } from "@/components/layout/AppLayout";
import { useEvent, useUpdateEvent } from "@/hooks/use-events";
import { useConnectZoom, useZoomStatus } from "@/hooks/use-zoom-auth";
import { sendToAgentChat } from "@agent-native/core/client";
import { toast } from "sonner";
import { useGuestNotificationPrompt } from "@/components/calendar/GuestNotificationDialog";
import {
  RenderedDescription,
  AutoGrowTextarea,
} from "@/components/calendar/EventDescription";
import { TimezoneCombobox } from "@/components/TimezoneCombobox";
import {
  AttachmentControls,
  EventColorSwatches,
  ReminderControls,
} from "@/components/calendar/EventOptionControls";
import {
  attachmentsToDrafts,
  buildRecurrenceRules,
  buildReminderPayload,
  dateTimeInTimezoneToIso,
  formatRecurrenceText,
  formatReminderText,
  formatTimezoneLabel,
  getEventEndValidationMessage,
  getLocalTimezone,
  getRecurrencePreset,
  remindersToDraftState,
  type AttachmentDraft,
  type RecurrencePreset,
  type ReminderDraft,
  type ReminderMode,
  validateAttachmentDrafts,
} from "@/lib/event-form-utils";
import { getGoogleEventColorHex } from "@/lib/event-colors";
import { shortcutModifierLabel } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

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

  // IconCheck hangoutLink
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

function getMeetingLabel(type: "zoom" | "meet" | "teams" | "link"): string {
  switch (type) {
    case "zoom":
      return "Join Zoom";
    case "meet":
      return "Join Meet";
    case "teams":
      return "Join Teams";
    default:
      return "Join Meeting";
  }
}

function getMeetingType(url: string): "zoom" | "meet" | "teams" | "link" {
  if (url.includes("zoom.us")) return "zoom";
  if (url.includes("meet.google.com")) return "meet";
  if (url.includes("teams.microsoft.com")) return "teams";
  return "link";
}

function MeetingLinkSkeleton({ provider }: { provider: "meet" | "zoom" }) {
  return (
    <div
      role="status"
      aria-label={`Adding ${provider === "zoom" ? "Zoom" : "Google Meet"} link`}
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
  scope?: UpdateEventScope;
};

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

interface EventDetailPopoverProps {
  event: CalendarEvent;
  children: React.ReactNode;
  onDelete: (eventId: string) => void;
  isDraft?: boolean;
  /** When true, the popover opens immediately and title is focused for editing */
  defaultOpen?: boolean;
  /** Called when the title is changed and should be persisted */
  onTitleSave?: (eventId: string, title: string) => void;
  /** Called when the popover is dismissed for a new event (to clean up if no title was set) */
  onDismissNew?: (eventId: string) => void;
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
  onDraftUpdate,
  onDraftCreate,
  onDraftDiscard,
}: EventDetailPopoverProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(defaultOpen);
  const [editingTitle, setEditingTitle] = useState(
    defaultOpen ? event.title : "",
  );
  const [isEditingTitle, setIsEditingTitle] = useState(defaultOpen);
  const isNewEventRef = useRef(defaultOpen);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const {
    eventDetailSidebar,
    setEventDetailSidebar,
    setSidebarEvent,
    setFocusedEvent,
  } = useCalendarContext();

  // Inline editing state
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState(
    event.description || "",
  );
  const [editLocation, setEditLocation] = useState(event.location || "");
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
  const isOverlay = !!event.overlayEmail;

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

  // Sync editing state when event changes
  useEffect(() => {
    setEditDescription(event.description || "");
    setEditLocation(event.location || "");
    setEditDate(toDateInputValue(event.start));
    setEditEndDate(
      event.allDay
        ? toAllDayEndDateInputValue(event.end)
        : toDateInputValue(event.end),
    );
    setEditStartTime(toTimeInputValue(event.start));
    setEditEndTime(toTimeInputValue(event.end));
    setEditTimezone(event.startTimeZone || getLocalTimezone());
    const reminderState = remindersToDraftState(event);
    setEditReminderMode(reminderState.mode);
    setEditReminders(reminderState.reminders);
    setEditAttachments(attachmentsToDrafts(event.attachments));
    setEditTimeScope("single");
  }, [
    event.id,
    event.description,
    event.location,
    event.start,
    event.end,
    event.allDay,
    event.startTimeZone,
    event.reminders,
    event.remindersUseDefault,
    event.attachments,
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
      if (!event.id) return;
      if (isDraft) {
        const { scope: _scope, ...draftUpdates } = updates;
        onDraftUpdate?.(event.id, draftUpdates);
        return;
      }
      void (async () => {
        const { scope: _scope, ...notificationUpdates } = updates;
        const guestNotification = await promptGuestNotification({
          event,
          action: "update",
          updates: notificationUpdates,
        });
        if (!guestNotification) return;
        updateEvent.mutate({
          id: event.id,
          accountEmail: event.accountEmail,
          ...updates,
          ...guestNotification,
        });
      })();
    },
    [event, isDraft, onDraftUpdate, promptGuestNotification, updateEvent],
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
    saveField(buildReminderPayload(editReminderMode, editReminders));
    setEditingField(null);
  }, [editReminderMode, editReminders, saveField]);

  const handleSaveAttachments = useCallback(() => {
    const result = validateAttachmentDrafts(editAttachments);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    saveField({ attachments: result.attachments });
    setEditingField(null);
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
      message: `Draft a concise calendar event description for "${event.title}".`,
      context: `Event id: ${event.id}
Title: ${event.title}
When: ${event.start} to ${event.end}
Timezone: ${event.startTimeZone || getLocalTimezone()}
Location: ${event.location || "(none)"}
Attendees: ${(event.attendees ?? []).map((attendee) => attendee.email).join(", ") || "(none)"}
Current description: ${event.description || "(empty)"}

Write a short, useful meeting description. If I ask you to apply it, update this event with the update-event action.`,
      submit: true,
    });
  }, [event]);

  const handleAddGoogleMeet = useCallback(() => {
    if (!event.id || updateEvent.isPending) return;
    if (isDraft) {
      onDraftUpdate?.(event.id, { addGoogleMeet: true, addZoom: false });
      toast("Google Meet will be added when the event is created");
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
          onSuccess: () => toast("Google Meet added"),
          onError: () => toast.error("Failed to add Google Meet"),
          onSettled: () => setPendingVideoProvider(null),
        },
      );
    })();
  }, [event, isDraft, onDraftUpdate, promptGuestNotification, updateEvent]);

  const handleAddZoom = useCallback(() => {
    if (!event.id || updateEvent.isPending || connectZoom.isPending) return;

    if (zoomStatus.data?.connected) {
      if (isDraft) {
        onDraftUpdate?.(event.id, { addZoom: true, addGoogleMeet: false });
        toast("Zoom will be added when the event is created");
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
            onSuccess: () => toast("Zoom added"),
            onError: (error) =>
              toast.error(
                error instanceof Error ? error.message : "Failed to add Zoom",
              ),
            onSettled: () => setPendingVideoProvider(null),
          },
        );
      })();
      return;
    }

    if (zoomStatus.data?.configured === false) {
      toast.error("Zoom is not configured for this deployment.");
      return;
    }

    connectZoom.mutate(undefined, {
      onSuccess: () => toast("Zoom connection opened"),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : "Could not connect Zoom",
        ),
    });
  }, [
    connectZoom,
    event,
    isDraft,
    onDraftUpdate,
    promptGuestNotification,
    updateEvent,
    zoomStatus.data?.configured,
    zoomStatus.data?.connected,
  ]);

  const handleSaveDescription = useCallback(() => {
    const trimmed = editDescription.trim();
    if (trimmed !== (event.description || "").trim()) {
      saveField({ description: trimmed });
    }
    setEditingField(null);
  }, [editDescription, event.description, saveField]);

  const handleSaveLocation = useCallback(() => {
    const trimmed = editLocation.trim();
    const locationContainsMeetingLink =
      !!meetingLink && event.location?.includes(meetingLink.url);
    if (locationContainsMeetingLink && !trimmed) {
      setEditLocation(event.location || "");
      setEditingField(null);
      return;
    }
    if (trimmed !== (event.location || "").trim()) {
      const updates: Partial<CalendarEvent> = { location: trimmed };
      if (
        locationContainsMeetingLink &&
        meetingLink &&
        !event.description?.includes(meetingLink.url)
      ) {
        const label =
          meetingLink.type === "zoom"
            ? "Zoom"
            : getMeetingLabel(meetingLink.type);
        updates.description = event.description?.trim()
          ? `${event.description.trim()}\n\n${label}: ${meetingLink.url}`
          : `${label}: ${meetingLink.url}`;
      }
      saveField(updates);
    }
    setEditingField(null);
  }, [editLocation, event.description, event.location, meetingLink, saveField]);

  const handleSaveTime = useCallback(() => {
    const allDayEnd = new Date(`${editEndDate}T00:00:00`);
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
      return;
    }
    if (newStart !== event.start || newEnd !== event.end) {
      saveField({
        start: newStart,
        end: newEnd,
        allDay: event.allDay,
        startTimeZone: event.allDay ? undefined : editTimezone,
        endTimeZone: event.allDay ? undefined : editTimezone,
        scope: isRecurringEvent ? editTimeScope : "single",
      });
    }
    setEditTimeScope("single");
    setEditingField(null);
  }, [
    editDate,
    editEndDate,
    editStartTime,
    editEndTime,
    editTimezone,
    event.start,
    event.end,
    event.allDay,
    isRecurringEvent,
    editTimeScope,
    saveField,
  ]);

  const handleSaveRecurrence = useCallback(() => {
    const recurrence = buildRecurrenceRules(
      editRecurrencePreset,
      masterEvent.data?.start || event.start,
      masterEvent.data?.startTimeZone || event.startTimeZone || editTimezone,
    );
    if (!recurrence) {
      toast.error("Custom repeat schedules must be edited in Google Calendar.");
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

      const newAttendees = [
        ...existing,
        {
          email,
          displayName: attendee.displayName,
          photoUrl: attendee.photoUrl,
        },
      ];
      saveField({ attendees: newAttendees });
    },
    [event.attendees, saveField],
  );

  const handleSaveMeetingLink = useCallback(() => {
    const url = editMeetingLink.trim();
    if (url) {
      // Save meeting link as location if no location exists, otherwise as description addendum
      if (!event.location) {
        saveField({ location: url });
        setEditLocation(url);
      } else {
        const desc = event.description ? `${event.description}\n\n${url}` : url;
        saveField({ description: desc });
        setEditDescription(desc);
      }
    }
    setEditMeetingLink("");
    setEditingField(null);
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
      onTitleSave?.(event.id, updates.title);
      setIsEditingTitle(false);
      isNewEventRef.current = false;
    }
    onDraftCreate(event.id, updates);
  }, [editingTitle, event.id, isEditingTitle, onDraftCreate, onTitleSave]);

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
    ? "Loading repeat..."
    : formatRecurrenceText(recurrenceRules) ||
      (isRecurringEvent ? "Repeats" : null);
  // Show the browser's local timezone offset (this is what the user sees times in)
  const localOffsetMinutes = -new Date().getTimezoneOffset();
  const localOffsetSign = localOffsetMinutes >= 0 ? "+" : "-";
  const localOffsetH = Math.floor(Math.abs(localOffsetMinutes) / 60);
  const localOffsetM = Math.abs(localOffsetMinutes) % 60;
  const tzLabel = event.startTimeZone
    ? formatTimezoneLabel(event.startTimeZone)
    : localOffsetM
      ? `GMT${localOffsetSign}${localOffsetH}:${String(localOffsetM).padStart(2, "0")}`
      : `GMT${localOffsetSign}${localOffsetH}`;

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && open) {
        // Popover is closing — handle saves
        if (isEditingTitle) {
          const trimmed = editingTitle.trim();
          if (trimmed && trimmed !== "(No title)") {
            onTitleSave?.(event.id, trimmed);
            isNewEventRef.current = false;
          } else if (isNewEventRef.current && onDismissNew) {
            onDismissNew(event.id);
          }
          setIsEditingTitle(false);
        }
        // Save any pending field edits
        if (editingField === "description") handleSaveDescription();
        else if (editingField === "location") handleSaveLocation();
        else if (editingField === "time") handleSaveTime();
        else if (editingField === "meetingLink") handleSaveMeetingLink();
        else if (editingField === "reminders") handleSaveReminders();
        else if (editingField === "attachments") handleSaveAttachments();

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
      onTitleSave,
      onDismissNew,
      editingField,
      handleSaveDescription,
      handleSaveLocation,
      handleSaveTime,
      handleSaveMeetingLink,
      handleSaveReminders,
      handleSaveAttachments,
    ],
  );

  return (
    <Popover
      open={
        eventDetailSidebar && !isNewEventRef.current && !isDraft ? false : open
      }
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger asChild onClick={handleTriggerClick}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        align={isMobile ? "center" : "start"}
        side={isMobile ? "bottom" : "right"}
        sideOffset={isMobile ? 6 : 8}
        collisionPadding={12}
        className="w-[calc(100vw-2rem)] sm:w-[420px] max-h-[90vh] p-0 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (isEditingTitle) {
            requestAnimationFrame(() => titleInputRef.current?.focus());
          }
        }}
        onInteractOutside={(e) => {
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
          markPopoverInteractOutside();
        }}
      >
        <TooltipProvider>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>{isDraft ? "Draft event" : "Event"}</span>
              <IconChevronRight className="h-3 w-3" />
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
                    <p>Open in sidebar</p>
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
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const trimmed = editingTitle.trim();
                      if (trimmed && trimmed !== "(No title)") {
                        onTitleSave?.(event.id, trimmed);
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
                      onTitleSave?.(event.id, trimmed);
                      isNewEventRef.current = false;
                    }
                    setIsEditingTitle(false);
                  }}
                  placeholder="Add title"
                  className="w-full text-lg font-semibold text-foreground leading-tight mb-4 bg-transparent border-none outline-none placeholder:text-muted-foreground/50 focus:ring-0"
                />
              ) : (
                <h2
                  className="text-lg font-semibold text-foreground leading-tight mb-4 cursor-text rounded px-0.5 -mx-0.5 hover:bg-muted/50"
                  onClick={() => {
                    if (isOverlay) return;
                    setEditingTitle(event.title);
                    setIsEditingTitle(true);
                  }}
                >
                  {event.title}
                </h2>
              )}
            </div>

            <div className="px-4 space-y-1">
              {/* Time — editable */}
              {editingField === "time" ? (
                <div className="flex items-start gap-3 py-1.5">
                  <IconClock className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => {
                          const next = e.target.value;
                          setEditDate(next);
                          setEditEndDate((current) =>
                            current < next ? next : current,
                          );
                        }}
                        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                        aria-label="Start date"
                      />
                      <input
                        type="date"
                        min={editDate}
                        value={editEndDate}
                        onChange={(e) =>
                          setEditEndDate(e.target.value || editDate)
                        }
                        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                        aria-label="End date"
                      />
                    </div>
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
                    {!event.allDay && (
                      <TimezoneCombobox
                        id={`event-timezone-${event.id}`}
                        value={editTimezone}
                        onChange={setEditTimezone}
                      />
                    )}
                    {isRecurringEvent && !isDraft && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Apply to
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
                            <SelectItem value="single">This event</SelectItem>
                            <SelectItem value="all">All events</SelectItem>
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
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleSaveTime}
                      >
                        Save
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
                        <span className="text-foreground">All day</span>
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

              {/* Timezone */}
              <div className="flex items-center gap-3 py-1.5">
                <IconGlobe className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{tzLabel}</span>
              </div>

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
                        <SelectItem value="none">Does not repeat</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekdays">Every weekday</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                        {editRecurrencePreset === "custom" && (
                          <SelectItem value="custom" disabled>
                            Custom schedule
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
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleSaveRecurrence}
                        disabled={editRecurrencePreset === "custom"}
                      >
                        Save
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
            </div>

            {/* Separator */}
            <div className="mx-4 my-2 border-t border-border/50" />

            {/* Attendees — always shown */}
            {event.attendees && event.attendees.length > 0 ? (
              <EventAttendeesSection event={event} />
            ) : !isOverlay ? (
              <div className="px-4 py-1">
                <div className="flex items-start gap-3">
                  <IconUser className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground/60">
                    No guests
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
                    placeholder="Add guests"
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

            {/* Meeting link */}
            {meetingLink ? (
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
                    <span>{getMeetingLabel(meetingLink.type)}</span>
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
                      {meetingLink.pin && <span>PIN: {meetingLink.pin}</span>}
                      {meetingLink.pin && meetingLink.passcode && (
                        <span className="mx-1">&middot;</span>
                      )}
                      {meetingLink.passcode && (
                        <span>Passcode: {meetingLink.passcode}</span>
                      )}
                    </div>
                  )}
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
                        placeholder="Paste meeting link (Zoom, Meet, Teams...)"
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
                          Meet
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
                          Zoom
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 flex-1 justify-center gap-1.5 px-2 text-xs text-muted-foreground"
                          onClick={() => setEditingField("meetingLink")}
                        >
                          <IconPlus className="h-3.5 w-3.5" />
                          Paste link
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : null}

            {/* Attachments */}
            {!isOverlay && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                {editingField === "attachments" ? (
                  <div className="px-4 py-1.5">
                    <div className="mb-2 flex items-center gap-3">
                      <IconPaperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        Attachments
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
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleSaveAttachments}
                      >
                        Save
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
                      Add attachment
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
                    Add attachment
                  </button>
                )}
              </>
            )}

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
                      setEditLocation(event.location || "");
                      setEditingField(null);
                    }
                    e.stopPropagation();
                  }}
                  onBlur={handleSaveLocation}
                  placeholder="Add location"
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
                      {getMeetingLabel(meetingLink.type)}
                    </a>
                    <div className="text-xs text-muted-foreground">
                      Saved as this event's video link
                    </div>
                  </div>
                </div>
                {!isOverlay && (
                  <div
                    className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-muted/50 rounded-md"
                    onClick={() => {
                      setEditLocation("");
                      setEditingField("location");
                    }}
                  >
                    <IconMapPin className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    <span className="text-sm text-muted-foreground/40">
                      Add location
                    </span>
                  </div>
                )}
              </>
            ) : !isOverlay ? (
              <div
                className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-muted/50 rounded-md"
                onClick={() => {
                  setEditLocation(
                    locationIsMeetingLink ? "" : event.location || "",
                  );
                  setEditingField("location");
                }}
              >
                <IconMapPin className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                <span className="text-sm text-muted-foreground/40">
                  Add location
                </span>
              </div>
            ) : null}

            {/* Description — always shown for editable events; hidden for overlay events with no description */}
            {(!isOverlay || event.description) && (
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
                          Ask AI
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
            {!isOverlay && editingField === "reminders" ? (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="px-4 py-1.5">
                  <div className="mb-2 flex items-center gap-3">
                    <IconBell className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      Event alerts
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
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 text-xs"
                      onClick={handleSaveReminders}
                    >
                      Save
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
            ) : null}

            {/* Availability, visibility, and alerts */}
            {!isOverlay ? (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="px-4 py-1.5">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground">
                        Show as
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
                          <SelectItem value="opaque">Busy</SelectItem>
                          <SelectItem value="transparent">Free</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground">
                        Visibility
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
                          <SelectItem value="default">Default</SelectItem>
                          <SelectItem value="public">Public</SelectItem>
                          <SelectItem value="private">Private</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground">
                        Alerts
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
                          <SelectItem value="default">Default</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="0">At start</SelectItem>
                          <SelectItem value="10">10 min</SelectItem>
                          <SelectItem value="30">30 min</SelectItem>
                          <SelectItem value="60">1 hour</SelectItem>
                          <SelectItem value="1440">1 day</SelectItem>
                          <SelectItem value="custom">Custom...</SelectItem>
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
                    {event.transparency === "transparent" ? "Free" : "Busy"}
                    {event.visibility && event.visibility !== "default"
                      ? ` · ${event.visibility} visibility`
                      : ""}
                  </span>
                </div>
              </>
            ) : null}

            {/* Overlay person badge */}
            {event.overlayEmail && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="flex items-center gap-3 px-4 py-1.5">
                  <IconUser className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {event.overlayEmail}
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
                {isDraft ? "Discard" : "Delete"}
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
                    Google Calendar
                  </a>
                </Button>
              )}
              {isDraft && (
                <Button
                  size="sm"
                  className="ml-auto text-xs"
                  onClick={handleCreateDraft}
                >
                  {event.attendees?.length ? "Create and send" : "Create event"}
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
