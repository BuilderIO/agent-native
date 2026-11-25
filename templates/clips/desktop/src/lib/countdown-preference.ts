export const COUNTDOWN_STORAGE_KEY = "clips:recording-countdown";
export const COUNTDOWN_CHANGED_EVENT = "clips:recording-countdown-changed";

export function loadCountdownPreference(): boolean {
  try {
    return window.localStorage.getItem(COUNTDOWN_STORAGE_KEY) !== "0";
  } catch (err) {
    // coercion-ok: unreadable storage keeps the countdown on, its default.
    console.warn("[countdown] could not read the preference", err);
    return true;
  }
}

export function saveCountdownPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(COUNTDOWN_STORAGE_KEY, enabled ? "1" : "0");
  } catch (err) {
    console.warn("[countdown] could not store the preference", err);
  }
  window.dispatchEvent(new Event(COUNTDOWN_CHANGED_EVENT));
}
