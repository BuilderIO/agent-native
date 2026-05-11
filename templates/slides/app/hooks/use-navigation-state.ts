import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  deckId?: string;
  slideIndex?: number;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "list" };

    if (path.startsWith("/deck/")) {
      state.view = "editor";
      const match = path.match(/\/deck\/([^/]+)/);
      if (match) state.deckId = match[1];
      // Presentation mode
      if (path.endsWith("/present")) {
        state.view = "present";
      }
      // The deck editor stores the active slide as a 1-based ?slide=N URL
      // param. Convert to a 0-based index for the agent so view-screen can
      // pick the correct slide; without this, the agent always thought the
      // user was on slide 1 (off-by-one vs. the toolbar's "6 of 10").
      const params = new URLSearchParams(location.search);
      const slideParam = params.get("slide");
      if (slideParam) {
        const oneBased = parseInt(slideParam, 10);
        if (Number.isFinite(oneBased) && oneBased >= 1) {
          state.slideIndex = oneBased - 1;
        }
      }
    } else if (path.startsWith("/settings")) {
      state.view = "settings";
    } else if (path.startsWith("/share/")) {
      state.view = "share";
    }

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Source": TAB_ID,
      },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, location.search]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      try {
        const data = JSON.parse(text);
        if (data) {
          // Return with a timestamp to ensure uniqueness
          return { ...data, _ts: Date.now() };
        }
      } catch {
        // Empty or invalid JSON response — no navigate command
      }
      return null;
    },
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1", "X-Request-Source": TAB_ID },
    }).catch(() => {});
    const cmd = navCommand as NavigationState;
    let path = "/";

    if (cmd.deckId) {
      path = `/deck/${cmd.deckId}`;
      if (cmd.view === "present") {
        path += "/present";
      } else if (
        typeof cmd.slideIndex === "number" &&
        Number.isFinite(cmd.slideIndex) &&
        cmd.slideIndex >= 0
      ) {
        // Convert agent's 0-based slideIndex back to the 1-based ?slide=N
        // URL param the editor reads. Without this the deck always opened
        // at slide 1 even when the agent asked for a different slide.
        path += `?slide=${cmd.slideIndex + 1}`;
      }
    } else if (cmd.view === "settings") {
      path = "/settings";
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
