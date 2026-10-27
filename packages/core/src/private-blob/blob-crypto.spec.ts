import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptBlobBytes, encryptBlobBytes } from "./blob-crypto.js";
import { PrivateBlobError } from "./errors.js";

const plain = new TextEncoder().encode("internal dashboard screenshot");

function flipFirstByte(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data);
  copy[0] ^= 0xff;
  return copy;
}

function flipFirstByteOf(base64url: string): string {
  return Buffer.from(
    flipFirstByte(Buffer.from(base64url, "base64url")),
  ).toString("base64url");
}

function decryptError(run: () => unknown): PrivateBlobError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateBlobError);
    return error as PrivateBlobError;
  }
  throw new Error("expected decryption to fail");
}

describe("blob encryption", () => {
  beforeEach(() => {
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", "blob-crypto-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips bytes without storing them in the clear", () => {
    const encrypted = encryptBlobBytes(plain);

    expect(Buffer.from(encrypted.ciphertext).toString()).not.toContain(
      "dashboard",
    );
    expect(Buffer.from(encrypted.iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(encrypted.tag, "base64url")).toHaveLength(16);
    expect(decryptBlobBytes(encrypted, encrypted.ciphertext)).toEqual(plain);
  });

  it("uses a fresh IV for each blob", () => {
    const first = encryptBlobBytes(plain);
    const second = encryptBlobBytes(plain);

    expect(first.iv).not.toBe(second.iv);
    expect(Buffer.from(first.ciphertext)).not.toEqual(
      Buffer.from(second.ciphertext),
    );
  });

  it("reports changed bytes, tags or IVs as corrupt", () => {
    const encrypted = encryptBlobBytes(plain);

    for (const run of [
      () => decryptBlobBytes(encrypted, flipFirstByte(encrypted.ciphertext)),
      () =>
        decryptBlobBytes(
          { ...encrypted, tag: flipFirstByteOf(encrypted.tag) },
          encrypted.ciphertext,
        ),
      () =>
        decryptBlobBytes(
          { ...encrypted, iv: flipFirstByteOf(encrypted.iv) },
          encrypted.ciphertext,
        ),
    ]) {
      const error = decryptError(run);
      expect(error.kind).toBe("corrupt");
      expect(error.message).toBe("Private blob bytes could not be decrypted");
    }
  });

  it("can't decrypt under a different key", () => {
    const encrypted = encryptBlobBytes(plain);
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", "another-deployment-key");

    expect(
      decryptError(() => decryptBlobBytes(encrypted, encrypted.ciphertext))
        .kind,
    ).toBe("corrupt");
  });
});
