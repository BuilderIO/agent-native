import { useEffect, useState } from "react";

/** The Tailwind `md` breakpoint: below it the slide rail sits behind a toggle. */
const RAIL_MIN_WIDTH = 768;

/**
 * True where the editor has no room for the slide rail beside the canvas, in
 * the app and in a host pane alike. The deck editor reads this one decision for
 * the rail toggle and for how the canvas lays out its slides.
 */
export function isCompactEditorLayout(): boolean {
  return typeof window === "undefined" || window.innerWidth < RAIL_MIN_WIDTH;
}

export function useCompactEditorLayout(): boolean {
  const [compact, setCompact] = useState(isCompactEditorLayout);

  useEffect(() => {
    const update = () => setCompact(isCompactEditorLayout());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return compact;
}
