import type { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifyA2AOrganizationIdentity } from "./organization-identity.js";

const resolveFederatedOrganizationForA2AMock = vi.hoisted(() => vi.fn());
const resolveA2AOrganizationMetadataByDomainMock = vi.hoisted(() => vi.fn());
const resolveA2AOrganizationMetadataByIdMock = vi.hoisted(() => vi.fn());

vi.mock("../org/federation.js", () => ({
  resolveFederatedOrganizationForA2A: resolveFederatedOrganizationForA2AMock,
}));
vi.mock("../org/context.js", () => ({
  resolveA2AOrganizationMetadataByDomain:
    resolveA2AOrganizationMetadataByDomainMock,
  resolveA2AOrganizationMetadataById: resolveA2AOrganizationMetadataByIdMock,
}));

const authority = "https://dispatch.agent-native.com";
const hubOrgId = "dispatch-org-1";
const memberEmail = "member@example.test";
const federatedPayload = {
  org_identity_authority: authority,
  org_identity_id: hubOrgId,
  sub: memberEmail,
};
const resolvedOrg = { orgId: "local-org-1", orgDomain: "example.test" };

describe("verifyA2AOrganizationIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a federated claim pair for the verified caller email", async () => {
    resolveFederatedOrganizationForA2AMock.mockResolvedValue(resolvedOrg);
    const event = {} as H3Event;

    await expect(
      verifyA2AOrganizationIdentity(
        { ...federatedPayload, sub: "  member@example.test  " },
        { event },
      ),
    ).resolves.toEqual(resolvedOrg);
    expect(resolveFederatedOrganizationForA2AMock).toHaveBeenCalledTimes(1);
    expect(resolveFederatedOrganizationForA2AMock).toHaveBeenCalledWith(event, {
      authority,
      id: hubOrgId,
      email: memberEmail,
    });
  });

  it("rejects a federated claim that arrives without its pair", async () => {
    await expect(
      verifyA2AOrganizationIdentity({
        org_identity_id: hubOrgId,
        sub: memberEmail,
      }),
    ).resolves.toBeNull();
    await expect(
      verifyA2AOrganizationIdentity({
        org_identity_authority: authority,
        sub: memberEmail,
      }),
    ).resolves.toBeNull();
    expect(resolveFederatedOrganizationForA2AMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...federatedPayload, org_identity_authority: "   " },
    { ...federatedPayload, org_identity_id: "" },
    { ...federatedPayload, org_identity_authority: 42 },
    { ...federatedPayload, org_identity_id: null },
  ])("rejects blank or non-string federated claims %#", async (payload) => {
    await expect(verifyA2AOrganizationIdentity(payload)).resolves.toBeNull();
    expect(resolveFederatedOrganizationForA2AMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...federatedPayload, org_id: "local-org-1" },
    { ...federatedPayload, org_domain: "example.test" },
  ])(
    "rejects federated claims combined with a local organization claim %#",
    async (payload) => {
      await expect(verifyA2AOrganizationIdentity(payload)).resolves.toBeNull();
      expect(resolveFederatedOrganizationForA2AMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { org_identity_authority: authority, org_identity_id: hubOrgId },
    { ...federatedPayload, sub: "   " },
    { ...federatedPayload, sub: undefined },
    { ...federatedPayload, sub: 123 },
  ])(
    "rejects federated claims without a usable caller email %#",
    async (payload) => {
      await expect(verifyA2AOrganizationIdentity(payload)).resolves.toBeNull();
      expect(resolveFederatedOrganizationForA2AMock).not.toHaveBeenCalled();
    },
  );

  it("returns null when the federated resolver finds no binding", async () => {
    resolveFederatedOrganizationForA2AMock.mockResolvedValue(null);

    await expect(
      verifyA2AOrganizationIdentity(federatedPayload),
    ).resolves.toBeNull();
    expect(resolveFederatedOrganizationForA2AMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a federated resolver failure instead of treating it as unbound", async () => {
    const failure = new Error(
      "Cross-app organization federation rollout is unavailable.",
    );
    resolveFederatedOrganizationForA2AMock.mockRejectedValue(failure);

    await expect(verifyA2AOrganizationIdentity(federatedPayload)).rejects.toBe(
      failure,
    );
  });

  it("returns undefined for a payload with no organization or federation claims", async () => {
    await expect(
      verifyA2AOrganizationIdentity({ sub: memberEmail, scope: "agent" }),
    ).resolves.toBeUndefined();
    expect(resolveFederatedOrganizationForA2AMock).not.toHaveBeenCalled();
    expect(resolveA2AOrganizationMetadataByDomainMock).not.toHaveBeenCalled();
    expect(resolveA2AOrganizationMetadataByIdMock).not.toHaveBeenCalled();
  });

  it("resolves an org_domain claim through the domain metadata lookup", async () => {
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue(resolvedOrg);

    await expect(
      verifyA2AOrganizationIdentity({ org_domain: " Example.TEST " }),
    ).resolves.toEqual(resolvedOrg);
    expect(resolveA2AOrganizationMetadataByDomainMock).toHaveBeenCalledWith(
      "example.test",
    );
    expect(resolveA2AOrganizationMetadataByIdMock).not.toHaveBeenCalled();
    expect(resolveFederatedOrganizationForA2AMock).not.toHaveBeenCalled();
  });

  it("resolves an org_id claim through the id metadata lookup", async () => {
    resolveA2AOrganizationMetadataByIdMock.mockResolvedValue(resolvedOrg);

    await expect(
      verifyA2AOrganizationIdentity({ org_id: "local-org-1" }),
    ).resolves.toEqual(resolvedOrg);
    expect(resolveA2AOrganizationMetadataByIdMock).toHaveBeenCalledWith(
      "local-org-1",
    );
    expect(resolveA2AOrganizationMetadataByDomainMock).not.toHaveBeenCalled();
    expect(resolveFederatedOrganizationForA2AMock).not.toHaveBeenCalled();
  });
});
