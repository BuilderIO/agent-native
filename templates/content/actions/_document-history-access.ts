import { ActionContractError } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";

/**
 * Viewer access to a page's History. A page in Trash shows none, as
 * get-document reads nothing of it, so its saved copies stay hidden too.
 */
export async function assertHistoryAccess(documentId: string) {
  const access = await assertAccess("document", documentId, "viewer");
  if (access.resource.trashedAt) {
    throw new ActionContractError("Document not found.", {
      errorCode: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
  }
  return access;
}
