import { z } from "zod";

import { fail, type ActionRunContext } from "../action.js";
import {
  assertAuditAttribution,
  auditAttribution,
} from "../audit/attribution.js";
import { recordOrgAdminAuditEvent } from "../audit/org-admin.js";
import { getDbExec } from "../db/client.js";
import { requireOrgMember } from "./actions.js";
import type { SingleInviteResult } from "./handlers.js";

const invitationSchema = z
  .object({ email: z.string().trim().email() })
  .strict();

/**
 * Server-only admin invitation for an authenticated action. The helper records
 * its own audit event; callers must not add a second success audit. A pending
 * invitation can have emailSent:false, which callers must preserve.
 */
export async function inviteOrganizationAdmin(
  input: { email: string },
  ctx: ActionRunContext | undefined,
): Promise<SingleInviteResult> {
  const { email } = invitationSchema.parse(input);
  const caller = await requireOrgMember(ctx, true);
  if (caller.role !== "owner") {
    fail("Only the organization owner can invite admins", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  }
  const attribution = auditAttribution(ctx);
  assertAuditAttribution(attribution, "inviteOrganizationAdmin");
  const { rows } = await getDbExec().execute({
    sql: `SELECT name FROM organizations WHERE id = ? LIMIT 1`,
    args: [caller.orgId],
  });
  const orgName = rows[0]?.name ? String(rows[0].name) : null;
  const { inviteOne } = await import("./handlers.js");
  const result = await inviteOne(
    { orgId: caller.orgId, orgName, email: caller.email },
    email,
    "admin",
  );
  await recordOrgAdminAuditEvent({
    action: "invite-organization-admin",
    targetType: "org-invitation",
    targetId: result.email,
    summary: `Invited ${result.email} as admin`,
    userEmail: caller.email,
    orgId: caller.orgId,
    attribution,
    args: { email: result.email, role: result.role },
  });
  return result;
}
