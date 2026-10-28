export const SURFACE_HIDDEN_FLAG = "__agentNativeSurfaceHidden";

export const SURFACE_VISIBILITY_EVENT = "agentnative:surfacevisibilitychange";

export function isHostSurfaceHidden(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] === true
  );
}

export function isSurfaceHidden(): boolean {
  if (isHostSurfaceHidden()) return true;
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

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

export function buildSurfaceVisibilityScript(hidden: boolean): string {
  return `(() => {
  const next = ${hidden ? "true" : "false"};
  if (window[${JSON.stringify(SURFACE_HIDDEN_FLAG)}] === next) return next;
  window[${JSON.stringify(SURFACE_HIDDEN_FLAG)}] = next;
  window.dispatchEvent(new Event(${JSON.stringify(SURFACE_VISIBILITY_EVENT)}));
  return next;
})()`;
}
