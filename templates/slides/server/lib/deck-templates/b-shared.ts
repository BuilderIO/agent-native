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
      content: content.replace(/>\s+</g, "><").trim(),
      layout,
      notes,
    })),
  };
}

export function bRoot(tokens: string, style: string, body: string): string {
  return `<div class="fmd-slide" style="${tokens}width:960px;height:540px;box-sizing:border-box;position:relative;margin:0;padding:0;display:flex;flex-direction:column;background:var(--deck-bg);color:var(--deck-ink);"><div style="position:relative;flex:1;min-height:0;box-sizing:border-box;display:flex;flex-direction:column;${style}">${body}</div></div>`;
}

export const tint = (color: string, percent: number) =>
  `color-mix(in srgb,${color} ${percent}%,transparent)`;
