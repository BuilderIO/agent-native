import { afterEach, describe, expect, it } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { isTestIdentity, testIdentitySql } from "./test-identity.js";

const ENV_KEY = "AGENT_NATIVE_TEST_IDENTITY_EMAILS";

describe("isTestIdentity", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
    resetAppConfigForTests();
  });

  it("applies the built-in rules with nothing configured", () => {
    expect(isTestIdentity("e2e+autoz@builder.io")).toBe(true);
    expect(isTestIdentity("qa-owner@example.test")).toBe(true);
    expect(isTestIdentity("qa-lead@builder.io")).toBe(false);
  });

  it("adds deployment-declared identities from the env alias", () => {
    process.env[ENV_KEY] = " QA-Lead@builder.io , @qa.acme.co ";
    expect(isTestIdentity("qa-lead@builder.io")).toBe(true);
    expect(isTestIdentity("anyone@qa.acme.co")).toBe(true);
    expect(isTestIdentity("steve@builder.io")).toBe(false);
    expect(testIdentitySql("email")).toContain("'qa-lead@builder.io'");
  });

  it("fails loudly on an entry that is neither an address nor @domain", () => {
    process.env[ENV_KEY] = "builder.io";
    expect(() => isTestIdentity("steve@builder.io")).toThrow();
  });
});
