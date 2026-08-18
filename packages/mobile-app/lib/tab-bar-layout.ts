import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Geometry for the floating bottom tab bar. The bar is absolutely positioned so
 * content scrolls underneath the glass, which means nothing reserves space for
 * it automatically — every scrolling tab screen pads itself by `contentInset`
 * from these same numbers. Split them and rows silently hide under the bar.
 */
export const TAB_BAR_PILL_HEIGHT = 62;
export const TAB_BAR_MINIMIZED_HEIGHT = 48;
/** Outer margin between the bar row and the screen edges, per side. */
export const TAB_BAR_MARGIN = 12;
/** Diameter of the round button that opens the app launcher. */
export const TAB_BAR_ACTION_SIZE = 56;
export const TAB_BAR_ACTION_GAP = 10;
/** Corner radius of the capsule — half its height, so it is a true capsule. */
export const TAB_BAR_PILL_RADIUS = TAB_BAR_PILL_HEIGHT / 2;
/** Inset between the capsule wall and the tab slots. */
export const TAB_BAR_ROW_PAD = 5;
/** How far the progressive blur bleeds above the capsule. */
export const TAB_BAR_BLUR_BLEED = 44;

/**
 * `bottom` is where the bar sits above the screen edge; `contentInset` is what
 * a scrolling screen reserves so its last row clears the glass.
 */
export function useTabBarLayout(): { bottom: number; contentInset: number } {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom - 16, 12);
  return {
    bottom,
    contentInset: bottom + TAB_BAR_PILL_HEIGHT + TAB_BAR_MARGIN,
  };
}
