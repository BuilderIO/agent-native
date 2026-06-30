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
  await assertAccess("document", documentId, "editor", {
    userEmail,
    orgId: getRequestOrgId(),
  });
  return userEmail;
}

export function resolveDocumentId(args: { documentId?: string; id?: string }) {
  const documentId = args.documentId || args.id;
  if (!documentId) throw new Error("documentId is required");
  return documentId;
}
