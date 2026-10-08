export const TOP_BAR_HEIGHT_PX = 48;

/**
 * Which shells render the docked top bar. Every control the bar carries (mode
 * switch, zoom, presence, Share, Review changes) must render somewhere in the
 * shells that do not: the inspector's own action row, the minimal-UI floating
 * bar, or, for the mode switch, the bottom toolbar.
 */
export function isTopBarVisible({
  embedded,
  isVisualEditSurface,
  minimalUi,
  uiHidden,
}: {
  embedded: boolean;
  isVisualEditSurface: boolean;
  minimalUi: boolean;
  uiHidden: boolean;
}): boolean {
  return !embedded && !isVisualEditSurface && !minimalUi && !uiHidden;
}
