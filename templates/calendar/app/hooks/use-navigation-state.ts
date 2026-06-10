import { useRef } from "react";
import { useAgentRouteState, callAction } from "@agent-native/core/client";
import {
  useCalendarContext,
  type ViewMode,
} from "@/components/layout/AppLayout";
import type { CalendarEvent, CalendarEventDraft } from "@shared/api";
import { agentNativePath } from "@agent-native/core/client";

interface NavigationState {
  view: string;
  calendarViewMode?: ViewMode;
  date?: string;
  eventId?: string;
  eventDraftId?: string;
  calendarDraft?: string;
  bookingLinkId?: string;
  extensionId?: string;
}

const EVENT_DRAFT_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function safeEventDraftId(id: unknown): string | null {
  return typeof id === "string" && EVENT_DRAFT_ID.test(id) ? id : null;
}

function decodeBase64UrlJson(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function loadEventDraft(
  cmd: NavigationState,
): Promise<CalendarEventDraft | null> {
  let decoded: CalendarEventDraft | null = null;
  if (cmd.calendarDraft) {
    try {
      const value = decodeBase64UrlJson(cmd.calendarDraft);
      if (value && typeof value === "object") {
        decoded = value as CalendarEventDraft;
      }
    } catch {
      decoded = null;
    }
  }

  const draftId =
    safeEventDraftId(cmd.eventDraftId) ?? safeEventDraftId(decoded?.id);
  if (draftId) {
    try {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/application-state/calendar-draft-${draftId}`,
        ),
      );
      if (res.ok) {
        const saved = (await res.json()) as CalendarEventDraft | null;
        if (saved && safeEventDraftId(saved.id)) return saved;
      }
    } catch {
      // Fall back to the compact draft payload in the deep link.
    }
  }

  if (decoded) {
    const decodedId = safeEventDraftId(decoded.id) ?? draftId;
    if (decodedId) return { ...decoded, id: decodedId };
  }
  return null;
}

export function useNavigationState() {
  const {
    selectedDate,
    viewMode,
    setViewMode,
    setSelectedDate,
    setEventDetailSidebar,
    setSidebarEvent,
    sidebarEvent,
    eventDraft,
    setEventDraft,
  } = useCalendarContext();

  // Capture setters in refs so the onNavigate callback always closes over current values.
  const setViewModeRef = useRef(setViewMode);
  setViewModeRef.current = setViewMode;
  const setSelectedDateRef = useRef(setSelectedDate);
  setSelectedDateRef.current = setSelectedDate;
  const setEventDetailSidebarRef = useRef(setEventDetailSidebar);
  setEventDetailSidebarRef.current = setEventDetailSidebar;
  const setSidebarEventRef = useRef(setSidebarEvent);
  setSidebarEventRef.current = setSidebarEvent;
  const setEventDraftRef = useRef(setEventDraft);
  setEventDraftRef.current = setEventDraft;

  useAgentRouteState<NavigationState>({
    getNavigationState: ({ pathname }) => {
      const state: NavigationState = { view: "calendar" };

      if (pathname === "/" || pathname === "") {
        state.view = "calendar";
      } else if (pathname.startsWith("/availability")) {
        state.view = "availability";
      } else if (pathname.startsWith("/booking-links")) {
        state.view = "booking-links";
        const match = pathname.match(/\/booking-links\/(.+)/);
        if (match) state.bookingLinkId = match[1];
      } else if (pathname.startsWith("/bookings")) {
        state.view = "bookings";
      } else if (pathname.startsWith("/settings")) {
        state.view = "settings";
      } else if (pathname.startsWith("/extensions")) {
        state.view = "extensions";
        const match = pathname.match(/\/extensions\/([^/?#]+)/);
        if (match?.[1] && match[1] !== "new") state.extensionId = match[1];
      }

      // Include the current calendar view mode
      state.calendarViewMode = viewMode;

      // Include the currently selected date
      if (selectedDate) {
        state.date = selectedDate.toISOString().split("T")[0];
      }

      // Include the selected event if one is open
      if (sidebarEvent?.id) {
        state.eventId = sidebarEvent.id;
      }

      if (eventDraft?.id) {
        state.eventDraftId = eventDraft.id;
      }

      return state;
    },
    getCommandPath: (cmd) => {
      let path = "/";
      if (cmd.view === "availability") {
        path = "/availability";
      } else if (cmd.view === "booking-links") {
        path = "/booking-links";
        if (cmd.bookingLinkId) path += `/${cmd.bookingLinkId}`;
      } else if (cmd.view === "bookings") {
        path = "/bookings";
      } else if (cmd.view === "settings") {
        path = "/settings";
      } else if (cmd.view === "extensions") {
        path = cmd.extensionId
          ? `/extensions/${encodeURIComponent(cmd.extensionId)}`
          : "/extensions";
      } else {
        path = "/";
      }
      return path;
    },
    onNavigate: (cmd) => {
      // Apply calendar view mode change (day/week/month)
      if (cmd.calendarViewMode) {
        setViewModeRef.current(cmd.calendarViewMode);
      }

      // Apply date change
      if (cmd.date) {
        // Parse YYYY-MM-DD as local date (not UTC)
        const [y, m, d] = cmd.date.split("-").map(Number);
        setSelectedDateRef.current(new Date(y, m - 1, d));
      }

      // A deep link can carry an eventId to focus a specific event. Fetch it
      // via the read-only get-event action, open it in the sidebar, and move
      // the calendar to its start date so the user lands on the event.
      if (cmd.eventId) {
        const eventId = cmd.eventId;
        (async () => {
          try {
            const evt = await callAction<CalendarEvent & { error?: string }>(
              "get-event",
              { id: eventId },
              { method: "GET" },
            );
            if (!evt || evt.error || !evt.id) return;
            if (!cmd.date && typeof evt.start === "string" && evt.start) {
              const startDate = new Date(evt.start);
              if (!Number.isNaN(startDate.getTime())) {
                setSelectedDateRef.current(startDate);
              }
            }
            setEventDetailSidebarRef.current(true);
            setSidebarEventRef.current(evt);
          } catch {
            // Best-effort — a failed focus must not break navigation.
          }
        })();
      }

      // A deep link can also carry an unsent event draft. The draft lives in
      // app-state and opens as a visible calendar placeholder with the native
      // event detail editor; nothing is written to Google Calendar until the
      // user creates it.
      if (cmd.eventDraftId || cmd.calendarDraft) {
        (async () => {
          const draft = await loadEventDraft(cmd);
          if (!draft) return;
          if (draft.start) {
            const startDate = new Date(draft.start);
            if (!Number.isNaN(startDate.getTime())) {
              setSelectedDateRef.current(startDate);
            }
          }
          setSidebarEventRef.current(null);
          setEventDetailSidebarRef.current(false);
          setEventDraftRef.current(draft);
        })();
      }
    },
  });
}
