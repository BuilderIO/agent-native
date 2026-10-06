import { assertDocumentMutationAccess } from "../../actions/_document-mutation-access.js";

export async function resolveEditablePrivateIconOrgId(
  documentId: string,
): Promise<string | null> {
  if (!documentId || documentId.length > 128) {
    throw new Error("A target Content document is required for private icons.");
  }
  const access = await assertDocumentMutationAccess(documentId, "editor");
  const orgId = access.resource.orgId;
  if (orgId === null || orgId === undefined) return null;
  if (typeof orgId !== "string" || !orgId) {
    throw new Error("The target document has an invalid organization.");
  }
  return orgId;
}
