import { describe, expect, it } from "vitest";

import { parseTestEnvKeys } from "./index.js";

describe("guards entry point", () => {
  it("parses declared test env keys", () => {
    expect(parseTestEnvKeys(undefined)).toEqual([]);
    expect(parseTestEnvKeys(["APP_MODE", "FEATURE_X"])).toEqual([
      "APP_MODE",
      "FEATURE_X",
    ]);
  });

  it("rejects malformed and credential-like test env keys", () => {
    expect(() => parseTestEnvKeys("APP_MODE")).toThrow(/must be an array/);
    expect(() => parseTestEnvKeys(["app_mode"])).toThrow(/not an env key/);
    expect(() => parseTestEnvKeys(["STRIPE_SECRET_KEY"])).toThrow(
      /looks like a credential/,
    );
    for (const key of [
      "GITHUB_PAT",
      "TEST_DATABASE_URL",
      "REDIS_URL",
      "SENTRY_DSN",
      "ADMIN_PASSWD",
      "SESSION_COOKIE",
      "BASIC_AUTH",
      "TLS_PRIVATE_PEM",
    ]) {
      expect(() => parseTestEnvKeys([key])).toThrow(/looks like a credential/);
    }
    expect(parseTestEnvKeys(["TEST_BASE_URL", "PATH_PREFIX"])).toEqual([
      "TEST_BASE_URL",
      "PATH_PREFIX",
    ]);
  });
});
