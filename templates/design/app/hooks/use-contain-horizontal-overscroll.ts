import { useEffect } from "react";

const PROPERTY = "overscroll-behavior-x";

/**
 * A two-finger horizontal swipe that no scroller under the pointer takes
 * reaches the document root, and there the browser treats it as Back or
 * Forward. The editor fills the window and owns that gesture (the canvas pans,
 * panels scroll), so it hands none of it to the page. Scoped to the screens
 * that mount it: the root's own value comes back on unmount.
 */
export function useContainHorizontalOverscroll(): void {
  useEffect(() => {
    // The viewport takes `html`'s value; `body` covers a root that is not the scroller.
    const roots = [document.documentElement, document.body];
    const previous = roots.map((root) => root.style.getPropertyValue(PROPERTY));
    for (const root of roots) root.style.setProperty(PROPERTY, "none");
    return () => {
      roots.forEach((root, index) => {
        if (previous[index]) root.style.setProperty(PROPERTY, previous[index]);
        else root.style.removeProperty(PROPERTY);
      });
    };
  }, []);
}
