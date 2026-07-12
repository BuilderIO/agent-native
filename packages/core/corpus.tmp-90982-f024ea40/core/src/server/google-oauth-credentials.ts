export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

function readCredentialPair(
  clientIdKey: string,
  clientSecretKey: string,
): GoogleOAuthCredentials | null {
  const clientId = process.env[clientIdKey];
  const clientSecret = process.env[clientSecretKey];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Credentials for identity-only Google sign-in. Deploys that also use Google
 * product APIs can set these separately from GOOGLE_CLIENT_ID/SECRET, which
 * remain the backwards-compatible provider OAuth credentials.
 */
export function resolveGoogleSignInCredentials(): GoogleOAuthCredentials | null {
  return (
    readCredentialPair(
      "GOOGLE_SIGN_IN_CLIENT_ID",
      "GOOGLE_SIGN_IN_CLIENT_SECRET",
    ) ?? readCredentialPair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")
  );
}

export function hasGoogleSignInCredentials(): boolean {
  return resolveGoogleSignInCredentials() !== null;
}

export function resolveGoogleProviderCredentials(): GoogleOAuthCredentials | null {
  return readCredentialPair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
}

export function resolveGoogleLegacyProviderCredentials(): GoogleOAuthCredentials | null {
  return readCredentialPair(
    "GOOGLE_LEGACY_CLIENT_ID",
    "GOOGLE_LEGACY_CLIENT_SECRET",
  );
}

export function resolveGoogleProviderCredentialCandidates(): GoogleOAuthCredentials[] {
  const primary = resolveGoogleProviderCredentials();
  const legacy = resolveGoogleLegacyProviderCredentials();
  if (!primary) return legacy ? [legacy] : [];
  if (!legacy || legacy.clientId === primary.clientId) return [primary];
  return [primary, legacy];
}
