/**
 * Governance input shared by `create-org-service-token` and
 * `set-service-principal-policy`, so a principal is validated the same way
 * whether it is born governed or tightened later.
 */
import { z } from "zod";

import { isOrgMember } from "../../org/membership.js";
import { parseServiceIdentityEmail } from "../../org/service-identity.js";
import {
  getServicePrincipalPolicy,
  SERVICE_PRINCIPAL_RISK_TIERS,
  type ServicePrincipalLifecycle,
  type ServicePrincipalPolicy,
  type ServicePrincipalRiskTier,
} from "../../org/service-principal-policy.js";
import { CREDENTIAL_MEMBERSHIP_UNAVAILABLE_MESSAGE } from "../../server/credential-membership-unavailable.js";
import {
  listOrgServiceTokens,
  normalizeServiceName,
  serviceIdentityEmail,
} from "../connect-store.js";
import { ServiceTokenError } from "./service-token-access.js";

export const MAX_ALLOWED_ACTIONS = 200;

/** An exact action name, or a prefix with ONE trailing `*`. A bare `*` is rejected: unrestricted is `null`. */
const ACTION_PATTERN = /^[A-Za-z0-9_.:-]+\*?$/;

export const riskTierSchema = z
  .enum(SERVICE_PRINCIPAL_RISK_TIERS)
  .describe("Risk tier: low, medium (default) or high");

export const allowedActionsSchema = z
  .array(z.string().min(1).max(128).regex(ACTION_PATTERN))
  .max(MAX_ALLOWED_ACTIONS)
  .describe(
    "Action names the principal may call; a trailing * matches a prefix (e.g. 'list-*'). An empty list grants nothing. Use null for unrestricted.",
  );

export const ownerEmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .describe("Accountable org member (email)");

export const teamSchema = z.string().trim().min(1).max(120);
export const purposeSchema = z.string().trim().min(1).max(500);

/** Dedupe so the stored grant (and its audited count) has no repeats. */
export function normalizeAllowedActions(
  allowed: string[] | null | undefined,
): string[] | null | undefined {
  return allowed ? [...new Set(allowed)] : allowed;
}

/**
 * The owner must be a person in this org. A service identity is refused by
 * name so the answer is a clear 400 rather than a membership miss, and an
 * unreadable membership store is a 503, never "not a member".
 */
export async function assertOwnerIsOrgMember(
  orgId: string,
  ownerEmail: string,
): Promise<string> {
  const email = ownerEmail.trim().toLowerCase();
  if (parseServiceIdentityEmail(email)) {
    throw new ServiceTokenError(
      "A service principal cannot own another service principal. Choose an org member.",
      400,
    );
  }
  let member: boolean;
  try {
    member = await isOrgMember(orgId, email);
  } catch (error) {
    console.error("[service-principal] Owner membership lookup failed:", error);
    throw new ServiceTokenError(CREDENTIAL_MEMBERSHIP_UNAVAILABLE_MESSAGE, 503);
  }
  if (!member) {
    throw new ServiceTokenError(
      `${email} is not a member of this organization.`,
      400,
    );
  }
  return email;
}

export interface ServicePrincipalView {
  serviceName: string;
  serviceEmail: string;
  state: "ungoverned" | ServicePrincipalLifecycle;
  ownerEmail: string | null;
  team: string | null;
  riskTier: ServicePrincipalRiskTier | null;
  purpose: string | null;
  /** `null` is unrestricted. */
  allowedActions: string[] | null;
  lifecycleReason: string | null;
  lifecycleChangedBy: string | null;
  lifecycleChangedAt: number | null;
}

/** No policy row is "ungoverned": a legacy principal that is active and unrestricted. */
export function describeServicePrincipal(
  orgId: string,
  serviceName: string,
  policy: ServicePrincipalPolicy | null | undefined,
): ServicePrincipalView {
  return {
    serviceName,
    serviceEmail: serviceIdentityEmail(serviceName, orgId),
    state: policy?.lifecycle ?? "ungoverned",
    ownerEmail: policy?.ownerEmail ?? null,
    team: policy?.team ?? null,
    riskTier: policy?.riskTier ?? null,
    purpose: policy?.purpose ?? null,
    allowedActions: policy ? policy.allowedActions : null,
    lifecycleReason: policy?.lifecycleReason ?? null,
    lifecycleChangedBy: policy?.lifecycleChangedBy ?? null,
    lifecycleChangedAt: policy?.lifecycleChangedAt ?? null,
  };
}

/**
 * A name with neither a token nor a policy is a typo, not a principal; refusing
 * it keeps governance rows from accumulating for names that can never act.
 */
export async function requireKnownServicePrincipal(
  orgId: string,
  serviceName: string,
): Promise<ServicePrincipalPolicy | null> {
  let policy: ServicePrincipalPolicy | null;
  let tokens: Awaited<ReturnType<typeof listOrgServiceTokens>>;
  try {
    [policy, tokens] = await Promise.all([
      getServicePrincipalPolicy(orgId, serviceName),
      listOrgServiceTokens(orgId),
    ]);
  } catch (error) {
    console.error("[service-principal] Principal lookup failed:", error);
    throw new ServiceTokenError(
      "Could not read service principal governance. Try again.",
      503,
    );
  }
  if (!policy && !tokens.some((t) => t.serviceName === serviceName)) {
    throw new ServiceTokenError(
      `No service principal named "${serviceName}" in this organization.`,
      404,
    );
  }
  return policy;
}

/** Normalize a user-supplied name; a name with no usable characters is a 400. */
export function parseServiceName(raw: string): string {
  try {
    return normalizeServiceName(raw);
  } catch (error) {
    throw new ServiceTokenError(
      error instanceof Error ? error.message : "Invalid service name.",
      400,
    );
  }
}
