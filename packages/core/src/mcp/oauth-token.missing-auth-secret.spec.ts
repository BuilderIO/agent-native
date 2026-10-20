import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyMcpOAuthAccessToken } from "./oauth-token.js";

// The www docs deploy runs without BETTER_AUTH_SECRET. Every bearer-carrying
// `GET /mcp` probe used to read the secret, throw MissingAuthSecretError, and
// surface as a captured 500.
describe("MCP bearer verification on a deploy without an auth secret", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of [
      "BETTER_AUTH_SECRET",
      "A2A_SECRET",
      "AGENT_NATIVE_WORKSPACE",
      "VITE_AGENT_NATIVE_WORKSPACE",
      "AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT",
    ]) {
      delete process.env[key];
    }
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("rejects the token as unverifiable instead of throwing the config error", async () => {
    await expect(
      verifyMcpOAuthAccessToken(
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm9iZSJ9.c2lnbmF0dXJl",
        "https://www.agent-native.com/mcp",
      ),
    ).resolves.toBeNull();
  });
});
