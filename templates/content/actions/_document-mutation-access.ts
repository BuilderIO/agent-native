import { ActionContractError } from "@agent-native/core/action";
import {
  ForbiddenError,
  ROLE_RANK,
  type ResolvedAccess,
} from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";

type DocumentArgumentName = "id" | "parentId" | "ownerDocumentId";

const NOT_FOUND_GUIDANCE: Record<DocumentArgumentName, string> = {
  id: "Create the page first or use an id from a prior action result.",
  parentId:
    "Create the parent page first or use an id from a prior action result.",
  ownerDocumentId:
    "The page that owns this document's inline database cannot be resolved, so the inline database cannot be detached from it.",
};

/**
 * Resolve-then-assert access for Content document mutations so a rejection is
 * diagnosable: an absent id says not-found (naming which argument), and an
 * existing document the caller cannot act on keeps forbidden classification
 * with the required role named. Bare `assertAccess` reports both as
 * "No access to document <id>", which agents read as a permission failure and
 * retry against more bad ids (see run run-1789141899442-pmm6ci) instead of
 * creating the missing page.
 */
export async function resolveDocumentAccessForMutation(
  documentId: string,
  argumentName: DocumentArgumentName = "id",
): Promise<ResolvedAccess> {
  // resolveAccess collapses "absent" and "no role" into null. Existence is
  // probed with an id-only primary-key lookup — the same unscoped-by-access
  // read the sharing layer performs internally before its access decision —
  // so absent can say not-found while present-but-inaccessible stays
  // ForbiddenError and no row data beyond existence leaves this check.
  const resolved = await resolveContentDocumentAccess(documentId);
  if (resolved) return resolved;
  const [existing] = await getDb()
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  if (existing) {
    throw new ForbiddenError(
      `No access to document ${documentId} (argument: ${argumentName}). The document exists but your account has no access to it.`,
    );
  }
  throw new ActionContractError(
    `Document "${documentId}" not found (argument: ${argumentName}). ${NOT_FOUND_GUIDANCE[argumentName]}`,
    { errorCode: "DOCUMENT_NOT_FOUND", statusCode: 404 },
  );
}

export async function assertDocumentMutationAccess(
  documentId: string,
  minRole: keyof typeof ROLE_RANK = "editor",
  argumentName: DocumentArgumentName = "id",
): Promise<ResolvedAccess> {
  const resolved = await resolveDocumentAccessForMutation(
    documentId,
    argumentName,
  );
  if (ROLE_RANK[resolved.role] < ROLE_RANK[minRole]) {
    throw new ForbiddenError(
      `Requires ${minRole} role on document ${documentId} (argument: ${argumentName}; have ${resolved.role})`,
    );
  }
  return resolved;
}
