// `changeResource` for actions that change one design: its change event then
// reaches every collaborator who can read it, so their open editor refetches
// frames, screens, and breakpoints without a reload.
export function designChangeResource(
  designId: string | null | undefined,
  result?: unknown,
): { resourceType: "design"; resourceId: string } | null {
  if (!designId || !didChange(result)) return null;
  return { resourceType: "design", resourceId: designId };
}

function didChange(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const outcome = result as Record<string, unknown>;
  return (
    outcome.stale !== true &&
    outcome.changed !== false &&
    outcome.deleted !== false &&
    outcome.renamed !== false
  );
}
