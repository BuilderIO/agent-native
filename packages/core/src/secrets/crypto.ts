/**
 * Shared AES-256-GCM encryption for secret values at rest.
 *
 * Used by the framework secrets vault, per-user/per-org credentials
 * (`resolveCredential` / `saveCredential`, stored in `settings`), and other
 * column-level encrypted values. The `app_secrets` storage layer uses the
 * shared-key variant below because workspace-scoped vault rows are readable by
 * sibling apps in the same workspace. When a deployment has not been given
 * shared key material yet, that variant falls back to the app-scoped key so
 * existing single-app deployments can keep reading and writing secrets while
 * they migrate to the shared key.
 *
 * The default encryption key is derived from
 * `<APP_NAME>_SECRETS_ENCRYPTION_KEY` when set, then `SECRETS_ENCRYPTION_KEY`,
 * then `BETTER_AUTH_SECRET`. The app-scoped key lets a local multi-app
 * workspace read one app's encrypted production data without replacing the
 * shared local auth secret. In production we refuse to start without
 * configured key material — a CWD-derived fallback would be effectively
 * static (e.g. `/var/task` on Lambda), so anyone with read access to the DB
 * could decrypt every secret.
 *
 * Encrypted values are tagged `v1:<iv-hex>:<ct-hex>:<tag-hex>`. The `v1:` prefix
 * lets readers distinguish ciphertext from legacy plaintext during migration.
 */

type NodeCryptoModule = typeof import("node:crypto");

function getNodeCrypto(): NodeCryptoModule | undefined {
  if (
    typeof window !== "undefined" ||
    typeof process === "undefined" ||
    !process.versions?.node ||
    typeof process.getBuiltinModule !== "function"
  ) {
    return undefined;
  }
  return process.getBuiltinModule("node:crypto") as
    | NodeCryptoModule
    | undefined;
}

const nodeCrypto = getNodeCrypto();

let _warnedFallback = false;

function requireNodeCrypto(): NonNullable<typeof nodeCrypto> {
  if (!nodeCrypto) {
    throw new Error(
      "[agent-native/secrets] Secret encryption is only available in server/runtime code.",
    );
  }
  return nodeCrypto;
}

function processNodeEnv(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.NODE_ENV;
}

function processCwd(): string {
  if (typeof process === "undefined") return ".";
  return process.cwd();
}

function appScopedEncryptionKey(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const appName = process.env.APP_NAME?.trim() // guard:allow-env-credential — deploy-level app configuration selects the scoped encryption key.
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return appName
    ? process.env[`${appName}_SECRETS_ENCRYPTION_KEY`] // guard:allow-env-credential — deploy-level app encryption material, never a user credential.
    : undefined;
}

function sharedEncryptionKeyMaterial(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.SECRETS_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
}

function deriveSecretEncryptionKey(
  explicit: string | undefined,
  errorMessage: string,
  warningMessage: string,
): Buffer {
  const { createHash } = requireNodeCrypto();

  if (!explicit) {
    if (processNodeEnv() === "production") {
      throw new Error(errorMessage);
    }
    if (!_warnedFallback) {
      _warnedFallback = true;
      // eslint-disable-next-line no-console
      console.warn(warningMessage);
    }
  }

  const material = explicit || `agent-native-secrets:${processCwd()}`;
  return createHash("sha256").update(material).digest();
}

/**
 * Derive the key used by generic encrypted values such as credentials and
 * OAuth tokens. App-specific key material is allowed for these app-local
 * values.
 */
