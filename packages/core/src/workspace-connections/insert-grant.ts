import { randomUUID } from "node:crypto";

import { isActiveTransactionExec, type DbExec } from "../db/client.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";

/** Caller must hold a row lock on the scoped connection and authorize the grant.
 * Existing grants are never changed. Returns false on any unique-key conflict.
 */
export async function insertWorkspaceConnectionGrantIfAbsent(
  tx: DbExec,
  input: {
    connectionId: string;
    appId: string;
    orgId: string;
    grantedByEmail: string;
  },
): Promise<boolean> {
  if (
    !isActiveTransactionExec(tx) ||
    !input.orgId ||
    !input.appId.trim() ||
    !input.connectionId.trim() ||
    getRequestOrgId()?.trim() !== input.orgId ||
    getRequestUserEmail()?.trim().toLowerCase() !== input.grantedByEmail
  ) {
    throw new Error("Grant insert requires the authenticated workspace scope.");
  }
  const locked = await tx.execute({
    sql: "SELECT id FROM public.workspace_connections WHERE id = ? AND org_id = ? FOR UPDATE",
    args: [input.connectionId, input.orgId],
  });
  if (locked.rows.length !== 1)
    throw new Error("Scoped connection was not found.");
  const now = Date.now();
  const result = await tx.execute({
    sql: `INSERT INTO public.workspace_connection_grants
      (id, connection_id, provider, app_id, scopes_json, config_json,
       credential_refs_json, granted_by_email, owner_email, org_id, created_at, updated_at)
      SELECT ?, id, provider, ?, scopes_json, '{}', '[]', ?, ?, org_id, ?, ?
      FROM public.workspace_connections WHERE id = ? AND org_id = ?
      ON CONFLICT (connection_id, app_id) DO NOTHING`,
    args: [
      randomUUID(),
      input.appId,
      input.grantedByEmail,
      input.grantedByEmail,
      now,
      now,
      input.connectionId,
      input.orgId,
    ],
  });
  return result.rowsAffected === 1;
}
