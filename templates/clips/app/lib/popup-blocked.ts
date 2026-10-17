/**
 * `window.open` returned null for an OAuth popup. Callers show the localized
 * `clipsSettings.popupBlocked` message instead of this English one.
 */
export class PopupBlockedError extends Error {
  constructor() {
    super("The browser blocked the popup.");
    this.name = "PopupBlockedError";
  }
}
