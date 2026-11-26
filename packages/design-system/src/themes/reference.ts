/**
 * A reference to a palette slot, resolved to the theme's own value when the
 * theme is built. Tailwind compiles `bg-primary/90` to this color-mix, not to
 * an hsl alpha; the two paint alike but resolve to different computed colors.
 */
export const shadcn = (name: string, alpha?: number) =>
  alpha === undefined
    ? `hsl(var(--${name}))`
    : `color-mix(in oklab, hsl(var(--${name})) ${Math.round(alpha * 100)}%, transparent)`;
