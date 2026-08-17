/**
 * Corner radius of the bottom tab bar's capsule. Half the bar's minimum height
 * (62) keeps it a true capsule rather than a rounded rectangle.
 *
 * Colors deliberately live in `mobile-colors` instead of here: the bar reads
 * `card` and `border` from the active theme, so a hardcoded palette here would
 * silently break light mode.
 */
export const TAB_BAR_PILL_RADIUS = 31;
