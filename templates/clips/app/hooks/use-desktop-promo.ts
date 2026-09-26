import { useEffect, useState } from "react";

import { useIsMobile } from "@/hooks/use-mobile";

function detectDesktopApp(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/Electron/i.test(navigator.userAgent)) return true;
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

  useEffect(() => {
    setIsDesktopApp(detectDesktopApp());
    setRuntimeDetected(true);
  }, []);

  return {
    isDesktopApp,
    isMobile,
    shouldShowSidebarLink: runtimeDetected && !isMobile && !isDesktopApp,
  };
}
