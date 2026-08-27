const STRUCTURED_INTAKE_PATTERNS = [
  /\b(?:file|submit|add|log|track|triage|prioriti[sz]e|create)\b.{0,64}\b(?:asks?|requests?|tickets?|tasks?|intake)\b/i,
  /\b(?:asks?|requests?|tickets?|intake)\b.{0,64}\b(?:database|table|board|form|queue|priority|deadline|urgency)\b/i,
  /\b(?:database|table|board|form|queue)\b.{0,64}\b(?:asks?|requests?|tickets?|intake|priority|deadline|urgency)\b/i,
];

const ONE_PAGER_CREATION_PATTERN =
  /\b(?:assemble|build|create|design|draft|generate|make|prepare|produce|write|put\s+together)\b.{0,64}\bone[-\s]?page(?:r)?s?\b/i;

const EXPLICIT_PLAN_PATTERN =
  /\b(?:interactive|visual)\s+(?:plan|prototype|recap)\b/i;
const NEGATION_PATTERN = /\b(?:do\s+not|don't|dont|never|not)\b/i;

const VISUAL_DESIGN_PATTERNS = [
  /\b(?:assemble|build|design|redesign|create|draft|generate|make|prepare|produce|write|put\s+together|mock(?:\s+up)?)\b.{0,64}\b(?:visual|mockup|wireframe|screen|interface|ui|website|landing\s+page|homepage|logo|graphic|illustration)\b/i,
  /\b(?:visual|ui|website|product|brand)\s+design\b/i,
];

function hasAffirmativeMatch(text: string, pattern: RegExp): boolean {
  return text.split(/[.!?;]+/).some((clause) => {
    const match = clause.match(pattern);
    return (
      match?.index !== undefined &&
      !NEGATION_PATTERN.test(clause.slice(0, match.index))
    );
  });
}

export interface DispatchIntegrationRoutingHint {
  targetAgent?: string;
  instruction: string;
}

export function dispatchIntegrationRoutingHint(
  text: string,
): DispatchIntegrationRoutingHint | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  // Route by the requested artifact type, not organization-specific names.
  // Exact destinations, schemas, and required fields come from workspace
  // resources such as shared LEARNINGS.md rather than this classifier.
  if (hasAffirmativeMatch(normalized, EXPLICIT_PLAN_PATTERN)) {
    return {
      targetAgent: "plan",
      instruction:
        "Use Plan only because the user explicitly requested an interactive or visual plan, prototype, or recap.",
    };
  }

  if (
    STRUCTURED_INTAKE_PATTERNS.some((pattern) =>
      hasAffirmativeMatch(normalized, pattern),
    )
  ) {
    return {
      instruction:
        "Resolve this structured-intake request from loaded workspace instructions/resources and discovered app capabilities. Follow any workspace-defined canonical destination and form contract; do not assume a particular app, database, schema, or owner. Preserve the source thread URL, submit once, verify the saved record, and return its exact link.",
    };
  }

  if (
    VISUAL_DESIGN_PATTERNS.some((pattern) =>
      hasAffirmativeMatch(normalized, pattern),
    )
  ) {
    return {
      targetAgent: "design",
      instruction:
        "Delegate to Design because the requested output is a visual design, mockup, or interface rather than an intake record.",
    };
  }

  if (hasAffirmativeMatch(normalized, ONE_PAGER_CREATION_PATTERN)) {
    return {
      targetAgent: "content",
      instruction:
        "Use Content for this one-pager: create a single document when it should be saved or shared, or return the finished copy inline when it does not need persistence. Do not route a one-pager to Plan; use Plan only when the user explicitly asks for an interactive visual plan, prototype, or recap.",
    };
  }

  return undefined;
}
