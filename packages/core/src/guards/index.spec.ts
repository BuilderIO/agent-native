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
  });
});
