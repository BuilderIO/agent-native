declare global {
  interface Window {
    AhrefsAnalytics?: {
      sendEvent: (
        name: string,
        options?: { props?: Record<string, string> },
      ) => void;
    };
  }
}

export function sendAhrefsEvent(
  name: string,
  props?: Record<string, string>,
): void {
  if (typeof window === "undefined") return;
  window.AhrefsAnalytics?.sendEvent(name, props ? { props } : undefined);
}
