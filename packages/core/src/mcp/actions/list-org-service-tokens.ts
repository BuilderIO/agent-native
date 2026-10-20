/**
 * List the org service tokens — metadata only (name, who minted it,
 * created/last-used/revoked timestamps) — and the governed principals they
 * belong to (state, owner, risk tier, grant). Token values are never stored, so
 * they can never appear here. Any org member may list; minting, revoking and
 * governance changes are owner/admin-gated.
 */
import { z } from "zod";

import { defineAction } from "../../action.js";
import { listServicePrincipalPolicies } from "../../org/service-principal-policy.js";
import { listOrgServiceTokens } from "../connect-store.js";
import { describeServicePrincipal } from "./service-principal-input.js";
import {
  requireServiceTokenCaller,
  ServiceTokenError,
} from "./service-token-access.js";

export default defineAction({
  description:
    "List your organization's service tokens (CI credentials such as PLAN_RECAP_TOKEN): name, who created them, created/last-used times, and revocation state. Also returns `principals`: one row per service name (from tokens and governance records) with state (ungoverned = no owner/grant set, active, suspended, retired), owner, team, risk tier, purpose, allowedActions (null = unrestricted) and lifecycle history. Token values are never stored and never shown. Any org member can list.",
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
    let rows: Awaited<ReturnType<typeof listOrgServiceTokens>>;
    let policies: Awaited<ReturnType<typeof listServicePrincipalPolicies>>;
    try {
      [rows, policies] = await Promise.all([
        listOrgServiceTokens(caller.orgId),
        listServicePrincipalPolicies(caller.orgId),
      ]);
    } catch (error) {
      // An unreadable policy table must not render every principal "ungoverned".
      console.error("[service-principal] Listing failed:", error);
      throw new ServiceTokenError(
        "Could not read service principal governance. Try again.",
        503,
      );
    }
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
    const policyByName = new Map(policies.map((p) => [p.serviceName, p]));
    const names = new Set<string>(policyByName.keys());
    for (const row of rows) if (row.serviceName) names.add(row.serviceName);
    const principals = [...names]
      .sort()
      .map((name) =>
        describeServicePrincipal(caller.orgId, name, policyByName.get(name)),
      );
    return {
      orgId: caller.orgId,
      canManage: caller.role !== "member",
      tokens,
      principals,
    };
  },
});
