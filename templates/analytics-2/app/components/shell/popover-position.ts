export interface PopoverPlacementInput {
  rect: { top: number; bottom: number; left: number };
  viewport: { width: number; height: number };
  placement: "bottom-start" | "top-start";
  minWidth: number;
  hasTriggerLayout?: boolean;
}

export interface PopoverPlacement {
  top?: number;
  bottom?: number;
  left: number;
  maxWidth: number;
  maxHeight: number;
}

const EDGE = 8;
const GAP = 4;
const MIN_PREFERRED_HEIGHT = 240;

export function computePopoverPlacement({
  rect,
  viewport,
  placement,
  minWidth,
  hasTriggerLayout = true,
}: PopoverPlacementInput): PopoverPlacement {
  const available = Math.max(160, viewport.width - 16);
  const width = Math.min(minWidth, available);
  const left = Math.max(
    EDGE,
    Math.min(rect.left, viewport.width - width - EDGE),
  );
  const maxWidth = Math.max(160, viewport.width - left - EDGE);
  const below = viewport.height - rect.bottom - GAP - EDGE;
  const above = rect.top - GAP - EDGE;
  const preferBelow = placement === "bottom-start";
  const preferredRoom = preferBelow ? below : above;
  const otherRoom = preferBelow ? above : below;
  const openBelow =
    !hasTriggerLayout ||
    preferredRoom >= MIN_PREFERRED_HEIGHT ||
    preferredRoom >= otherRoom
      ? preferBelow
      : !preferBelow;
  const maxHeight = Math.max(0, openBelow ? below : above);
  return openBelow
    ? { top: rect.bottom + GAP, left, maxWidth, maxHeight }
    : {
        bottom: viewport.height - rect.top + GAP,
        left,
        maxWidth,
        maxHeight,
      };
}
