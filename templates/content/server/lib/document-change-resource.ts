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
