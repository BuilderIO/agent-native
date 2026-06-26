import { describe, it, expect, beforeAll, afterEach } from "vitest";

import {
  encryptSecretValue,
  decryptSecretValue,
  getSecretEncryptionKey,
  isEncryptedSecretValue,
} from "./crypto.js";

beforeAll(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "crypto-spec-encryption-key";
});

describe("secret crypto", () => {
  it("round-trips a value and never stores it in the clear", () => {
    const enc = encryptSecretValue("sk-live-abc123");
    expect(enc).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(enc).not.toContain("sk-live-abc123");
    expect(decryptSecretValue(enc)).toBe("sk-live-abc123");
  });

  it("uses a fresh IV per call (no deterministic ciphertext)", () => {
    expect(encryptSecretValue("x")).not.toBe(encryptSecretValue("x"));
  });

  it("recognises encrypted values strictly", () => {
    expect(isEncryptedSecretValue(encryptSecretValue("y"))).toBe(true);
    // A legacy plaintext secret that merely starts with `v1:` is NOT treated
    // as ciphertext, so the credential read-path falls back to plaintext.
    expect(isEncryptedSecretValue("v1:hello-world")).toBe(false);
    expect(isEncryptedSecretValue("sk-plaintext-key")).toBe(false);
    expect(isEncryptedSecretValue(undefined)).toBe(false);
    expect(isEncryptedSecretValue(123)).toBe(false);
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const enc = encryptSecretValue("secret");
    const tampered = enc.slice(0, -2) + (enc.endsWith("00") ? "11" : "00");
    expect(() => decryptSecretValue(tampered)).toThrow();
  });

  it("fails to decrypt with a rotated key", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "key-A";
    const enc = encryptSecretValue("rotate-me");
    process.env.SECRETS_ENCRYPTION_KEY = "key-B";
    expect(() => decryptSecretValue(enc)).toThrow();
    process.env.SECRETS_ENCRYPTION_KEY = "crypto-spec-encryption-key";
  });

  it("rejects payloads that are not v1-tagged ciphertext", () => {
    // A legacy plaintext value (or any non-v1 string) is refused outright so
    // the caller can fall back rather than mis-decrypt arbitrary bytes.
    expect(() => decryptSecretValue("sk-plaintext-key")).toThrow(
      /Unrecognised secret encoding/,
    );
  });

  it("rejects a v1 payload that is missing one of its three segments", () => {
    expect(() => decryptSecretValue("v1:onlyiv:onlyct")).toThrow(
      /Corrupt secret payload/,
    );
    expect(() => decryptSecretValue("v1:")).toThrow(/Corrupt secret payload/);
  });
});

describe("getSecretEncryptionKey", () => {
  const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY;
  const ORIGINAL_AUTH = process.env.BETTER_AUTH_SECRET;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY;
    if (ORIGINAL_AUTH === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = ORIGINAL_AUTH;
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("derives a stable 32-byte AES key from the configured material", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "stable-material";
    const a = getSecretEncryptionKey();
    const b = getSecretEncryptionKey();
    expect(a).toHaveLength(32);
    // Re-derived per call but deterministic for the same material.
    expect(a.equals(b)).toBe(true);
  });

  it("falls back to BETTER_AUTH_SECRET when SECRETS_ENCRYPTION_KEY is unset", () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    process.env.BETTER_AUTH_SECRET = "auth-fallback-material";
    // The derived key must match deriving directly from the same material via
    // SECRETS_ENCRYPTION_KEY — i.e. the fallback source is honored.
    const viaAuth = getSecretEncryptionKey();
    process.env.SECRETS_ENCRYPTION_KEY = "auth-fallback-material";
    delete process.env.BETTER_AUTH_SECRET;
    const viaExplicit = getSecretEncryptionKey();
    expect(viaAuth.equals(viaExplicit)).toBe(true);
  });

  it("refuses to derive a key in production without any configured secret", () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    delete process.env.BETTER_AUTH_SECRET;
    process.env.NODE_ENV = "production";
    expect(() => getSecretEncryptionKey()).toThrow(
      /Refusing to start in production without an encryption key/,
    );
  });
});
