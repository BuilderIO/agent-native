import { useEffect, type RefObject } from "react";

const ROVING_CANDIDATES = "button, a[href]";

function rovingItems(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(ROVING_CANDIDATES),
  ).filter(
    (item) =>
      !(item instanceof HTMLButtonElement && item.disabled) &&
      // An inert subtree takes no focus, so it gets no tab stop either.
      !item.closest("[inert]"),
  );
}

/** One tab stop for `container`, landing on the last-used item; arrows move. */
export function useRovingFocus(
  containerRef: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    let current: HTMLElement | null = null;
    const sync = () => {
      const items = rovingItems(container);
      if (!current || !items.includes(current)) current = items[0] ?? null;
      // Every candidate, so a newly enabled item joins at -1, not as a stop.
      for (const item of container.querySelectorAll<HTMLElement>(
        ROVING_CANDIDATES,
      ))
        item.tabIndex = item === current ? 0 : -1;
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!rovingItems(container).includes(target)) return;
      current = target;
      sync();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const items = rovingItems(container);
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index < 0) return;
      const rtl =
        getComputedStyle(container).direction === "rtl" ||
        container.closest("[dir]")?.getAttribute("dir") === "rtl";
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const backward = rtl ? "ArrowRight" : "ArrowLeft";
      const next =
        event.key === forward
          ? items[(index + 1) % items.length]
          : event.key === backward
            ? items[(index - 1 + items.length) % items.length]
            : event.key === "Home"
              ? items[0]
              : event.key === "End"
                ? items[items.length - 1]
                : undefined;
      if (!next) return;
      event.preventDefault();
      next.focus();
    };
    sync();
    // Items and their disabled/inert state change without a re-render.
    const observer = new MutationObserver(sync);
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled", "inert"],
    });
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, enabled]);
}
