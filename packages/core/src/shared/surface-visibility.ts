/**
 * Host-declared surface visibility.
 *
 * An Electron `<webview>` guest never reports itself hidden: hiding the element
 * or any ancestor leaves `document.visibilityState === "visible"` and never
 * fires `visibilitychange`, so every visibility-based pause in this package is
 * inert inside the desktop shell. A backgrounded app tab there keeps polling at
 * its full foreground cadence and holds its event stream open for as long as
 * the shell is running. The host therefore has to say so explicitly, and this
 * flag is what background work must consult instead of the document alone.
 */
export const SURFACE_HIDDEN_FLAG = "__agentNativeSurfaceHidden";

/** Dispatched on `window` whenever the host flips the flag. */
export const SURFACE_VISIBILITY_EVENT = "agentnative:surfacevisibilitychange";

/** Whether an embedding host has declared this surface off screen. */
export function isHostSurfaceHidden(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] === true
  );
}

/**
 * Whether this surface is off screen by either signal. A host that has stashed
 * the surface entirely is a stronger statement than a backgrounded browser tab,
 * so callers that keep working while merely backgrounded should still stop on
 * `isHostSurfaceHidden()`.
 */
export function isSurfaceHidden(): boolean {
  if (isHostSurfaceHidden()) return true;
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/** Subscribe to both visibility signals. Returns an unsubscribe function. */
export function addSurfaceVisibilityListener(handler: () => void): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }
  document.addEventListener("visibilitychange", handler);
  window.addEventListener(SURFACE_VISIBILITY_EVENT, handler);
  return () => {
    document.removeEventListener("visibilitychange", handler);
    window.removeEventListener(SURFACE_VISIBILITY_EVENT, handler);
  };
}

/**
 * Script a host embedder evaluates inside the guest to declare whether the
 * surface it is hosting is on screen. Kept here so the flag name, the event
 * name, and the write that sets them cannot drift apart across packages.
 */
export function buildSurfaceVisibilityScript(hidden: boolean): string {
  return `(() => {
  const next = ${hidden ? "true" : "false"};
  if (window[${JSON.stringify(SURFACE_HIDDEN_FLAG)}] === next) return next;
  window[${JSON.stringify(SURFACE_HIDDEN_FLAG)}] = next;
  window.dispatchEvent(new Event(${JSON.stringify(SURFACE_VISIBILITY_EVENT)}));
  return next;
})()`;
}
