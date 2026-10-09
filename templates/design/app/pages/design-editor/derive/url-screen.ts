import type { DesignSourceType } from "@shared/source-mode";

import { previewUrlAtLiveRoute } from "../design-editor-shared";
import { resolveScreenRoute, resolveScreenTitle } from "../interact-routes";
import { resolveOverviewScreenSourceType } from "../pending-edits";
import type { OverviewScreen } from "./overview-screens";

export interface UrlScreen {
  /** The screen's name, shown beside its route. */
  title: string;
  /** The live path once the running app has navigated, else the path of its URL. */
  route: string;
  /** The URL the screen serves. */
  url: string;
  /** Where Open in browser goes, or null when the URL is not an http(s) page. */
  openUrl: string | null;
}

/**
 * Open in browser lands on the page the preview is showing, which is the same
 * address the frame loads: the screen's URL moved to its live route.
 */
function resolveOpenUrl(url: string, liveRoutePath?: string): string | null {
  const href = previewUrlAtLiveRoute(url, liveRoutePath) ?? url;
  try {
    const target = new URL(href);
    return target.protocol === "http:" || target.protocol === "https:"
      ? target.href
      : null;
    // coercion-ok: an unparseable URL has nowhere to open, and null disables the control instead of opening a wrong page.
  } catch {
    return null;
  }
}

/**
 * The URL-backed screen the top bar shows route, Reload and Open in browser
 * for. A markup screen has no running app behind it, so it returns null.
 */
export function resolveUrlScreen({
  screen,
  fallbackSourceType,
  liveRoutePath,
}: {
  screen: OverviewScreen | null | undefined;
  fallbackSourceType: DesignSourceType;
  liveRoutePath?: string;
}): UrlScreen | null {
  if (!screen) return null;
  if (
    resolveOverviewScreenSourceType(screen, fallbackSourceType) !== "localhost"
  ) {
    return null;
  }
  const url = (screen.url ?? screen.previewUrl ?? screen.content).trim();
  if (!url) return null;
  return {
    title: resolveScreenTitle(screen),
    route: resolveScreenRoute({ ...screen, url }, liveRoutePath),
    url,
    openUrl: resolveOpenUrl(url, liveRoutePath),
  };
}
