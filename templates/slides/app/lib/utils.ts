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
    .split("+")
    .map((part) => {
      const token = part.trim();
      const lower = token.toLowerCase();
      if (lower === "cmd" || lower === "meta") return isMac ? "\u2318" : "Ctrl";
      if (lower === "ctrl" || lower === "control") return "Ctrl";
      if (lower === "alt" || lower === "option") return isMac ? "\u2325" : "Alt";
      if (lower === "shift") return isMac ? "\u21e7" : "Shift";
      if (lower === "enter") return "Enter";
      if (lower === "space") return "Space";
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join("+");
}
