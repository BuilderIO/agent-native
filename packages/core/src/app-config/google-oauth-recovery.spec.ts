import { describe, expect, it } from "vitest";

import {
  readAgentNativeConfigEnv,
  resolveAgentNativeConfig,
  type AgentNativeConfigContext,
} from "../config.js";
import { collectEnvAliases, readEnvConfigLayer } from "./env-layer.js";
import { googleOAuthRecoveryConfig } from "./google-oauth-recovery.js";
import { appConfigSchema } from "./schema.js";

const recoveryEnv = {
  GOOGLE_OAUTH_RECOVERY_PUBLIC_KEY: "fake-recipient-public-key",
  GOOGLE_OAUTH_RECOVERY_CLIENT_ID: "fake-client-id",
  GOOGLE_OAUTH_RECOVERY_SECRET_SHA256: "fake-fingerprint",
  GOOGLE_OAUTH_RECOVERY_OPERATOR_EMAIL: "operator@example.test",
  GOOGLE_OAUTH_RECOVERY_NOT_BEFORE: "2026-11-09T20:00:00.000Z",
  GOOGLE_OAUTH_RECOVERY_EXPIRES_AT: "2026-11-09T20:10:00.000Z",
};

const clientContext: AgentNativeConfigContext = {
  command: "serve",
  mode: "development",
  isDev: true,
  isBuild: false,
};

describe("Google OAuth recovery server configuration", () => {
  it("defaults off when no deployment values are set", () => {
    expect(googleOAuthRecoveryConfig.parse({})).toEqual({});
    expect(appConfigSchema.parse({}).googleOAuthRecovery).toEqual({});
  });

  it("maps each recovery deployment variable into server config only", () => {
    const aliases = collectEnvAliases(appConfigSchema);
    for (const [field, env] of Object.entries({
      recipientPublicKey: "GOOGLE_OAUTH_RECOVERY_PUBLIC_KEY",
      expectedClientId: "GOOGLE_OAUTH_RECOVERY_CLIENT_ID",
      expectedSecretSha256: "GOOGLE_OAUTH_RECOVERY_SECRET_SHA256",
      operatorEmail: "GOOGLE_OAUTH_RECOVERY_OPERATOR_EMAIL",
      notBefore: "GOOGLE_OAUTH_RECOVERY_NOT_BEFORE",
      expiresAt: "GOOGLE_OAUTH_RECOVERY_EXPIRES_AT",
    })) {
      expect(aliases).toContainEqual({
        path: ["googleOAuthRecovery", field],
        env: [env],
        type: "string",
      });
    }

    const serverLayer = readEnvConfigLayer(appConfigSchema, recoveryEnv);
    expect(appConfigSchema.parse(serverLayer).googleOAuthRecovery).toEqual({
      recipientPublicKey: recoveryEnv.GOOGLE_OAUTH_RECOVERY_PUBLIC_KEY,
      expectedClientId: recoveryEnv.GOOGLE_OAUTH_RECOVERY_CLIENT_ID,
      expectedSecretSha256: recoveryEnv.GOOGLE_OAUTH_RECOVERY_SECRET_SHA256,
      operatorEmail: recoveryEnv.GOOGLE_OAUTH_RECOVERY_OPERATOR_EMAIL,
      notBefore: recoveryEnv.GOOGLE_OAUTH_RECOVERY_NOT_BEFORE,
      expiresAt: recoveryEnv.GOOGLE_OAUTH_RECOVERY_EXPIRES_AT,
    });

    const browserLayer = readAgentNativeConfigEnv(recoveryEnv);
    expect(browserLayer).toEqual({});
    expect(
      Object.hasOwn(
        resolveAgentNativeConfig(browserLayer, clientContext),
        "googleOAuthRecovery",
      ),
    ).toBe(false);
  });
});
