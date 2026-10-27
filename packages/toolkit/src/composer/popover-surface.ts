/**
 * Surface for every composer popover (mentions, model, mode and plus menus).
 * Append it last: the popover primitives merge classes, so these win over
 * their defaults and the caller's layout classes.
 */
export const COMPOSER_POPOVER_SURFACE_CLASS =
  "z-[9999] max-h-[min(27.5rem,calc(var(--agent-native-viewport-height,100dvh)-2rem))] overflow-y-auto rounded-[var(--radius-lg,var(--radius,0.75rem))] border border-[color:color-mix(in_srgb,var(--agent-kit-border,color-mix(in_srgb,CanvasText_16%,transparent))_80%,transparent)] bg-[color:var(--agent-kit-popover-surface,var(--agent-kit-raised-surface,Canvas))] p-1 text-[color:var(--agent-kit-popover-text,var(--agent-kit-text,CanvasText))] shadow-(--agent-kit-overlay-elevation) [font:inherit]";
