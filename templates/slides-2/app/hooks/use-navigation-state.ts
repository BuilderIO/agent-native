import {
  deleteClientAppState,
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/application-state";
import { useActionQuery } from "@agent-native/core/client/hooks";
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
  app?: string;
  view: string;
  deckId?: string;
  slideId?: string | null;
  templateId?: string;
  themeId?: string;
  search?: string;
  homeTab?: "recent" | "templates";
  deckSearch?: string;
  deckFilter?: "all" | "created-by-me" | "shared";
  slideNumber?: number;
  slideIndex?: number;
  _writeId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const routeDeckId = location.pathname.match(/^\/deck\/([^/]+)/)?.[1];
  const deckQuery = useActionQuery(
    "get-deck",
    { id: routeDeckId ?? "", compact: "true" },
    { enabled: Boolean(routeDeckId) },
  );
  const params = new URLSearchParams(location.search);
  const slideParam = params.get("p") ?? params.get("slide");
  const slideNumber = Number.parseInt(slideParam ?? "1", 10);
  const requestedSlideIndex = Number.isFinite(slideNumber)
    ? Math.max(0, slideNumber - 1)
    : 0;
  const slideCount = deckQuery.data?.slides?.length ?? 0;
  const activeSlideIndex = slideCount
    ? Math.min(requestedSlideIndex, slideCount - 1)
    : requestedSlideIndex;
  const activeSlideId = deckQuery.data?.slides?.[activeSlideIndex]?.id;

  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { app: "slides-2", view: "list" };

    if (path.startsWith("/deck/")) {
      state.view = "editor";
      const match = path.match(/\/deck\/([^/]+)/);
      if (match) {
        state.deckId = match[1];
        state.slideId = activeSlideId ?? null;
      }
      if (path.endsWith("/present")) {
        state.view =
          params.get("view") === "presenter" ? "presenter" : "present";
      }
      if (slideParam) {
        const oneBased = parseInt(slideParam, 10);
        if (Number.isFinite(oneBased) && oneBased >= 1) {
          state.slideNumber = activeSlideIndex + 1;
          state.slideIndex = activeSlideIndex;
        }
      }
    } else if (path === "/themes" || path === "/themes/") {
      state.view = "themes";
    } else if (path.startsWith("/themes/")) {
      state.view = "themes";
      state.themeId = path.slice("/themes/".length).split("/")[0];
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
        const homeTab = params.get("homeTab");
        if (homeTab === "recent" || homeTab === "templates") {
          state.homeTab = homeTab;
        } else if (params.get("deckSearch")?.trim()) {
          state.homeTab = "recent";
        }
        state.deckSearch = params.get("deckSearch")?.slice(0, 200) || undefined;
      }
      const resolvedDeckFilter = resolveDeckFilter(
        params.get("createdBy"),
        readStoredDeckFilter(),
      );
      state.deckFilter =
        resolvedDeckFilter === "mine"
          ? "created-by-me"
          : resolvedDeckFilter === "not-mine"
            ? "shared"
            : "all";
    }

    const write = (key: string, value: unknown = state) =>
      writeClientAppState(key, value, {
        keepalive: true,
        requestSource: TAB_ID,
      }).catch((error) =>
        console.error(`Could not update application state "${key}".`, error),
      );
    const clear = (key: string) =>
      deleteClientAppState(key, {
        keepalive: true,
        requestSource: TAB_ID,
      }).catch((error) =>
        console.error(`Could not clear application state "${key}".`, error),
      );

    void write(appStateKeyForBrowserTab("navigation", TAB_ID));
    void write("navigation");
    if (state.view !== "editor") {
      void clear(appStateKeyForBrowserTab("slides-open-panel", TAB_ID));
      void write(appStateKeyForBrowserTab("slides-panels", TAB_ID), {
        layersOpen: false,
        animationsOpen: false,
      });
      if (state.view === "list" || state.view === "templates") {
        void clear(appStateKeyForBrowserTab("slides-selection", TAB_ID));
      }
    }
  }, [activeSlideId, location.pathname, location.search]);

  const { data: navCommand } = useQuery<{
    key: string;
    command: NavigationState;
  } | null>({
    queryKey: ["navigate-command", TAB_ID],
    queryFn: async () => {
      const key = appStateKeyForBrowserTab("navigate", TAB_ID);
      const command = await readClientAppState<NavigationState>(key);
      return command ? { key, command } : null;
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
        themeId: cmd.themeId,
        search: cmd.search,
        homeTab: cmd.homeTab,
        deckSearch: cmd.deckSearch,
        deckFilter: cmd.deckFilter,
        slideNumber: cmd.slideNumber,
        slideIndex: cmd.slideIndex,
      });
    if (lastProcessedDedupKeyRef.current === dedupKey) {
      void deleteClientAppState(key, { requestSource: TAB_ID }).catch((error) =>
        console.error(`Could not clear application state "${key}".`, error),
      );
      qc.setQueryData(["navigate-command", TAB_ID], null);
      return;
    }
    lastProcessedDedupKeyRef.current = dedupKey;

    void deleteClientAppState(key, { requestSource: TAB_ID }).catch((error) =>
      console.error(`Could not clear application state "${key}".`, error),
    );
    let path = "/home";

    if (cmd.view === "themes") {
      path = cmd.themeId
        ? `/themes/${encodeURIComponent(cmd.themeId)}`
        : "/themes";
    } else if (cmd.view === "templates") {
      path = templateLibraryPath(cmd.templateId, cmd.search);
    } else if (
      cmd.view === "list" &&
      (cmd.homeTab || cmd.deckSearch || cmd.deckFilter)
    ) {
      const params = new URLSearchParams();
      const homeTab = cmd.deckSearch || cmd.deckFilter ? "recent" : cmd.homeTab;
      if (homeTab) params.set("homeTab", homeTab);
      if (cmd.deckSearch) params.set("deckSearch", cmd.deckSearch);
      if (cmd.deckFilter === "all") params.set("createdBy", "all");
      if (cmd.deckFilter === "created-by-me") params.set("createdBy", "me");
      if (cmd.deckFilter === "shared") params.set("createdBy", "not-me");
      path = `/home?${params}`;
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
