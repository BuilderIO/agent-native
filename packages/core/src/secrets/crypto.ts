/**
 * Shared AES-256-GCM encryption for secret values at rest.
 *
 * Used by both the framework secrets vault (`app_secrets`) and per-user/per-org
 * credentials (`resolveCredential` / `saveCredential`, stored in `settings`) so
 * there is a single crypto implementation and a single key story.
 *
 * The encryption key is derived from `SECRETS_ENCRYPTION_KEY` (preferred) or the
 * existing `BETTER_AUTH_SECRET` env var (fallback so templates don't need a
 * second secret during development). In production we refuse to start without
 * one of them — a CWD-derived fallback would be effectively static (e.g.
 * `/var/task` on Lambda), so anyone with read access to the DB could decrypt
 * every secret.
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

/**
 * Derive a 32-byte AES key from the configured secret material via SHA-256.
 * Re-derived per call (cheap, stateless, and makes rotation easy).
 */
export function getSecretEncryptionKey(): Buffer {
  const { createHash } = requireNodeCrypto();
  const explicit =
    (typeof process === "undefined"
      ? undefined
      : process.env.SECRETS_ENCRYPTION_KEY) ||
    (typeof process === "undefined"
      ? undefined
      : process.env.BETTER_AUTH_SECRET);

  if (!explicit) {
    if (processNodeEnv() === "production") {
      throw new Error(
        "[agent-native/secrets] Refusing to start in production without an encryption key. " +
          "Set SECRETS_ENCRYPTION_KEY (preferred) or BETTER_AUTH_SECRET in the deploy environment. " +
          "The previous CWD-derived fallback was effectively static (e.g. `/var/task` on Lambda), " +
          "which means anyone with read access to the secrets table could decrypt every user's secrets.",
      );
    }
    if (!_warnedFallback) {
      _warnedFallback = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[agent-native/secrets] SECRETS_ENCRYPTION_KEY not set — using a machine-local fallback. " +
          "Set SECRETS_ENCRYPTION_KEY (or BETTER_AUTH_SECRET) for production. " +
          "Production deploys without one of these env vars now hard-fail.",
      );
    }
  }

  const material = explicit || `agent-native-secrets:${processCwd()}`;
  return createHash("sha256").update(material).digest();
}

/** Encrypt a plain-text value. Returns `v1:<iv-hex>:<ct-hex>:<tag-hex>`. */
export function encryptSecretValue(plaintext: string): string {
  const { createCipheriv, randomBytes } = requireNodeCrypto();
  const key = getSecretEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${ct.toString("hex")}:${tag.toString("hex")}`;
}

/** Decrypt a value produced by `encryptSecretValue`. Throws on tampering. */
export function decryptSecretValue(encrypted: string): string {
  const { createDecipheriv } = requireNodeCrypto();
  if (!encrypted.startsWith("v1:")) {
    throw new Error("Unrecognised secret encoding");
  }
  const [, ivHex, ctHex, tagHex] = encrypted.split(":");
  if (!ivHex || !ctHex || !tagHex) {
    throw new Error("Corrupt secret payload");
  }
  const key = getSecretEncryptionKey();
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
