import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { trackMobileEvent } from "@/lib/analytics";
import { useCurrentPathname } from "@/lib/navigation";

export default function MobileAnalyticsObserver() {
  const pathname = useCurrentPathname();
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    void trackMobileEvent("pageview", {
      app: "mobile",
      path: pathname,
      url: pathname,
      navigation_type: "native",
    });
  }, [pathname]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void trackMobileEvent("mobile_app_foreground", {
        app: "mobile",
        path: pathname ?? "/",
      });
    });
    return () => subscription.remove();
  }, [pathname]);

  return null;
}
