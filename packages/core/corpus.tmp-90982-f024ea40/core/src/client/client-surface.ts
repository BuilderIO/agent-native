/**
 * The runtime shell the web UI is rendering inside. Used as pass-through
 * feedback metadata so form owners can tell whether a submission came from the
 * Agent Native desktop app (Electron), a Tauri desktop shell (e.g. Clips), or a
 * plain browser — without surfacing it as a visible form field.
 */
export type ClientSurface = "web" | "electron" | "tauri";

interface SurfaceGlobals {
  // Tauri v2 always injects this into the webview; `__TAURI__` only exists when
  // the app opts into `withGlobalTauri`, so check both.
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
  // Exposed by the Agent Native desktop (Electron) preload bridges.
  agentNativeDesktop?: unknown;
  electronAPI?: unknown;
}

/**
 * Best-effort, side-effect-free detection of the current client surface.
 * Returns "web" during SSR and in any plain browser.
 *
 * Electron detection keys off the `AgentNativeDesktop` User-Agent token that the
 * desktop shell appends app-wide (see `app.userAgentFallback`), plus the preload
 * globals, so it stays specific to our app rather than every Electron webview.
 */
export function getClientSurface(): ClientSurface {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as SurfaceGlobals;
  if (w.__TAURI_INTERNALS__ || w.__TAURI__) return "tauri";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  if (
    /AgentNativeDesktop/i.test(ua) ||
    /\bElectron\b/i.test(ua) ||
    w.agentNativeDesktop ||
    w.electronAPI
  ) {
    return "electron";
  }
  return "web";
}
