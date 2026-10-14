/**
 * Fallback values for `hero-ocean-background.tsx` before the async renderer
 * chunk loads. Duplicated from `tuning.ts` on purpose, not imported: `tuning.ts`
 * is also pulled in by the dynamically-split `renderer.ts`, and auth's entry
 * chunk has a fixed filename (see `authClientAssetPlugin` in `vite/client.ts`).
 * Importing it here would let the renderer chunk import it back out of that
 * entry chunk, re-running auth's hydration a second time and crashing with
 * `NotFoundError: removeChild`. Update both places if the tuning changes.
 */
export const HERO_BOTTOM_FADE_START_PERCENT = 62;

// Matches UPSTREAM_TUNING.present in tuning.ts (the dark-mode default).
export const HERO_FALLBACK_COLORS = {
  fg: [0.682, 0.678, 0.671] as const,
  bg: [0.039, 0.039, 0.039] as const,
};
