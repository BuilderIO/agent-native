import {
  resolveInteractPreviewTheme,
  type InteractPreviewTheme,
  type InteractThemeAvailability,
  type InteractThemeMode,
  type PreviewColorScheme,
} from "@shared/preview-color-scheme";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { PreviewThemeStatus } from "@/components/design/design-canvas/preview-theme";

import {
  buildInteractRoutes,
  EMPTY_INTERACT_ROUTE_HISTORY,
  interactRouteBackTarget,
  interactRouteForwardTarget,
  reduceInteractRouteHistory,
  type InteractRoute,
  type InteractRouteScreen,
} from "../interact-routes";

/** How long a Back or Forward press stays attributable to the screen change it caused. */
const ROUTE_INTENT_TTL_MS = 2000;

export interface InteractControls {
  interactRoutes: InteractRoute[];
  canGoBackInteractRoute: boolean;
  canGoForwardInteractRoute: boolean;
  handleInteractRouteSelect: (screenId: string) => void;
  handleInteractRouteBack: () => void;
  handleInteractRouteForward: () => void;
  handleScreenReload: () => void;
  /** Reload count by screen id; a frame remounts when its count changes. */
  screenReloadNonces: Readonly<Record<string, number>>;
  interactPreviewTheme: InteractPreviewTheme;
  /** The scheme to force in the preview; null outside Interact. */
  previewColorScheme: PreviewColorScheme | null;
}

function themeAvailability(
  status: PreviewThemeStatus | undefined,
): InteractThemeAvailability {
  if (!status) return "pending";
  return status.kind === "unavailable" ? "unavailable" : status.darkStyles;
}

/**
 * The state behind Interact's route, reload and theme controls. Route changes
 * of any origin (the picker, a prototype link, the agent) arrive as a change of
 * the active screen, so the history stack records them in one place.
 */
export function useInteractControls({
  active,
  activeScreenId,
  screens,
  liveRoutePathsByScreenId,
  interactTheme,
  setInteractTheme,
  requestDarkStyles,
  activeThemeStatus,
  navigateToScreen,
}: {
  active: boolean;
  activeScreenId: string | null;
  screens: readonly InteractRouteScreen[];
  liveRoutePathsByScreenId: Readonly<Record<string, string>>;
  interactTheme: InteractThemeMode;
  setInteractTheme: (mode: InteractThemeMode) => void;
  /** Put the request to add dark styles in the agent chat, unsent. */
  requestDarkStyles: () => void;
  activeThemeStatus: PreviewThemeStatus | undefined;
  /** Switches the previewed screen without leaving Interact or its device. */
  navigateToScreen: (screenId: string) => void;
}): InteractControls & {
  handleInteractThemeChange: (mode: InteractThemeMode) => void;
} {
  const [history, dispatch] = useReducer(
    reduceInteractRouteHistory,
    EMPTY_INTERACT_ROUTE_HISTORY,
  );
  const intentRef = useRef<{
    screenId: string;
    via: -1 | 1;
    at: number;
  } | null>(null);

  useEffect(() => {
    if (!active) {
      intentRef.current = null;
      dispatch({ type: "reset" });
      return;
    }
    if (!activeScreenId) return;
    const intent = intentRef.current;
    intentRef.current = null;
    const fromPress =
      intent &&
      intent.screenId === activeScreenId &&
      Date.now() - intent.at < ROUTE_INTENT_TTL_MS
        ? intent.via
        : undefined;
    dispatch({ type: "visit", screenId: activeScreenId, via: fromPress });
  }, [active, activeScreenId]);

  const screenIdsKey = screens.map((screen) => screen.id).join("\0");
  useEffect(() => {
    dispatch({
      type: "prune",
      screenIds: screenIdsKey ? screenIdsKey.split("\0") : [],
    });
  }, [screenIdsKey]);

  const goTo = useCallback(
    (screenId: string | null, via: -1 | 1) => {
      if (!screenId) return;
      intentRef.current = { screenId, via, at: Date.now() };
      navigateToScreen(screenId);
    },
    [navigateToScreen],
  );
  const handleInteractRouteBack = useCallback(
    () => goTo(interactRouteBackTarget(history), -1),
    [goTo, history],
  );
  const handleInteractRouteForward = useCallback(
    () => goTo(interactRouteForwardTarget(history), 1),
    [goTo, history],
  );
  const handleInteractRouteSelect = useCallback(
    (screenId: string) => {
      if (screenId === activeScreenId) return;
      navigateToScreen(screenId);
    },
    [activeScreenId, navigateToScreen],
  );

  // Per screen, and never reset: a frame keeps the identity its last reload
  // gave it, so reloading one screen cannot remount another.
  const [screenReloadNonces, setScreenReloadNonces] = useState<
    Record<string, number>
  >({});
  const handleScreenReload = useCallback(() => {
    if (!activeScreenId) return;
    setScreenReloadNonces((nonces) => ({
      ...nonces,
      [activeScreenId]: (nonces[activeScreenId] ?? 0) + 1,
    }));
  }, [activeScreenId]);

  const interactPreviewTheme = resolveInteractPreviewTheme({
    mode: interactTheme,
    availability: themeAvailability(activeThemeStatus),
  });
  const { darkAvailable } = interactPreviewTheme;
  // With no dark styles there is nothing to preview, so Dark leaves the theme
  // alone and asks the agent to write them.
  const handleInteractThemeChange = useCallback(
    (next: InteractThemeMode) => {
      if (next === "dark" && !darkAvailable) {
        requestDarkStyles();
        return;
      }
      setInteractTheme(next);
    },
    [darkAvailable, requestDarkStyles, setInteractTheme],
  );

  return {
    interactRoutes: buildInteractRoutes(screens, liveRoutePathsByScreenId),
    canGoBackInteractRoute: interactRouteBackTarget(history) !== null,
    canGoForwardInteractRoute: interactRouteForwardTarget(history) !== null,
    handleInteractRouteSelect,
    handleInteractRouteBack,
    handleInteractRouteForward,
    handleScreenReload,
    screenReloadNonces,
    interactPreviewTheme,
    previewColorScheme: active ? interactPreviewTheme.scheme : null,
    handleInteractThemeChange,
  };
}
