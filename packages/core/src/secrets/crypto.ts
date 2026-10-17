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
 * The generic encryption key is derived from
 * `<APP_NAME>_SECRETS_ENCRYPTION_KEY` when set, then
 * `SECRETS_ENCRYPTION_KEY`, then `BETTER_AUTH_SECRET`. Workspace-shared vault
 * rows use a different precedence: `WORKSPACE_SECRETS_ENCRYPTION_KEY`, then
 * the legacy shared `SECRETS_ENCRYPTION_KEY`, then material derived from the
 * workspace-wide `A2A_SECRET`, then the app-local auth/key fallbacks retained
 * for backward-compatible reads. A previous workspace key can be supplied
 * during rotation with `WORKSPACE_SECRETS_ENCRYPTION_KEY_PREVIOUS`. This keeps
 * sibling apps on one stable key even when each app correctly has a different
 * auth secret, and prevents A2A trust rotation from stranding vault data.
 *
 * In production we refuse to start without configured key material — a
 * CWD-derived fallback would be effectively static (e.g. `/var/task` on
 * Lambda), so anyone with read access to the DB could decrypt every secret.
 *
 * Encrypted values are tagged `v1:<iv-hex>:<ct-hex>:<tag-hex>`. The `v1:` prefix
 * lets readers distinguish ciphertext from legacy plaintext during migration.
 */

import {
  deriveServerSecret,
  getWorkspaceA2ADerivedSecret,
} from "../server/derived-secret.js";

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

function genericEncryptionKeyMaterial(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return (
    process.env.SECRETS_ENCRYPTION_KEY ||
    process.env.BETTER_AUTH_SECRET ||
    getWorkspaceA2ADerivedSecret("secrets-encryption")
  );
}

function workspaceSharedEncryptionKeyMaterial(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.WORKSPACE_SECRETS_ENCRYPTION_KEY?.trim() || undefined;
}

function previousWorkspaceSharedEncryptionKeyMaterial(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return (
    process.env.WORKSPACE_SECRETS_ENCRYPTION_KEY_PREVIOUS?.trim() || undefined
  );
}

function a2aSharedEncryptionKeyMaterial(): string | undefined {
  const workspaceDerived = getWorkspaceA2ADerivedSecret("secrets-encryption");
  if (workspaceDerived) return workspaceDerived;
  if (typeof process === "undefined") return undefined;
  const rootSecret = process.env.A2A_SECRET?.trim();
  return rootSecret
    ? deriveServerSecret(rootSecret, "secrets-encryption")
    : undefined;
}

function sharedEncryptionKeyMaterials(): string[] {
  if (typeof process === "undefined") return [];
  const candidates = [
    workspaceSharedEncryptionKeyMaterial(),
    process.env.SECRETS_ENCRYPTION_KEY,
    a2aSharedEncryptionKeyMaterial(),
    previousWorkspaceSharedEncryptionKeyMaterial(),
    process.env.BETTER_AUTH_SECRET,
    appScopedEncryptionKey(),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}

function preferredSharedEncryptionKeyMaterial(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return (
    workspaceSharedEncryptionKeyMaterial() ||
    process.env.SECRETS_ENCRYPTION_KEY ||
    a2aSharedEncryptionKeyMaterial() ||
    process.env.BETTER_AUTH_SECRET ||
    appScopedEncryptionKey()
  );
}

function hashSecretEncryptionKey(material: string): Buffer {
  const { createHash } = requireNodeCrypto();
  return createHash("sha256").update(material).digest();
}

function deriveSecretEncryptionKey(
  explicit: string | undefined,
  errorMessage: string,
  warningMessage: string,
): Buffer {
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
  return hashSecretEncryptionKey(material);
}

export function getSecretEncryptionKey(): Buffer {
  const appName =
    typeof process === "undefined"
      ? undefined
      : process.env.APP_NAME?.trim() // guard:allow-env-credential — deploy-level app configuration selects the scoped encryption key.
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
  return deriveSecretEncryptionKey(
    appScopedEncryptionKey() || genericEncryptionKeyMaterial(),
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
 * Unlike generic column-level encryption, workspace vault data must decrypt
 * in sibling apps. An explicit `WORKSPACE_SECRETS_ENCRYPTION_KEY` wins without
 * changing the key for app-local OAuth and credential ciphertext. The legacy
 * shared `SECRETS_ENCRYPTION_KEY` remains supported; hosted workspaces
 * otherwise derive material from their shared `A2A_SECRET` before considering
 * app-local `BETTER_AUTH_SECRET` or app-scoped key fallbacks. Reads try every
 * configured legacy/previous candidate and report when the ciphertext should
 * be refreshed under the preferred key.
 */
export function getSharedSecretEncryptionKey(): Buffer {
  return deriveSecretEncryptionKey(
    preferredSharedEncryptionKeyMaterial(),
    "[agent-native/secrets] Refusing to start in production without encryption key material for workspace secrets. " +
      "Set WORKSPACE_SECRETS_ENCRYPTION_KEY (preferred), SECRETS_ENCRYPTION_KEY, ensure a hosted workspace has A2A_SECRET, " +
      "or set BETTER_AUTH_SECRET / an app-scoped " +
      "*_SECRETS_ENCRYPTION_KEY compatibility fallback in the deploy environment.",
    "[agent-native/secrets] Workspace encryption key not set — using app-scoped or machine-local fallback for workspace secrets. " +
      "Set WORKSPACE_SECRETS_ENCRYPTION_KEY or rely on A2A_SECRET-derived material on hosted workspace deploys so sibling apps share vault rows.",
  );
}

export function hasSharedSecretEncryptionKeyMaterial(): boolean {
  if (typeof process === "undefined") return false;
  return Boolean(
    workspaceSharedEncryptionKeyMaterial() ||
    process.env.SECRETS_ENCRYPTION_KEY ||
    a2aSharedEncryptionKeyMaterial() ||
    process.env.BETTER_AUTH_SECRET,
  );
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

export function encryptSecretValue(plaintext: string): string {
  return encryptWithKey(plaintext, getSecretEncryptionKey());
}

export function decryptSecretValue(encrypted: string): string {
  return decryptWithKey(encrypted, getSecretEncryptionKey());
}

export function encryptSharedSecretValue(plaintext: string): string {
  return encryptWithKey(plaintext, getSharedSecretEncryptionKey());
}

export function decryptSharedSecretValue(encrypted: string): string {
  return decryptSharedSecretValueDetailed(encrypted).value;
}

export interface DecryptedSharedSecretValue {
  value: string;
  needsReencrypt: boolean;
}

/**
 * Decrypt workspace ciphertext with the preferred key first, then configured
 * legacy candidates. The result never exposes which secret material matched.
 */
export function decryptSharedSecretValueDetailed(
  encrypted: string,
): DecryptedSharedSecretValue {
  const preferredKey = getSharedSecretEncryptionKey();
  const candidateKeys = [preferredKey];
  for (const material of sharedEncryptionKeyMaterials()) {
    const candidate = hashSecretEncryptionKey(material);
    if (!candidateKeys.some((existing) => existing.equals(candidate))) {
      candidateKeys.push(candidate);
    }
  }

  let lastError: unknown;
  for (const candidate of candidateKeys) {
    try {
      return {
        value: decryptWithKey(encrypted, candidate),
        needsReencrypt: !candidate.equals(preferredKey),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to decrypt workspace secret");
}

const ENCRYPTED_VALUE_RE = /^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;

export function isEncryptedSecretValue(value: unknown): value is string {
  return typeof value === "string" && ENCRYPTED_VALUE_RE.test(value);
}
