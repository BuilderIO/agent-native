/**
 * Surface for every composer popover (mentions, model, mode and plus menus).
 * Append it last: the popover primitives merge classes, so these win over
 * their defaults and the caller's layout classes.
 */
export const COMPOSER_POPOVER_SURFACE_CLASS =
  "z-[9999] max-h-[min(27.5rem,calc(var(--agent-native-viewport-height,100dvh)-2rem))] overflow-y-auto rounded-[var(--agent-kit-radius-sm,0.5rem)] [&_[role^=menuitem]]:rounded-[var(--agent-kit-radius-xs,0.25rem)] border border-[color:var(--agent-kit-border,color-mix(in_srgb,CanvasText_16%,transparent))] bg-[color:var(--agent-kit-popover-surface,var(--agent-kit-raised-surface,Canvas))] p-1 text-[color:var(--agent-kit-popover-text,var(--agent-kit-text,CanvasText))] shadow-(--agent-kit-overlay-elevation) [font:inherit]";
