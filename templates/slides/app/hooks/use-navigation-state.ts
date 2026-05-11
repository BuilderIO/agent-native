import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  deckId?: string;
  slideIndex?: number;
  /** Optional unique-per-write token. When present, the UI uses it to detect
   * legitimate repeat writes (same payload, different `_writeId`) vs. the
   * race where DELETE didn't land before the next polling refetch. Older
   * writers may omit it; the dedup logic falls back to content equality.  */
  _writeId?: string;
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

  // Listen for navigate commands from agent. Default React Query options
  // (`structuralSharing: true`) deep-equal the response and reuse the previous
  // reference when the value hasn't changed — so repeated invalidations
  // triggered by `useDbSync` (which fire on every app-state event including
  // unrelated keys like `slide-fit-check`) don't churn the useEffect below.
  const { data: navCommand } = useQuery<NavigationState | null>({
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
        return data ?? null;
      } catch {
        return null;
      }
    },
  });

  // Dedup re-processing of the same navigate command. Two ways the same
  // command can be read more than once: (1) the fire-and-forget DELETE below
  // hasn't reached the server before the next `useDbSync`-driven refetch, so
  // the GET still returns the old value, and (2) the agent error path leaves
  // a stale command in `application_state` that every subsequent app-state
  // event keeps re-reading. Without this dedup the editor visibly flips
  // between slides — most painfully when both `navigate` and `__set_url__`
  // have stale commands pointing at different slides, producing an
  // oscillation between two slide indexes. Dedup key prefers the writer's
  // `_writeId` (unique per write) and falls back to content equality so older
  // writers that haven't been updated to include `_writeId` still benefit.
  const lastProcessedDedupKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!navCommand) return;

    const cmd = navCommand;
    const dedupKey =
      cmd._writeId ??
      JSON.stringify({
        view: cmd.view,
        deckId: cmd.deckId,
        slideIndex: cmd.slideIndex,
      });
    if (lastProcessedDedupKeyRef.current === dedupKey) {
      // Same command we already handled. Re-fire the DELETE in case the
      // earlier one lost its race, and clear the local cache so we don't
      // re-enter on the next render.
      fetch(agentNativePath("/_agent-native/application-state/navigate"), {
        method: "DELETE",
        headers: { "X-Agent-Native-CSRF": "1", "X-Request-Source": TAB_ID },
      }).catch(() => {});
      qc.setQueryData(["navigate-command"], null);
      return;
    }
    lastProcessedDedupKeyRef.current = dedupKey;

    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1", "X-Request-Source": TAB_ID },
    }).catch(() => {});
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
