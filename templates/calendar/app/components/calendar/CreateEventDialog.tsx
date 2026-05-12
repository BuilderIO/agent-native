import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
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
import { sendToAgentChat } from "@agent-native/core/client";
import { toast } from "sonner";
import {
  AttendeeAutocomplete,
  type AttendeeAutocompleteHandle,
  type AttendeeRecipient,
} from "@/components/calendar/AttendeeAutocomplete";
import {
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
import {
  buildReminderPayload,
  createAttachmentDraft,
  createReminderDraft,
  dateTimeInTimezoneToIso,
  getEventEndValidationMessage,
  getLocalTimezone,
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

interface CreateEventPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: Date;
  defaultStartTime?: string;
  defaultEndTime?: string;
}

export function CreateEventPopover({
  open,
  onOpenChange,
  defaultDate,
  defaultStartTime: defaultStart,
  defaultEndTime: defaultEnd,
}: CreateEventPopoverProps) {
  const today = defaultDate || new Date();
  const defaultDateStr = format(today, "yyyy-MM-dd");
  const { data: settings } = useSettings();
  const defaultDurationMinutes = settings?.defaultEventDuration ?? 60;
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
  const [timezone, setTimezone] = useState(getLocalTimezone());
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
  const timedOnlyStatus =
    eventType === "outOfOffice" || eventType === "focusTime";

  const createEvent = useCreateEvent();
  const delEvent = useDeleteEvent();
  const zoomStatus = useZoomStatus();
  const connectZoom = useConnectZoom();
  const formRef = useRef<HTMLFormElement>(null);
  const attendeeAutocompleteRef = useRef<AttendeeAutocompleteHandle>(null);

  // Reset form when popover opens
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      const nextDate = format(defaultDate || new Date(), "yyyy-MM-dd");
      setDate(nextDate);
      setEndDate(nextDate);
      setStartTime(defaultStart || fallbackStart);
      setEndTime(defaultEnd || fallbackEnd);
      setLocation("");
      setAllDay(false);
      setEventType("default");
      setAvailability("opaque");
      setVisibility("default");
      setTimezone(getLocalTimezone());
      setColorId(undefined);
      setReminderMode("default");
      setReminders([createReminderDraft()]);
      setAttachments([createAttachmentDraft()]);
      setWorkingLocationType("customLocation");
      setVideoProvider("none");
      setAttendees([]);
    }
  }, [open, defaultDate, defaultStart, defaultEnd, fallbackStart, fallbackEnd]);

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

  // ⌘+Enter to submit
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
          const target = event.target as HTMLElement;
          if (target.closest("[data-attendee-autocomplete]")) {
            event.preventDefault();
          }
        }}
      >
        <div className="mb-3 text-sm font-semibold">New Event</div>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
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
              <SelectTrigger id="event-video-provider" className="h-8 text-sm">
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
