import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MintedTokenRow } from "../mcp/connect-store.js";
import type { ServicePrincipalPolicy } from "../org/service-principal-policy.js";
import {
  agentDisplayName,
  isShareableAgent,
  listShareableAgents,
} from "./agent-principals.js";
import { isOrgPrincipal } from "./grant.js";

const state = vi.hoisted(() => ({
  tokens: [] as MintedTokenRow[],
  policies: [] as ServicePrincipalPolicy[],
  members: new Set<string>(),
  invited: new Set<string>(),
}));

vi.mock("../mcp/connect-store.js", () => ({
  listOrgServiceTokens: async (orgId: string) =>
    state.tokens.filter((token) => token.orgId === orgId),
  serviceIdentityEmail: (name: string, orgId: string) =>
    `svc-${name}@service.${orgId}`,
}));

vi.mock("../org/service-principal-policy.js", () => ({
  listServicePrincipalPolicies: async (orgId: string) =>
    state.policies.filter((policy) => policy.orgId === orgId),
}));

vi.mock("../org/membership.js", () => ({
  isOrgMember: async (orgId: string, email: string) =>
    state.members.has(`${orgId}:${email}`),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async ({ args }: { args: string[] }) => ({
      rows: state.invited.has(`${args[0]}:${args[1]}`)
        ? [{ "?column?": 1 }]
        : [],
    }),
  }),
  getScopedDbExec: () => undefined,
}));

const orgId = "Org_Mixed";

function token(
  serviceName: string | null,
  overrides: Partial<MintedTokenRow> = {},
): MintedTokenRow {
  return {
    id: `tok-${serviceName}`,
    jti: `jti-${serviceName}`,
    ownerEmail: `svc-${serviceName}@service.${orgId}`,
    orgId,
    label: null,
    createdAt: 0,
    lastUsedAt: null,
    revokedAt: null,
    kind: "service",
    serviceName,
    createdBy: "owner@example.com",
    ...overrides,
  };
}

function policy(
  serviceName: string,
  lifecycle: ServicePrincipalPolicy["lifecycle"],
): ServicePrincipalPolicy {
  return {
    orgId,
    serviceName,
    ownerEmail: "owner@example.com",
    team: null,
    riskTier: "low",
    purpose: null,
    lifecycle,
    allowedActions: null,
    lifecycleReason: null,
    lifecycleChangedBy: null,
    lifecycleChangedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

beforeEach(() => {
  state.tokens = [
    token("zeta"),
    token("alpha"),
    token("alpha", { id: "tok-alpha-2" }),
    token("revoked", { revokedAt: 5 }),
    token("retired"),
    token("paused"),
    token(null),
    token("elsewhere", { orgId: "org-other" }),
  ];
  state.policies = [
    policy("retired", "retired"),
    policy("paused", "suspended"),
  ];
  state.members = new Set([`${orgId}:member@example.com`]);
  state.invited = new Set([`${orgId}:invitee@example.com`]);
});

describe("listShareableAgents", () => {
  it("lists each live, unretired principal once, sorted by name", async () => {
    await expect(listShareableAgents(orgId)).resolves.toEqual([
      { email: `svc-alpha@service.${orgId}`, name: "alpha" },
      { email: `svc-paused@service.${orgId}`, name: "paused" },
      { email: `svc-zeta@service.${orgId}`, name: "zeta" },
    ]);
  });
});

describe("isShareableAgent", () => {
  it("accepts a live agent whatever the stored case", async () => {
    await expect(
      isShareableAgent(orgId, `svc-alpha@service.${orgId}`.toLowerCase()),
    ).resolves.toBe(true);
  });

  it.each([
    ["a revoked token", `svc-revoked@service.${orgId}`],
    ["a retired principal", `svc-retired@service.${orgId}`],
    ["another org's agent", "svc-elsewhere@service.org-other"],
    ["an unknown name", `svc-typo@service.${orgId}`],
    ["a person", "member@example.com"],
  ])("refuses %s", async (_case, email) => {
    await expect(isShareableAgent(orgId, email)).resolves.toBe(false);
  });
});

describe("agentDisplayName", () => {
  it("names a service principal and returns null for a person", () => {
    expect(agentDisplayName(`svc-alpha@service.${orgId}`)).toBe("alpha");
    expect(agentDisplayName("member@example.com")).toBeNull();
  });
});

describe("isOrgPrincipal", () => {
  it("admits members, pending invitees, and live agents of the org", async () => {
    await expect(isOrgPrincipal(orgId, "Member@example.com")).resolves.toBe(
      true,
    );
    await expect(isOrgPrincipal(orgId, "invitee@example.com")).resolves.toBe(
      true,
    );
    await expect(
      isOrgPrincipal(orgId, `svc-zeta@service.${orgId}`),
    ).resolves.toBe(true);
  });

  it("refuses outsiders and agents that cannot act", async () => {
    await expect(isOrgPrincipal(orgId, "outsider@example.com")).resolves.toBe(
      false,
    );
    await expect(
      isOrgPrincipal(orgId, `svc-retired@service.${orgId}`),
    ).resolves.toBe(false);
  });
});
