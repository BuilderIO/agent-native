import { agentNativePath } from "@agent-native/core/client";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  deckId?: string;
  deckFilter?: "all" | "created-by-me";
  /** User-visible slide number. 1-based and matches the editor UI. */
  slideNumber?: number;
  /** Internal zero-based slide index kept for backwards compatibility. */
  slideIndex?: number;
  /** Optional unique-per-write token. When present, the UI uses it to detect
   * legitimate repeat writes (same payload, different `_writeId`) vs. the
   * race where DELETE didn't land before the next polling refetch. Older
   * writers may omit it; the dedup logic falls back to content equality. */
  _writeId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state. The tab-scoped key is what chat
  // requests from this browser tab read; the global key remains for CLI and
  // older callers that do not send a browser tab id.
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
      // param. Write both the UI-facing slideNumber and the legacy
      // zero-based slideIndex so agent context can be explicit without
      // breaking older callers.
      const params = new URLSearchParams(location.search);
      const slideParam = params.get("slide");
      if (slideParam) {
        const oneBased = parseInt(slideParam, 10);
        if (Number.isFinite(oneBased) && oneBased >= 1) {
          state.slideNumber = oneBased;
          state.slideIndex = oneBased - 1;
        }
      }
    } else if (path.startsWith("/share/")) {
      state.view = "share";
    } else {
      const params = new URLSearchParams(location.search);
      state.deckFilter =
        params.get("createdBy") === "me" ? "created-by-me" : "all";
    }

    const write = (key: string) =>
      fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
        method: "PUT",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Source": TAB_ID,
        },
        body: JSON.stringify(state),
      }).catch(() => {});

    write(appStateKeyForBrowserTab("navigation", TAB_ID));
    write("navigation");
  }, [location.pathname, location.search]);

  // Listen for navigate commands from agent. Prefer the one-shot command for
  // this browser tab; fall back to the legacy global command for CLI actions.
  const { data: navCommand } = useQuery<{
    key: string;
    command: NavigationState;
  } | null>({
    queryKey: ["navigate-command", TAB_ID],
    queryFn: async () => {
      const read = async (key: string) => {
        const res = await fetch(
          agentNativePath(`/_agent-native/application-state/${key}`),
        );
        if (!res.ok) return null;
        const text = await res.text();
        if (!text) return null;
        try {
          const data = JSON.parse(text);
          return data ? { key, command: data as NavigationState } : null;
        } catch {
          return null;
        }
      };

      return (
        (await read(appStateKeyForBrowserTab("navigate", TAB_ID))) ??
        (await read("navigate"))
      );
    },
  });

  // Dedup re-processing of the same navigate command. Two ways the same
  // command can be read more than once: (1) the fire-and-forget DELETE below
  // hasn't reached the server before the next `useDbSync`-driven refetch, so
  // the GET still returns the old value, and (2) the agent error path leaves
  // a stale command in `application_state` that every subsequent app-state
  // event keeps re-reading. Without this dedup the editor visibly flips
  // between slides. Dedup key prefers the writer's `_writeId` and falls back
  // to content equality so older writers still benefit.
  const lastProcessedDedupKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!navCommand) return;
    const { key, command: cmd } = navCommand;
    const dedupKey =
      cmd._writeId ??
      JSON.stringify({
        view: cmd.view,
        deckId: cmd.deckId,
        slideNumber: cmd.slideNumber,
        slideIndex: cmd.slideIndex,
      });
    if (lastProcessedDedupKeyRef.current === dedupKey) {
      // Same command we already handled. Re-fire the DELETE in case the
      // earlier one lost its race, and clear the local cache so we don't
      // re-enter on the next render.
      fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
        method: "DELETE",
        headers: { "X-Agent-Native-CSRF": "1", "X-Request-Source": TAB_ID },
      }).catch(() => {});
      qc.setQueryData(["navigate-command", TAB_ID], null);
      return;
    }
    lastProcessedDedupKeyRef.current = dedupKey;

    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1", "X-Request-Source": TAB_ID },
    }).catch(() => {});
    let path = "/";

    if (cmd.deckId) {
      path = `/deck/${cmd.deckId}`;
      if (cmd.view === "present") {
        path += "/present";
      } else {
        const internalSlideIndex =
          typeof cmd.slideNumber === "number" &&
          Number.isFinite(cmd.slideNumber) &&
          cmd.slideNumber >= 1
            ? cmd.slideNumber - 1
            : cmd.slideIndex;
        if (
          typeof internalSlideIndex === "number" &&
          Number.isFinite(internalSlideIndex) &&
          internalSlideIndex >= 0
        ) {
          // Convert the internal zero-based value back to the 1-based
          // ?slide=N URL param the editor reads.
          path += `?slide=${internalSlideIndex + 1}`;
        }
      }
    }

    navigate(path);
    qc.setQueryData(["navigate-command", TAB_ID], null);
  }, [navCommand, navigate, qc]);
}
