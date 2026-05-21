import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  parseISO,
  startOfDay,
} from "date-fns";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { DayView } from "@/components/calendar/DayView";
import { CreateEventPopover } from "@/components/calendar/CreateEventDialog";
import { CommandPalette } from "@/components/calendar/CommandPalette";
import { GoogleConnectBanner } from "@/components/calendar/GoogleConnectBanner";
import { PeopleSearchDialog } from "@/components/calendar/PeopleSearchDialog";
import { EventDetailPanel } from "@/components/calendar/EventDetailPanel";
import { DeleteEventDialog } from "@/components/calendar/DeleteEventDialog";
import {
  shouldPromptGuests,
  useGuestNotificationPrompt,
} from "@/components/calendar/GuestNotificationDialog";
import { useCalendarContext } from "@/components/layout/AppLayout";
import {
  useEvents,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
  prefetchEvents,
} from "@/hooks/use-events";
import { useOverlayPeople } from "@/hooks/use-overlay-people";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { useViewPreferences } from "@/hooks/use-view-preferences";
import { useMeetingStartNotifications } from "@/hooks/use-meeting-start-notifications";
import { useQueryClient } from "@tanstack/react-query";
import {
  AgentToggleButton,
  agentNativePath,
  NotificationsBell,
} from "@agent-native/core/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { setUndoAction, runUndo } from "@/hooks/use-undo";
import type { CalendarEvent, CalendarEventDraft } from "@shared/api";
import {
  dateTimeInTimezoneToIso,
  getLocalTimezone,
} from "@/lib/event-form-utils";
import { getGoogleEventColorHex } from "@/lib/event-colors";

import type { ViewMode } from "@/components/layout/AppLayout";

const viewModeLabels: Record<ViewMode, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

const CALENDAR_DRAFT_EVENT_PREFIX = "calendar-draft-event:";

type DraftEventPatch = Partial<CalendarEvent> & {
  addGoogleMeet?: boolean;
  addZoom?: boolean;
  workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
  workingLocationLabel?: string;
};

