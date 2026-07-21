import { useCallback, useEffect, useState } from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import {
  hasDownloadedDesktopApp,
  markDesktopAppDownloaded,
} from "@/lib/capture-install-options";

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
  const isMobile = useIsMobile();
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [runtimeDetected, setRuntimeDetected] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setIsDesktopApp(detectDesktopApp());
    setDismissed(hasDownloadedDesktopApp());
    // Keep desktop prompts hidden until the client runtime is known. This
    // prevents the web CTA from flashing in the desktop shell's first render.
    setRuntimeDetected(true);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    markDesktopAppDownloaded();
  }, []);

  return {
    isDesktopApp,
    isMobile,
    shouldShowPromo:
      runtimeDetected && !isMobile && !isDesktopApp && !dismissed,
    shouldShowSidebarLink: runtimeDetected && !isMobile && !isDesktopApp,
    dismiss,
  };
}
