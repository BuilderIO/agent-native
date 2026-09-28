import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import {
  buildSettingsRoute,
  STANDARD_APP_ROUTES,
} from "../navigation/index.js";
import { appPath } from "./api-path.js";

/** Dispatched on `window` to open Settings; `detail.page` names a page id. */
export const OPEN_SETTINGS_PAGE_EVENT = "agent-native:open-settings-page";

/** The page ⌘, opens. Legacy ids resolve through the settings redirect table. */
export const SETTINGS_SHORTCUT_PAGE = "account";

export interface OpenSettingsPageDetail {
  page?: string;
}

type SettingsShortcutKeyInput = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export function isSettingsShortcutEvent(
  event: SettingsShortcutKeyInput,
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return false;
  }
  return event.key === "," || event.code === "Comma";
}

// Router paths are basename-relative: React Router adds the app base path, so
// adding it here too would double it (/slides/slides/settings) in mounted apps.
export function isSettingsRoutePath(routerPathname: string): boolean {
  const settingsPath = STANDARD_APP_ROUTES.settings;
  return (
    routerPathname === settingsPath ||
    routerPathname.startsWith(`${settingsPath}/`)
  );
}

export function settingsPagePath(page: string = SETTINGS_SHORTCUT_PAGE) {
  return buildSettingsRoute(page);
}

export function getSettingsShortcutHint(isMac: boolean): string {
  return isMac ? "⌘," : "Ctrl+,";
}

/**
 * Opens a Settings page from code outside the router (for example the command
 * menu). A mounted `useSettingsShortcut` claims the request and navigates in
 * the router; without one, the browser loads the page directly so the request
 * never silently does nothing.
 */
export function openSettingsPage(page?: string): void {
  if (typeof window === "undefined") return;
  const event = new CustomEvent<OpenSettingsPageDetail>(
    OPEN_SETTINGS_PAGE_EVENT,
    { cancelable: true, detail: page ? { page } : {} },
  );
  const unclaimed = window.dispatchEvent(event);
  if (unclaimed) window.location.assign(appPath(settingsPagePath(page)));
}

/**
 * ⌘, (Ctrl+, off macOS) opens Settings from anywhere in the app, including
 * inside inputs and editors. It is a no-op on a Settings route.
 */
export function useSettingsShortcut({
  enabled = true,
}: { enabled?: boolean } = {}): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!enabled) return;

    const open = (page?: string) => {
      if (!page && isSettingsRoutePath(pathname)) return;
      void navigate(settingsPagePath(page));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // A second mounted instance has already claimed this press.
      if (event.defaultPrevented || event.isComposing) return;
      if (!isSettingsShortcutEvent(event)) return;
      event.preventDefault();
      if (event.repeat) return;
      open();
    };

    const handleOpenRequest = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      open((event as CustomEvent<OpenSettingsPageDetail>).detail?.page);
    };

    // Capture on window so editors that stop propagation cannot swallow it.
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener(OPEN_SETTINGS_PAGE_EVENT, handleOpenRequest);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener(OPEN_SETTINGS_PAGE_EVENT, handleOpenRequest);
    };
  }, [enabled, navigate, pathname]);
}

/** Mount point for `useSettingsShortcut`; must render inside a router. */
export function SettingsShortcut(): null {
  useSettingsShortcut();
  return null;
}
