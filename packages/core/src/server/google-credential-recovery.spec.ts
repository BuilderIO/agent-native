import {
  constants,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import type { GoogleOAuthRecoveryConfig } from "../app-config/google-oauth-recovery.js";
import {
  GoogleCredentialRecoveryError,
  recoverGoogleCredential,
} from "./google-credential-recovery.js";

const fakeSecret = "obviously-fake-google-secret-for-unit-tests";
const fakeClientId = "fake-google-client-id.apps.example.test";
const now = Date.parse("2026-11-09T20:00:00.000Z");

const keyPair = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const wrongKeyType = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const undersizedKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const baseConfig: GoogleOAuthRecoveryConfig = {
  recipientPublicKey: keyPair.publicKey,
  expectedClientId: fakeClientId,
  expectedSecretSha256: createHash("sha256").update(fakeSecret).digest("hex"),
  operatorEmail: "operator@example.test",
  notBefore: "2026-11-09T19:59:00.000Z",
  expiresAt: "2026-11-09T20:01:00.000Z",
};

function recover(
  overrides: Partial<Parameters<typeof recoverGoogleCredential>[0]> = {},
) {
  return recoverGoogleCredential({
    credentials: { clientId: fakeClientId, clientSecret: fakeSecret },
    recorded: true,
    userEmail: "OPERATOR@example.test",
    config: baseConfig,
    now,
    ...overrides,
  });
}

function expectFailure(
  code: GoogleCredentialRecoveryError["code"],
  overrides: Partial<Parameters<typeof recoverGoogleCredential>[0]> = {},
) {
  try {
    recover(overrides);
    throw new Error("Expected recovery to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(GoogleCredentialRecoveryError);
    expect((error as GoogleCredentialRecoveryError).code).toBe(code);
  }
}

describe("recoverGoogleCredential", () => {
  it("encrypts only the configured active pair for the pinned recipient", () => {
    const result = recover();
    const decrypted = privateDecrypt(
      {
        key: keyPair.privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(result.encryptedSecret, "base64url"),
    ).toString("utf8");

    expect(result).toMatchObject({
      algorithm: "RSA-OAEP-SHA256",
      clientId: fakeClientId,
      secretSha256: baseConfig.expectedSecretSha256,
      expiresAt: baseConfig.expiresAt,
    });
    expect(decrypted).toBe(fakeSecret);
    expect(result.encryptedSecret).not.toContain(fakeSecret);
    expect(JSON.stringify(result)).not.toContain(fakeSecret);
  });

  it("fails closed when recovery is off or its config is incomplete", () => {
    expectFailure("google_recovery_off", { config: {} });
    expectFailure("google_recovery_incomplete_config", {
      config: { ...baseConfig, expectedSecretSha256: undefined },
    });
  });

  it("requires the configured operator and recorded active pair", () => {
    expectFailure("google_recovery_wrong_operator", {
      userEmail: "other@example.test",
    });
    expectFailure("google_recovery_not_recorded", { recorded: false });
    expectFailure("google_recovery_credentials_missing", {
      credentials: null,
    });
  });

  it("matches both the active client ID and secret fingerprint before encryption", () => {
    expectFailure("google_recovery_client_mismatch", {
      credentials: { clientId: "other-client", clientSecret: fakeSecret },
    });
    expectFailure("google_recovery_secret_mismatch", {
      credentials: {
        clientId: fakeClientId,
        clientSecret: "different-fake-secret",
      },
    });
  });

  it("enforces the configured time window and 30-minute maximum lease", () => {
    expectFailure("google_recovery_not_yet_valid", { now: now - 61_000 });
    expectFailure("google_recovery_expired", { now: now + 61_000 });
    expectFailure("google_recovery_lease_too_long", {
      config: {
        ...baseConfig,
        expiresAt: "2026-11-09T20:30:01.000Z",
      },
    });
    expectFailure("google_recovery_invalid_config", { now: Number.NaN });
  });

  it("rejects invalid and private recipient keys", () => {
    expectFailure("google_recovery_invalid_public_key", {
      config: { ...baseConfig, recipientPublicKey: "not a PEM key" },
    });
    expectFailure("google_recovery_invalid_public_key", {
      config: { ...baseConfig, recipientPublicKey: keyPair.privateKey },
    });
    expectFailure("google_recovery_invalid_public_key", {
      config: { ...baseConfig, recipientPublicKey: wrongKeyType.publicKey },
    });
    expectFailure("google_recovery_invalid_public_key", {
      config: { ...baseConfig, recipientPublicKey: undersizedKey.publicKey },
    });
  });

  it("rejects fingerprints with invalid format", () => {
    expectFailure("google_recovery_invalid_config", {
      config: { ...baseConfig, expectedSecretSha256: "short" },
    });
    expectFailure("google_recovery_invalid_config", {
      config: { ...baseConfig, expiresAt: "November 9, 2026" },
    });
  });
});
