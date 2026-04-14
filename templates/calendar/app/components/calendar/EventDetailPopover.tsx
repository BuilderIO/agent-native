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
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import type { CalendarEvent } from "@shared/api";
import { ResearchMeetingButton } from "@/components/calendar/ApolloPanel";
import { EventAttendeesSection } from "@/components/calendar/EventAttendeesSection";
import { useCalendarContext } from "@/components/layout/AppLayout";
import { useUpdateEvent } from "@/hooks/use-events";
import {
  RenderedDescription,
  AutoGrowTextarea,
} from "@/components/calendar/EventDescription";

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

function formatReminderText(minutes: number): string {
  if (minutes < 60) return `${minutes}min before`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    return `${h}h before`;
  }
  const d = Math.floor(minutes / 1440);
  return `${d}d before`;
}

function formatRecurrence(recurrence?: string[]): string | null {
  if (!recurrence || recurrence.length === 0) return null;
  const rule = recurrence.find((r) => r.startsWith("RRULE:"));
  if (!rule) return null;

  const freq = rule.match(/FREQ=(\w+)/)?.[1];
  const interval = parseInt(rule.match(/INTERVAL=(\d+)/)?.[1] || "1", 10);
  const byDay = rule.match(/BYDAY=([^;]+)/)?.[1];

  const dayMap: Record<string, string> = {
    MO: "Mon",
    TU: "Tue",
    WE: "Wed",
    TH: "Thu",
    FR: "Fri",
    SA: "Sat",
    SU: "Sun",
  };

  switch (freq) {
    case "DAILY":
      return interval === 1 ? "Every day" : `Every ${interval} days`;
    case "WEEKLY": {
      const days = byDay
        ?.split(",")
        .map((d) => dayMap[d] || d)
        .join(", ");
      if (interval === 1) return days ? `Every week on ${days}` : "Every week";
      return days
        ? `Every ${interval} weeks on ${days}`
        : `Every ${interval} weeks`;
    }
    case "MONTHLY":
      return interval === 1 ? "Every month" : `Every ${interval} months`;
    case "YEARLY":
      return interval === 1 ? "Every year" : `Every ${interval} years`;
    default:
      return null;
  }
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

/** Convert ISO date string to local time input value (HH:mm) */
function toTimeInputValue(iso: string): string {
  const d = parseISO(iso);
  return format(d, "HH:mm");
}

interface EventDetailPopoverProps {
  event: CalendarEvent;
  children: React.ReactNode;
  onDelete: (eventId: string) => void;
  /** When true, the popover opens immediately and title is focused for editing */
  defaultOpen?: boolean;
  /** Called when the title is changed and should be persisted */
  onTitleSave?: (eventId: string, title: string) => void;
  /** Called when the popover is dismissed for a new event (to clean up if no title was set) */
  onDismissNew?: (eventId: string) => void;
}

export function EventDetailPopover({
  event,
  children,
  onDelete,
  defaultOpen = false,
  onTitleSave,
  onDismissNew,
}: EventDetailPopoverProps) {
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
  const [editStartTime, setEditStartTime] = useState(() =>
    toTimeInputValue(event.start),
  );
  const [editEndTime, setEditEndTime] = useState(() =>
    toTimeInputValue(event.end),
  );
  const [editAttendeeEmail, setEditAttendeeEmail] = useState("");
  const [editMeetingLink, setEditMeetingLink] = useState("");

  const updateEvent = useUpdateEvent();
  const locationRef = useRef<HTMLInputElement>(null);
  const attendeeRef = useRef<HTMLInputElement>(null);
  const meetingLinkRef = useRef<HTMLInputElement>(null);

  // Sync editing state when event changes
  useEffect(() => {
    setEditDescription(event.description || "");
    setEditLocation(event.location || "");
    setEditDate(toDateInputValue(event.start));
    setEditStartTime(toTimeInputValue(event.start));
    setEditEndTime(toTimeInputValue(event.end));
  }, [event.id, event.description, event.location, event.start, event.end]);

  // When defaultOpen changes to true (new event created), open the popover
  useEffect(() => {
    if (defaultOpen) {
      setOpen(true);
      setIsEditingTitle(true);
      isNewEventRef.current = true;
      setEditingTitle(event.title === "(No title)" ? "" : event.title);
    }
  }, [defaultOpen]);

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
      else if (editingField === "attendees") attendeeRef.current?.focus();
      else if (editingField === "meetingLink") meetingLinkRef.current?.focus();
    });
  }, [editingField]);

  const meetingLink = extractMeetingLink(event);

  // Save a field update
  const saveField = useCallback(
    (updates: Partial<CalendarEvent>) => {
      if (!event.id) return;
      updateEvent.mutate({
        id: event.id,
        accountEmail: event.accountEmail,
        ...updates,
      });
    },
    [event.id, event.accountEmail, updateEvent],
  );

  const handleSaveDescription = useCallback(() => {
    const trimmed = editDescription.trim();
    if (trimmed !== (event.description || "").trim()) {
      saveField({ description: trimmed });
    }
    setEditingField(null);
  }, [editDescription, event.description, saveField]);

  const handleSaveLocation = useCallback(() => {
    const trimmed = editLocation.trim();
    if (trimmed !== (event.location || "").trim()) {
      saveField({ location: trimmed });
    }
    setEditingField(null);
  }, [editLocation, event.location, saveField]);

  const handleSaveTime = useCallback(() => {
    const newStart = new Date(`${editDate}T${editStartTime}:00`).toISOString();
    const newEnd = new Date(`${editDate}T${editEndTime}:00`).toISOString();
    if (newStart !== event.start || newEnd !== event.end) {
      saveField({ start: newStart, end: newEnd, allDay: event.allDay });
    }
    setEditingField(null);
  }, [
    editDate,
    editStartTime,
    editEndTime,
    event.start,
    event.end,
    event.allDay,
    saveField,
  ]);

  const handleAddAttendee = useCallback(() => {
    const email = editAttendeeEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

    const existing = event.attendees || [];
    if (existing.some((a) => a.email.toLowerCase() === email)) {
      setEditAttendeeEmail("");
      return;
    }

    const newAttendees = [...existing, { email }];
    saveField({ attendees: newAttendees });
    setEditAttendeeEmail("");
  }, [editAttendeeEmail, event.attendees, saveField]);

  const handleRemoveAttendee = useCallback(
    (emailToRemove: string) => {
      const existing = event.attendees || [];
      const newAttendees = existing.filter(
        (a) => a.email.toLowerCase() !== emailToRemove.toLowerCase(),
      );
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
    if (eventDetailSidebar && !isNewEventRef.current) {
      setSidebarEvent(event);
    }
  }, [eventDetailSidebar, event, setSidebarEvent, setFocusedEvent]);

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
  const recurrenceText = formatRecurrence(event.recurrence);
  // Detect timezone from event start (offset-based)
  const startDate = parseISO(event.start);
  const offsetMinutes = -startDate.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const tzLabel = `GMT${offsetSign}${offsetHours}`;

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && open) {
        // Popover is closing — handle saves
        if (isEditingTitle) {
          const trimmed = editingTitle.trim();
          if (trimmed && trimmed !== "(No title)") {
            onTitleSave?.(event.id, trimmed);
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
    ],
  );

  const isOverlay = !!event.overlayEmail;

  return (
    <Popover
      open={eventDetailSidebar && !isNewEventRef.current ? false : open}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger asChild onClick={handleTriggerClick}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
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
          if (target.closest("[data-apollo-popover]")) {
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
              <span>Event</span>
              <IconChevronRight className="h-3 w-3" />
            </div>
            <div className="flex items-center gap-0.5">
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
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                    />
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
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => {
                          setEditDate(toDateInputValue(event.start));
                          setEditStartTime(toTimeInputValue(event.start));
                          setEditEndTime(toTimeInputValue(event.end));
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
                          {format(parseISO(event.start), "EEE MMM d")}
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
                          {format(parseISO(event.start), "EEE MMM d")}
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
              {recurrenceText && (
                <div className="flex items-center gap-3 py-1.5">
                  <IconRefresh className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {recurrenceText}
                  </span>
                </div>
              )}
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
                  <input
                    ref={attendeeRef}
                    value={editAttendeeEmail}
                    onChange={(e) => setEditAttendeeEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddAttendee();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEditAttendeeEmail("");
                        (e.target as HTMLInputElement).blur();
                      }
                      e.stopPropagation();
                    }}
                    placeholder="Add guests"
                    className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:ring-0"
                  />
                  {editAttendeeEmail.trim() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs shrink-0"
                      onClick={handleAddAttendee}
                    >
                      Add
                    </Button>
                  )}
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
                      <kbd className="text-xs font-normal">⌘</kbd>
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
                  <div
                    className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-muted/50 rounded-md mx-0"
                    onClick={() => setEditingField("meetingLink")}
                  >
                    <IconVideo className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    <span className="text-sm text-muted-foreground/40">
                      Add video conferencing
                    </span>
                  </div>
                )}
              </>
            ) : null}

            {/* Attachments */}
            {event.attachments && event.attachments.length > 0 && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
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
                </div>
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
                  <a
                    href={event.location}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline truncate block max-w-full"
                    title={event.location}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {event.location}
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {event.location}
                  </span>
                )}
              </div>
            ) : !isOverlay ? (
              <div
                className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-muted/50 rounded-md"
                onClick={() => setEditingField("location")}
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
                    {isOverlay ? (
                      event.description ? (
                        <RenderedDescription description={event.description} />
                      ) : null
                    ) : editingField === "description" || !event.description ? (
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
              </>
            )}

            {/* Reminders */}
            {event.reminders && event.reminders.length > 0 && (
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
            )}

            {/* Status / Visibility */}
            {(event.status || event.visibility) && (
              <>
                <div className="mx-4 my-2 border-t border-border/50" />
                <div className="flex items-center gap-3 px-4 py-1.5 text-sm text-muted-foreground">
                  <div className="h-4 w-4 shrink-0" />
                  <div className="flex items-center gap-2">
                    {event.status && event.status !== "cancelled" && (
                      <span>
                        {event.status === "confirmed" ? "Busy" : "Free"}
                      </span>
                    )}
                    {event.status &&
                      event.status !== "cancelled" &&
                      event.visibility &&
                      event.visibility !== "default" && (
                        <span className="text-muted-foreground/40">
                          &middot;
                        </span>
                      )}
                    {event.visibility && event.visibility !== "default" && (
                      <span className="capitalize">
                        {event.visibility} visibility
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

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
                  onDelete(event.id);
                  handleOpenChange(false);
                }}
              >
                Delete
              </Button>
            </div>
          )}
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
