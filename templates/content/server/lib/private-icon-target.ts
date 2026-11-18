import { assertDocumentMutationAccess } from "../../actions/_document-mutation-access.js";

async function privateMediaTargetOrgId(
  documentId: string,
  minRole: "commenter" | "editor",
): Promise<string | null> {
  if (!documentId || documentId.length > 128) {
    throw new Error("A target Content document is required for private icons.");
  }
  const access = await assertDocumentMutationAccess(documentId, minRole);
  const orgId = access.resource.orgId;
  if (orgId === null || orgId === undefined) return null;
  if (typeof orgId !== "string" || !orgId) {
    throw new Error("The target document has an invalid organization.");
  }
  return orgId;
}

export function resolveEditablePrivateIconOrgId(
  documentId: string,
): Promise<string | null> {
  return privateMediaTargetOrgId(documentId, "editor");
}

export function resolveCommentablePrivateMediaOrgId(
  documentId: string,
): Promise<string | null> {
  return privateMediaTargetOrgId(documentId, "commenter");
}
