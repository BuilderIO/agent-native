/**
 * Mint an org-scoped SERVICE token for CI and other non-human callers (e.g.
 * the `PLAN_RECAP_TOKEN` GitHub secret used by PR Visual Recap). Unlike a
 * personal connect token, the credential belongs to the ORG: it keeps working
 * when the human who minted it leaves or revokes their own tokens, and rows
 * created with it are org-scoped so every org member can see them.
 *
 * SECURITY:
 *   - Gated to org owners/admins (see service-token-access.ts).
 *   - The token value appears ONLY in this action's response — it is never
 *     stored (only its `jti`) and never logged.
 *   - Not callable by the sandboxed agent tool loop (`toolCallable: false`):
 *     minting a long-lived credential must be an explicit human/HTTP/CLI act,
 *     never a prompt-injection target.
 *   - Revocable via `revoke-org-service-token` — same `revoked_at` gate the
 *     personal-token revocation path uses.
 *
 * GOVERNANCE: every mint leaves the principal governed. A name with no policy
 * row gets one (owner defaults to the creating admin, riskTier medium,
 * allowedActions null = unrestricted); an existing policy only changes the
 * fields passed explicitly. A suspended or retired name is refused, since a
 * token minted for it could never authenticate.
 */
import { z } from "zod";

import { defineAction } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import {
  getServicePrincipalPolicy,
  upsertServicePrincipalPolicy,
  type ServicePrincipalPolicy,
  type ServicePrincipalPolicyInput,
} from "../../org/service-principal-policy.js";
import { CREDENTIAL_MEMBERSHIP_UNAVAILABLE_MESSAGE } from "../../server/credential-membership-unavailable.js";
import { getRequestContext } from "../../server/request-context.js";
import {
  mintOrgServiceToken,
  OrgServiceTokenAppUrlError,
} from "../connect-route.js";
import {
  MAX_SERVICE_TOKEN_TTL_DAYS,
  revokeOrgServiceToken,
} from "../connect-store.js";
import { McpCredentialIssuanceError } from "../credential-issuance.js";
import {
  allowedActionsSchema,
  assertOwnerIsOrgMember,
  normalizeAllowedActions,
  ownerEmailSchema,
  parseServiceName,
  purposeSchema,
  riskTierSchema,
  teamSchema,
} from "./service-principal-input.js";
import {
  requireServiceTokenCaller,
  SERVICE_TOKEN_MANAGE_FORBIDDEN_MESSAGE,
  ServiceTokenError,
} from "./service-token-access.js";

