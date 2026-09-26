import type {
  DeckTemplate,
  DeckTemplateCategory,
  DeckTemplateSlide,
} from "../deck-templates.js";

export type BSlide = [
  layout: DeckTemplateSlide["layout"],
  content: string,
  notes: string,
];

export function bDeck(
  id: string,
  title: string,
  category: DeckTemplateCategory,
  description: string,
  slides: readonly BSlide[],
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
    slides: slides.map(([layout, content, notes], index) => ({
      id: `${id}-${index + 1}`,
      // Source is indented for reading; only whitespace between tags is dropped,
      // so never rely on it to space inline elements apart.
      content: content.replace(/>\s+</g, "><").trim(),
      layout,
      notes,
    })),
  };
}

/**
 * Slide root: the `--deck-*` contract on a padding-free 960x540 canvas, with the
 * slide's own layout on one full-size child. The editor's autofit wraps the
 * root's children in a flex column sized to the root's content box, so root
 * padding or a row/grid root would be silently rearranged there.
 */
export function bRoot(tokens: string, style: string, body: string): string {
  return `<div class="fmd-slide" style="${tokens}width:960px;height:540px;box-sizing:border-box;position:relative;margin:0;padding:0;display:flex;flex-direction:column;background:var(--deck-bg);color:var(--deck-ink);"><div style="position:relative;flex:1;min-height:0;box-sizing:border-box;display:flex;flex-direction:column;${style}">${body}</div></div>`;
}

/** A translucent tint of a palette color that keeps the palette the only raw-color site. */
export const tint = (color: string, percent: number) =>
  `color-mix(in srgb,${color} ${percent}%,transparent)`;
