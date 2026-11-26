import { afterEach, describe, expect, it, vi } from "vitest";

import { getAppConfig, resetAppConfigForTests } from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

describe("provider pause operator config", () => {
  it("declares nobody when the deployment sets nothing", () => {
    vi.stubEnv("PROVIDER_PAUSE_OPERATOR_EMAILS", undefined);
    vi.stubEnv("PROVIDER_PAUSE_OPERATOR_ORG", undefined);
    resetAppConfigForTests();
    expect(getAppConfig().providerPause).toEqual({ operatorEmails: [] });
  });

  it("reads the comma-separated allowlist and the operator organization", () => {
    vi.stubEnv(
      "PROVIDER_PAUSE_OPERATOR_EMAILS",
      " Operator@Example.Test, ,second@example.test ",
    );
    vi.stubEnv("PROVIDER_PAUSE_OPERATOR_ORG", "org-deployment");
    resetAppConfigForTests();
    expect(getAppConfig().providerPause).toEqual({
      operatorEmails: ["operator@example.test", "second@example.test"],
      operatorOrgId: "org-deployment",
    });
  });
});
