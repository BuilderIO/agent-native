import { useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCalendarContext } from "@/components/layout/AppLayout";

interface NavigationState {
  view: string;
  date?: string;
  eventId?: string;
  bookingLinkId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { selectedDate, sidebarEvent } = useCalendarContext();

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

    // Include the currently selected date
    if (selectedDate) {
      state.date = selectedDate.toISOString().split("T")[0];
    }

    // Include the selected event if one is open
    if (sidebarEvent?.id) {
      state.eventId = sidebarEvent.id;
    }

    fetch("/api/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, selectedDate, sidebarEvent]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch("/api/application-state/navigate");
      if (!res.ok) return null;
      const data = await res.json();
      if (data) {
        // Delete the one-shot command
        fetch("/api/application-state/navigate", { method: "DELETE" }).catch(
          () => {},
        );
        return data;
      }
      return null;
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!navCommand) return;
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

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
