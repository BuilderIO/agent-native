import { agentNativePath } from "@agent-native/core/client/api-path";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { readStoredDeckFilter, resolveDeckFilter } from "@/lib/deck-filter";
import { TAB_ID } from "@/lib/tab-id";
import {
  templateLibraryNavigation,
  templateLibraryPath,
} from "@/lib/template-navigation";

export interface NavigationState {
  view: string;
  deckId?: string;
  templateId?: string;
  search?: string;
  deckFilter?: "all" | "created-by-me";
  slideNumber?: number;
  slideIndex?: number;
  _writeId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "list" };

    if (path.startsWith("/deck/")) {
      state.view = "editor";
      const match = path.match(/\/deck\/([^/]+)/);
      if (match) state.deckId = match[1];
      if (path.endsWith("/present")) {
        state.view = "present";
      }
      const params = new URLSearchParams(location.search);
      const slideParam = params.get("slide");
      if (slideParam) {
        const oneBased = parseInt(slideParam, 10);
        if (Number.isFinite(oneBased) && oneBased >= 1) {
          state.slideNumber = oneBased;
          state.slideIndex = oneBased - 1;
        }
      }
    } else if (path === "/templates" || path === "/templates/") {
      Object.assign(state, templateLibraryNavigation(location.search));
    } else if (path.startsWith("/share/")) {
      state.view = "share";
    } else {
      const params = new URLSearchParams(location.search);
      if (path === "/home") {
        state.templateId = templateLibraryNavigation(
          location.search,
        ).templateId;
      }
      state.deckFilter =
        resolveDeckFilter(params.get("createdBy"), readStoredDeckFilter()) ===
        "mine"
          ? "created-by-me"
          : "all";
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

    void write(appStateKeyForBrowserTab("navigation", TAB_ID));
    void write("navigation");
  }, [location.pathname, location.search]);

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

      return read(appStateKeyForBrowserTab("navigate", TAB_ID));
    },
  });

  const lastProcessedDedupKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!navCommand) return;
    const { key, command: cmd } = navCommand;
    const dedupKey =
      cmd._writeId ??
      JSON.stringify({
        view: cmd.view,
        deckId: cmd.deckId,
        templateId: cmd.templateId,
        search: cmd.search,
        slideNumber: cmd.slideNumber,
        slideIndex: cmd.slideIndex,
      });
    if (lastProcessedDedupKeyRef.current === dedupKey) {
      fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
        method: "DELETE",
        headers: { "X-Agent-Native-CSRF": "1", "X-Request-Source": TAB_ID },
      }).catch(() => {});
      qc.setQueryData(["navigate-command", TAB_ID], null);
      return;
    }
    lastProcessedDedupKeyRef.current = dedupKey;

    fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1", "X-Request-Source": TAB_ID },
    }).catch(() => {});
    let path = "/home";

    if (cmd.view === "templates") {
      path = templateLibraryPath(cmd.templateId, cmd.search);
    } else if (cmd.deckId) {
      path = `/deck/${cmd.deckId}`;
      if (cmd.view === "present") {
        path += "/present";
      }
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
        path += `?slide=${internalSlideIndex + 1}`;
      }
    }

    void navigate(path);
    qc.setQueryData(["navigate-command", TAB_ID], null);
  }, [navCommand, navigate, qc]);
}
