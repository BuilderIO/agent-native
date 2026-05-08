export { cn } from "@agent-native/core";

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
  );
}

export function shortcutModifierLabel(): string {
  return isMacPlatform() ? "\u2318" : "Ctrl";
}

export function shortcutLabel(shortcut: string): string {
  const isMac = isMacPlatform();
  return shortcut
    .replace(/\bcmd\b/gi, isMac ? "\u2318" : "Ctrl")
    .replace(/\bctrl\b/gi, "Ctrl")
    .replace(/\balt\b/gi, isMac ? "\u2325" : "Alt")
    .replace(/\bshift\b/gi, isMac ? "\u21e7" : "Shift");
}
