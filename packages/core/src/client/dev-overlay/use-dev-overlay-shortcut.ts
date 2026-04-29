import { useEffect } from "react";

/**
 * Toggle the dev overlay with Cmd+Ctrl+A (Mac) / Ctrl+Alt+A (Windows/Linux).
 * Mirrors the useCommandMenuShortcut pattern — skip when an input is focused.
 */
export function useDevOverlayShortcut(onToggle: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMacCombo = e.metaKey && e.ctrlKey;
      const isWinCombo = !e.metaKey && e.ctrlKey && e.altKey;
      if (!(isMacCombo || isWinCombo)) return;
      if (e.key !== "a" && e.key !== "A") return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      e.preventDefault();
      onToggle();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onToggle]);
}
