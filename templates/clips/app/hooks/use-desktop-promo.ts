import { useCallback, useEffect, useState } from "react";

const DISMISSED_KEY = "clips.desktop-promo.dismissed";

function detectDesktopApp(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/Electron/i.test(navigator.userAgent)) return true;
  // Tauri v2 exposes `__TAURI_INTERNALS__` on window; v1 used `__TAURI__`.
  if (typeof window !== "undefined") {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: unknown;
      __TAURI__?: unknown;
    };
    if (w.__TAURI_INTERNALS__ || w.__TAURI__) return true;
  }
  return false;
}

export function useDesktopPromo() {
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setIsDesktopApp(detectDesktopApp());
    setDismissed(
      typeof window !== "undefined" &&
        window.localStorage?.getItem(DISMISSED_KEY) === "1",
    );
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage?.setItem(DISMISSED_KEY, "1");
    } catch {
      // localStorage can throw in private browsing — ignore, dismissal
      // still holds for the session via React state.
    }
  }, []);

  return {
    isDesktopApp,
    shouldShowPromo: !isDesktopApp && !dismissed,
    shouldShowSidebarLink: !isDesktopApp,
    dismiss,
  };
}
