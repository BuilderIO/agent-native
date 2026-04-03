import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCalendarContext,
  type ViewMode,
} from "@/components/layout/AppLayout";

interface NavigationState {
  view: string;
  calendarViewMode?: ViewMode;
  date?: string;
  eventId?: string;
  bookingLinkId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { selectedDate, viewMode, setViewMode, setSelectedDate, sidebarEvent } =
    useCalendarContext();

  // Sync current route to application state
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "calendar" };

    if (path === "/" || path === "") {
      state.view = "calendar";
    } else if (path.startsWith("/availability")) {
      state.view = "availability";
    } else if (path.startsWith("/booking-links")) {
      state.view = "booking-links";
      const match = path.match(/\/booking-links\/(.+)/);
      if (match) state.bookingLinkId = match[1];
    } else if (path.startsWith("/bookings")) {
      state.view = "bookings";
    } else if (path.startsWith("/settings")) {
      state.view = "settings";
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

    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, selectedDate, viewMode, sidebarEvent]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/application-state/navigate");
      if (!res.ok) return null;
      const data = await res.json();
      if (data) {
        // Return with a timestamp to ensure uniqueness
        return { ...data, _ts: Date.now() };
      }
      return null;
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    // Delete the one-shot command AFTER reading it
    fetch("/_agent-native/application-state/navigate", {
      method: "DELETE",
    }).catch(() => {});
    const cmd = navCommand as NavigationState;
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
    } else {
      path = "/";
    }

    // Apply calendar view mode change (day/week/month)
    if (cmd.calendarViewMode) {
      setViewMode(cmd.calendarViewMode);
    }

    // Apply date change
    if (cmd.date) {
      // Parse YYYY-MM-DD as local date (not UTC)
      const [y, m, d] = cmd.date.split("-").map(Number);
      setSelectedDate(new Date(y, m - 1, d));
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc, setViewMode, setSelectedDate]);
}
