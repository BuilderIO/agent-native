import { ActionContractError } from "@agent-native/core/action";
import {
  resolveAccess,
  ROLE_RANK,
  type ResolvedAccess,
} from "@agent-native/core/sharing";

/**
 * Resolve-then-assert access for Content document mutations so a rejection is
 * diagnosable: an absent id must say not-found (naming which argument), and a
 * present-but-unauthorized id must say which role was required. Bare
 * `assertAccess` reports both as "No access to document <id>", which agents
 * read as a permission failure and retry against more bad ids (see run
 * run-1789141899442-pmm6ci) instead of creating the missing page.
 */
export async function resolveDocumentAccessForMutation(
  documentId: string,
  argumentName: "id" | "parentId" = "id",
): Promise<ResolvedAccess> {
  const resolved = await resolveAccess("document", documentId);
  if (!resolved) {
    throw new ActionContractError(
      `Document "${documentId}" not found (argument: ${argumentName}). Create the page first or use an id from a prior action result.`,
      { errorCode: "DOCUMENT_NOT_FOUND", statusCode: 404 },
    );
  }
  return resolved;
}

export async function assertDocumentMutationAccess(
  documentId: string,
  minRole: keyof typeof ROLE_RANK = "editor",
  argumentName: "id" | "parentId" = "id",
): Promise<ResolvedAccess> {
  const resolved = await resolveDocumentAccessForMutation(
    documentId,
    argumentName,
  );
  if (ROLE_RANK[resolved.role] < ROLE_RANK[minRole]) {
    throw new Error(
      `Requires ${minRole} role on document ${documentId} (argument: ${argumentName}; have ${resolved.role})`,
    );
  }
  return resolved;
}
