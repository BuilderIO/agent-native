import { GROUP_A_DECK_TEMPLATES } from "./deck-templates/group-a.js";
import { GROUP_B_DECK_TEMPLATES } from "./deck-templates/group-b.js";
import { LEGACY_DECK_TEMPLATES } from "./deck-templates/legacy.js";

export const DECK_TEMPLATE_CATEGORIES = [
  "pitch",
  "update",
  "company",
  "quarterly",
  "case-study",
  "workshop",
  "keynote",
  "report",
  "education",
  "roadmap",
  "portfolio",
] as const;
export type DeckTemplateCategory = (typeof DECK_TEMPLATE_CATEGORIES)[number];

export interface DeckTemplateSlide {
  id: string;
  content: string;
  layout: "title" | "statement" | "content";
  notes: string;
}
export interface DeckTemplate {
  id: string;
  title: string;
  description: string;
  category: DeckTemplateCategory;
  aspectRatio: "16:9";
  width: 960;
  height: 540;
  isBuiltIn: true;
  version: 1;
  slides: DeckTemplateSlide[];
}

const templates: readonly DeckTemplate[] = [
  ...GROUP_A_DECK_TEMPLATES,
  ...GROUP_B_DECK_TEMPLATES,
  ...LEGACY_DECK_TEMPLATES,
];

export function listBuiltInDeckTemplates(): DeckTemplate[] {
  return templates.map((item) => structuredClone(item));
}

export function getBuiltInDeckTemplate(id: string): DeckTemplate | undefined {
  const item = templates.find((candidate) => candidate.id === id);
  return item ? structuredClone(item) : undefined;
}

export function listBuiltInDeckTemplateSummaries(includePreview = false) {
  return templates.map(({ slides, ...metadata }) => ({
    ...metadata,
    slideCount: slides.length,
    ...(includePreview ? { previewHtml: slides[0].content } : {}),
  }));
}
