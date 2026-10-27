declare global {
  interface Window {
    __DND_DEBUG?: boolean;
  }
}

export function dndHostLog(phase: string, data?: unknown): void {
  if (typeof window === "undefined") return;
  if (window.__DND_DEBUG === false) return;
  if (!window.__DND_DEBUG && !import.meta.env?.DEV) return;
  try {
    const tag = `%c[dnd:host:${phase}]`;
    const style = "color:#0ea5e9;font-weight:bold";
    if (data === undefined) console.log(tag, style);
    else console.log(tag, style, data);
  } catch {
    /* logging must never break a drag */
  }
}
