import type {
  DeckTemplate,
  DeckTemplateCategory,
  DeckTemplateSlide,
} from "../deck-templates.js";

export type AuthoredSlide = Omit<DeckTemplateSlide, "id">;

export function authoredDeck(
  id: string,
  title: string,
  category: DeckTemplateCategory,
  description: string,
  slides: readonly AuthoredSlide[],
): DeckTemplate {
  return {
    id,
    title,
    description,
    category,
    aspectRatio: "16:9",
    width: 960,
    height: 540,
    isBuiltIn: true,
    version: 1,
    slides: slides.map((slide, index) => ({
      id: `${id}-${index + 1}`,
      ...slide,
    })),
  };
}

/**
 * The slide root every template shares: the `--deck-*` theming contract, the fixed 960x540 canvas, and one
 * full-size layout child. The editor's autofit wraps the root's children in its content box and flags any box
 * outside it, so the root keeps zero padding and every offset is measured from the child's full-canvas box.
 */
export function slideRoot(tokens: string, style: string, body: string): string {
  return `<div class="fmd-slide" style="${tokens}width:960px;height:540px;box-sizing:border-box;padding:0;display:flex;flex-direction:column;position:relative;clip-path:inset(0);background:var(--deck-bg);color:var(--deck-ink);"><div style="position:relative;flex:1;min-height:0;box-sizing:border-box;${style}">${body}</div></div>`;
}
