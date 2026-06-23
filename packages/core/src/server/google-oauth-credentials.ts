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
