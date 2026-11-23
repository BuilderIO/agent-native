import { fail } from "@agent-native/core/action";

import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";

/**
 * The workspace an action that manages BigQuery model sources runs in.
 *
 * These actions used to import this helper from a file the rebuild replaced;
 * the missing import stopped the whole action registry from loading, so every
 * action (and the app shell) answered 404 on the served build. The two checks
 * below are the ones those actions actually call, expressed against the current
 * workspace contract.
 */
export async function requireSemanticOrg(): Promise<string> {
  const current = await requireCurrentWorkspace();
  return current.orgId;
}

/**
 * Only workspace admins and owners may change BigQuery model sources, table
 * allow-lists or table-valued function allow-lists. The reference rejects the
 * same actions with this message.
 */
export async function requireBigQueryModelCurator({
  userEmail,
}: {
  orgId: string;
  userEmail: string;
}): Promise<void> {
  const current = await requireCurrentWorkspace();
  if (current.ownerEmail !== userEmail.trim().toLowerCase()) {
    fail(
      "Only workspace admins and owners can change BigQuery model sources.",
      {
        errorCode: "semantic_model_source_admin_required",
        statusCode: 403,
      },
    );
  }
  if (!isWorkspaceAdministrator(current)) {
    fail(
      "Only workspace admins and owners can create or change BigQuery model sources, table allow-lists, or table-valued function allow-lists.",
      {
        errorCode: "semantic_model_source_admin_required",
        statusCode: 403,
      },
    );
  }
}
