/**
 * Share-password storage for recordings.
 *
 * The per-recording share password gates access to private recordings. It is
 * stored encrypted at rest (AES-256-GCM, same key story as the framework
 * secrets vault) so a leaked DB backup / pg_dump / read replica does not expose
 * every share password in plaintext, and it is never returned to clients (the
 * player surfaces only `hasPassword`). Verification decrypts server-side and
 * compares in constant time.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import {
  encryptSecretValue,
  decryptSecretValue,
  isEncryptedSecretValue,
} from "@agent-native/core/secrets/crypto";

/**
 * Encrypt a share password for storage. Empty / nullish / whitespace-only
 * input clears it (returns null), matching the prior `args.password ?? null`
 * semantics while also rejecting spaces-only "passwords". Real values are
 * trimmed so accidental leading/trailing whitespace doesn't get baked into
 * the stored password.
 */
export function encryptSharePassword(
  raw: string | null | undefined,
): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  return encryptSecretValue(value);
}

/**
 * Recover the plaintext password from a stored value. Encrypted rows are
 * decrypted; rows written before encryption are legacy plaintext and read
 * transparently. A row that can't be decrypted (key rotated / corrupt) is
 * treated as "no password" rather than throwing.
 */
function decodeStoredPassword(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  if (isEncryptedSecretValue(stored)) {
    try {
      return decryptSecretValue(stored);
    } catch {
      return null;
    }
  }
  return stored;
}

/**
 * Constant-time check of a supplied password against the stored (encrypted or
 * legacy-plaintext) value. Hashing both sides to a fixed width lets
 * `timingSafeEqual` run without leaking length via an early return.
 */
export function verifySharePassword(
  supplied: string,
  stored: string | null | undefined,
): boolean {
  const expected = decodeStoredPassword(stored);
  if (expected == null || expected === "") return false;
  const a = createHash("sha256").update(supplied, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
