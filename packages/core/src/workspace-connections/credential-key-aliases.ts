const PROVIDER_CREDENTIAL_KEY_ALIASES: Record<
  string,
  Record<string, string[]>
> = {
  hubspot: {
    HUBSPOT_ACCESS_TOKEN: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_SECRET_KEY"],
    HUBSPOT_PRIVATE_APP_TOKEN: ["HUBSPOT_ACCESS_TOKEN", "HUBSPOT_SECRET_KEY"],
    // This alias is only considered after the connection has been identified
    // as HubSpot. Key names alone never identify a provider.
    HUBSPOT_SECRET_KEY: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_ACCESS_TOKEN"],
  },
};

function normalizeCredentialKey(key: string): string {
  return key.trim().toUpperCase();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

export function credentialKeyAliases(provider: string, key: string): string[] {
  const aliases =
    PROVIDER_CREDENTIAL_KEY_ALIASES[provider.trim().toLowerCase()]?.[
      normalizeCredentialKey(key)
    ] ?? [];
  return uniqueStrings([key, ...aliases]);
}

export function credentialKeyMatches(
  provider: string,
  requestedKey: string,
  refKey: string,
): boolean {
  const requested = new Set(
    credentialKeyAliases(provider, requestedKey).map(normalizeCredentialKey),
  );
  return requested.has(normalizeCredentialKey(refKey));
}

export function lookupKeysForRef(
  provider: string,
  requestedKey: string,
  refKey: string,
): string[] {
  return uniqueStrings([
    refKey,
    ...credentialKeyAliases(provider, refKey),
    requestedKey,
    ...credentialKeyAliases(provider, requestedKey),
  ]);
}
