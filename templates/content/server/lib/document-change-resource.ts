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

export function commentAiChangeResource(input: unknown, result: unknown) {
  return documentChangeResource(documentIdIn(input) ?? documentIdIn(result));
}
