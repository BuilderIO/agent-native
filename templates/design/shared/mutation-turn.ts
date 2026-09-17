/**
 * Marks app-composed chat context whose turn is only complete once a Design
 * mutation persisted. The response guard matches this line exactly; ambient
 * context (selection, design system, intake questions) must never carry it.
 */
export const DESIGN_MUTATION_REQUIRED_DIRECTIVE =
  "Completion for this turn requires a successful mutating Design action; a text-only reply is not completion.";
