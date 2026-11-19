// `changeResource` for actions that change one document: its change event then
// reaches every collaborator who can read it, so their open editor, comments,
// and access state refresh without a reload.
export function documentChangeResource(
  documentId: string | null | undefined,
): { resourceType: "document"; resourceId: string } | null {
  return documentId
    ? { resourceType: "document", resourceId: documentId }
    : null;
}

function documentIdIn(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("documentId" in value && typeof value.documentId === "string") {
    return value.documentId;
  }
  return "request" in value ? documentIdIn(value.request) : undefined;
}

// `changeResource` for a comment AI write. Most are keyed by the operation, so
// the page comes from the operation they return, bare or as `{ request }`.
// Without it, the working row, the AI's reply or suggestion, and an applied
// edit or its undo reached only the person who asked, and everyone else on
// the page saw them at the next idle poll or reload.
export function commentAiChangeResource(input: unknown, result: unknown) {
  return documentChangeResource(documentIdIn(input) ?? documentIdIn(result));
}
