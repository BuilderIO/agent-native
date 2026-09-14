export { cn } from "@agent-native/toolkit/utils";

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
  );
}

// macOS spells this modifier with the glyph, not the word — "Cmd J" next to a
// key chip reads as two words rather than a shortcut.
export function shortcutModifierLabel(): string {
  return isMacPlatform() ? "\u2318" : "Ctrl";
}
