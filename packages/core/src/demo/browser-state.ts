/** Browser-local Demo mode state.
 *
 * Demo mode is a presentation preference for this browser only. It must not
 * be persisted in application state or consulted by backend actions.
 */
export const DEMO_MODE_STORAGE_KEY = "agent-native:demo-mode";

const DEMO_MODE_CHANGE_EVENT = "agent-native:demo-mode-change";

export function getBrowserDemoModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEMO_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setBrowserDemoModeEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
    }
  } catch {
    // A blocked or unavailable localStorage should not break the settings UI.
  }
  window.dispatchEvent(new Event(DEMO_MODE_CHANGE_EVENT));
}

export function subscribeToBrowserDemoMode(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onStorage = (event: StorageEvent) => {
    if (event.key === DEMO_MODE_STORAGE_KEY || event.key === null) callback();
  };
  const onChange = () => callback();

  window.addEventListener("storage", onStorage);
  window.addEventListener(DEMO_MODE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DEMO_MODE_CHANGE_EVENT, onChange);
  };
}
