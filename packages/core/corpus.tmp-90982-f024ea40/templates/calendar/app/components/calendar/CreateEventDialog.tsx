import {
  agentNativePath,
  sendToAgentChat,
  useT,
} from "@agent-native/core/client";
import type { CalendarEventDraft } from "@shared/api";
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
import { differenceInMinutes, format } from "date-fns";
import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import {
  AttendeeAutocomplete,
  type AttendeeAutocompleteHandle,
  type AttendeeRecipient,
} from "@/components/calendar/AttendeeAutocomplete";
import {
  AttachmentControls,
  EventColorSwatches,
  ReminderControls,
} from "@/components/calendar/EventOptionControls";
import { FindTimeTakeover } from "@/components/calendar/FindTimePanel";
import { TimezoneCombobox } from "@/components/TimezoneCombobox";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCreateEvent, useDeleteEvent } from "@/hooks/use-events";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { useSettings } from "@/hooks/use-settings";
import { setUndoAction } from "@/hooks/use-undo";
import { useViewPreferences } from "@/hooks/use-view-preferences";
import { useConnectZoom, useZoomStatus } from "@/hooks/use-zoom-auth";
import { defaultColorForAccount } from "@/lib/calendar-view-preferences";
import {
  reconcileEventAccountEmail,
  shouldShowEventAccountSelector,
} from "@/lib/event-account-selection";
import { getGoogleEventColorHex } from "@/lib/event-colors";
import { buildEventFormInitializationKey } from "@/lib/event-form-initialization";
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
import { buildDeleteEventMutationInput } from "@/lib/event-mutation-inputs";

type VideoProvider = "none" | "google_meet" | "zoom";
type EventType = "default" | "outOfOffice" | "focusTime" | "workingLocation";
type Availability = "opaque" | "transparent";
type Visibility = "default" | "public" | "private" | "confidential";
type WorkingLocationType = "homeOffice" | "officeLocation" | "customLocation";

const EMPTY_CONNECTED_ACCOUNTS: Array<{ email: string }> = [];

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
      optional:
        attendee.optional === true
          ? true
          : existing?.optional === true
            ? true
            : undefined,
    });
  }
  return Array.from(byEmail.values());
}

