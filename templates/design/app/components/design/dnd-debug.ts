// Drag-and-drop debug logging (host side). Mirrors the bridge's own [dnd:*]
// console timeline (editor-chrome.bridge.ts) so a single gesture reads
// end-to-end across the prototype iframe and the parent React app.
//
// The iframe and the host are separate windows, so each has its OWN toggle:
//   • bridge (in the iframe console):  window.__DND_DEBUG = true
//   • host   (in the top-frame console): window.__DND_DEBUG = true
// Both default OFF (opt in at runtime). Host lines are cyan and prefixed
// [dnd:host:*]; bridge lines are purple and prefixed [dnd:*].
declare global {
  interface Window {
    __DND_DEBUG?: boolean;
  }
}

export function dndHostLog(phase: string, data?: unknown): void {
  if (typeof window === "undefined") return;
  if (!window.__DND_DEBUG) return;
  try {
    const tag = `%c[dnd:host:${phase}]`;
    const style = "color:#0ea5e9;font-weight:bold";
    if (data === undefined) console.log(tag, style);
    else console.log(tag, style, data);
  } catch {
    /* logging must never break a drag */
  }
}