export default defineAction({
  description:
    "Create a named, org-scoped service token (for CI like PR Visual Recap's PLAN_RECAP_TOKEN). The token acts as a service principal owned by the organization, not a person. Org owner/admin only. The token value is returned ONCE and never stored — copy it immediately. The principal is created governed: owner defaults to you, risk tier to medium, allowedActions to null (unrestricted); pass ownerEmail/team/riskTier/purpose/allowedActions to set them at birth. Refused when the name is suspended or retired.",
  schema: z.object({
    name: z
      .string()
      .min(1)
      .max(64)
      .describe("Short service name, e.g. 'ci' or 'pr-recap'"),
    ttlDays: z
      .number()
      .int()
      .min(1)
      .max(MAX_SERVICE_TOKEN_TTL_DAYS)
      .optional()
      .describe("Token lifetime in days (1-3650, default 365)"),
    ownerEmail: ownerEmailSchema.optional(),
    team: teamSchema.optional(),
    riskTier: riskTierSchema.optional(),
    purpose: purposeSchema.optional(),
    allowedActions: allowedActionsSchema.nullable().optional(),
  }),
  requiresAuth: true,
  toolCallable: false,
  audit: orgAdminAudit({
    targetType: "service-principal",
    targetId: (_args, result) =>
      (result as { serviceName?: string } | undefined)?.serviceName,
    recordInputs: false,
    summary: () => "Created or re-minted an organization service token.",
  }),
  run: async (args, ctx) => {
    const caller = await requireServiceTokenCaller({
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId,
      level: "manage",
    });

    const serviceName = parseServiceName(args.name);
    let existing: ServicePrincipalPolicy | null;
    try {
      existing = await getServicePrincipalPolicy(caller.orgId, serviceName);
    } catch (error) {
      console.error("[service-principal] Policy lookup failed:", error);
      throw new ServiceTokenError(
        "Could not read service principal governance. Try again.",
        503,
      );
    }
    if (existing && existing.lifecycle !== "active") {
      throw new ServiceTokenError(
        `Service principal "${serviceName}" is ${existing.lifecycle}. Resume it with set-service-principal-lifecycle before minting a token.`,
        409,
      );
    }
    const policyInput: ServicePrincipalPolicyInput = {};
    if (args.ownerEmail !== undefined) {
      policyInput.ownerEmail = await assertOwnerIsOrgMember(
        caller.orgId,
        args.ownerEmail,
      );
    } else if (!existing?.ownerEmail) {
      policyInput.ownerEmail = caller.email.toLowerCase();
    }
    if (args.team !== undefined) policyInput.team = args.team;
    if (args.riskTier !== undefined) policyInput.riskTier = args.riskTier;
    if (args.purpose !== undefined) policyInput.purpose = args.purpose;
    if (args.allowedActions !== undefined) {
      policyInput.allowedActions = normalizeAllowedActions(args.allowedActions);
    }

    let minted: Awaited<ReturnType<typeof mintOrgServiceToken>>;
    try {
      minted = await mintOrgServiceToken({
        serviceName,
        orgId: caller.orgId,
        createdBy: caller.email,
        ttlDays: args.ttlDays,
        appUrl: getRequestContext()?.requestOrigin?.replace(/\/+$/, ""),
      });
    } catch (error) {
      if (error instanceof OrgServiceTokenAppUrlError) {
        throw new ServiceTokenError(error.message, 500);
      }
      if (!(error instanceof McpCredentialIssuanceError)) throw error;
      throw error.reason === "not-member"
        ? new ServiceTokenError(SERVICE_TOKEN_MANAGE_FORBIDDEN_MESSAGE, 403)
        : new ServiceTokenError(CREDENTIAL_MEMBERSHIP_UNAVAILABLE_MESSAGE, 503);
    }

    // Governance is written after the mint so a rejected mint leaves no orphan
    // policy; a failed write revokes the token rather than leaving a live
    // credential that nobody is accountable for.
    let policy: ServicePrincipalPolicy;
    try {
      policy = await upsertServicePrincipalPolicy(
        caller.orgId,
        minted.serviceName,
        policyInput,
      );
    } catch (error) {
      console.error("[service-principal] Policy write failed:", error);
      let revoked = false;
      try {
        revoked = await revokeOrgServiceToken(caller.orgId, minted.id);
      } catch (revokeError) {
        console.error("[service-principal] Revoke after failure:", revokeError);
      }
      throw new ServiceTokenError(
        revoked
          ? "Could not record the service principal's governance, so the new token was revoked. Try again."
          : `Could not record the service principal's governance AND could not revoke token ${minted.id}. Revoke it with revoke-org-service-token.`,
        503,
      );
    }

    // Retirement can finish revoking existing tokens after the initial
    // lifecycle check but before this mint is recorded. The upsert returns the
    // persisted lifecycle; contain this token before ever returning its secret.
    if (policy.lifecycle !== "active") {
      let revoked = false;
      try {
        revoked = await revokeOrgServiceToken(caller.orgId, minted.id);
      } catch (error) {
        console.error(
          "[service-principal] Revoke after lifecycle change:",
          error,
        );
      }
      if (!revoked) {
        throw new ServiceTokenError(
          `Service principal "${serviceName}" became ${policy.lifecycle} while minting, and token ${minted.id} could not be revoked. Revoke it with revoke-org-service-token.`,
          503,
        );
      }
      throw new ServiceTokenError(
        `Service principal "${serviceName}" became ${policy.lifecycle} while minting. The new token was revoked; resume it before minting again.`,
        409,
      );
    }

    return {
      // The ONLY place the secret ever appears. Never stored, never logged.
      token: minted.token,
      id: minted.id,
      serviceName: minted.serviceName,
      serviceEmail: minted.serviceEmail,
      orgId: caller.orgId,
      ttlDays: minted.ttlDays,
      ownerEmail: policy.ownerEmail,
      riskTier: policy.riskTier,
      allowedActions: policy.allowedActions,
      note: "Store this token now (e.g. as the PLAN_RECAP_TOKEN GitHub Actions secret). It will not be shown again. Revoke it any time with revoke-org-service-token.",
    };
  },
});
