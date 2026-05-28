import { useState, useEffect, useRef } from "react";
import { differenceInMinutes, format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
} from "@/components/ui/tooltip";
import { useCreateEvent, useDeleteEvent } from "@/hooks/use-events";
import { useSettings } from "@/hooks/use-settings";
import { useConnectZoom, useZoomStatus } from "@/hooks/use-zoom-auth";
import { setUndoAction } from "@/hooks/use-undo";
import { agentNativePath, sendToAgentChat } from "@agent-native/core/client";
import { toast } from "sonner";
import type { CalendarEventDraft } from "@shared/api";
import {
  AttendeeAutocomplete,
  type AttendeeAutocompleteHandle,
  type AttendeeRecipient,
} from "@/components/calendar/AttendeeAutocomplete";
import {
  IconCalendarTime,
  IconBrandZoom,
  IconChevronDown,
  IconMessage,
  IconPlus,
  IconSettings2,
  IconVideo,
  IconUsers,
} from "@tabler/icons-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TimezoneCombobox } from "@/components/TimezoneCombobox";
import {
  AttachmentControls,
  EventColorSwatches,
  ReminderControls,
} from "@/components/calendar/EventOptionControls";
import { FindTimeTakeover } from "@/components/calendar/FindTimePanel";
import {
  attachmentsToDrafts,
  buildReminderPayload,
  createAttachmentDraft,
  createReminderDraft,
  dateTimeInTimezoneToIso,
  getEventEndValidationMessage,
  getLocalTimezone,
  remindersToDraftState,
  type AttachmentDraft,
  type ReminderDraft,
  type ReminderMode,
  validateAttachmentDrafts,
} from "@/lib/event-form-utils";
import { getGoogleEventColorHex } from "@/lib/event-colors";
import { shortcutModifierLabel } from "@/lib/utils";

type VideoProvider = "none" | "google_meet" | "zoom";
type EventType = "default" | "outOfOffice" | "focusTime" | "workingLocation";
type Availability = "opaque" | "transparent";
type Visibility = "default" | "public" | "private" | "confidential";
type WorkingLocationType = "homeOffice" | "officeLocation" | "customLocation";

function addDaysToDateString(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return format(next, "yyyy-MM-dd");
}

