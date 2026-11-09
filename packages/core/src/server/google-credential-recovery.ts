import {
  constants,
  createHash,
  createPublicKey,
  publicEncrypt,
  timingSafeEqual,
} from "node:crypto";

import type { GoogleOAuthRecoveryConfig } from "../app-config/google-oauth-recovery.js";
import type { GoogleOAuthCredentials } from "./google-oauth-credentials.js";

const MAX_RECOVERY_LEASE_MS = 30 * 60 * 1000;

export type GoogleCredentialRecoveryFailureCode =
  | "google_recovery_off"
  | "google_recovery_incomplete_config"
  | "google_recovery_invalid_config"
  | "google_recovery_wrong_operator"
  | "google_recovery_not_recorded"
  | "google_recovery_credentials_missing"
  | "google_recovery_client_mismatch"
  | "google_recovery_secret_mismatch"
  | "google_recovery_not_yet_valid"
  | "google_recovery_expired"
  | "google_recovery_lease_too_long"
  | "google_recovery_invalid_public_key"
  | "google_recovery_encryption_failed";

export class GoogleCredentialRecoveryError extends Error {
  constructor(readonly code: GoogleCredentialRecoveryFailureCode) {
    super(code);
    this.name = "GoogleCredentialRecoveryError";
  }
}

export interface GoogleCredentialRecoveryEnvelope {
  algorithm: "RSA-OAEP-SHA256";
  clientId: string;
  secretSha256: string;
  encryptedSecret: string;
  expiresAt: string;
}

function fail(code: GoogleCredentialRecoveryFailureCode): never {
  throw new GoogleCredentialRecoveryError(code);
}

function present(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireConfigValue(value: string | null): string {
  if (value === null) fail("google_recovery_incomplete_config");
  return value;
}

function safeFingerprintMatches(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
  return timingSafeEqual(
    Buffer.from(expected.toLowerCase(), "hex"),
    Buffer.from(actual, "hex"),
  );
}

function parseRecipientPublicKey(pem: string) {
  if (
    !/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+?\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(
      pem,
    )
  ) {
    fail("google_recovery_invalid_public_key");
  }

  try {
    const key = createPublicKey(pem);
    const modulusLength = key.asymmetricKeyDetails?.modulusLength;
    if (
      key.type !== "public" ||
      key.asymmetricKeyType !== "rsa" ||
      typeof modulusLength !== "number" ||
      modulusLength < 3072
    ) {
      fail("google_recovery_invalid_public_key");
    }
    return key;
  } catch {
    fail("google_recovery_invalid_public_key");
  }
}

export function recoverGoogleCredential(options: {
  credentials: GoogleOAuthCredentials | null;
  recorded: boolean;
  userEmail: string;
  config: GoogleOAuthRecoveryConfig;
  now?: number;
}): GoogleCredentialRecoveryEnvelope {
  const config = options.config;
  const recipientPublicKey = present(config.recipientPublicKey);
  const expectedClientId = present(config.expectedClientId);
  const expectedSecretSha256 = present(config.expectedSecretSha256);
  const operatorEmail = present(config.operatorEmail);
  const notBefore = present(config.notBefore);
  const expiresAt = present(config.expiresAt);
  const values = [
    recipientPublicKey,
    expectedClientId,
    expectedSecretSha256,
    operatorEmail,
    notBefore,
    expiresAt,
  ];

  if (values.every((value) => value === null)) {
    fail("google_recovery_off");
  }
  if (values.some((value) => value === null)) {
    fail("google_recovery_incomplete_config");
  }

  const activeConfig = {
    recipientPublicKey: requireConfigValue(recipientPublicKey),
    expectedClientId: requireConfigValue(expectedClientId),
    expectedSecretSha256: requireConfigValue(expectedSecretSha256),
    operatorEmail: requireConfigValue(operatorEmail),
    notBefore: requireConfigValue(notBefore),
    expiresAt: requireConfigValue(expiresAt),
  };
  const start = parseTimestamp(activeConfig.notBefore);
  const end = parseTimestamp(activeConfig.expiresAt);
  if (
    start === null ||
    end === null ||
    !/^[a-f0-9]{64}$/i.test(activeConfig.expectedSecretSha256)
  ) {
    fail("google_recovery_invalid_config");
  }
  if (end <= start) fail("google_recovery_invalid_config");
  if (end - start > MAX_RECOVERY_LEASE_MS) {
    fail("google_recovery_lease_too_long");
  }

  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) fail("google_recovery_invalid_config");
  if (now < start) fail("google_recovery_not_yet_valid");
  if (now >= end) fail("google_recovery_expired");

  if (
    options.userEmail.trim().toLowerCase() !==
    activeConfig.operatorEmail.toLowerCase()
  ) {
    fail("google_recovery_wrong_operator");
  }
  if (!options.recorded) fail("google_recovery_not_recorded");
  const credentials = options.credentials;
  if (!credentials?.clientId || !credentials.clientSecret) {
    fail("google_recovery_credentials_missing");
  }
  if (credentials.clientId !== activeConfig.expectedClientId) {
    fail("google_recovery_client_mismatch");
  }

  const secretSha256 = createHash("sha256")
    .update(credentials.clientSecret)
    .digest("hex");
  if (
    !safeFingerprintMatches(activeConfig.expectedSecretSha256, secretSha256)
  ) {
    fail("google_recovery_secret_mismatch");
  }

  const publicKey = parseRecipientPublicKey(activeConfig.recipientPublicKey);
  try {
    const encryptedSecret = publicEncrypt(
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(credentials.clientSecret, "utf8"),
    ).toString("base64url");

    return {
      algorithm: "RSA-OAEP-SHA256",
      clientId: credentials.clientId,
      secretSha256,
      encryptedSecret,
      expiresAt: new Date(end).toISOString(),
    };
  } catch {
    fail("google_recovery_encryption_failed");
  }
}
