import { createContext, useContext, useEffect, type ReactNode } from "react";

import type { SettingsRoute } from "./routing.js";

export interface SettingsPageHeader {
  /** Replaces the page label as the header title (a sub-page's own name). */
  title?: ReactNode;
  /** Rendered at the right of the header, replacing the page's `primaryAction`. */
  action?: ReactNode;
}

export interface SettingsShellContextValue {
  route: SettingsRoute;
  navigate: (
    page: string,
    sub?: string | null,
    options?: { replace?: boolean; anchor?: string | null },
  ) => void;
  setHeader: (header: SettingsPageHeader | null) => void;
}

const SettingsShellContext = createContext<SettingsShellContextValue | null>(
  null,
);

export const SettingsShellProvider = SettingsShellContext.Provider;

export function useSettingsShell(): SettingsShellContextValue {
  const value = useContext(SettingsShellContext);
  if (!value) {
    throw new Error("useSettingsShell must be used inside the Settings shell");
  }
  return value;
}

/**
 * Let a page name its sub-page or put an action in the sticky header. Pass a
 * stable object (memoize it); the header resets when the page unmounts.
 */
export function useSettingsPageHeader(header: SettingsPageHeader | null) {
  const { setHeader } = useSettingsShell();
  useEffect(() => {
    setHeader(header);
    return () => setHeader(null);
  }, [header, setHeader]);
}
