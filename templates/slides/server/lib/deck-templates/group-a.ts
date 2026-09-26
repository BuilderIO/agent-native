import type { DeckTemplate } from "../deck-templates.js";
import { CASE_STUDY_DECK } from "./a-case-study.js";
import { COMPANY_DECK } from "./a-company.js";
import { PITCH_DECK } from "./a-pitch.js";
import { QUARTERLY_DECK } from "./a-quarterly.js";
import { UPDATE_DECK } from "./a-update.js";
import { WORKSHOP_DECK } from "./a-workshop.js";

export const GROUP_A_DECK_TEMPLATES: readonly DeckTemplate[] = [
  PITCH_DECK,
  UPDATE_DECK,
  COMPANY_DECK,
  QUARTERLY_DECK,
  CASE_STUDY_DECK,
  WORKSHOP_DECK,
];
