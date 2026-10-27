// Use-case pages that moved to a new address. Ads and links still point at the
// old ones, so each redirects permanently to its replacement in every language.
export const USE_CASE_SLUG_REDIRECTS: Record<string, string> = {
  "startup-pitch-deck": "ai-pitch-deck-maker",
  "dictate-instead-of-typing": "ai-dictation",
  "bug-reports-with-console-logs": "ai-bug-reporting-tool",
  "see-what-your-coding-agent-plans": "visual-plan-mode",
  "understand-what-your-coding-agent-changed": "visually-recap-agent-changes",
  "wireframe-before-agent-builds": "ui-planning",
  "ask-your-database-in-plain-english": "ask-your-database",
  "crm-and-call-questions": "ai-sales-analytics",
  "find-where-users-drop-off": "ai-funnel-analysis",
  "startup-kpi-dashboard": "ai-kpi-dashboard",
  "design-brief-to-prototype": "ai-prototype-generator",
  "spec-your-coding-agent-builds-from": "specs-for-coding-agents",
};

export function movedUseCaseSlug(slug: string | undefined) {
  return slug && Object.hasOwn(USE_CASE_SLUG_REDIRECTS, slug)
    ? USE_CASE_SLUG_REDIRECTS[slug]
    : undefined;
}
