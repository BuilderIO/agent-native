/**
 * Runtime recovery for Better Auth JWKS keys orphaned by an auth-secret
 * rotation.
 *
 * Better Auth encrypts the persisted JWT signing key with the current
 * `BETTER_AUTH_SECRET`. Rotating that secret leaves the newest `jwks` row
 * undecryptable, and the JWT plugin's optional response hook signs it on every
 * `/get-session` response when enabled — so a rotation can turn every session
 * check into a 500 and sign the whole deployment out (2026-08-28 outage on
 * the hosted design/clips apps). The release migration
 * `better-auth-jwks-key-rotation-recovery` already expires stale rows, but
 * release migrations do not reach every deployed database, so the same
 * recovery must also run where the failure is actually observed.
 */
import { parseEnvelope, symmetricDecrypt } from "better-auth/crypto";

const JWKS_DECRYPT_ERROR_SNIPPET = "Failed to decrypt private key";

export function isJwksDecryptError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes(JWKS_DECRYPT_ERROR_SNIPPET)
  );
}

const HEAL_COOLDOWN_MS = 60_000;
let lastHealAttemptAt = 0;
let inFlightHeal: Promise<boolean> | undefined;

export function resetJwksSecretRotationStateForTests(): void {
  lastHealAttemptAt = 0;
  inFlightHeal = undefined;
}

/**
 * Verify the newest active JWKS key against the current secret and, only when
 * it genuinely cannot be decrypted, expire the stale rows so Better Auth
 * mints a fresh key on the next JWT it signs. Returns true when rows were
 * expired (callers may retry the failed request once), false otherwise.
 */
export async function healUndecryptableJwks(): Promise<boolean> {
  if (inFlightHeal) return inFlightHeal;
  const now = Date.now();
  if (now - lastHealAttemptAt < HEAL_COOLDOWN_MS) return false;
  lastHealAttemptAt = now;
  inFlightHeal = attemptHeal().finally(() => {
    inFlightHeal = undefined;
  });
  return inFlightHeal;
}

async function attemptHeal(): Promise<boolean> {
  const [{ getDbExec }, { getAuthSecret }] = await Promise.all([
    import("../db/client.js"),
    import("./better-auth-instance.js"),
  ]);

  const table = '"jwks"';
  const nowValue = new Date().toISOString();
  const { rows } = await getDbExec().execute({
    sql: `SELECT private_key FROM ${table} WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC LIMIT 1`,
    args: [nowValue],
  });
  const storedPrivateKey = rows[0]?.private_key;
  if (typeof storedPrivateKey !== "string") return false;

  let ciphertext: unknown;
  try {
    ciphertext = JSON.parse(storedPrivateKey);
    // coercion-ok: false is the typed "did not heal" answer, documented above.
  } catch {
    return false;
  }
  if (typeof ciphertext !== "string") return false;

  if (parseEnvelope(ciphertext)) return false;

  try {
    await symmetricDecrypt({ key: getAuthSecret(), data: ciphertext });
    return false;
    // coercion-ok: this decrypt is a probe; the throw is the positive signal.
  } catch {
    // Confirmed: the newest active key does not decrypt with the current
    // secret. Fall through to the loud expiry below.
  }

  console.error(
    "[auth] The newest JWKS signing key cannot be decrypted with the current " +
      "BETTER_AUTH_SECRET — the secret was rotated after the key was stored. " +
      "Expiring stale JWKS keys so Better Auth mints a fresh one; users, " +
      "sessions, and cookies are unaffected.",
  );
  const { expireJwksKeysAfterAuthSecretRotation } =
    await import("./better-auth-migrations.js");
  await expireJwksKeysAfterAuthSecretRotation();
  return true;
}

type AuthHookLike = {
  matcher: (context: any) => boolean;
  handler: (context: any) => Promise<unknown>;
};

type AuthPluginLike = {
  hooks?: {
    before?: AuthHookLike[];
    after?: AuthHookLike[];
  };
};

export function withJwksRotationRecovery<P extends AuthPluginLike>(
  plugin: P,
): P {
  const after = plugin.hooks?.after;
  if (!after) return plugin;
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      after: after.map((hook) => ({
        ...hook,
        handler: async (context: any) => {
          try {
            return await hook.handler(context);
          } catch (error) {
            if (!isJwksDecryptError(error)) throw error;
            if (await healUndecryptableJwks()) {
              try {
                return await hook.handler(context);
              } catch (retryError) {
                if (!isJwksDecryptError(retryError)) throw retryError;
              }
            }
            console.error(
              "[auth] Skipping the set-auth-jwt response header: the JWKS " +
                "signing key is still undecryptable after rotation recovery.",
              error,
            );
            return undefined;
          }
        },
      })),
    },
  };
}
