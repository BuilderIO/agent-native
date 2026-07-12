export { cn } from "@agent-native/core/client";

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
  );
}

export function shortcutModifierLabel(): string {
  return isMacPlatform() ? "\u2318" : "Ctrl";
}
