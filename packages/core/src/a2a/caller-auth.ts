import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  callerOrgBindingClaims,
  resolveCallerOrgBinding,
  type CallerOrgBinding,
} from "./caller-org-binding.js";
import {
  getGlobalA2ASecret,
  signA2AOrgMemberDelegationToken,
  signA2AOrganizationToken,
  signA2AToken,
} from "./client.js";

const DEFAULT_A2A_CALLER_TOKEN_TTL = "5m";

export interface A2ACallerAuth {
  apiKey?: string;
  apiKeyFallbacks?: string[];
  userEmail?: string;
  orgId?: string;
  orgDomain?: string;
  orgSecret?: string;
  orgBinding?: CallerOrgBinding;
  metadata: Record<string, unknown>;
}

export async function resolveA2ACallerAuth(options?: {
  expiresIn?: string | number;
  includeGoogleToken?: boolean;
  audience?: string | string[];
  userIdentityOnly?: boolean;
}): Promise<A2ACallerAuth> {
  const userEmail = getRequestUserEmail();
  const isOrgMemberDelegation =
    getRequestContext()?.a2aIdentityAssurance === "org-member";
  const globalSecret = getGlobalA2ASecret();
  const metadata: Record<string, unknown> = {};
  if (userEmail) metadata.userEmail = userEmail;

  let orgDomain: string | undefined;
  let orgSecret: string | undefined;
  const orgId = getRequestOrgId();
  if (orgId) {
    const { getOrgDomain, getOrgA2ASecret } = await import("../org/context.js");
    orgDomain = (await getOrgDomain(orgId)) ?? undefined;
    if (orgDomain) metadata.orgDomain = orgDomain;
    orgSecret = (await getOrgA2ASecret(orgId)) ?? undefined;
  }
  const orgBinding =
    orgId && !options?.userIdentityOnly
      ? await resolveCallerOrgBinding({ orgId, orgDomain, userEmail })
      : undefined;

  const apiKeyAttempts: string[] = [];
  const addApiKeyAttempt = (token: string | undefined) => {
    if (!token || apiKeyAttempts.includes(token)) return;
    apiKeyAttempts.push(token);
  };
  if (
    userEmail &&
    !isOrgMemberDelegation &&
    options?.audience &&
    globalSecret &&
    (options.userIdentityOnly || !orgBinding || orgBinding.kind !== "unlinked")
  ) {
    const extraClaims =
      options.userIdentityOnly && orgId
        ? { org_id: orgId }
        : callerOrgBindingClaims(orgBinding);
    addApiKeyAttempt(
      await signA2AToken(
        userEmail,
        options?.userIdentityOnly ? undefined : orgDomain,
        undefined,
        {
          expiresIn: options?.expiresIn ?? DEFAULT_A2A_CALLER_TOKEN_TTL,
          preferGlobalSecret: true,
          audience: options?.audience,
          ...(extraClaims ? { extraClaims } : {}),
        },
      ),
    );
  }
  if (
    !options?.userIdentityOnly &&
    orgDomain &&
    options?.audience &&
    (orgSecret || globalSecret)
  ) {
    if (userEmail && orgSecret) {
      addApiKeyAttempt(
        await signA2AOrgMemberDelegationToken(
          userEmail,
          orgDomain,
          orgSecret,
          options.audience,
        ),
      );
    }
    addApiKeyAttempt(
      await signA2AOrganizationToken(orgDomain, orgSecret, undefined, {
        expiresIn: options?.expiresIn ?? DEFAULT_A2A_CALLER_TOKEN_TTL,
        audience: options?.audience,
      }),
    );
  }

  if (options?.includeGoogleToken) {
    await attachGoogleTokenMetadata(metadata, userEmail);
  }

  return {
    apiKey: apiKeyAttempts[0],
    ...(apiKeyAttempts.length > 1
      ? { apiKeyFallbacks: apiKeyAttempts.slice(1) }
      : {}),
    userEmail,
    orgId,
    orgDomain,
    orgSecret,
    ...(orgBinding ? { orgBinding } : {}),
    metadata,
  };
}

async function attachGoogleTokenMetadata(
  metadata: Record<string, unknown>,
  userEmail: string | undefined,
): Promise<void> {
  if (process.env.NODE_ENV !== "production" || !userEmail) return;

  try {
    const { listOAuthAccountsByOwner } =
      await import("../oauth-tokens/store.js");
    const accounts = await listOAuthAccountsByOwner("google", userEmail);
    const tokens = accounts[0]?.tokens;
    if (tokens?.access_token) {
      metadata.googleToken = tokens.access_token;
    }
  } catch {}
}