function addMinutesToTimeString(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const mm = (total % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function uniqueAttendees(attendees: AttendeeRecipient[]) {
  const byEmail = new Map<string, AttendeeRecipient>();
  for (const attendee of attendees) {
    const email = attendee.email.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    byEmail.set(key, {
      email,
      displayName: existing?.displayName ?? attendee.displayName,
      photoUrl: existing?.photoUrl ?? attendee.photoUrl,
    });
  }
  return Array.from(byEmail.values());
}

function dateTimePartsInTimezone(value: string, timezone: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(parsed);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = values.get("year");
    const month = values.get("month");
    const day = values.get("day");
    const hour = values.get("hour");
    const minute = values.get("minute");
    if (!year || !month || !day || !hour || !minute) return null;
    return {
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}`,
    };
  } catch {
    return {
      date: format(parsed, "yyyy-MM-dd"),
      time: format(parsed, "HH:mm"),
    };
  }
}

function allDayEndDate(end: string | undefined, fallback: string) {
  if (!end) return fallback;
  const parsed = new Date(end);
  if (Number.isNaN(parsed.getTime())) return fallback;
  parsed.setDate(parsed.getDate() - 1);
  const value = format(parsed, "yyyy-MM-dd");
  return value < fallback ? fallback : value;
}

function safeDraftId(id: string | undefined): string | null {
  return id && /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

function deletePersistedDraft(id: string) {
  const safeId = safeDraftId(id);
  if (!safeId) return;
  fetch(
    agentNativePath(
      `/_agent-native/application-state/calendar-draft-${safeId}`,
    ),
    {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    },
  ).catch(() => {});
}

interface CreateEventPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: Date;
  defaultStartTime?: string;
  defaultEndTime?: string;
  draft?: CalendarEventDraft | null;
  onDraftChange?: (draft: CalendarEventDraft) => void;
  onDraftCreated?: (draftId: string) => void;
}

export function CreateEventPopover({
  open,
  onOpenChange,
  defaultDate,
  defaultStartTime: defaultStart,
  defaultEndTime: defaultEnd,
  draft,
  onDraftChange,
  onDraftCreated,
}: CreateEventPopoverProps) {
  const today = defaultDate || new Date();
  const defaultDateStr = format(today, "yyyy-MM-dd");
  const { data: settings } = useSettings();
  const rawDefaultDuration = settings?.defaultEventDuration ?? 30;
  const defaultDurationMinutes = Number.isFinite(rawDefaultDuration)
    ? Math.max(5, rawDefaultDuration)
    : 30;
  const defaultTimezone = settings?.timezone || getLocalTimezone();
  const fallbackStart = "09:00";
  const fallbackEnd = addMinutesToTimeString(
    fallbackStart,
    defaultDurationMinutes,
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(defaultDateStr);
  const [endDate, setEndDate] = useState(defaultDateStr);
  const [startTime, setStartTime] = useState(defaultStart || fallbackStart);
  const [endTime, setEndTime] = useState(defaultEnd || fallbackEnd);
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [eventType, setEventType] = useState<EventType>("default");
  const [availability, setAvailability] = useState<Availability>("opaque");
  const [visibility, setVisibility] = useState<Visibility>("default");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [colorId, setColorId] = useState<string | undefined>();
  const [reminderMode, setReminderMode] = useState<ReminderMode>("default");
  const [reminders, setReminders] = useState<ReminderDraft[]>(() => [
    createReminderDraft(),
  ]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>(() => [
    createAttachmentDraft(),
  ]);
  const [workingLocationType, setWorkingLocationType] =
    useState<WorkingLocationType>("customLocation");
  const [videoProvider, setVideoProvider] = useState<VideoProvider>("none");
  const [attendees, setAttendees] = useState<AttendeeRecipient[]>([]);
  const [findTimeOpen, setFindTimeOpen] = useState(false);
  const timedOnlyStatus =
    eventType === "outOfOffice" || eventType === "focusTime";

  const createEvent = useCreateEvent();
  const delEvent = useDeleteEvent();
  const zoomStatus = useZoomStatus();
  const connectZoom = useConnectZoom();
  const formRef = useRef<HTMLFormElement>(null);
  const attendeeAutocompleteRef = useRef<AttendeeAutocompleteHandle>(null);
  const initializedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedKeyRef.current = null;
      return;
    }

    const nextDate = format(defaultDate || new Date(), "yyyy-MM-dd");
    const draftTimezone =
      draft?.startTimeZone || draft?.endTimeZone || defaultTimezone;
    const initKey = draft?.id
      ? `draft:${draft.id}:${draftTimezone}`
      : `new:${nextDate}:${defaultStart || fallbackStart}:${defaultEnd || fallbackEnd}:${defaultTimezone}`;
    if (initializedKeyRef.current === initKey) return;
    initializedKeyRef.current = initKey;

    if (draft) {
      const startParts = draft.start
        ? dateTimePartsInTimezone(draft.start, draftTimezone)
        : null;
      const endParts = draft.end
        ? dateTimePartsInTimezone(draft.end, draft.endTimeZone || draftTimezone)
        : null;
      const reminderState = remindersToDraftState({
        reminders: draft.reminders,
        remindersUseDefault: draft.remindersUseDefault,
      });

      setTitle(draft.title || "");
      setDescription(draft.description || "");
      setDate(startParts?.date || nextDate);
      setEndDate(
        draft.allDay
          ? allDayEndDate(draft.end, startParts?.date || nextDate)
          : endParts?.date || startParts?.date || nextDate,
      );
      setStartTime(startParts?.time || defaultStart || fallbackStart);
      setEndTime(endParts?.time || defaultEnd || fallbackEnd);
      setLocation(draft.location || draft.workingLocationLabel || "");
      setAllDay(draft.allDay ?? false);
      setEventType(draft.eventType ?? "default");
      setAvailability(draft.transparency ?? "opaque");
      setVisibility(draft.visibility ?? "default");
      setTimezone(draftTimezone);
      setColorId(draft.colorId);
      setReminderMode(reminderState.mode);
      setReminders(reminderState.reminders);
      setAttachments(attachmentsToDrafts(draft.attachments));
      setWorkingLocationType(draft.workingLocationType ?? "customLocation");
      setVideoProvider(
        draft.addGoogleMeet ? "google_meet" : draft.addZoom ? "zoom" : "none",
      );
      setAttendees(
        uniqueAttendees(
          (draft.attendees ?? []).map((attendee) => ({
            email: attendee.email,
            displayName: attendee.displayName,
            photoUrl: attendee.photoUrl,
          })),
        ),
      );
      return;
    }

    setTitle("");
    setDescription("");
    setDate(nextDate);
    setEndDate(nextDate);
    setStartTime(defaultStart || fallbackStart);
    setEndTime(defaultEnd || fallbackEnd);
    setLocation("");
    setAllDay(false);
    setEventType("default");
    setAvailability("opaque");
    setVisibility("default");
    setTimezone(defaultTimezone);
    setColorId(undefined);
    setReminderMode("default");
    setReminders([createReminderDraft()]);
    setAttachments([createAttachmentDraft()]);
    setWorkingLocationType("customLocation");
    setVideoProvider("none");
    setAttendees([]);
  }, [
    open,
    draft,
    defaultDate,
    defaultStart,
    defaultEnd,
    fallbackStart,
    fallbackEnd,
    defaultTimezone,
  ]);

  useEffect(() => {
    if (!open) setFindTimeOpen(false);
  }, [open]);

  useEffect(() => {
    const draftId = safeDraftId(draft?.id);
    if (!open || !draftId) return;

    const effectiveAllDay = allDay && !timedOnlyStatus;
    if (!date || !endDate || (!effectiveAllDay && (!startTime || !endTime))) {
      return;
    }
    const allDayEnd = new Date(`${endDate}T00:00:00`);
    allDayEnd.setDate(allDayEnd.getDate() + 1);
    const startISO = effectiveAllDay
      ? new Date(`${date}T00:00:00`).toISOString()
      : dateTimeInTimezoneToIso(date, startTime, timezone);
    const endISO = effectiveAllDay
      ? allDayEnd.toISOString()
      : dateTimeInTimezoneToIso(endDate, endTime, timezone);
    const attachmentResult = validateAttachmentDrafts(attachments);
    const reminderPatch = buildReminderPayload(reminderMode, reminders);
    const nextDraft: CalendarEventDraft = {
      id: draftId,
      createdAt: draft?.createdAt,
      title,
      description,
      start: startISO,
      end: endISO,
      startTimeZone: effectiveAllDay ? undefined : timezone,
      endTimeZone: effectiveAllDay ? undefined : timezone,
      location,
      allDay: effectiveAllDay,
      eventType,
      transparency:
        eventType === "workingLocation"
          ? "transparent"
          : eventType === "default"
            ? availability
            : "opaque",
      visibility: eventType === "workingLocation" ? "public" : visibility,
      ...reminderPatch,
      colorId,
      attachments:
        attachmentResult.error || attachmentResult.attachments.length === 0
          ? undefined
          : attachmentResult.attachments,
      attendees:
        attendees.length > 0
          ? attendees.map((attendee) => ({
              email: attendee.email,
              displayName: attendee.displayName,
            }))
          : undefined,
      addGoogleMeet: videoProvider === "google_meet",
      addZoom: videoProvider === "zoom",
      accountEmail: draft?.accountEmail,
      workingLocationType,
      workingLocationLabel:
        workingLocationType === "customLocation" ? location : undefined,
      updatedAt: new Date().toISOString(),
    };

    onDraftChange?.(nextDraft);
    const timeout = window.setTimeout(() => {
      fetch(
        agentNativePath(
          `/_agent-native/application-state/calendar-draft-${draftId}`,
        ),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextDraft),
        },
      ).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [
    open,
    draft?.id,
    draft?.createdAt,
    draft?.accountEmail,
    title,
    description,
    date,
    endDate,
    startTime,
    endTime,
    location,
    allDay,
    eventType,
    availability,
    visibility,
    timezone,
    colorId,
    reminderMode,
    reminders,
    attachments,
    attendees,
    videoProvider,
    workingLocationType,
    timedOnlyStatus,
    onDraftChange,
  ]);

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    setEndDate((current) => (current < nextDate ? nextDate : current));
  }

  function handleDraftDescription() {
    sendToAgentChat({
      message: `Draft a concise calendar event description for "${title || "Untitled event"}".`,
      context: `New event draft:
Title: ${title || "(not set)"}
Date: ${date}${endDate !== date ? ` to ${endDate}` : ""}
Time: ${allDay ? "All day" : `${startTime} to ${endTime}`}
Timezone: ${timezone}
Location: ${location || "(none)"}
Attendees: ${attendees.map((attendee) => attendee.email).join(", ") || "(none)"}
Current description: ${description || "(empty)"}

Write a short, useful meeting description. Keep it paste-ready and avoid adding facts that are not in the draft.`,
      submit: true,
    });
  }

  useEffect(() => {
    if (timedOnlyStatus && allDay) setAllDay(false);
    if (eventType === "workingLocation") {
      setAvailability("transparent");
      setVisibility("public");
    }
  }, [allDay, eventType, timedOnlyStatus]);

  function addAttendee(attendee: AttendeeRecipient) {
    setAttendees((prev) => uniqueAttendees([...prev, attendee]));
  }

  function removeAttendee(email: string) {
    setAttendees((prev) =>
      prev.filter(
        (attendee) => attendee.email.toLowerCase() !== email.toLowerCase(),
      ),
    );
  }

  const effectiveAllDay = allDay && !timedOnlyStatus;
  const currentStartISO =
    !effectiveAllDay && date && startTime
      ? dateTimeInTimezoneToIso(date, startTime, timezone)
      : undefined;
  const currentEndISO =
    !effectiveAllDay && endDate && endTime
      ? dateTimeInTimezoneToIso(endDate, endTime, timezone)
      : undefined;
  const findTimeDurationMinutes =
    currentStartISO && currentEndISO
      ? Math.max(
          5,
          differenceInMinutes(
            new Date(currentEndISO),
            new Date(currentStartISO),
          ),
        )
      : defaultDurationMinutes;

  function handleSelectFindTimeSlot(slot: { start: string; end: string }) {
    const startParts = dateTimePartsInTimezone(slot.start, timezone);
    const endParts = dateTimePartsInTimezone(slot.end, timezone);
    if (!startParts || !endParts) return;
    setAllDay(false);
    setDate(startParts.date);
    setEndDate(endParts.date);
    setStartTime(startParts.time);
    setEndTime(endParts.time);
    setFindTimeOpen(false);
    toast("Time selected");
  }

  // ⌘+Enter to submit
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (findTimeOpen) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findTimeOpen, open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const activeDraftId = safeDraftId(draft?.id);
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    const effectiveAllDay = allDay && !timedOnlyStatus;
    const allDayEnd = new Date(`${endDate}T00:00:00`);
    allDayEnd.setDate(allDayEnd.getDate() + 1);
    const startISO = effectiveAllDay
      ? new Date(`${date}T00:00:00`).toISOString()
      : dateTimeInTimezoneToIso(date, startTime, timezone);
    const endISO = effectiveAllDay
      ? allDayEnd.toISOString()
      : dateTimeInTimezoneToIso(endDate, endTime, timezone);

    if (new Date(endISO).getTime() <= new Date(startISO).getTime()) {
      toast.error(
        getEventEndValidationMessage({
          allDay: effectiveAllDay,
          startDate: date,
          endDate,
          startTime,
          endTime,
        }),
      );
      return;
    }
    const attachmentResult = validateAttachmentDrafts(attachments);
    if (attachmentResult.error) {
      toast.error(attachmentResult.error);
      return;
    }

    // Pick up any unsubmitted typed email so users do not lose the final entry.
    const trailingAttendees =
      attendeeAutocompleteRef.current?.commitPending() ?? [];
    const finalAttendees = uniqueAttendees([
      ...attendees,
      ...trailingAttendees,
    ]);
    const reminderPatch = buildReminderPayload(reminderMode, reminders);
    const statusPatch =
      eventType === "default"
        ? {}
        : {
            eventType,
            workingLocationType,
            workingLocationLabel:
              workingLocationType === "customLocation" ? location : undefined,
          };

    createEvent.mutate(
      {
        title: title.trim(),
        description,
        start: startISO,
        end: endISO,
        startTimeZone: effectiveAllDay ? undefined : timezone,
        endTimeZone: effectiveAllDay ? undefined : timezone,
        location,
        accountEmail: draft?.accountEmail,
        allDay: effectiveAllDay,
        transparency:
          eventType === "workingLocation"
            ? "transparent"
            : eventType === "default"
              ? availability
              : "opaque",
        visibility: eventType === "workingLocation" ? "public" : visibility,
        ...reminderPatch,
        ...statusPatch,
        addGoogleMeet: videoProvider === "google_meet",
        addZoom: videoProvider === "zoom",
        color: colorId ? getGoogleEventColorHex(colorId) : undefined,
        colorId,
        attachments:
          attachmentResult.attachments.length > 0
            ? attachmentResult.attachments
            : undefined,
        attendees:
          finalAttendees.length > 0
            ? finalAttendees.map((attendee) => ({
                email: attendee.email,
                displayName: attendee.displayName,
              }))
            : undefined,
      },
      {
        onSuccess: (result) => {
          if (activeDraftId) {
            deletePersistedDraft(activeDraftId);
            onDraftCreated?.(activeDraftId);
          }
          onOpenChange(false);
          const eventId = result?.id;
          const undo = eventId
            ? () => {
                delEvent.mutate({
                  id: eventId,
                  scope: "single",
                  sendUpdates: "none",
                });
              }
            : undefined;
          if (undo) setUndoAction(undo);
          toast("Event created", {
            action: undo ? { label: "Undo", onClick: undo } : undefined,
          });
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : "Failed to create event",
          ),
      },
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" className="ml-1 h-7 gap-1.5 px-2.5 text-xs">
          <IconPlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New Event</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="max-h-[var(--radix-popover-content-available-height)] w-[calc(100vw-2rem)] overflow-y-auto p-4 sm:w-80"
        onInteractOutside={(event) => {
          if (findTimeOpen) {
            event.preventDefault();
            return;
          }
          const target = event.target as HTMLElement;
          if (target.closest("[data-attendee-autocomplete]")) {
            event.preventDefault();
          }
        }}
      >
        <div className="mb-3 text-sm font-semibold">
          {draft ? "Review Invite" : "New Event"}
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-title" className="text-xs">
                Title
              </Label>
              <Input
                id="event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Event title"
                autoFocus
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-type" className="text-xs">
                Type
              </Label>
              <Select
                value={eventType}
                onValueChange={(value) => setEventType(value as EventType)}
              >
                <SelectTrigger id="event-type" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Event</SelectItem>
                  <SelectItem value="outOfOffice">Out of office</SelectItem>
                  <SelectItem value="focusTime">Focus time</SelectItem>
                  <SelectItem value="workingLocation">
                    Working location
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {eventType === "workingLocation" && (
              <div className="space-y-1.5">
                <Label htmlFor="working-location-type" className="text-xs">
                  Working from
                </Label>
                <Select
                  value={workingLocationType}
                  onValueChange={(value) =>
                    setWorkingLocationType(value as WorkingLocationType)
                  }
                >
                  <SelectTrigger
                    id="working-location-type"
                    className="h-8 text-sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="homeOffice">Home</SelectItem>
                    <SelectItem value="officeLocation">Office</SelectItem>
                    <SelectItem value="customLocation">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="event-description" className="text-xs">
                  Description
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                  onClick={handleDraftDescription}
                >
                  <IconMessage className="h-3 w-3" />
                  Ask AI
                </Button>
              </div>
              <Textarea
                id="event-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                rows={2}
                className="text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="event-date" className="text-xs">
                  Start date
                </Label>
                <Input
                  id="event-date"
                  type="date"
                  value={date}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-end-date" className="text-xs">
                  End date
                </Label>
                <Input
                  id="event-end-date"
                  type="date"
                  min={date}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value || date)}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {timedOnlyStatus ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex w-fit items-center gap-2">
                    <Switch
                      id="all-day"
                      checked={false}
                      onCheckedChange={setAllDay}
                      disabled
                    />
                    <Label
                      htmlFor="all-day"
                      className="text-xs text-muted-foreground"
                    >
                      All day
                    </Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {eventType === "outOfOffice"
                    ? "Out of office events must have a specific start and end time."
                    : "Focus time events must have a specific start and end time."}
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-2">
                <Switch
                  id="all-day"
                  checked={allDay}
                  onCheckedChange={setAllDay}
                />
                <Label htmlFor="all-day" className="text-xs">
                  All day
                </Label>
              </div>
            )}

            {!allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start-time" className="text-xs">
                    Start
                  </Label>
                  <Input
                    id="start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end-time" className="text-xs">
                    End
                  </Label>
                  <Input
                    id="end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => {
                      const next = e.target.value;
                      setEndTime(next);
                      if (endDate === date && next <= startTime) {
                        setEndDate(addDaysToDateString(date, 1));
                      }
                    }}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            )}

            {!effectiveAllDay && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full justify-center gap-1.5 text-xs"
                onClick={() => setFindTimeOpen(true)}
              >
                <IconCalendarTime className="h-3.5 w-3.5" />
                Find a time
              </Button>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="event-attendees" className="text-xs">
                Attendees
              </Label>
              <AttendeeAutocomplete
                ref={attendeeAutocompleteRef}
                attendees={attendees}
                onAdd={addAttendee}
                onRemove={removeAttendee}
                inputId="event-attendees"
                placeholder="Search contacts or type an email"
              />
              {attendees.length > 0 && (
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <IconUsers className="h-3 w-3" />
                  {attendees.length} invited — Google will email them when you
                  create
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-location" className="text-xs">
                Location
              </Label>
              <Input
                id="event-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Optional location"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-video-provider" className="text-xs">
                Video
              </Label>
              <Select
                value={videoProvider}
                onValueChange={(value) =>
                  setVideoProvider(value as VideoProvider)
                }
              >
                <SelectTrigger
                  id="event-video-provider"
                  className="h-8 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No video</SelectItem>
                  <SelectItem value="google_meet">
                    <span className="flex items-center gap-2">
                      <IconVideo className="h-3.5 w-3.5" />
                      Google Meet
                    </span>
                  </SelectItem>
                  <SelectItem value="zoom">
                    <span className="flex items-center gap-2">
                      <IconBrandZoom className="h-3.5 w-3.5" />
                      Zoom
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {videoProvider === "zoom" && !zoomStatus.data?.connected && (
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {zoomStatus.data?.configured === false
                        ? "Zoom OAuth is not configured."
                        : "Connect Zoom before creating this event."}
                    </p>
                    {zoomStatus.data?.configured !== false && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 gap-1.5 text-xs"
                        disabled={connectZoom.isPending}
                        onClick={() =>
                          connectZoom.mutate(undefined, {
                            onSuccess: () => toast("Zoom connection opened"),
                            onError: (error) =>
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Could not connect Zoom",
                              ),
                          })
                        }
                      >
                        <IconBrandZoom className="h-3.5 w-3.5" />
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full justify-between px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <IconSettings2 className="h-3.5 w-3.5" />
                    Event options
                  </span>
                  <IconChevronDown className="h-3.5 w-3.5" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="event-availability" className="text-xs">
                      Show as
                    </Label>
                    <Select
                      value={
                        eventType === "workingLocation"
                          ? "transparent"
                          : eventType === "default"
                            ? availability
                            : "opaque"
                      }
                      onValueChange={(value) =>
                        setAvailability(value as Availability)
                      }
                      disabled={eventType !== "default"}
                    >
                      <SelectTrigger
                        id="event-availability"
                        className="h-8 text-sm"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="opaque">Busy</SelectItem>
                        <SelectItem value="transparent">Free</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="event-visibility" className="text-xs">
                      Visibility
                    </Label>
                    <Select
                      value={
                        eventType === "workingLocation" ? "public" : visibility
                      }
                      onValueChange={(value) =>
                        setVisibility(value as Visibility)
                      }
                      disabled={eventType === "workingLocation"}
                    >
                      <SelectTrigger
                        id="event-visibility"
                        className="h-8 text-sm"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="public">Public</SelectItem>
                        <SelectItem value="private">Private</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {!allDay && (
                  <div className="space-y-1.5">
                    <Label htmlFor="event-timezone" className="text-xs">
                      Timezone
                    </Label>
                    <TimezoneCombobox
                      id="event-timezone"
                      value={timezone}
                      onChange={setTimezone}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Color</Label>
                  <EventColorSwatches
                    value={colorId}
                    onChange={setColorId}
                    includeDefault
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Alerts</Label>
                  <ReminderControls
                    idPrefix="event"
                    mode={reminderMode}
                    reminders={reminders}
                    onModeChange={setReminderMode}
                    onRemindersChange={setReminders}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Attachments</Label>
                  <AttachmentControls
                    idPrefix="event"
                    attachments={attachments}
                    onChange={setAttachments}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <FindTimeTakeover
            open={findTimeOpen}
            onOpenChange={setFindTimeOpen}
            title="Find a time"
            subtitle={title.trim() || (draft ? "Invite" : "New event")}
            date={date}
            timezone={timezone}
            durationMinutes={findTimeDurationMinutes}
            attendees={attendees}
            accountEmail={draft?.accountEmail}
            selectedStart={currentStartISO}
            selectedEnd={currentEndISO}
            onSelectSlot={handleSelectFindTimeSlot}
            onAddAttendee={addAttendee}
            onRemoveAttendee={removeAttendee}
          />

          <div className="flex items-center justify-between pt-1">
            <p className="text-[10px] text-muted-foreground/60">
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
                {shortcutModifierLabel()}+↵
              </kbd>{" "}
              to save
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-7 text-xs"
                disabled={
                  createEvent.isPending ||
                  (videoProvider === "zoom" && !zoomStatus.data?.connected)
                }
              >
                {createEvent.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
