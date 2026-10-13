import { useSafeAreaInsets } from "react-native-safe-area-context";

export const TAB_BAR_PILL_HEIGHT = 62;
export const TAB_BAR_MINIMIZED_HEIGHT = 48;
export const TAB_BAR_MARGIN = 12;
export const TAB_BAR_ACTION_SIZE = 56;
export const TAB_BAR_ACTION_GAP = 10;
export const TAB_BAR_PILL_RADIUS = TAB_BAR_PILL_HEIGHT / 2;
export const TAB_BAR_ROW_PAD = 5;
export const TAB_BAR_BLUR_BLEED = 44;

export function useTabBarLayout(): { bottom: number; contentInset: number } {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom - 16, 12);
  return {
    bottom,
    contentInset: bottom + TAB_BAR_PILL_HEIGHT + TAB_BAR_MARGIN,
  };
}
