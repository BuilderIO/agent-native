import { STANDARD_APP_ROUTES } from "../../../navigation/index.js";

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
 */
export function rememberSettingsReturnPath(
  pathname: string,
  search = "",
): void {
  if (!pathname.startsWith("/") || isSettingsRoute(pathname)) return;
  const path = `${pathname}${search}`;
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
    return stored && stored.startsWith("/") && !isSettingsRoute(stored)
      ? stored
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
