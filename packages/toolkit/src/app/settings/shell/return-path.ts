import { STANDARD_APP_ROUTES } from "@agent-native/core/navigation";

import { settingsLocalPathname } from "./routing.js";

const RETURN_PATH_KEY = "agent-native:settings-return-path";
const SETTINGS_PREFIX = STANDARD_APP_ROUTES.settings;

let memoryReturnPath: string | null = null;

function isSettingsRoute(pathname: string): boolean {
  return (
    pathname === SETTINGS_PREFIX || pathname.startsWith(`${SETTINGS_PREFIX}/`)
  );
}

/**
 * Remember the app route the viewer is on so Settings' "Back to {App}" can
 * return there. Router-relative paths only; Settings routes are ignored.
 *
 * A mounted app (for example `/calendar-app`) hands in the base-prefixed pathname,
 * and every reader applies the mount again, so the mount is stripped here once.
 * Keeping a base-prefixed path made Escape from Settings land on a doubled base
 * (`/calendar-app/calendar-app/home`), which the app renders as "Route not found".
 */
export function rememberSettingsReturnPath(
  pathname: string,
  search = "",
): void {
  const local = settingsLocalPathname(pathname);
  if (!local.startsWith("/") || isSettingsRoute(local)) return;
  const path = `${local}${search}`;
  memoryReturnPath = path;
  try {
    window.sessionStorage.setItem(RETURN_PATH_KEY, path);
  } catch {
    // coercion-ok: the in-memory copy still serves this document; storage only
    // carries the path across a reload.
  }
}

/** The last app route, or `null` when none was recorded (Back then goes home). */
export function readSettingsReturnPath(): string | null {
  if (memoryReturnPath) return memoryReturnPath;
  try {
    const stored = window.sessionStorage.getItem(RETURN_PATH_KEY);
    // A path stored by an earlier build may still carry the mount; strip it so a
    // reader that applies the mount cannot double it.
    const local = stored ? settingsLocalPathname(stored) : null;
    return local && local.startsWith("/") && !isSettingsRoute(local)
      ? local
      : null;
  } catch {
    // coercion-ok: unreadable storage is the same as nothing recorded; Back
    // falls back to the app's home.
    return null;
  }
}

/** Test-only reset. */
export function _resetSettingsReturnPathForTests(): void {
  memoryReturnPath = null;
}
