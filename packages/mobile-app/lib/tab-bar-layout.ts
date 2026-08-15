import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * expo-glass-tabs keeps the pill's geometry private, so these mirror its
 * internals (`EXPANDED_HEIGHT`, `BAR_MARGIN`, and its bottom offset formula).
 * The bar floats over the screen instead of pushing it up, so any screen that
 * scrolls has to reserve `contentInset` itself or its last row sits under the
 * glass forever.
 */
const PILL_HEIGHT = 58;
const PILL_GAP = 12;

/** Diameter of the round quick-action button that sits above the pill. */
export const TAB_BAR_ACTION_SIZE = 52;

export const TAB_BAR_THEME = {
  activeTint: "#f4f4f5",
  inactiveTint: "#71717a",
  highlight: "rgba(199, 243, 107, 0.16)",
  glassTint: "rgba(11, 11, 12, 0.55)",
  solidFallback: "rgba(20, 20, 22, 0.94)",
} as const;

export function useTabBarLayout(): { bottom: number; contentInset: number } {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom - 16, 12);
  return { bottom, contentInset: bottom + PILL_HEIGHT + PILL_GAP };
}
