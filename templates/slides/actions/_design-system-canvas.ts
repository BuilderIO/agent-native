import { DEFAULT_SLIDE_BACKGROUND } from "../shared/slide-background.js";
import getDesignSystem from "./get-design-system.js";

/**
 * The canvas a slide renders on when it declares no background of its own:
 * the linked design system's, or the built-in default when nothing is linked.
 *
 * Contrast is only checkable against the canvas the slide actually paints on.
 * Passing nothing here made every slide that relies on an inherited canvas
 * invisible to the audit, which is the class of slide the light-on-light
 * reports were about.
 *
 * Returns null for a linked system whose canvas cannot be read: "unknown" has
 * to stay distinct from the default, or a dark system's slides would be
 * audited against a light canvas and every one of them would be reported.
 */
export async function inheritedSlideCanvas(
  designSystemId: string | null | undefined,
  /** Canvas the caller already resolved, to skip the lookup. */
  known?: string | null,
): Promise<string | null> {
  if (known?.trim()) return known.trim();
  if (!designSystemId) return DEFAULT_SLIDE_BACKGROUND;

  const cached = canvasCache.get(designSystemId);
  if (cached && cached.expiresAt > Date.now()) return cached.background;

  const background = await resolveCanvas(designSystemId);
  canvasCache.set(designSystemId, {
    background,
    expiresAt: Date.now() + CANVAS_TTL_MS,
  });
  return background;
}

/**
 * A Builder-linked system keeps its token values behind the docs fetch that
 * the compact read deliberately skips, so its canvas costs a network call.
 * Caching it briefly keeps a deck-length generation to one fetch while
 * staying fresh enough for an audit.
 */
const CANVAS_TTL_MS = 60_000;
const canvasCache = new Map<
  string,
  { background: string | null; expiresAt: number }
>();

async function resolveCanvas(id: string): Promise<string | null> {
  try {
    const summary = (await getDesignSystem.run({ id, compact: "true" })) as
      | {
          colorMode?: { background?: unknown };
          builderDesignSystemId?: unknown;
        }
      | undefined;
    const summaryBackground = canvasValue(summary?.colorMode?.background);
    if (summaryBackground) return summaryBackground;
    if (typeof summary?.builderDesignSystemId !== "string") return null;

    const full = (await getDesignSystem.run({ id, compact: "false" })) as
      | { colorMode?: { background?: unknown } }
      | undefined;
    return canvasValue(full?.colorMode?.background);
  } catch {
    // coercion-ok: null is "no canvas to audit against", which leaves the
    // markup-only report standing rather than inventing one. A design-system
    // read that fails must never fail the slide write it was checking.
    return null;
  }
}

function canvasValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
