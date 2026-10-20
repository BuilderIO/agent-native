import { useEffect } from "react";

export function useHomeSearchShortcut(
  enabled: boolean,
  revealSearch?: () => boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing
      ) {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.isContentEditable ||
        target?.closest("input, textarea, select, [role='textbox']")
      ) {
        return;
      }
      if (
        document.querySelector(
          '[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open]',
        )
      ) {
        return;
      }
      const findSearch = () =>
        Array.from(
          document.querySelectorAll<HTMLInputElement>("[data-home-search]"),
        ).find((input) => input.getClientRects().length > 0);
      const search = findSearch();
      if (search && !search.disabled) {
        event.preventDefault();
        search.focus();
        return;
      }
      if (!revealSearch?.()) return;
      event.preventDefault();
      window.requestAnimationFrame(() => {
        const revealedSearch = findSearch();
        if (revealedSearch && !revealedSearch.disabled) {
          revealedSearch.focus();
        }
      });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, revealSearch]);
}
