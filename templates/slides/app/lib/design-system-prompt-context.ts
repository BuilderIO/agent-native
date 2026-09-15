import { callAction } from "@agent-native/core/client/hooks";

export const WEBSITE_STYLE_REFERENCE_DIRECTIVE =
  "When the user asks to use or match a website's styling or branding and provides a URL, call `import-from-url` for each URL before generating. Treat the returned design.md-style visual system as the source of truth for colors, typography, spacing, components, and imagery. If no URL is provided, ask for one instead of guessing the site's style from its name.";

interface DesignSystemGenerationContextResult {
  agentContext?: string;
}

/**
 * Hydrate the linked design system into the text of a generation prompt.
 *
 * Every Slides flow that starts an authoring run has to do this before the
 * agent writes markup. When a flow skipped it, the agent fell through to the
 * generic "light neutral canvas" fallback and produced light slides inside a
 * dark design system, so a failed or empty hydration returns a loud block
 * rather than an empty string.
 */
export async function loadDesignSystemGenerationContext(
  designSystemId?: string | null,
): Promise<string> {
  if (!designSystemId) return "";
  try {
    const result = (await callAction(
      "get-design-system",
      { id: designSystemId },
      { method: "GET" },
    )) as DesignSystemGenerationContextResult | undefined;
    if (result?.agentContext?.trim()) {
      // The color-mode directive is built inside get-design-system, the only
      // side that can see a Builder-hydrated palette. Re-deriving it here from
      // `data` would read a proxy reference with no colors in it and append a
      // contradictory "UNDETERMINED" under a correct DARK/LIGHT line.
      return [
        "",
        result.agentContext.trim(),
        "",
        "The selected design system context above was hydrated before this agent run. Follow it directly; do not replace it with generic colors, fonts, spacing, imagery, or slide components.",
      ].join("\n");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    return [
      "",
      "## Selected Design System Context",
      `The selected design system id "${designSystemId}" could not be loaded before generation: ${message}`,
      "Before adding slides, call `get-design-system` for this id. If it still fails, stop and tell the user the selected design system is unavailable instead of improvising a generic style.",
    ].join("\n");
  }
  return [
    "",
    "## Selected Design System Context",
    `The selected design system id "${designSystemId}" returned no generation context.`,
    "Call `get-design-system` for this id before adding slides. If it still has no usable tokens/docs, stop and ask the user to finish design-system indexing instead of improvising a generic style.",
  ].join("\n");
}

/**
 * The design-system block for a prompt that adds slides to a deck that
 * already exists. The linked system is authoritative here: unlike new-deck
 * generation there is no picker and no workspace-default resolution step, so
 * the only two states are "this deck is linked" and "it is not".
 */
export async function addSlideDesignSystemContext(
  designSystemId?: string | null,
): Promise<string> {
  if (!designSystemId) {
    return [
      "",
      "Design system: this deck has no linked design system.",
      "Match the deck's existing slides instead of inventing a new palette: read `deckStyle` and the `representativeSlideId` returned by `get-deck` and mirror that slide's background, text colors, type scale, and spacing.",
      "Use the generic light neutral canvas fallback only when the deck is empty and there is no representative slide to match.",
    ].join("\n");
  }

  const hydrated = await loadDesignSystemGenerationContext(designSystemId);
  return [
    "",
    "Design system: this deck is linked to design system id " +
      `"${designSystemId}", which is authoritative for this slide.`,
    "The hydrated context below is the source of truth for background, text colors, typography, spacing, imagery, and slide defaults. Do not substitute a generic palette, and do not apply the no-design-system light-canvas fallback described in the add-slide action's own description or in AGENTS.md.",
    "Also match the deck's existing slides: read `deckStyle` and `representativeSlideId` from `get-deck` so the new slide sits in the same visual language as its neighbours.",
    hydrated,
  ].join("\n");
}
