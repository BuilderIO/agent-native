import { useEffect, useCallback } from "react";

interface ShortcutConfig {
  onNext?: () => void;
  onPrev?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  onCreate?: () => void;
  onSearch?: () => void;
}

export function useKeyboardShortcuts(config: ShortcutConfig) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInput) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          config.onNext?.();
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          config.onPrev?.();
          break;
        case "Enter":
          e.preventDefault();
          config.onOpen?.();
          break;
        case "Escape":
          e.preventDefault();
          config.onClose?.();
          break;
        case "c":
          e.preventDefault();
          config.onCreate?.();
          break;
        case "/":
          e.preventDefault();
          config.onSearch?.();
          break;
      }
    },
    [config],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
