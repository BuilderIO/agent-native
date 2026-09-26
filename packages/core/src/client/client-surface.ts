export type ClientSurface = "web" | "electron" | "tauri";

interface SurfaceGlobals {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
  agentNativeDesktop?: unknown;
}

export function getClientSurface(): ClientSurface {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as SurfaceGlobals;
  if (w.__TAURI_INTERNALS__ || w.__TAURI__) return "tauri";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  if (
    /\b(?:AgentNativeDesktop|ChatGPT|Claude|Codex)\b/i.test(ua) ||
    w.agentNativeDesktop
  ) {
    return "electron";
  }
  return "web";
}
