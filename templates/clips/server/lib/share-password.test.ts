import { describe, expect, it } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY ||= "clips-share-password-test-key";

const {
  encryptSharePassword,
  getRecordingAccessTokenResourceId,
  verifySharePassword,
} = await import("./share-password.js");
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
    expect(verifySharePassword("legacy-pw", "legacy-pw")).toBe(true);
    expect(verifySharePassword("nope", "legacy-pw")).toBe(false);
  });

  it("treats a missing/empty stored value as no password", () => {
    expect(verifySharePassword("anything", null)).toBe(false);
    expect(verifySharePassword("anything", undefined)).toBe(false);
    expect(verifySharePassword("anything", "")).toBe(false);
  });

  it("invalidates scoped tokens when the stored password changes", () => {
    const previous = encryptSharePassword("same password");
    const current = encryptSharePassword("same password");

    expect(
      getRecordingAccessTokenResourceId("rec-1", previous, "same-update"),
    ).not.toBe(
      getRecordingAccessTokenResourceId("rec-1", current, "same-update"),
    );
  });

  it("uses the update timestamp for legacy plaintext rows without exposing the password", () => {
    const previous = getRecordingAccessTokenResourceId(
      "rec-1",
      "example-legacy-value",
      "2026-01-01T00:00:00.000Z",
    );
    const current = getRecordingAccessTokenResourceId(
      "rec-1",
      "example-legacy-value",
      "2026-01-02T00:00:00.000Z",
    );

    expect(previous).not.toBe(current);
    expect(previous).not.toContain("example-legacy-value");
    expect(() =>
      getRecordingAccessTokenResourceId("rec-1", "example-legacy-value", null),
    ).toThrow("Recording access scope requires an update timestamp");
  });

  it("versions passwordless recording links so removed passwords do not revive old links", () => {
    expect(
      getRecordingAccessTokenResourceId("rec-1", null, "before-password"),
    ).not.toBe(
      getRecordingAccessTokenResourceId("rec-1", null, "after-password"),
    );
  });
});
