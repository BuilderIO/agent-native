import { fail } from "@agent-native/core/action";
import { getDbExec, sql } from "@agent-native/core/db";
import { invalidateMemberOrgCaches } from "@agent-native/core/org";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import { requireSemanticOrg } from "./_semantic-helpers.js";

export async function readWorkspaceName() {
  const orgId = await requireSemanticOrg();
  const email = getRequestUserEmail()?.trim().toLowerCase();
  const { rows } = await getDbExec().execute(sql`
    SELECT o.name, m.role FROM organizations o
    JOIN org_members m ON m.org_id = o.id
    WHERE o.id = ${sql.value(orgId)} AND lower(m.email) = ${sql.value(email)}
      AND m.federation_removal_pending_at IS NULL`);
  const row = rows[0];
  if (!row) fail("Workspace is unavailable.", { statusCode: 403 });
  return {
    orgId,
    name: String(row.name),
    canEdit: row.role === "owner" || row.role === "admin",
  };
}

export async function changeWorkspaceName(name: string, expectedOrgId: string) {
  const orgId = await requireSemanticOrg();
  if (expectedOrgId !== orgId)
    fail(
      "The active workspace changed. Reopen workspace settings and try again.",
      { statusCode: 409 },
    );
  const email = getRequestUserEmail()?.trim().toLowerCase();
  const { rows } = await getDbExec().execute(sql`
    UPDATE organizations SET name = ${sql.value(name)}
    WHERE id = ${sql.value(orgId)} AND EXISTS (
      SELECT 1 FROM org_members m WHERE m.org_id = ${sql.value(orgId)}
        AND lower(m.email) = ${sql.value(email)} AND m.role IN ('owner', 'admin')
        AND m.federation_removal_pending_at IS NULL
    ) RETURNING name`);
  if (!rows[0])
    fail("Only workspace owners and admins can update the workspace name.", {
      statusCode: 403,
    });
  invalidateMemberOrgCaches();
  return { name: String(rows[0].name) };
}
