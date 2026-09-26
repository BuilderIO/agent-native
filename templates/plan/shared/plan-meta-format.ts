
export function buildPlanMetaDescription(brief: string): string {
  const trimmed = brief.trim();
  if (trimmed.length <= 160) return trimmed;
  const cut = trimmed.lastIndexOf(" ", 157);
  return `${trimmed.slice(0, cut > 0 ? cut : 157)}…`;
}
