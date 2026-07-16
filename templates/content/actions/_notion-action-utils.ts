import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";

import { flushOpenDocumentEditorToSql } from "./_document-flush.js";

export function getCurrentNotionCaller() {
  const callerEmail = getRequestUserEmail();
  if (!callerEmail) throw new Error("no authenticated user");
  return callerEmail;
}

export async function getNotionDocumentAuthority(documentId: string) {
  const callerEmail = getCurrentNotionCaller();
  const access = await assertAccess("document", documentId, "editor", {
    userEmail: callerEmail,
    orgId: getRequestOrgId(),
  });
  const documentOwnerEmail = access?.resource?.ownerEmail;
  if (
    typeof documentOwnerEmail !== "string" ||
    documentOwnerEmail.length === 0
  ) {
    throw new Error("Document not found");
  }
  return { callerEmail, documentOwnerEmail };
}

/**
 * Flush the live collaborative editor before a user-triggered Notion operation
 * reads or replaces SQL content. The Y.Doc can be ahead of the debounced
 * documents row; without this handshake "Use local" can push a stale snapshot,
 * while "Use Notion" can discard edits that never reached version history.
 */
export async function flushNotionDocumentEditor(
  documentId: string,
  ownerEmail: string,
) {
  await flushOpenDocumentEditorToSql({ documentId, ownerEmail });
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
