/**
 * Palette for the glass bottom tab bar. The bar stays in the navigator's
 * layout flow, so `glassTint` sits over the app background rather than over
 * scrolling content — keep it dark enough to read as a surface on its own.
 */
export type GlassTabBarTheme = {
  /** Dark tint layered over the liquid glass on iOS 26. */
  glassTint: string;
  /** Background used wherever liquid glass is unavailable. */
  solidFallback: string;
  /** Hairline on the fallback surface, which has no rim lighting of its own. */
  fallbackBorder: string;
};

export const TAB_BAR_THEME: GlassTabBarTheme = {
  glassTint: "rgba(11, 11, 12, 0.55)",
  solidFallback: "rgba(20, 20, 22, 0.94)",
  fallbackBorder: "#27272a",
};

/** Corner radius of the pill. Half the minimum height keeps it a true capsule. */
export const TAB_BAR_PILL_RADIUS = 31;
