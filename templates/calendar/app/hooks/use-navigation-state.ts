import { agentNativePath } from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import { useAgentRouteState } from "@agent-native/core/client/navigation";
import type { CalendarEvent, CalendarEventDraft } from "@shared/api";
import { useRef } from "react";

import {
  useCalendarContext,
  type ViewMode,
} from "@/components/layout/AppLayout";
import { dateToCalendarDateKey } from "@/lib/calendar-timezone";

interface NavigationState {
  view: string;
  calendarViewMode?: ViewMode;
  date?: string;
  eventId?: string;
  eventDraftId?: string;
  calendarDraft?: string;
  bookingLinkId?: string;
  extensionId?: string;
  addPersonEmail?: string;
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
    openAddPersonPrefilled,
  } = useCalendarContext();

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
  const openAddPersonPrefilledRef = useRef(openAddPersonPrefilled);
  openAddPersonPrefilledRef.current = openAddPersonPrefilled;

  useAgentRouteState<NavigationState>({
    getNavigationState: ({ pathname }) => {
      const state: NavigationState = { view: "calendar" };

      if (pathname === "/home" || pathname === "") {
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

      state.calendarViewMode = viewMode;

      if (selectedDate) {
        state.date = dateToCalendarDateKey(selectedDate);
      }

      if (sidebarEvent?.id) {
        state.eventId = sidebarEvent.id;
      }

      if (eventDraft?.id) {
        state.eventDraftId = eventDraft.id;
      }

      return state;
    },
    getCommandPath: (cmd) => {
      let path = "/home";
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
        path = "/home";
      }
      return path;
    },
    onNavigate: (cmd) => {
      if (cmd.calendarViewMode) {
        setViewModeRef.current(cmd.calendarViewMode);
      }

      if (cmd.date) {
        const [y, m, d] = cmd.date.split("-").map(Number);
        setSelectedDateRef.current(new Date(y, m - 1, d));
      }

      if (cmd.eventId) {
        const eventId = cmd.eventId;
        void (async () => {
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

      if (cmd.addPersonEmail) {
        openAddPersonPrefilledRef.current(cmd.addPersonEmail);
      }

      if (cmd.eventDraftId || cmd.calendarDraft) {
        void (async () => {
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
