/**
 * Timezone hook — resolves the viewer's IANA timezone with `localStorage`
 * persistence and a setter. Booker uses this to display slot times.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "scheduling.timezone";

export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useTimezone(): [string, (tz: string) => void] {
  const [tz, setTz] = useState<string>(() => {
    if (typeof window === "undefined") return "UTC";
    return window.localStorage?.getItem(KEY) || detectBrowserTimezone();
  });
  useEffect(() => {
    try {
      window.localStorage?.setItem(KEY, tz);
    } catch {}
  }, [tz]);
  const update = useCallback((next: string) => setTz(next), []);
  return [tz, update];
}