function safeCalendarDraftId(id: string | undefined): string | null {
  return id && /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

function calendarDraftEventId(id: string) {
  return `${CALENDAR_DRAFT_EVENT_PREFIX}${id}`;
}

function calendarDraftIdFromEventId(eventId: string) {
  return eventId.startsWith(CALENDAR_DRAFT_EVENT_PREFIX)
    ? eventId.slice(CALENDAR_DRAFT_EVENT_PREFIX.length)
    : null;
}

function parseValidDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fallbackDraftRange(fallbackDate: Date) {
  const start = new Date(fallbackDate);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return { start, end };
}

function draftRange(draft: CalendarEventDraft, fallbackDate: Date) {
  const fallback = fallbackDraftRange(fallbackDate);
  const start = parseValidDate(draft.start) ?? fallback.start;
  const parsedEnd = parseValidDate(draft.end);
  const end =
    parsedEnd && parsedEnd.getTime() > start.getTime()
      ? parsedEnd
      : new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

function draftToCalendarEvent(
  draft: CalendarEventDraft,
  fallbackDate: Date,
): CalendarEvent {
  const { start, end } = draftRange(draft, fallbackDate);
  return {
    id: calendarDraftEventId(draft.id),
    title: draft.title?.trim() || "(No title)",
    description: draft.description ?? "",
    start: start.toISOString(),
    end: end.toISOString(),
    startTimeZone: draft.startTimeZone,
    endTimeZone: draft.endTimeZone ?? draft.startTimeZone,
    location: draft.location ?? draft.workingLocationLabel ?? "",
    allDay: draft.allDay ?? false,
    source: "local",
    accountEmail: draft.accountEmail,
    colorId: draft.colorId,
    color: draft.colorId ? getGoogleEventColorHex(draft.colorId) : undefined,
    transparency: draft.transparency,
    visibility: draft.visibility,
    eventType: draft.eventType ?? "default",
    attendees: draft.attendees,
    reminders: draft.reminders,
    remindersUseDefault: draft.remindersUseDefault,
    attachments: draft.attachments,
    createdAt: draft.createdAt ?? new Date().toISOString(),
    updatedAt: draft.updatedAt ?? draft.createdAt ?? new Date().toISOString(),
  };
}

function applyDraftPatch(
  draft: CalendarEventDraft,
  patch: DraftEventPatch,
): CalendarEventDraft {
  const next: CalendarEventDraft = {
    ...draft,
    updatedAt: new Date().toISOString(),
  };
  const copy = <K extends keyof CalendarEventDraft>(key: K) => {
    if (patch[key] !== undefined) {
      next[key] = patch[key] as CalendarEventDraft[K];
    }
  };

  copy("title");
  copy("description");
  copy("start");
  copy("end");
  copy("startTimeZone");
  copy("endTimeZone");
  copy("location");
  copy("allDay");
  copy("eventType");
  copy("transparency");
  copy("visibility");
  copy("colorId");
  copy("reminders");
  copy("remindersUseDefault");
  copy("attachments");
  copy("attendees");
  copy("accountEmail");
  copy("workingLocationType");
  copy("workingLocationLabel");

  if (patch.addGoogleMeet !== undefined) {
    next.addGoogleMeet = patch.addGoogleMeet;
    if (patch.addGoogleMeet) next.addZoom = false;
  }
  if (patch.addZoom !== undefined) {
    next.addZoom = patch.addZoom;
    if (patch.addZoom) next.addGoogleMeet = false;
  }

  return next;
}

function persistCalendarDraft(draft: CalendarEventDraft) {
  const safeId = safeCalendarDraftId(draft.id);
  if (!safeId) return;
  fetch(
    agentNativePath(
      `/_agent-native/application-state/calendar-draft-${safeId}`,
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    },
  ).catch(() => {});
}

function deletePersistedCalendarDraft(id: string) {
  const safeId = safeCalendarDraftId(id);
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

export default function CalendarView() {
  const isMobile = useIsMobile();
  const {
    selectedDate,
    setSelectedDate,
    viewMode,
    setViewMode,
    peopleSearchOpen,
    setPeopleSearchOpen,
    addCalendarOpen,
    setAddCalendarOpen,
    addCalendarDefaultTab,
    setAddCalendarDefaultTab,
    eventDetailSidebar,
    setEventDetailSidebar,
    sidebarEvent,
    setSidebarEvent,
    focusedEvent,
    setFocusedEvent,
    hiddenCalendars,
    eventDraft,
    setEventDraft,
  } = useCalendarContext();
  const { prefs: viewPrefs, update: setViewPrefs } = useViewPreferences();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDefaultStart, setCreateDefaultStart] = useState<string>();
  const [createDefaultEnd, setCreateDefaultEnd] = useState<string>();
  const [quickEditEventId, setQuickEditEventId] = useState<string | null>(null);
  const [quickEditTempIds, setQuickEditTempIds] = useState<
    Record<string, string>
  >({});
  const openedDraftIdRef = useRef<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [deleteDialogEvent, setDeleteDialogEvent] =
    useState<CalendarEvent | null>(null);

  const queryClient = useQueryClient();
  const googleStatus = useGoogleAuthStatus();
  const { data: rawOverlayPeople } = useOverlayPeople();
  const overlayPeople = Array.isArray(rawOverlayPeople) ? rawOverlayPeople : [];
  const overlayEmails = useMemo(
    () => overlayPeople.map((p) => p.email),
    [overlayPeople],
  );
  const isGoogleConnected = googleStatus.data?.connected ?? false;
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const { promptGuestNotification, guestNotificationDialog } =
    useGuestNotificationPrompt();

  // Compute date range for query based on view
  const { from, to } = useMemo(() => {
    switch (viewMode) {
      case "month": {
        const ms = startOfMonth(selectedDate);
        const me = endOfMonth(selectedDate);
        return {
          from: startOfWeek(ms).toISOString(),
          to: endOfWeek(me).toISOString(),
        };
      }
      case "week": {
        return {
          from: startOfWeek(selectedDate).toISOString(),
          to: endOfWeek(selectedDate).toISOString(),
        };
      }
      case "day": {
        const dayStart = new Date(selectedDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(selectedDate);
        dayEnd.setHours(23, 59, 59, 999);
        return { from: dayStart.toISOString(), to: dayEnd.toISOString() };
      }
    }
  }, [viewMode, selectedDate]);

  const {
    data: rawEventsData,
    error: eventsError,
    isLoading,
  } = useEvents(from, to, overlayEmails);
  const rawEvents = Array.isArray(rawEventsData) ? rawEventsData : [];
  const draftEvent = useMemo(
    () => (eventDraft ? draftToCalendarEvent(eventDraft, selectedDate) : null),
    [eventDraft, selectedDate],
  );
  const draftEventIds = useMemo(
    () => (draftEvent ? [draftEvent.id] : []),
    [draftEvent],
  );

  // Warm the adjacent ranges so j/k (and the chevron buttons) feel instant.
  // Borrowed from the mail template's background-warm pattern — fire-and-forget
  // prefetch that lets React Query dedupe and reuse the response when the user
  // actually navigates. Only runs once the current range has loaded so we
  // don't fight the primary fetch for bandwidth.
  useEffect(() => {
    if (isLoading) return;
    const ranges = (() => {
      switch (viewMode) {
        case "month": {
          const next = addMonths(selectedDate, 1);
          const prev = subMonths(selectedDate, 1);
          return [next, prev].map((d) => ({
            from: startOfWeek(startOfMonth(d)).toISOString(),
            to: endOfWeek(endOfMonth(d)).toISOString(),
          }));
        }
        case "week": {
          // Two weeks forward so rapid `j j` stays instant, plus one back.
          const next = addWeeks(selectedDate, 1);
          const next2 = addWeeks(selectedDate, 2);
          const prev = subWeeks(selectedDate, 1);
          return [next, next2, prev].map((d) => ({
            from: startOfWeek(d).toISOString(),
            to: endOfWeek(d).toISOString(),
          }));
        }
        case "day": {
          const next = addDays(selectedDate, 1);
          const prev = subDays(selectedDate, 1);
          return [next, prev].map((d) => {
            const start = new Date(d);
            start.setHours(0, 0, 0, 0);
            const end = new Date(d);
            end.setHours(23, 59, 59, 999);
            return { from: start.toISOString(), to: end.toISOString() };
          });
        }
      }
    })();
    for (const range of ranges) {
      void prefetchEvents(queryClient, range.from, range.to, overlayEmails);
    }
  }, [isLoading, viewMode, selectedDate, overlayEmails, queryClient]);

  // Show skeleton only when loading with no cached data (new date range).
  // Tab refocus keeps cached data visible and refetches in background.
  const eventsLoading = isLoading;

  // Apply overlay colors and filter hidden calendars
  const events = useMemo(() => {
    const colorMap = new Map(overlayPeople.map((p) => [p.email, p.color]));
    const sourceEvents = draftEvent
      ? [...rawEvents.filter((e) => e.id !== draftEvent.id), draftEvent]
      : rawEvents;
    return sourceEvents
      .map((e) => {
        if (e.overlayEmail && colorMap.has(e.overlayEmail)) {
          return { ...e, color: colorMap.get(e.overlayEmail) };
        }
        const tempId = quickEditTempIds[e.id];
        return tempId && !e._tempId ? { ...e, _tempId: tempId } : e;
      })
      .filter((e) => {
        // Hide events from hidden people overlays
        if (e.overlayEmail && hiddenCalendars.people.includes(e.overlayEmail))
          return false;
        // Hide events from hidden Google accounts
        if (
          e.accountEmail &&
          !e.overlayEmail &&
          hiddenCalendars.accounts.includes(e.accountEmail)
        )
          return false;
        // Hide events from hidden external calendars
        if (e.source === "ical") {
          const hiddenMatch = hiddenCalendars.external.some((calId) =>
            e.id.startsWith(`ical-${calId}-`),
          );
          if (hiddenMatch) return false;
        }
        return true;
      });
  }, [rawEvents, draftEvent, overlayPeople, hiddenCalendars, quickEditTempIds]);

  // Filter events for day view — use overlap check so multi-day continuation
  // events (started on a prior day) still appear on the selected day.
  const dayEvents = useMemo(
    () =>
      viewMode === "day"
        ? events.filter((e) => {
            const evStart = parseISO(e.start);
            const evEnd = parseISO(e.end);
            const dayStart = startOfDay(selectedDate);
            const dayEnd = addDays(dayStart, 1);
            return evStart < dayEnd && evEnd > dayStart;
          })
        : events,
    [events, viewMode, selectedDate],
  );
  const openNotificationEvent = useCallback(
    (event: CalendarEvent) => {
      setSelectedDate(parseISO(event.start));
      setViewMode("day");
      setSidebarEvent(event);
      setFocusedEvent(event);
    },
    [setFocusedEvent, setSelectedDate, setSidebarEvent, setViewMode],
  );
  useMeetingStartNotifications(events, openNotificationEvent);

  useEffect(() => {
    if (!eventDraft) {
      openedDraftIdRef.current = null;
      return;
    }
    if (openedDraftIdRef.current === eventDraft.id) return;
    openedDraftIdRef.current = eventDraft.id;

    const { start } = draftRange(eventDraft, selectedDate);
    setSelectedDate(start);
    if (isMobile || viewMode === "month") {
      setViewMode("day");
    }
    setCreateDefaultStart(undefined);
    setCreateDefaultEnd(undefined);
    setCreateDialogOpen(false);
    setEventDetailSidebar(false);
    setSidebarEvent(null);
    setQuickEditEventId(calendarDraftEventId(eventDraft.id));
  }, [
    eventDraft,
    isMobile,
    selectedDate,
    setEventDetailSidebar,
    setSelectedDate,
    setSidebarEvent,
    setViewMode,
    viewMode,
  ]);

  const updateDraftEvent = useCallback(
    (eventId: string, patch: DraftEventPatch) => {
      const draftId = calendarDraftIdFromEventId(eventId);
      if (!draftId || !eventDraft || eventDraft.id !== draftId) return null;
      const nextDraft = applyDraftPatch(eventDraft, patch);
      setEventDraft(nextDraft);
      persistCalendarDraft(nextDraft);
      return nextDraft;
    },
    [eventDraft, setEventDraft],
  );

  const discardDraftEvent = useCallback(
    (eventId: string) => {
      const draftId = calendarDraftIdFromEventId(eventId);
      if (!draftId || !eventDraft || eventDraft.id !== draftId) return;
      deletePersistedCalendarDraft(draftId);
      setEventDraft(null);
      setQuickEditEventId(null);
      if (sidebarEvent?.id === eventId) setSidebarEvent(null);
      if (focusedEvent?.id === eventId) setFocusedEvent(null);
    },
    [
      eventDraft,
      focusedEvent,
      setEventDraft,
      setFocusedEvent,
      setSidebarEvent,
      sidebarEvent,
    ],
  );

  const createDraftEvent = useCallback(
    (eventId: string, pendingPatch?: DraftEventPatch) => {
      const draftId = calendarDraftIdFromEventId(eventId);
      if (!draftId || !eventDraft || eventDraft.id !== draftId) return;
      const draft = pendingPatch
        ? applyDraftPatch(eventDraft, pendingPatch)
        : eventDraft;
      if (pendingPatch) {
        setEventDraft(draft);
        persistCalendarDraft(draft);
      }
      const title = draft.title?.trim();
      if (!title || title === "(No title)") {
        toast.error("Add a title before creating the event");
        return;
      }

      const { start, end } = draftRange(draft, selectedDate);
      if (end.getTime() <= start.getTime()) {
        toast.error("End time must be after start time");
        return;
      }

      const eventType = draft.eventType ?? "default";
      const location = draft.location ?? draft.workingLocationLabel ?? "";
      const timezone = draft.startTimeZone ?? getLocalTimezone();
      const statusPatch =
        eventType === "default"
          ? {}
          : {
              eventType,
              workingLocationType:
                draft.workingLocationType ?? "customLocation",
              workingLocationLabel:
                (draft.workingLocationType ?? "customLocation") ===
                "customLocation"
                  ? location
                  : draft.workingLocationLabel,
            };

      createEvent.mutate(
        {
          title,
          description: draft.description ?? "",
          start: start.toISOString(),
          end: end.toISOString(),
          startTimeZone: draft.allDay ? undefined : timezone,
          endTimeZone: draft.allDay
            ? undefined
            : (draft.endTimeZone ?? draft.startTimeZone ?? timezone),
          location,
          accountEmail: draft.accountEmail,
          allDay: draft.allDay ?? false,
          transparency:
            eventType === "workingLocation"
              ? "transparent"
              : eventType === "default"
                ? draft.transparency
                : "opaque",
          visibility:
            eventType === "workingLocation" ? "public" : draft.visibility,
          reminders: draft.reminders,
          remindersUseDefault: draft.remindersUseDefault,
          ...statusPatch,
          addGoogleMeet: draft.addGoogleMeet,
          addZoom: draft.addZoom,
          color: draft.colorId
            ? getGoogleEventColorHex(draft.colorId)
            : undefined,
          colorId: draft.colorId,
          attachments: draft.attachments,
          attendees: draft.attendees,
        },
        {
          onSuccess: (result) => {
            deletePersistedCalendarDraft(draftId);
            setEventDraft(null);
            setQuickEditEventId(null);
            const createdEventId = result?.id;
            if (createdEventId) {
              const undo = () => {
                deleteEvent.mutate({
                  id: createdEventId,
                  scope: "single",
                  sendUpdates: "none",
                });
              };
              setUndoAction(undo);
              toast("Event created", {
                action: { label: "Undo", onClick: undo },
              });
              return;
            }
            toast("Event created");
          },
          onError: (error) =>
            toast.error(
              error instanceof Error ? error.message : "Failed to create event",
            ),
        },
      );
    },
    [createEvent, deleteEvent, eventDraft, selectedDate, setEventDraft],
  );

  const selectedEvent = useMemo(() => {
    const candidate = sidebarEvent ?? focusedEvent;
    if (!candidate) return null;
    return events.find((event) => event.id === candidate.id) ?? candidate;
  }, [events, sidebarEvent, focusedEvent]);

  function handleNavigate(direction: "prev" | "next") {
    const fns =
      direction === "next"
        ? { month: addMonths, week: addWeeks, day: addDays }
        : { month: subMonths, week: subWeeks, day: subDays };
    setSelectedDate(fns[viewMode](selectedDate, 1));
  }

  function handleToday() {
    setSelectedDate(new Date());
  }

  function handleDateSelect(date: Date) {
    setSelectedDate(date);
    if (viewMode === "month") {
      setViewMode("day");
    }
  }

  function handleGoToDate(date: Date) {
    setSelectedDate(date);
    setViewMode("day");
  }

  function handleOpenSelectedEventInGoogleCalendar(event: CalendarEvent) {
    if (!event.htmlLink) {
      toast.error("Google Calendar link unavailable");
      return;
    }

    try {
      const url = new URL(event.htmlLink);
      const isGoogleCalendarUrl =
        url.protocol === "https:" &&
        (url.hostname === "calendar.google.com" ||
          (url.hostname === "www.google.com" &&
            url.pathname.startsWith("/calendar/")));

      if (!isGoogleCalendarUrl) {
        toast.error("Google Calendar link unavailable");
        return;
      }

      const opened = window.open(
        url.toString(),
        "_blank",
        "noopener,noreferrer",
      );
      if (!opened) {
        window.location.assign(url.toString());
      }
    } catch {
      toast.error("Google Calendar link unavailable");
    }
  }

  async function handleDirectDelete(
    ev: CalendarEvent,
    notificationOptions?: {
      sendUpdates: "all" | "none";
      notificationMessage?: string;
    },
  ) {
    const isOrganizer =
      ev.organizer?.self ||
      ev.attendees?.find((a) => a.self)?.organizer ||
      !ev.attendees?.length;
    const hasOtherAttendees =
      ev.attendees && ev.attendees.filter((a) => !a.self).length > 0;
    const removeOnly = !isOrganizer && !!hasOtherAttendees;
    const shouldAskGuests = !removeOnly && shouldPromptGuests(ev);
    const guestNotification =
      notificationOptions ??
      (shouldAskGuests
        ? await promptGuestNotification({
            event: ev,
            action: "cancellation",
          })
        : { sendUpdates: "none" as const });
    if (!guestNotification) return;

    // Snapshot for undo — preserve all event fields so undo recreates faithfully
    const { id: _id, source: _source, ...snapshot } = ev;
    const undo = () => {
      createEvent.mutate(snapshot);
    };

    deleteEvent.mutate(
      {
        id: ev.id,
        scope: "single",
        ...guestNotification,
        removeOnly,
      },
      {
        onSuccess: () => {
          if (sidebarEvent?.id === ev.id) setSidebarEvent(null);
          setUndoAction(undo);
          toast(`Event ${removeOnly ? "removed" : "deleted"}`, {
            action: { label: "Undo", onClick: undo },
          });
        },
        onError: () => toast.error("Failed to delete event"),
      },
    );
  }

  function handleDeleteEvent(eventId: string) {
    if (calendarDraftIdFromEventId(eventId)) {
      discardDraftEvent(eventId);
      return;
    }
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;
    const isRecurring = !!(ev.recurringEventId || ev.recurrence?.length);
    const isOrganizer =
      ev.organizer?.self ||
      ev.attendees?.find((a) => a.self)?.organizer ||
      !ev.attendees?.length;
    const hasOtherAttendees =
      ev.attendees && ev.attendees.filter((a) => !a.self).length > 0;
    const removeOnly = !isOrganizer && !!hasOtherAttendees;
    if (isRecurring || (!removeOnly && shouldPromptGuests(ev))) {
      setDeleteDialogEvent(ev);
    } else {
      void handleDirectDelete(ev);
    }
  }

  // Move event to a new date (drag-and-drop from MonthView)
  async function handleEventDrop(eventId: string, newDate: Date) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;

    if (calendarDraftIdFromEventId(eventId)) {
      const originalStart = parseISO(event.start);
      const originalEnd = parseISO(event.end);
      const newStart = new Date(originalStart);
      const newEnd = new Date(originalEnd);
      newStart.setFullYear(
        newDate.getFullYear(),
        newDate.getMonth(),
        newDate.getDate(),
      );
      newEnd.setFullYear(
        newDate.getFullYear(),
        newDate.getMonth(),
        newDate.getDate(),
      );
      updateDraftEvent(eventId, {
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      });
      return;
    }

    const oldStartISO = event.start;
    const oldEndISO = event.end;
    const originalStart = parseISO(event.start);
    const originalEnd = parseISO(event.end);
    const newStart = new Date(originalStart);
    const newEnd = new Date(originalEnd);

    newStart.setFullYear(
      newDate.getFullYear(),
      newDate.getMonth(),
      newDate.getDate(),
    );
    newEnd.setFullYear(
      newDate.getFullYear(),
      newDate.getMonth(),
      newDate.getDate(),
    );

    const undo = () => {
      updateEvent.mutate({
        id: eventId,
        start: oldStartISO,
        end: oldEndISO,
        sendUpdates: "none",
      });
    };
    const updates = {
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
    };
    const guestNotification = await promptGuestNotification({
      event,
      action: "update",
      updates,
    });
    if (!guestNotification) return;

    updateEvent.mutate(
      {
        id: eventId,
        ...updates,
        ...guestNotification,
      },
      {
        onSuccess: () => {
          setUndoAction(undo);
          toast("Event moved", {
            action: { label: "Undo", onClick: undo },
          });
        },
        onError: () => toast.error("Failed to move event"),
      },
    );
  }

  // Move/resize event to new start/end times (drag from Week/Day views)
  async function handleEventTimeChange(
    eventId: string,
    newStart: Date,
    newEnd: Date,
  ) {
    // Skip no-op drags (dropped back in same spot)
    const event = events.find((e) => e.id === eventId);
    if (!event) return;

    if (calendarDraftIdFromEventId(eventId)) {
      updateDraftEvent(eventId, {
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
        allDay: false,
        startTimeZone: getLocalTimezone(),
        endTimeZone: getLocalTimezone(),
      });
      return;
    }

    const oldStart = parseISO(event.start).getTime();
    const oldEnd = parseISO(event.end).getTime();
    if (oldStart === newStart.getTime() && oldEnd === newEnd.getTime()) {
      return;
    }

    const oldStartISO = event.start;
    const oldEndISO = event.end;
    const undo = () => {
      updateEvent.mutate({
        id: eventId,
        start: oldStartISO,
        end: oldEndISO,
        sendUpdates: "none",
      });
    };
    const updates = {
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
    };
    const guestNotification = await promptGuestNotification({
      event,
      action: "update",
      updates,
    });
    if (!guestNotification) return;

    updateEvent.mutate(
      {
        id: eventId,
        ...updates,
        ...guestNotification,
      },
      {
        onSuccess: () => {
          setUndoAction(undo);
          toast("Event updated", {
            action: { label: "Undo", onClick: undo },
          });
        },
        onError: () => toast.error("Failed to update event"),
      },
    );
  }

  function handleClickTimeSlot(
    clickedDate: Date,
    startTime: string,
    endTime: string,
  ) {
    setSelectedDate(clickedDate);
    setEventDraft(null);
    setCreateDefaultStart(startTime);
    setCreateDefaultEnd(endTime);
    setCreateDialogOpen(false);

    const dateStr = format(clickedDate, "yyyy-MM-dd");
    const timezone = getLocalTimezone();
    const startISO = dateTimeInTimezoneToIso(dateStr, startTime, timezone);
    const endISO = dateTimeInTimezoneToIso(dateStr, endTime, timezone);
    const tempId = `temp-${Date.now()}`;

    createEvent.mutate(
      {
        title: "(No title)",
        description: "",
        location: "",
        start: startISO,
        end: endISO,
        startTimeZone: timezone,
        endTimeZone: timezone,
        allDay: false,
        _tempId: tempId,
      },
      {
        onSuccess: (result) => {
          const { _tempId, ...realEvent } = result;
          const stableTempId = _tempId ?? tempId;
          setQuickEditTempIds((current) => ({
            ...current,
            [realEvent.id]: stableTempId,
          }));
          queryClient.setQueriesData<CalendarEvent[]>(
            { queryKey: ["action", "list-events"] },
            (old) =>
              old?.map((e) =>
                e.id === stableTempId
                  ? { ...e, ...realEvent, _tempId: stableTempId }
                  : e,
              ),
          );
          setQuickEditEventId(realEvent.id);
        },
        onError: () => {
          setQuickEditEventId(null);
          toast.error("Failed to create event");
        },
      },
    );

    setQuickEditEventId(tempId);
  }

  async function handleQuickEditSave(eventId: string, title: string) {
    setQuickEditEventId(null);
    if (calendarDraftIdFromEventId(eventId)) {
      updateDraftEvent(eventId, { title: title.trim() });
      return;
    }
    setQuickEditTempIds((current) => {
      if (!current[eventId]) return current;
      const { [eventId]: _removed, ...next } = current;
      return next;
    });
    if (title.trim() && title.trim() !== "(No title)") {
      const event = events.find((e) => e.id === eventId);
      const updates = { title: title.trim() };
      const guestNotification = event
        ? await promptGuestNotification({
            event,
            action: "update",
            updates,
          })
        : { sendUpdates: "none" as const };
      if (!guestNotification) return;
      updateEvent.mutate({ id: eventId, ...updates, ...guestNotification });
    }
  }

  async function handleTitleSave(eventId: string, title: string) {
    if (calendarDraftIdFromEventId(eventId)) {
      updateDraftEvent(eventId, { title });
      return;
    }
    const event = events.find((e) => e.id === eventId);
    const updates = { title };
    const guestNotification = event
      ? await promptGuestNotification({
          event,
          action: "update",
          updates,
        })
      : { sendUpdates: "none" as const };
    if (!guestNotification) return;
    updateEvent.mutate({ id: eventId, ...updates, ...guestNotification });
  }

  function handleQuickEditCancel(eventId: string) {
    setQuickEditEventId(null);
    if (calendarDraftIdFromEventId(eventId)) {
      discardDraftEvent(eventId);
      return;
    }
    setQuickEditTempIds((current) => {
      if (!current[eventId]) return current;
      const { [eventId]: _removed, ...next } = current;
      return next;
    });
    // Delete the event if title was never set
    const ev = events.find((e) => e.id === eventId);
    if (!ev || ev.title === "(No title)") {
      deleteEvent.mutate({ id: eventId, scope: "single", sendUpdates: "none" });
    }
  }

  // IconKeyboard shortcuts — don't fire when user is typing in an input
  const isTypingInInput = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K / Ctrl+K — always open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Skip all other shortcuts when typing or when a dialog is open
      if (isTypingInInput(e)) return;
      if (createDialogOpen || deleteDialogEvent) return;

      // Delete/Backspace — delete the selected event
      if (e.key === "Delete" || e.key === "Backspace") {
        const targetEvent = sidebarEvent || focusedEvent;
        if (!targetEvent) return;
        e.preventDefault();
        handleDeleteEvent(targetEvent.id);
        return;
      }

      // Don't intercept keyboard shortcuts with modifier keys (Cmd+C, Ctrl+V, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // `?` / shift+/ opens the keyboard shortcuts help — that listener now
      // lives in AppLayout so it works on every tab. Don't double-handle here.

      switch (e.key) {
        case "z":
          e.preventDefault();
          runUndo();
          break;
        case "j":
          e.preventDefault();
          handleNavigate("next");
          break;
        case "k":
          e.preventDefault();
          handleNavigate("prev");
          break;
        case "p":
          e.preventDefault();
          setPeopleSearchOpen(true);
          break;
        case "t":
          handleToday();
          break;
        case "m":
          setViewMode("month");
          break;
        case "w":
          setViewMode("week");
          break;
        case "d":
          setViewMode("day");
          break;
        case "c":
          e.preventDefault();
          setEventDraft(null);
          setCreateDefaultStart(undefined);
          setCreateDefaultEnd(undefined);
          setCreateDialogOpen(true);
          break;
        case "/":
          e.preventDefault();
          setCommandPaletteOpen(true);
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    createDialogOpen,
    deleteDialogEvent,
    isTypingInInput,
    viewMode,
    selectedDate,
    sidebarEvent,
    focusedEvent,
    events,
  ]);

  const headerLabel = (() => {
    switch (viewMode) {
      case "month":
        return isMobile
          ? format(selectedDate, "MMM yyyy")
          : format(selectedDate, "MMMM yyyy");
      case "week": {
        const ws = startOfWeek(selectedDate);
        const we = endOfWeek(selectedDate);
        return isMobile
          ? `${format(ws, "MMM d")} – ${format(we, "d")}`
          : `${format(ws, "MMM d")} – ${format(we, "d, yyyy")}`;
      }
      case "day":
        return isMobile
          ? format(selectedDate, "EEE, MMM d")
          : format(selectedDate, "EEEE, MMMM d, yyyy");
    }
  })();

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex h-full min-w-0">
        {/* Left: calendar area (header + grid) */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Google Calendar connect banner — show when there's a credentials error */}
          {eventsError ? <GoogleConnectBanner /> : null}

          {/* Error detail */}
          {eventsError && (
            <div className="shrink-0 border-b border-destructive/20 bg-destructive/[0.06] px-4 py-1.5 text-xs text-destructive/70">
              {eventsError.message}
            </div>
          )}

          {/* Top bar */}
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2 sm:gap-3 sm:px-3">
            {/* Left: view mode dropdown */}
            <div className="flex shrink-0 items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-sm font-semibold sm:px-2.5"
                  >
                    {viewModeLabels[viewMode]}
                    <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setViewMode("day")}>
                    Day
                    <kbd className="ml-auto text-[10px] text-muted-foreground">
                      D
                    </kbd>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode("week")}>
                    Week
                    <kbd className="ml-auto text-[10px] text-muted-foreground">
                      W
                    </kbd>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode("month")}>
                    Month
                    <kbd className="ml-auto text-[10px] text-muted-foreground">
                      M
                    </kbd>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                    Display
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setViewPrefs({ hideWeekends: !viewPrefs.hideWeekends });
                    }}
                  >
                    Hide weekends
                    {viewPrefs.hideWeekends && (
                      <IconCheck className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Center: today, nav arrows, date label */}
            <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5 sm:gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToday}
                    className="h-7 px-2 text-xs font-medium sm:px-2.5"
                  >
                    Today
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    Go to today{" "}
                    <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                      T
                    </kbd>
                  </p>
                </TooltipContent>
              </Tooltip>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleNavigate("prev")}
                className="h-8 w-8 sm:h-7 sm:w-7"
              >
                <IconChevronLeft className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleNavigate("next")}
                className="h-8 w-8 sm:h-7 sm:w-7"
              >
                <IconChevronRight className="h-4 w-4" />
              </Button>

              <span className="ml-0.5 min-w-0 flex-1 truncate whitespace-nowrap text-center text-xs font-semibold sm:ml-1 sm:text-sm">
                {headerLabel}
              </span>
            </div>

            {/* Right: search, new event */}
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 sm:h-7 sm:w-7"
                    onClick={() => setCommandPaletteOpen(true)}
                  >
                    <IconSearch className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    Search{" "}
                    <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                      /
                    </kbd>
                  </p>
                </TooltipContent>
              </Tooltip>

              <NotificationsBell
                browserNotifications
                emptyDescription="Calendar can pop browser alerts while this app is open. Clips desktop handles fuller meeting prompts with one-click notes."
              />
              <CreateEventPopover
                open={createDialogOpen}
                onOpenChange={(open) => {
                  setCreateDialogOpen(open);
                  if (open) {
                    setEventDraft(null);
                  }
                  if (!open) {
                    setCreateDefaultStart(undefined);
                    setCreateDefaultEnd(undefined);
                  }
                }}
                defaultDate={selectedDate}
                defaultStartTime={createDefaultStart}
                defaultEndTime={createDefaultEnd}
              />
              <AccountAvatars />
              <AgentToggleButton />
            </div>
          </div>

          {/* Calendar grid */}
          <div className="flex-1 overflow-hidden">
            {viewMode === "month" && (
              <MonthView
                events={events}
                selectedDate={selectedDate}
                onDateSelect={handleDateSelect}
                onDeleteEvent={handleDeleteEvent}
                onEventDrop={handleEventDrop}
                draftEventIds={draftEventIds}
                onDraftUpdate={updateDraftEvent}
                onDraftCreate={createDraftEvent}
                onDraftDiscard={discardDraftEvent}
                isLoading={eventsLoading}
              />
            )}
            {viewMode === "week" && (
              <WeekView
                events={events}
                selectedDate={selectedDate}
                onDateSelect={handleDateSelect}
                onDeleteEvent={handleDeleteEvent}
                onEventTimeChange={handleEventTimeChange}
                onClickTimeSlot={handleClickTimeSlot}
                quickEditEventId={quickEditEventId}
                onQuickEditSave={handleQuickEditSave}
                onQuickEditCancel={handleQuickEditCancel}
                draftEventIds={draftEventIds}
                onDraftUpdate={updateDraftEvent}
                onDraftCreate={createDraftEvent}
                onDraftDiscard={discardDraftEvent}
                isLoading={eventsLoading}
              />
            )}
            {viewMode === "day" && (
              <DayView
                events={dayEvents}
                date={selectedDate}
                onDeleteEvent={handleDeleteEvent}
                onEventTimeChange={handleEventTimeChange}
                onClickTimeSlot={handleClickTimeSlot}
                quickEditEventId={quickEditEventId}
                onQuickEditSave={handleQuickEditSave}
                onQuickEditCancel={handleQuickEditCancel}
                draftEventIds={draftEventIds}
                onDraftUpdate={updateDraftEvent}
                onDraftCreate={createDraftEvent}
                onDraftDiscard={discardDraftEvent}
                isLoading={eventsLoading}
              />
            )}
          </div>
        </div>

        {/* Event detail sidebar — full height, outside the calendar column */}
        {eventDetailSidebar && (
          <EventDetailPanel
            event={sidebarEvent}
            onClose={() => setSidebarEvent(null)}
            onDelete={handleDeleteEvent}
            onTitleSave={handleTitleSave}
          />
        )}

        {/* Dialogs */}
        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          events={events}
          onGoToDate={handleGoToDate}
          onEventClick={(event) => {
            setCommandPaletteOpen(false);
            handleGoToDate(parseISO(event.start));
          }}
          onCreateEvent={() => {
            setCommandPaletteOpen(false);
            setEventDraft(null);
            setCreateDialogOpen(true);
          }}
          onViewChange={setViewMode}
          onToday={handleToday}
          selectedEvent={selectedEvent}
          onOpenSelectedEventInGoogleCalendar={
            handleOpenSelectedEventInGoogleCalendar
          }
          onAddPeopleCalendar={() => {
            setCommandPaletteOpen(false);
            setAddCalendarDefaultTab("people");
            setAddCalendarOpen(true);
          }}
          onAddUrlCalendar={() => {
            setCommandPaletteOpen(false);
            setAddCalendarDefaultTab("url");
            setAddCalendarOpen(true);
          }}
        />
        <PeopleSearchDialog
          open={peopleSearchOpen}
          onOpenChange={setPeopleSearchOpen}
        />
        <DeleteEventDialog
          event={deleteDialogEvent}
          open={deleteDialogEvent !== null}
          onClose={() => setDeleteDialogEvent(null)}
          onConfirm={(options) => {
            if (!deleteDialogEvent) return;
            const snapshot = { ...deleteDialogEvent };
            const eventId = deleteDialogEvent.id;
            const undo = () => {
              createEvent.mutate({
                title: snapshot.title,
                description: snapshot.description ?? "",
                location: snapshot.location ?? "",
                start: snapshot.start,
                end: snapshot.end,
                startTimeZone: snapshot.startTimeZone,
                endTimeZone: snapshot.endTimeZone,
                allDay: snapshot.allDay ?? false,
                color: snapshot.color,
                colorId: snapshot.colorId,
                attachments: snapshot.attachments,
                eventType: snapshot.eventType,
                transparency: snapshot.transparency,
                visibility: snapshot.visibility,
                reminders: snapshot.reminders,
                remindersUseDefault: snapshot.remindersUseDefault,
                outOfOfficeProperties: snapshot.outOfOfficeProperties,
                focusTimeProperties: snapshot.focusTimeProperties,
                workingLocationProperties: snapshot.workingLocationProperties,
              });
            };
            // Optimistic: close dialog immediately
            setDeleteDialogEvent(null);
            if (sidebarEvent?.id === eventId) {
              setSidebarEvent(null);
            }
            deleteEvent.mutate(
              { id: eventId, ...options },
              {
                onSuccess: () => {
                  const label = options.removeOnly ? "removed" : "deleted";
                  setUndoAction(undo);
                  toast(`Event ${label}`, {
                    action: { label: "Undo", onClick: undo },
                  });
                },
                onError: () => toast.error("Failed to delete event"),
              },
            );
          }}
        />
        {guestNotificationDialog}
      </div>
    </TooltipProvider>
  );
}

function AccountAvatars() {
  const googleStatus = useGoogleAuthStatus();
  const accounts = googleStatus.data?.accounts ?? [];
  if (accounts.length === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/settings"
          className="flex items-center hover:opacity-90 ml-1"
          aria-label="Manage accounts"
        >
          <div className="flex items-center">
            {accounts.map((account, i) => (
              <div
                key={account.email}
                className={cn("relative rounded-full ring-2 ring-card")}
                style={{
                  marginLeft: i === 0 ? 0 : -8,
                  zIndex: accounts.length - i,
                }}
              >
                {account.photoUrl ? (
                  <img
                    src={account.photoUrl}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-[11px] font-semibold text-primary">
                    {account.email[0]?.toUpperCase()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="space-y-0.5">
          {accounts.map((a) => (
            <div key={a.email} className="text-xs">
              {a.email}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
