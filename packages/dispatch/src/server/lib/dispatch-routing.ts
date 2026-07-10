const STRUCTURED_INTAKE_PATTERNS = [
  /\b(?:file|submit|add|log|track|triage|prioriti[sz]e|create)\b.{0,64}\b(?:asks?|requests?|tickets?|tasks?|intake)\b/i,
  /\b(?:asks?|requests?|tickets?|intake)\b.{0,64}\b(?:database|table|board|form|queue|priority|deadline|urgency)\b/i,
  /\b(?:database|table|board|form|queue)\b.{0,64}\b(?:asks?|requests?|tickets?|intake|priority|deadline|urgency)\b/i,
];

const VISUAL_DESIGN_PATTERNS = [
  /\b(?:design|redesign|create|make|generate|mock(?:\s+up)?)\b.{0,64}\b(?:visual|mockup|wireframe|screen|interface|ui|website|landing\s+page|homepage|logo|graphic|illustration)\b/i,
  /\b(?:visual|ui|website|product|brand)\s+design\b/i,
];

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
  if (STRUCTURED_INTAKE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      instruction:
        "Resolve this structured-intake request from loaded workspace instructions/resources and discovered app capabilities. Follow any workspace-defined canonical destination and form contract; do not assume a particular app, database, schema, or owner. Preserve the source thread URL, submit once, verify the saved record, and return its exact link.",
    };
  }

  if (VISUAL_DESIGN_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      targetAgent: "design",
      instruction:
        "Delegate to Design because the requested output is a visual design, mockup, or interface rather than an intake record.",
    };
  }

  return undefined;
}
