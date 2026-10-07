/**
 * Set who is accountable for an org service principal and which actions it may
 * call. Fields left out keep their stored value; `null` clears one (and for
 * `allowedActions`, `null` means unrestricted). Lifecycle (suspend/resume) is a
 * separate action because it also contains in-flight work.
 *
 * Owner/admin only, and not callable by the agent tool loop: a prompt-injected
 * agent must not be able to widen a grant.
 */
import { z } from "zod";

import { defineAction } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import {
  upsertServicePrincipalPolicy,
  type ServicePrincipalPolicyInput,
} from "../../org/service-principal-policy.js";
import {
  allowedActionsSchema,
  assertOwnerIsOrgMember,
  describeServicePrincipal,
  normalizeAllowedActions,
  ownerEmailSchema,
  parseServiceName,
  purposeSchema,
  requireKnownServicePrincipal,
  riskTierSchema,
  teamSchema,
} from "./service-principal-input.js";
import {
  requireServiceTokenCaller,
  ServiceTokenError,
} from "./service-token-access.js";

const FIELDS = [
  "ownerEmail",
  "team",
  "riskTier",
  "purpose",
  "allowedActions",
] as const;

export default defineAction({
  description:
    "Set the governance record of an org service principal: accountable owner (an org member), team, risk tier, purpose, and the action allow-list (null = unrestricted, [] = nothing, a trailing * matches a prefix). Omitted fields are unchanged; null clears a field. Org owner/admin only.",
  schema: z.object({
    serviceName: z
      .string()
      .min(1)
      .max(64)
      .describe("Service name from list-org-service-tokens"),
    ownerEmail: ownerEmailSchema.nullable().optional(),
    team: teamSchema.nullable().optional(),
    riskTier: riskTierSchema.optional(),
    purpose: purposeSchema.nullable().optional(),
    allowedActions: allowedActionsSchema.nullable().optional(),
  }),
  toolCallable: false,
  audit: orgAdminAudit({
    targetType: "service-principal",
    targetId: (args) => String(args.serviceName ?? ""),
    // The grant list is only ever counted, never echoed, into the event.
    recordInputs: false,
    summary: (args, result) => {
      const r = result as { serviceEmail?: string; changedFields?: string[] };
      const changed = r.changedFields ?? [];
      const detail = changed.map((f) =>
        f === "allowedActions"
          ? args.allowedActions == null
            ? "allowedActions: unrestricted"
            : `allowedActions: ${args.allowedActions.length} entries`
          : f,
      );
      return `Updated governance of ${r.serviceEmail ?? args.serviceName}: ${detail.length ? detail.join(", ") : "no changes"}`;
    },
  }),
  run: async (args, ctx) => {
    const caller = await requireServiceTokenCaller({
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId,
      level: "manage",
    });
    const serviceName = parseServiceName(args.serviceName);
    const existing = await requireKnownServicePrincipal(
      caller.orgId,
      serviceName,
    );

    const input: ServicePrincipalPolicyInput = {};
    if (args.ownerEmail !== undefined) {
      input.ownerEmail =
        args.ownerEmail === null
          ? null
          : await assertOwnerIsOrgMember(caller.orgId, args.ownerEmail);
    }
    if (args.team !== undefined) input.team = args.team;
    if (args.riskTier !== undefined) input.riskTier = args.riskTier;
    if (args.purpose !== undefined) input.purpose = args.purpose;
    if (args.allowedActions !== undefined) {
      input.allowedActions = normalizeAllowedActions(args.allowedActions);
    }

    const before = {
      ownerEmail: existing?.ownerEmail ?? null,
      team: existing?.team ?? null,
      riskTier: existing?.riskTier ?? "medium",
      purpose: existing?.purpose ?? null,
      allowedActions: existing?.allowedActions ?? null,
    };
    const changedFields = FIELDS.filter(
      (field) =>
        input[field] !== undefined &&
        JSON.stringify(input[field]) !== JSON.stringify(before[field]),
    );

    let saved;
    try {
      saved = await upsertServicePrincipalPolicy(
        caller.orgId,
        serviceName,
        input,
      );
    } catch (error) {
      console.error("[service-principal] Policy write failed:", error);
      throw new ServiceTokenError(
        "Could not save the service principal policy. Nothing was changed; try again.",
        503,
      );
    }
    const principal = describeServicePrincipal(
      caller.orgId,
      serviceName,
      saved,
    );
    return {
      orgId: caller.orgId,
      serviceEmail: principal.serviceEmail,
      principal,
      changedFields,
    };
  },
});
