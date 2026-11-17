import { describe, expect, it } from "vitest";

import {
  automationUsageOrgId,
  getEngineCredentialOrgId,
  tagEngineCredentialOrg,
} from "./credential-owner.js";
import type { AgentEngine } from "./types.js";

function engineFor(orgId?: string): AgentEngine {
  const engine = {} as AgentEngine;
  if (orgId !== undefined) tagEngineCredentialOrg(engine, orgId);
  return engine;
}

describe("getEngineCredentialOrgId", () => {
  it("reads the org an engine's key came from", () => {
    expect(getEngineCredentialOrgId(engineFor("org-a"))).toBe("org-a");
  });

  it("reads no org for an untagged engine or a value that is not one", () => {
    expect(getEngineCredentialOrgId(engineFor())).toBeUndefined();
    expect(getEngineCredentialOrgId(undefined)).toBeUndefined();
    expect(getEngineCredentialOrgId(null)).toBeUndefined();
    expect(getEngineCredentialOrgId("org-a")).toBeUndefined();
  });
});

describe("automationUsageOrgId", () => {
  it("keeps an organization run's usage with that org, whoever's key paid", () => {
    expect(
      automationUsageOrgId(engineFor("vault-org"), "acme", undefined),
    ).toBe("acme");
    expect(automationUsageOrgId(engineFor(), "acme", "other-org")).toBe("acme");
  });

  it("gives a personal run's usage to its creator's org when that org's key paid", () => {
    expect(automationUsageOrgId(engineFor("acme"), undefined, "acme")).toBe(
      "acme",
    );
  });

  it("gives a personal run's usage no org when any other key paid", () => {
    expect(
      automationUsageOrgId(engineFor("vault-org"), undefined, "acme"),
    ).toBeUndefined();
    expect(
      automationUsageOrgId(engineFor(), undefined, "acme"),
    ).toBeUndefined();
    expect(
      automationUsageOrgId(engineFor("acme"), undefined, undefined),
    ).toBeUndefined();
    expect(
      automationUsageOrgId(engineFor(), undefined, undefined),
    ).toBeUndefined();
  });
});
