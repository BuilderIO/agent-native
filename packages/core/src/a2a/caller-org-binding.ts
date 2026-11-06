export const A2A_ORG_IDENTITY_AUTHORITY_CLAIM = "org_identity_authority";
export const A2A_ORG_IDENTITY_ID_CLAIM = "org_identity_id";

export type CallerOrgBinding =
  | { kind: "domain"; orgDomain: string }
  | { kind: "federated"; authority: string; id: string }
  | { kind: "unlinked" };

/**
 * How a caller's active organization can be named to a peer app. Organization
 * ids are local to each app's database, so only an email domain or the
 * identity hub's shared `(authority, id)` pair may cross an app boundary. An
 * `unlinked` organization sends nothing: an unscoped token would run the call
 * outside the team's data.
 */
export async function resolveCallerOrgBinding(input: {
  orgId: string;
  orgDomain?: string | null | undefined;
  userEmail?: string | undefined;
}): Promise<CallerOrgBinding> {
  const orgDomain = input.orgDomain?.trim();
  if (orgDomain) return { kind: "domain", orgDomain };

  const { getOrgFederatedIdentity } = await import("../org/context.js");
  const identity = await getOrgFederatedIdentity(input.orgId);
  if (!identity) return { kind: "unlinked" };

  const [
    { evaluateFeatureFlagStrict },
    { registerFeatureFlags },
    { CROSS_APP_ORG_FEDERATION_FLAG },
  ] = await Promise.all([
    import("../feature-flags/store.js"),
    import("../feature-flags/registry.js"),
    import("../org/feature-flags.js"),
  ]);
  // An unregistered flag evaluates to off, which would read as "not linked".
  registerFeatureFlags([CROSS_APP_ORG_FEDERATION_FLAG]);
  const enabled = await evaluateFeatureFlagStrict(
    CROSS_APP_ORG_FEDERATION_FLAG.key,
    {
      ...(input.userEmail
        ? { userEmail: input.userEmail, userKey: input.userEmail }
        : {}),
      orgId: input.orgId,
    },
  );
  return enabled ? { kind: "federated", ...identity } : { kind: "unlinked" };
}

export function callerOrgBindingClaims(
  binding: CallerOrgBinding | undefined,
): Record<string, string> | undefined {
  if (binding?.kind !== "federated") return undefined;
  return {
    [A2A_ORG_IDENTITY_AUTHORITY_CLAIM]: binding.authority,
    [A2A_ORG_IDENTITY_ID_CLAIM]: binding.id,
  };
}
