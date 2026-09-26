import type { DeckTemplate } from "../deck-templates.js";
import { KEYNOTE_DECK } from "./b-keynote.js";
import { LESSON_DECK } from "./b-lesson.js";
import { MANIFESTO_DECK } from "./b-manifesto.js";
import { PORTFOLIO_DECK } from "./b-portfolio.js";
import { RESEARCH_DECK } from "./b-research.js";
import { ROADMAP_DECK } from "./b-roadmap.js";

export const GROUP_B_DECK_TEMPLATES: readonly DeckTemplate[] = [
  KEYNOTE_DECK,
  MANIFESTO_DECK,
  RESEARCH_DECK,
  LESSON_DECK,
  ROADMAP_DECK,
  PORTFOLIO_DECK,
];