export function getSecretEncryptionKey(): Buffer {
  const appName =
    typeof process === "undefined"
      ? undefined
      : process.env.APP_NAME?.trim() // guard:allow-env-credential — deploy-level app configuration selects the scoped encryption key.
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
  return deriveSecretEncryptionKey(
    appScopedEncryptionKey() || sharedEncryptionKeyMaterial(),
    "[agent-native/secrets] Refusing to start in production without an encryption key. " +
      `Set ${appName ? `${appName}_SECRETS_ENCRYPTION_KEY, ` : ""}SECRETS_ENCRYPTION_KEY, or BETTER_AUTH_SECRET in the deploy environment. ` +
      "The previous CWD-derived fallback was effectively static (e.g. `/var/task` on Lambda), " +
      "which means anyone with read access to the DB could decrypt every secret.",
    "[agent-native/secrets] SECRETS_ENCRYPTION_KEY not set — using a machine-local fallback. " +
      "Set an app-scoped *_SECRETS_ENCRYPTION_KEY, SECRETS_ENCRYPTION_KEY, or BETTER_AUTH_SECRET for production. " +
      "Production deploys without one of these env vars now hard-fail.",
  );
}

/**
 * Derive the preferred workspace-shared key used by `app_secrets` rows.
 * Unlike generic column-level encryption, workspace vault data should decrypt
 * in sibling apps, so `SECRETS_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET` take
 * precedence. The app-scoped key remains a compatibility fallback for
 * deployments that have not configured shared material yet; once the shared
 * key is configured, writes use it and reads still fall back to old rows.
 */
export function getSharedSecretEncryptionKey(): Buffer {
  return deriveSecretEncryptionKey(
    sharedEncryptionKeyMaterial() || appScopedEncryptionKey(),
    "[agent-native/secrets] Refusing to start in production without encryption key material for workspace secrets. " +
      "Set SECRETS_ENCRYPTION_KEY, BETTER_AUTH_SECRET, or the app-scoped *_SECRETS_ENCRYPTION_KEY in the deploy environment.",
    "[agent-native/secrets] SECRETS_ENCRYPTION_KEY not set — using app-scoped or machine-local fallback for workspace secrets. " +
      "Set SECRETS_ENCRYPTION_KEY or BETTER_AUTH_SECRET in every workspace app so sibling apps share vault rows.",
  );
}

/** Whether this deployment has stable workspace-shared key material. */
export function hasSharedSecretEncryptionKeyMaterial(): boolean {
  return Boolean(sharedEncryptionKeyMaterial());
}

function encryptWithKey(plaintext: string, key: Buffer): string {
  const { createCipheriv, randomBytes } = requireNodeCrypto();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${ct.toString("hex")}:${tag.toString("hex")}`;
}

function decryptWithKey(encrypted: string, key: Buffer): string {
  const { createDecipheriv } = requireNodeCrypto();
  if (!encrypted.startsWith("v1:")) {
    throw new Error("Unrecognised secret encoding");
  }
  const [, ivHex, ctHex, tagHex] = encrypted.split(":");
  if (!ivHex || !ctHex || !tagHex) {
    throw new Error("Corrupt secret payload");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

/** Encrypt a plain-text value with the generic app-local key. */
export function encryptSecretValue(plaintext: string): string {
  return encryptWithKey(plaintext, getSecretEncryptionKey());
}

/** Decrypt a value produced by `encryptSecretValue`. Throws on tampering. */
export function decryptSecretValue(encrypted: string): string {
  return decryptWithKey(encrypted, getSecretEncryptionKey());
}

/** Encrypt a workspace-shared `app_secrets` value. */
export function encryptSharedSecretValue(plaintext: string): string {
  return encryptWithKey(plaintext, getSharedSecretEncryptionKey());
}

/** Decrypt a workspace-shared `app_secrets` value. */
export function decryptSharedSecretValue(encrypted: string): string {
  return decryptWithKey(encrypted, getSharedSecretEncryptionKey());
}

/**
 * Strict check for a value produced by `encryptSecretValue`: `v1:` followed by
 * three hex segments. Intentionally strict so a legacy plaintext credential
 * that merely happens to start with `v1:` is treated as plaintext (and read via
 * the legacy fallback) rather than mis-decrypted.
 */
const ENCRYPTED_VALUE_RE = /^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;

export function isEncryptedSecretValue(value: unknown): value is string {
  return typeof value === "string" && ENCRYPTED_VALUE_RE.test(value);
}
