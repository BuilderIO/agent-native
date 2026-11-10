import { z } from "zod";

export const googleOAuthRecoveryConfig = z.object({
  recipientPublicKey: z.string().trim().optional().meta({
    env: "GOOGLE_OAUTH_RECOVERY_PUBLIC_KEY",
    doc: "Temporary SPKI RSA public key used only for operator-approved Google OAuth credential recovery.",
  }),
  expectedClientId: z.string().trim().optional().meta({
    env: "GOOGLE_OAUTH_RECOVERY_CLIENT_ID",
    doc: "Google OAuth client ID that must match the active sign-in credentials for temporary recovery.",
  }),
  expectedSecretSha256: z.string().trim().optional().meta({
    env: "GOOGLE_OAUTH_RECOVERY_SECRET_SHA256",
    doc: "SHA-256 fingerprint that must match the active Google OAuth client secret for temporary recovery.",
  }),
  operatorEmail: z.string().trim().optional().meta({
    env: "GOOGLE_OAUTH_RECOVERY_OPERATOR_EMAIL",
    doc: "Email address allowed to request the temporary Google OAuth credential recovery envelope.",
  }),
  notBefore: z.string().trim().optional().meta({
    env: "GOOGLE_OAUTH_RECOVERY_NOT_BEFORE",
    doc: "ISO timestamp when temporary Google OAuth credential recovery becomes available.",
  }),
  expiresAt: z.string().trim().optional().meta({
    env: "GOOGLE_OAUTH_RECOVERY_EXPIRES_AT",
    doc: "UTC ISO issuance cutoff for temporary Google OAuth credential recovery; already-issued ciphertext remains decryptable afterward.",
  }),
});

export type GoogleOAuthRecoveryConfig = z.infer<
  typeof googleOAuthRecoveryConfig
>;
