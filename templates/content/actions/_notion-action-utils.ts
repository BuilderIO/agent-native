import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";

export function getCurrentNotionOwner() {
  const owner = getRequestUserEmail();
  if (!owner) throw new Error("no authenticated user");
  return owner;
}

export async function getNotionDocumentOwner(documentId: string) {
  const userEmail = getCurrentNotionOwner();
  const access = await assertAccess("document", documentId, "editor", {
    userEmail,
    orgId: getRequestOrgId(),
  });
  const owner = access?.resource?.ownerEmail;
  if (typeof owner !== "string" || owner.length === 0) {
    throw new Error("Document not found");
  }
  return owner;
}

export function resolveDocumentId(args: { documentId?: string; id?: string }) {
  const documentId = args.documentId || args.id;
  if (!documentId) throw new Error("documentId is required");
  return documentId;
}
