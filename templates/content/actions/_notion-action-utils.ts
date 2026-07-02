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
  const documentId = args.documentId?.trim() || args.id?.trim();
  if (!documentId) {
    throw Object.assign(new Error("documentId is required"), {
      statusCode: 400,
    });
  }
  return documentId;
}
