/**
 * Share-password storage for recordings.
 *
 * The per-recording share password gates access to public recordings. It is
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
 * transparently. A row that can't be decrypted (key rotated / corrupt) cannot
 * verify a supplied password.
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

export function getRecordingAccessTokenResourceId(
  recordingId: string,
  storedPassword: string | null | undefined,
  sharePasswordVersion: string | null | undefined,
  visibility: "private" | "org" | "public",
): string {
  let base = recordingId;
  if (
    sharePasswordVersion !== "initial" &&
    !sharePasswordVersion?.startsWith("legacy:")
  ) {
    const versionSource =
      storedPassword && isEncryptedSecretValue(storedPassword)
        ? storedPassword
        : sharePasswordVersion;
    if (!versionSource) {
      throw new Error("Recording access scope requires a password version");
    }
    const version = createHash("sha256").update(versionSource).digest("hex");
    base = `${recordingId}:access:${version}`;
  }

  return visibility === "public" ? base : `${base}:visibility:${visibility}`;
}
