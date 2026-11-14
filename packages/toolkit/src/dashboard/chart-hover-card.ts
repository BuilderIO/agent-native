import { useLayoutEffect, useState } from "react";

/**
 * Open state for a hover card drawn on a chart, reported to the chart so it
 * holds back its own tooltip meanwhile. Reported from the open state rather
 * than from closing, because a card can unmount while open (its note hidden
 * or deleted) and the chart would then never get its tooltip back.
 */
export function useChartHoverCardOpen(
  onHoverChange?: (hovered: boolean) => void,
): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open || !onHoverChange) return;
    onHoverChange(true);
    return () => onHoverChange(false);
  }, [open, onHoverChange]);
  return [open, setOpen];
}
