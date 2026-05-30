import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptSecretValue,
  decryptSecretValue,
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
});
