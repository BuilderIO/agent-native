export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface GoogleOAuthCredentialKeyPair {
  clientIdKey: string;
  clientSecretKey: string;
}

export type ReadGoogleOAuthCredential = (
  key: string,
) => string | null | undefined | Promise<string | null | undefined>;

export const GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS = {
  clientIdKey: "GOOGLE_CLIENT_ID",
  clientSecretKey: "GOOGLE_CLIENT_SECRET",
} as const satisfies GoogleOAuthCredentialKeyPair;

export const GOOGLE_LEGACY_PROVIDER_CREDENTIAL_KEYS = {
  clientIdKey: "GOOGLE_LEGACY_CLIENT_ID",
  clientSecretKey: "GOOGLE_LEGACY_CLIENT_SECRET",
} as const satisfies GoogleOAuthCredentialKeyPair;

export const GOOGLE_PROVIDER_CREDENTIAL_KEY_PAIRS = [
  GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS,
  GOOGLE_LEGACY_PROVIDER_CREDENTIAL_KEYS,
] as const satisfies readonly GoogleOAuthCredentialKeyPair[];

function readCredentialPair(
  clientIdKey: string,
  clientSecretKey: string,
): GoogleOAuthCredentials | null {
  const clientId = process.env[clientIdKey];
  const clientSecret = process.env[clientSecretKey];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function readInjectedCredentialPair(
  readCredential: ReadGoogleOAuthCredential,
  keys: GoogleOAuthCredentialKeyPair,
): Promise<GoogleOAuthCredentials | null> {
  const [clientId, clientSecret] = await Promise.all([
    readCredential(keys.clientIdKey),
    readCredential(keys.clientSecretKey),
  ]);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Resolve Google provider credentials from an app-owned credential source.
 *
 * Templates pass their scoped secret reader so Core does not choose an app's
 * secret store or request context. An optional fallback reader preserves
 * deployments that still keep the same credential pair in environment vars.
 * Each candidate pair is read atomically and de-duped by client id, which lets
 * refresh paths retry tokens minted by a previous Google OAuth client without
 * ever mixing an id and secret from different sources.
 */
export async function resolveGoogleProviderCredentialCandidatesWithReader(options: {
  readCredential: ReadGoogleOAuthCredential;
  fallbackReadCredential?: ReadGoogleOAuthCredential;
  credentialKeyPairs?: readonly GoogleOAuthCredentialKeyPair[];
}): Promise<GoogleOAuthCredentials[]> {
  const pairs =
    options.credentialKeyPairs ?? GOOGLE_PROVIDER_CREDENTIAL_KEY_PAIRS;
  const candidates: GoogleOAuthCredentials[] = [];

  for (const keys of pairs) {
    const credentials =
      (await readInjectedCredentialPair(options.readCredential, keys)) ??
      (options.fallbackReadCredential
        ? await readInjectedCredentialPair(options.fallbackReadCredential, keys)
        : null);
    if (
      credentials &&
      !candidates.some(
        (candidate) => candidate.clientId === credentials.clientId,
      )
    ) {
      candidates.push(credentials);
    }
  }

  return candidates;
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
  return readCredentialPair(
    GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS.clientIdKey,
    GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS.clientSecretKey,
  );
}

export function resolveGoogleLegacyProviderCredentials(): GoogleOAuthCredentials | null {
  return readCredentialPair(
    GOOGLE_LEGACY_PROVIDER_CREDENTIAL_KEYS.clientIdKey,
    GOOGLE_LEGACY_PROVIDER_CREDENTIAL_KEYS.clientSecretKey,
  );
}

export function resolveGoogleProviderCredentialCandidates(): GoogleOAuthCredentials[] {
  const primary = resolveGoogleProviderCredentials();
  const legacy = resolveGoogleLegacyProviderCredentials();
  if (!primary) return legacy ? [legacy] : [];
  if (!legacy || legacy.clientId === primary.clientId) return [primary];
  return [primary, legacy];
}
