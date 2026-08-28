const STRUCTURED_INTAKE_PATTERNS = [
  /\b(?:file|submit|add|log|track|triage|prioriti[sz]e|create)\b.{0,64}\b(?:asks?|requests?|tickets?|tasks?|intake)\b/i,
  /\b(?:asks?|requests?|tickets?|intake)\b.{0,64}\b(?:database|table|board|form|queue|priority|deadline|urgency)\b/i,
  /\b(?:database|table|board|form|queue)\b.{0,64}\b(?:asks?|requests?|tickets?|intake|priority|deadline|urgency)\b/i,
];

const ONE_PAGER_CREATION_PATTERN =
  /\b(?:assemble|build|create|design|draft|generate|make|prepare|produce|write|put\s+together)\b.{0,64}\bone[-\s]?page(?:r)?s?\b/i;

const EXPLICIT_PLAN_PATTERN =
  /\b(?:(?:(?:interactive|visual)(?:\s*,\s*|\s+)){1,2}(?:one[-\s]?page(?:r)?s?\s+)?(?:plans?|prototypes?|recaps?)|one[-\s]?page(?:r)?s?\s+(?:(?:interactive|visual)(?:\s*,\s*|\s+)){1,2}(?:plans?|prototypes?|recaps?))\b/i;
const NEGATED_MATCH_PATTERN =
  /\b(?:not(?!\s+only)|without|no)\s+(?:a\s+|an\s+|the\s+)?(?:[\w-]+\s+){0,6}(?:(?:interactive|visual)\s+){0,2}(?:one[-\s]?page(?:r)?s?|visual|mockup|wireframe|screen|interface|ui|website|landing\s+page|homepage|logo|graphic|illustration|design|intake|form|plan|prototype|recap)\b/i;
const VISUAL_PROSE_EXCLUSION_PATTERN =
  /\b(?:about|documentation|document|report)\b/i;
const ROUTING_ACTION_PATTERN =
  /\b(?:file|submit|add|log|track|triage|prioriti[sz]e|assemble|build|create|design|redesign|draft|generate|make|prepare|produce|write|put\s+together|mock(?:\s+up)?)\b/gi;
const CREATION_ACTION_PATTERN =
  /\b(?:assemble|build|create|design|redesign|draft|generate|make|prepare|produce|write|put\s+together|mock(?:\s+up)?)\b/i;
const INFORMATIONAL_ACTION_PATTERN =
  /\b(?:how\s+(?:do|can|should|would)|how\s+to|explain\s+how)\b/i;
const NEGATED_ACTION_PREFIX_PATTERN =
  /(?:\b(?:do\s+not|don't|dont|never)\s*|\bno\s+need(?:\s+to)?\s*|\b(?:instead\s+of|rather\s+than)\s*)$/i;
const ACTION_CLAUSE_SPLIT_PATTERN =
  /[.!?;:—]+|,(?=\s*(?:do\s+not|don't|dont|never|not|no\b|assemble|build|create|design|redesign|draft|generate|make|prepare|produce|write|put\s+together)\b)|\b(?:but\s+rather|but|and|or|then)\b(?=\s+(?:do\s+not|don't|dont|never|not|no(?:\s+need)?|assemble|build|create|design|redesign|draft|generate|make|prepare|produce|write|put\s+together|discuss|compare|review|explain|describe|summarize|outline|analy[sz]e|edit|update|revise|check|evaluate)\b)|(?=\b(?:instead(?:\s+of)?|rather\s+than)\b)/gi;

const VISUAL_DESIGN_PATTERNS = [
  /\b(?:assemble|build|design|redesign|create|draft|generate|make|prepare|produce|write|put\s+together|mock(?:\s+up)?)\b.{0,64}\b(?:visual|mockup|wireframe|screen|interface|ui|website|landing\s+page|homepage|logo|graphic|illustration)\b/i,
  /\b(?:visual|ui|website|product|brand)\s+design\b/i,
];

function findLastRoutingAction(
  text: string,
): { index: number; text: string } | undefined {
  let lastMatch: { index: number; text: string } | undefined;
  for (const match of text.matchAll(ROUTING_ACTION_PATTERN)) {
    lastMatch = { index: match.index, text: match[0] };
  }
  return lastMatch;
}

function hasAffirmativeMatch(
  text: string,
  pattern: RegExp,
  actionPattern?: RegExp,
  rejectNegatedMatch = false,
  matchExclusionPattern?: RegExp,
): boolean {
  return text.split(ACTION_CLAUSE_SPLIT_PATTERN).some((clause) => {
    const match = clause.match(pattern);
    if (match?.index === undefined) return false;

    const matchPrefix = clause.slice(0, match.index);
    const matchEnd = match.index + match[0].length;
    const actionAtMatchStart = match[0].match(CREATION_ACTION_PATTERN);
    const actionMatch =
      actionAtMatchStart?.index === 0
        ? { index: match.index, text: actionAtMatchStart[0] }
        : findLastRoutingAction(matchPrefix);
    const actionStart = actionMatch?.index;
    const actionPrefix =
      actionStart === undefined ? matchPrefix : clause.slice(0, actionStart);
    const actionContext = clause.slice(actionStart ?? match.index, matchEnd);
    return (
      !NEGATED_ACTION_PREFIX_PATTERN.test(actionPrefix) &&
      (!actionPattern ||
        (actionMatch !== undefined && actionPattern.test(actionMatch.text))) &&
      (!actionPattern || !INFORMATIONAL_ACTION_PATTERN.test(actionPrefix)) &&
      (!rejectNegatedMatch || !NEGATED_MATCH_PATTERN.test(actionContext)) &&
      (!matchExclusionPattern || !matchExclusionPattern.test(actionContext))
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
  if (
    hasAffirmativeMatch(
      normalized,
      EXPLICIT_PLAN_PATTERN,
      CREATION_ACTION_PATTERN,
      true,
    )
  ) {
    return {
      targetAgent: "plan",
      instruction:
        "Use Plan only because the user explicitly requested an interactive or visual plan, prototype, or recap.",
    };
  }

  if (
    STRUCTURED_INTAKE_PATTERNS.some((pattern) =>
      hasAffirmativeMatch(normalized, pattern, undefined, true),
    )
  ) {
    return {
      instruction:
        "Resolve this structured-intake request from loaded workspace instructions/resources and discovered app capabilities. Follow any workspace-defined canonical destination and form contract; do not assume a particular app, database, schema, or owner. Preserve the source thread URL, submit once, verify the saved record, and return its exact link.",
    };
  }

  if (
    VISUAL_DESIGN_PATTERNS.some((pattern) =>
      hasAffirmativeMatch(
        normalized,
        pattern,
        CREATION_ACTION_PATTERN,
        true,
        VISUAL_PROSE_EXCLUSION_PATTERN,
      ),
    )
  ) {
    return {
      targetAgent: "design",
      instruction:
        "Delegate to Design because the requested output is a visual design, mockup, or interface rather than an intake record.",
    };
  }

  if (
    hasAffirmativeMatch(
      normalized,
      ONE_PAGER_CREATION_PATTERN,
      CREATION_ACTION_PATTERN,
      true,
    )
  ) {
    return {
      targetAgent: "content",
      instruction:
        "Use Content for this one-pager: create a single document when it should be saved or shared, or return the finished copy inline when it does not need persistence. Do not route a one-pager to Plan; use Plan only when the user explicitly asks for an interactive visual plan, prototype, or recap.",
    };
  }

  return undefined;
}
