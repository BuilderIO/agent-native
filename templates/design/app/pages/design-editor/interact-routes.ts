/**
 * Interact mode's screen picker. Switching screen switches the screen being
 * previewed, the same hop a prototype link makes. It lists screens by name, not
 * by path: the design's screens are not a site's routes. Back and forward walk
 * a session stack of the screens visited, like a browser tab's history. The
 * route helpers below serve the URL-screen chip in Design, which does show one.
 */

import { prettyScreenName } from "@/lib/screen-names";

export interface InteractRouteScreen {
  id: string;
  filename: string;
  title?: string;
  url?: string;
  previewUrl?: string;
}

export interface InteractScreen {
  screenId: string;
  title: string;
}

function routeFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = (dot > 0 ? filename.slice(0, dot) : filename).replace(
    /^\.?\/+/,
    "",
  );
  if (!stem || stem.toLowerCase() === "index") return "/";
  return `/${stem}`;
}

function routeFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
    // coercion-ok: an unparseable URL names no route, so the caller falls back to the filename route instead of claiming "/".
  } catch {
    return null;
  }
}

/**
 * The route shown for a screen: a URL-backed screen reports the path it is
 * serving (its live path once the app has navigated), a markup screen the path
 * a prototype link would use to reach it (`pricing.html` is `/pricing`).
 */
export function resolveScreenRoute(
  screen: InteractRouteScreen,
  liveRoutePath?: string,
): string {
  const url = screen.url ?? screen.previewUrl;
  // A markup screen reports its own location too, and that is `srcdoc`, not a
  // route, so only a screen serving a URL has a live path worth showing.
  if (url && liveRoutePath) return liveRoutePath;
  if (url) {
    const fromUrl = routeFromUrl(url);
    if (fromUrl) return fromUrl;
  }
  return routeFromFilename(screen.filename);
}

/** The name a screen goes by in the screen controls. */
export function resolveScreenTitle(screen: InteractRouteScreen): string {
  return screen.title?.trim() || prettyScreenName(screen.filename);
}

export function buildInteractScreens(
  screens: readonly InteractRouteScreen[],
): InteractScreen[] {
  return screens.map((screen) => ({
    screenId: screen.id,
    title: resolveScreenTitle(screen),
  }));
}

/**
 * The screen the picker shows: the active one, or the first screen when none
 * is active or it is not a screen of the design. Null only for a design with
 * no screens, so the control never invents one.
 */
export function resolveActiveInteractScreen(
  screens: readonly InteractScreen[],
  activeScreenId: string | null,
): InteractScreen | null {
  return (
    screens.find((screen) => screen.screenId === activeScreenId) ??
    screens[0] ??
    null
  );
}

export interface InteractRouteHistory {
  entries: readonly string[];
  /** Index of the screen being previewed, or -1 before the first visit. */
  index: number;
}

export const EMPTY_INTERACT_ROUTE_HISTORY: InteractRouteHistory = {
  entries: [],
  index: -1,
};

export const MAX_INTERACT_ROUTE_HISTORY = 100;

export type InteractRouteHistoryAction =
  /**
   * The previewed screen changed. `via` says the change was a Back (-1) or
   * Forward (1) press, so it moves along the stack instead of pushing onto it.
   */
  | { type: "visit"; screenId: string; via?: -1 | 1 }
  | { type: "prune"; screenIds: readonly string[] }
  | { type: "reset" };

function visit(
  history: InteractRouteHistory,
  screenId: string,
  via: -1 | 1 | undefined,
): InteractRouteHistory {
  if (history.entries[history.index] === screenId) return history;
  if (via && history.entries[history.index + via] === screenId) {
    return { entries: history.entries, index: history.index + via };
  }
  const kept = history.entries.slice(0, history.index + 1);
  const entries = [...kept, screenId].slice(-MAX_INTERACT_ROUTE_HISTORY);
  return { entries, index: entries.length - 1 };
}

function prune(
  history: InteractRouteHistory,
  screenIds: readonly string[],
): InteractRouteHistory {
  const valid = new Set(screenIds);
  if (history.entries.every((entry) => valid.has(entry))) return history;
  const entries: string[] = [];
  let index = -1;
  history.entries.forEach((entry, position) => {
    if (!valid.has(entry)) return;
    if (entries[entries.length - 1] !== entry) entries.push(entry);
    if (position <= history.index) index = entries.length - 1;
  });
  return { entries, index };
}

export function reduceInteractRouteHistory(
  history: InteractRouteHistory,
  action: InteractRouteHistoryAction,
): InteractRouteHistory {
  switch (action.type) {
    case "visit":
      return visit(history, action.screenId, action.via);
    case "prune":
      return prune(history, action.screenIds);
    case "reset":
      return history.entries.length === 0
        ? history
        : EMPTY_INTERACT_ROUTE_HISTORY;
  }
}

export function interactRouteBackTarget(
  history: InteractRouteHistory,
): string | null {
  return history.index > 0
    ? (history.entries[history.index - 1] ?? null)
    : null;
}

export function interactRouteForwardTarget(
  history: InteractRouteHistory,
): string | null {
  return history.entries[history.index + 1] ?? null;
}
