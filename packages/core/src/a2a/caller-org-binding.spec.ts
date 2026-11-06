import { beforeEach, describe, expect, it, vi } from "vitest";

import { CROSS_APP_ORG_FEDERATION_FLAG } from "../org/feature-flags.js";
import {
  callerOrgBindingClaims,
  resolveCallerOrgBinding,
} from "./caller-org-binding.js";

const getOrgFederatedIdentityMock = vi.hoisted(() => vi.fn());
const evaluateFeatureFlagStrictMock = vi.hoisted(() => vi.fn());

vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  getOrgFederatedIdentity: getOrgFederatedIdentityMock,
}));

vi.mock("../feature-flags/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../feature-flags/store.js")>()),
  evaluateFeatureFlagStrict: evaluateFeatureFlagStrictMock,
}));

describe("resolveCallerOrgBinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrgFederatedIdentityMock.mockResolvedValue(null);
    evaluateFeatureFlagStrictMock.mockResolvedValue(false);
  });

  it("uses the org domain without reading the federated identity", async () => {
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);

    await expect(
      resolveCallerOrgBinding({
        orgId: "org-qa",
        orgDomain: "builder.io",
        userEmail: "alice@example.test",
      }),
    ).resolves.toEqual({ kind: "domain", orgDomain: "builder.io" });
    expect(getOrgFederatedIdentityMock).not.toHaveBeenCalled();
    expect(evaluateFeatureFlagStrictMock).not.toHaveBeenCalled();
  });

  it("treats a blank org domain as absent and falls through to the identity", async () => {
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);

    await expect(
      resolveCallerOrgBinding({ orgId: "org-qa", orgDomain: "   " }),
    ).resolves.toEqual({
      kind: "federated",
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    expect(getOrgFederatedIdentityMock).toHaveBeenCalledWith("org-qa");
  });

  it("is unlinked when the organization has no federated identity", async () => {
    await expect(
      resolveCallerOrgBinding({ orgId: "org-qa", orgDomain: null }),
    ).resolves.toEqual({ kind: "unlinked" });
    expect(evaluateFeatureFlagStrictMock).not.toHaveBeenCalled();
  });

  it("is federated with the same authority and id when the flag is on", async () => {
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);

    await expect(
      resolveCallerOrgBinding({ orgId: "org-qa", orgDomain: null }),
    ).resolves.toEqual({
      kind: "federated",
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
  });

  it("is unlinked when the organization has an identity but the flag is off", async () => {
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(false);

    await expect(
      resolveCallerOrgBinding({ orgId: "org-qa", orgDomain: null }),
    ).resolves.toEqual({ kind: "unlinked" });
  });

  it("rejects when the federated identity lookup throws", async () => {
    getOrgFederatedIdentityMock.mockRejectedValue(
      new Error("Organization has an invalid identity mapping."),
    );

    await expect(
      resolveCallerOrgBinding({ orgId: "org-qa", orgDomain: null }),
    ).rejects.toThrow("Organization has an invalid identity mapping.");
    expect(evaluateFeatureFlagStrictMock).not.toHaveBeenCalled();
  });

  it("rejects when the feature flag evaluation throws", async () => {
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    evaluateFeatureFlagStrictMock.mockRejectedValue(
      new Error("flag store unavailable"),
    );

    await expect(
      resolveCallerOrgBinding({ orgId: "org-qa", orgDomain: null }),
    ).rejects.toThrow("flag store unavailable");
  });

  it("evaluates the flag for the org and, when given, the user", async () => {
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });

    await resolveCallerOrgBinding({
      orgId: "org-qa",
      orgDomain: null,
      userEmail: "alice@example.test",
    });

    expect(evaluateFeatureFlagStrictMock).toHaveBeenCalledWith(
      CROSS_APP_ORG_FEDERATION_FLAG.key,
      {
        userEmail: "alice@example.test",
        userKey: "alice@example.test",
        orgId: "org-qa",
      },
    );
  });
});

describe("callerOrgBindingClaims", () => {
  it("returns the identity claims for a federated binding", () => {
    expect(
      callerOrgBindingClaims({
        kind: "federated",
        authority: "identity-hub.test",
        id: "org-hub-1",
      }),
    ).toEqual({
      org_identity_authority: "identity-hub.test",
      org_identity_id: "org-hub-1",
    });
  });

  it("returns no claims for a domain, unlinked, or missing binding", () => {
    expect(
      callerOrgBindingClaims({ kind: "domain", orgDomain: "builder.io" }),
    ).toBeUndefined();
    expect(callerOrgBindingClaims({ kind: "unlinked" })).toBeUndefined();
    expect(callerOrgBindingClaims(undefined)).toBeUndefined();
  });
});
