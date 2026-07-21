import { describe, expect, it } from "vitest";

// Deterministic key for the at-rest encryption round-trip. Set before importing
// the helper (which pulls in core's secrets/crypto).
process.env.SECRETS_ENCRYPTION_KEY ||= "clips-share-password-test-key";

const { encryptSharePassword, verifySharePassword } =
  await import("./share-password.js");
const { isEncryptedSecretValue } =
  await import("@agent-native/core/secrets/crypto");

describe("share-password storage", () => {
  it("clears the password for empty / nullish input", () => {
    expect(encryptSharePassword(null)).toBeNull();
    expect(encryptSharePassword(undefined)).toBeNull();
    expect(encryptSharePassword("")).toBeNull();
  });

  it("rejects whitespace-only input and trims real passwords", () => {
    expect(encryptSharePassword("   ")).toBeNull();
    expect(encryptSharePassword("\t\n")).toBeNull();

    const stored = encryptSharePassword("  hunter2  ");
    expect(verifySharePassword("hunter2", stored)).toBe(true);
  });

  it("encrypts at rest (no plaintext in the stored value) and round-trips", () => {
    const stored = encryptSharePassword("hunter2");
    expect(stored).not.toBeNull();
    expect(isEncryptedSecretValue(stored)).toBe(true);
    expect(stored).not.toContain("hunter2");
    expect(verifySharePassword("hunter2", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = encryptSharePassword("correct horse");
    expect(verifySharePassword("battery staple", stored)).toBe(false);
    expect(verifySharePassword("", stored)).toBe(false);
  });

  it("verifies legacy plaintext rows transparently (pre-encryption data)", () => {
    // Rows written before encryption stored the raw password.
    expect(verifySharePassword("legacy-pw", "legacy-pw")).toBe(true);
    expect(verifySharePassword("nope", "legacy-pw")).toBe(false);
  });

  it("treats a missing/empty stored value as no password", () => {
    expect(verifySharePassword("anything", null)).toBe(false);
    expect(verifySharePassword("anything", undefined)).toBe(false);
    expect(verifySharePassword("anything", "")).toBe(false);
  });
});