function buildVideoProviderPatch(
  provider: VideoProvider,
  explicitChoice: boolean,
): { addGoogleMeet?: boolean; addZoom?: boolean } {
  if (provider === "google_meet")
    return { addGoogleMeet: true, addZoom: false };
  if (provider === "zoom") return { addGoogleMeet: false, addZoom: true };
  return explicitChoice ? { addGoogleMeet: false, addZoom: false } : {};
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
  const t = useT();
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
  const [videoProviderTouched, setVideoProviderTouched] = useState(false);
  const [attendees, setAttendees] = useState<AttendeeRecipient[]>([]);
  const [accountEmail, setAccountEmail] = useState<string>();
  const [findTimeOpen, setFindTimeOpen] = useState(false);
  const timedOnlyStatus =
    eventType === "outOfOffice" || eventType === "focusTime";

  const createEvent = useCreateEvent();
  const delEvent = useDeleteEvent();
  const googleStatus = useGoogleAuthStatus();
  const connectedAccounts =
    googleStatus.data?.accounts ?? EMPTY_CONNECTED_ACCOUNTS;
  const connectedAccountEmails = useMemo(
    () => connectedAccounts.map((account) => account.email),
    [connectedAccounts],
  );
  const { prefs: viewPrefs } = useViewPreferences();
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
    const initKey = buildEventFormInitializationKey({
      draftId: draft?.id,
      draftTimezone,
      date: nextDate,
      startTime: defaultStart || fallbackStart,
      endTime: defaultEnd || fallbackEnd,
      defaultTimezone,
    });
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
      setVideoProviderTouched(
        draft.addGoogleMeet !== undefined || draft.addZoom !== undefined,
      );
      setAttendees(
        uniqueAttendees(
          (draft.attendees ?? []).map((attendee) => ({
            email: attendee.email,
            displayName: attendee.displayName,
            photoUrl: attendee.photoUrl,
            optional: attendee.optional === true ? true : undefined,
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
    setVideoProviderTouched(false);
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
    if (!open) {
      setAccountEmail(undefined);
      return;
    }

    setAccountEmail((currentAccountEmail) =>
      reconcileEventAccountEmail(
        connectedAccounts,
        currentAccountEmail,
        draft?.accountEmail,
      ),
    );
  }, [open, connectedAccounts, draft?.accountEmail]);

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
        attachmentResult.error ||
        (attachmentResult.attachments?.length ?? 0) === 0
          ? undefined
          : attachmentResult.attachments,
      attendees:
        attendees.length > 0
          ? attendees.map((attendee) => ({
              email: attendee.email,
              displayName: attendee.displayName,
              ...(attendee.optional === true ? { optional: true } : {}),
            }))
          : undefined,
      ...buildVideoProviderPatch(videoProvider, videoProviderTouched),
      accountEmail,
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
    accountEmail,
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
    videoProviderTouched,
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
      message: t("eventForm.ai.descriptionMessage", {
        title: title || t("eventForm.ai.untitledEvent"),
      }),
      context: t("eventForm.ai.descriptionContext", {
        title: title || t("eventForm.ai.notSet"),
        date,
        endDate: endDate !== date ? t("eventForm.ai.toDate", { endDate }) : "",
        time: allDay
          ? t("eventForm.allDay")
          : t("eventForm.ai.timeRange", { startTime, endTime }),
        timezone,
        location: location || t("eventForm.ai.none"),
        attendees:
          attendees.map((attendee) => attendee.email).join(", ") ||
          t("eventForm.ai.none"),
        description: description || t("eventForm.ai.empty"),
      }),
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

  function toggleAttendeeOptional(email: string, optional: boolean) {
    setAttendees((prev) =>
      prev.map((attendee) =>
        attendee.email.toLowerCase() === email.toLowerCase()
          ? {
              ...attendee,
              optional: optional ? true : undefined,
            }
          : attendee,
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
    toast(t("eventForm.timeSelected"));
  }

  // Keep the global shortcut for long-form fields while regular inputs submit
  // through the form-level Enter handler below.
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

  function handleFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter" || e.defaultPrevented || e.nativeEvent.isComposing) {
      return;
    }

    if (!(e.target instanceof HTMLInputElement)) return;

    e.preventDefault();
    formRef.current?.requestSubmit();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const activeDraftId = safeDraftId(draft?.id);
    if (!title.trim()) {
      toast.error(t("eventForm.titleRequired"));
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

    const payload: Parameters<typeof createEvent.mutate>[0] = {
      title: title.trim(),
      description,
      start: startISO,
      end: endISO,
      startTimeZone: effectiveAllDay ? undefined : timezone,
      endTimeZone: effectiveAllDay ? undefined : timezone,
      location,
      accountEmail,
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
      color: colorId ? getGoogleEventColorHex(colorId) : undefined,
      colorId,
      attachments:
        (attachmentResult.attachments?.length ?? 0) > 0
          ? attachmentResult.attachments
          : undefined,
      attendees:
        finalAttendees.length > 0
          ? finalAttendees.map((attendee) => ({
              email: attendee.email,
              displayName: attendee.displayName,
              ...(attendee.optional === true ? { optional: true } : {}),
            }))
          : undefined,
      ...buildVideoProviderPatch(videoProvider, videoProviderTouched),
    };

    onOpenChange(false);
    createEvent.mutate(payload, {
      onSuccess: (result) => {
        if (activeDraftId) {
          deletePersistedDraft(activeDraftId);
          onDraftCreated?.(activeDraftId);
        }
        const eventId = result?.id;
        const undo = eventId
          ? () => {
              delEvent.mutate(
                buildDeleteEventMutationInput(
                  {
                    id: eventId,
                    accountEmail: result.accountEmail ?? accountEmail,
                  },
                  { scope: "single", sendUpdates: "none" },
                ),
              );
            }
          : undefined;
        if (undo) setUndoAction(undo);
      },
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : t("eventForm.createFailed"),
        ),
    });
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" className="ml-1 h-7 gap-1.5 px-2.5 text-xs">
          <IconPlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("eventForm.newEvent")}</span>
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
          {draft ? t("eventForm.reviewInvite") : t("eventForm.newEvent")}
        </div>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
          className="space-y-3"
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-title" className="text-xs">
                {t("eventForm.title")}
              </Label>
              <Input
                id="event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("eventForm.eventTitlePlaceholder")}
                autoFocus
                className="h-8 text-sm"
              />
            </div>

            {shouldShowEventAccountSelector(connectedAccounts) &&
              accountEmail && (
                <div className="space-y-1.5">
                  <Label htmlFor="event-calendar" className="text-xs">
                    {t("navigation.calendar")}
                  </Label>
                  <Select value={accountEmail} onValueChange={setAccountEmail}>
                    <SelectTrigger
                      id="event-calendar"
                      aria-label={t("navigation.calendar")}
                      className="h-8 text-sm"
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
              )}

            <div className="space-y-1.5">
              <Label htmlFor="event-type" className="text-xs">
                {t("eventForm.type")}
              </Label>
              <Select
                value={eventType}
                onValueChange={(value) => setEventType(value as EventType)}
              >
                <SelectTrigger id="event-type" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    {t("eventForm.event")}
                  </SelectItem>
                  <SelectItem value="outOfOffice">
                    {t("eventForm.outOfOffice")}
                  </SelectItem>
                  <SelectItem value="focusTime">
                    {t("eventForm.focusTime")}
                  </SelectItem>
                  <SelectItem value="workingLocation">
                    {t("eventForm.workingLocation")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {eventType === "workingLocation" && (
              <div className="space-y-1.5">
                <Label htmlFor="working-location-type" className="text-xs">
                  {t("eventForm.workingFrom")}
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
                    <SelectItem value="homeOffice">
                      {t("eventForm.home")}
                    </SelectItem>
                    <SelectItem value="officeLocation">
                      {t("eventForm.office")}
                    </SelectItem>
                    <SelectItem value="customLocation">
                      {t("eventForm.custom")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="event-description" className="text-xs">
                  {t("eventForm.description")}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                  onClick={handleDraftDescription}
                >
                  <IconMessage className="h-3 w-3" />
                  {t("eventForm.askAi")}
                </Button>
              </div>
              <Textarea
                id="event-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("eventForm.optionalDescription")}
                rows={2}
                className="text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="event-date" className="text-xs">
                  {t("eventForm.startDate")}
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
                  {t("eventForm.endDate")}
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
                      {t("eventForm.allDay")}
                    </Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {eventType === "outOfOffice"
                    ? t("eventForm.outOfOfficeTimedOnly")
                    : t("eventForm.focusTimeTimedOnly")}
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
                  {t("eventForm.allDay")}
                </Label>
              </div>
            )}

            {!allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start-time" className="text-xs">
                    {t("eventForm.start")}
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
                    {t("eventForm.end")}
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
                {t("eventForm.findTime")}
              </Button>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="event-attendees" className="text-xs">
                {t("eventForm.attendees")}
              </Label>
              <AttendeeAutocomplete
                ref={attendeeAutocompleteRef}
                attendees={attendees}
                onAdd={addAttendee}
                onRemove={removeAttendee}
                onToggleOptional={toggleAttendeeOptional}
                inputId="event-attendees"
                placeholder={t("eventForm.attendeesPlaceholder")}
                onEmptyEnter={() => formRef.current?.requestSubmit()}
              />
              {attendees.length > 0 && (
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <IconUsers className="h-3 w-3" />
                  {t("eventForm.invitedNotice", { count: attendees.length })}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-location" className="text-xs">
                {t("eventForm.location")}
              </Label>
              <Input
                id="event-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t("eventForm.optionalLocation")}
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-video-provider" className="text-xs">
                {t("eventForm.video")}
              </Label>
              <Select
                value={videoProvider}
                onValueChange={(value) => {
                  setVideoProvider(value as VideoProvider);
                  setVideoProviderTouched(true);
                }}
              >
                <SelectTrigger
                  id="event-video-provider"
                  className="h-8 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("eventForm.noVideo")}</SelectItem>
                  <SelectItem value="google_meet">
                    <span className="flex items-center gap-2">
                      <IconVideo className="h-3.5 w-3.5" />
                      {t("eventForm.googleMeet")}
                    </span>
                  </SelectItem>
                  <SelectItem value="zoom">
                    <span className="flex items-center gap-2">
                      <IconBrandZoom className="h-3.5 w-3.5" />
                      {t("eventForm.zoom")}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {videoProvider === "zoom" && !zoomStatus.data?.connected && (
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {zoomStatus.data?.configured === false
                        ? t("eventForm.zoomNotConfigured")
                        : t("eventForm.connectZoomBeforeCreate")}
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
                            onSuccess: () =>
                              toast(t("eventForm.zoomConnectionOpened")),
                            onError: (error) =>
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : t("eventForm.zoomConnectFailed"),
                              ),
                          })
                        }
                      >
                        <IconBrandZoom className="h-3.5 w-3.5" />
                        {t("common.connect")}
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
                    {t("eventForm.eventOptions")}
                  </span>
                  <IconChevronDown className="h-3.5 w-3.5" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="event-availability" className="text-xs">
                      {t("eventForm.showAs")}
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
                        <SelectItem value="opaque">
                          {t("eventForm.busy")}
                        </SelectItem>
                        <SelectItem value="transparent">
                          {t("eventForm.free")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="event-visibility" className="text-xs">
                      {t("eventForm.visibility")}
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
                </div>

                {!allDay && (
                  <div className="space-y-1.5">
                    <Label htmlFor="event-timezone" className="text-xs">
                      {t("eventForm.timezone")}
                    </Label>
                    <TimezoneCombobox
                      id="event-timezone"
                      value={timezone}
                      onChange={setTimezone}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">{t("eventForm.color")}</Label>
                  <EventColorSwatches
                    value={colorId}
                    onChange={setColorId}
                    includeDefault
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">{t("eventForm.alerts")}</Label>
                  <ReminderControls
                    idPrefix="event"
                    mode={reminderMode}
                    reminders={reminders}
                    onModeChange={setReminderMode}
                    onRemindersChange={setReminders}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t("eventForm.attachments")}
                  </Label>
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
            title={t("eventForm.findTime")}
            subtitle={
              title.trim() ||
              (draft ? t("eventForm.invite") : t("eventForm.newEventLower"))
            }
            date={date}
            timezone={timezone}
            durationMinutes={findTimeDurationMinutes}
            attendees={attendees}
            accountEmail={accountEmail}
            selectedStart={currentStartISO}
            selectedEnd={currentEndISO}
            onSelectSlot={handleSelectFindTimeSlot}
            onAddAttendee={addAttendee}
            onRemoveAttendee={removeAttendee}
          />

          <div className="flex items-center justify-between pt-1">
            <p className="text-[10px] text-muted-foreground/60">
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
                ↵
              </kbd>{" "}
              {t("eventForm.toSave")}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onOpenChange(false)}
              >
                {t("eventForm.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-7 text-xs"
                disabled={
                  createEvent.isPending ||
                  !accountEmail ||
                  (videoProvider === "zoom" && !zoomStatus.data?.connected)
                }
              >
                {createEvent.isPending
                  ? t("eventForm.creating")
                  : t("eventForm.create")}
              </Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
