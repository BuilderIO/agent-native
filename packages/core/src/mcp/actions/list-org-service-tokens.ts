/**
 * List the active org service tokens — metadata only (name, who minted it,
 * created/last-used/revoked timestamps). Token values are never stored, so
 * they can never appear here. Any org member may list; minting and revoking
 * are owner/admin-gated.
 */
import { z } from "zod";
import { defineAction } from "../../action.js";
import { listOrgServiceTokens } from "../connect-store.js";
import { requireServiceTokenCaller } from "./service-token-access.js";

export default defineAction({
  description:
    "List your organization's service tokens (CI credentials such as PLAN_RECAP_TOKEN): name, who created them, created/last-used times, and revocation state. Token values are never stored and never shown. Any org member can list.",
  schema: z.object({
    includeRevoked: z
      .boolean()
      .optional()
      .describe("Also include revoked tokens (default false)"),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    const caller = await requireServiceTokenCaller({
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId,
      level: "read",
    });
    const rows = await listOrgServiceTokens(caller.orgId);
    const tokens = rows
      .filter((row) => args.includeRevoked || row.revokedAt == null)
      .map((row) => ({
        id: row.id,
        serviceName: row.serviceName,
        serviceEmail: row.ownerEmail,
        label: row.label,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
      }));
    return { orgId: caller.orgId, tokens };
  },
});
