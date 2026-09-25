import { beforeEach, describe, expect, it, vi } from "vitest";

const isRestrictedMock = vi.hoisted(() => vi.fn(async () => false));

vi.mock("./personal-provider-key-policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./personal-provider-key-policy.js")
  >()),
  isPersonalProviderKeyUseRestricted: isRestrictedMock,
}));

beforeEach(() => {
  isRestrictedMock.mockReset();
  isRestrictedMock.mockResolvedValue(false);
});

import {
  BUILDER_STATUS_LEGACY_CREDENTIAL_KEYS,
  BUILDER_STATUS_ROUTE_SUFFIXES,
  builderEffectiveConnectionFor,
  getBuilderConnectErrorDisposition,
  getBuilderConnectErrorKey,
  mountBuilderStatusRouteAliases,
  resolveBuilderConnectionsStatus,
  resolveOAuthCustodyBuilderKeyStatus,
} from "./core-routes-plugin.js";

describe("Builder status route aliases", () => {
  it("shares Content's intentional legacy private-key aliases", () => {
    expect(BUILDER_STATUS_LEGACY_CREDENTIAL_KEYS).toEqual([
      "BUILDER_PRIVATE_KEY",
      "BUILDER_CMS_PRIVATE_KEY",
    ]);
  });

  it("retains the legacy path and mounts the neutral connection-status alias", () => {
    expect(BUILDER_STATUS_ROUTE_SUFFIXES).toEqual([
      "/builder/status",
      "/connection-status/builder",
    ]);
  });

  it("mounts both aliases with the exact same handler", () => {
    const handler = () => ({ configured: false });
    const mounted: Array<{ path: string; handler: typeof handler }> = [];

    mountBuilderStatusRouteAliases(
      (path, mountedHandler) => {
        mounted.push({ path, handler: mountedHandler });
      },
      "/_agent-native",
      handler,
    );

    expect(mounted.map(({ path }) => path)).toEqual([
      "/_agent-native/builder/status",
      "/_agent-native/connection-status/builder",
    ]);
    expect(mounted[0]?.handler).toBe(handler);
    expect(mounted[1]?.handler).toBe(handler);
  });
});

describe("Builder connect error correlation", () => {
  it("surfaces only a matching attempt-bound error", () => {
    expect(
      getBuilderConnectErrorDisposition(
        { message: "denied", attemptId: "attempt-1" },
        "attempt-1",
      ),
    ).toBe("correlated");
    expect(
      getBuilderConnectErrorDisposition(
        { message: "denied", attemptId: "attempt-1" },
        "attempt-2",
      ),
    ).toBeNull();
  });

  it("keeps one-shot consumption for legacy errors without an attempt", () => {
    expect(getBuilderConnectErrorDisposition({ message: "denied" }, null)).toBe(
      "legacy",
    );
  });

  it("keeps concurrent attempt errors isolated when writes complete out of order", () => {
    const rows = new Map<string, { message: string; attemptId: string }>();
    const write = (attemptId: string, message: string) => {
      rows.set(getBuilderConnectErrorKey("user@example.com", attemptId), {
        message,
        attemptId,
      });
    };

    write("attempt-2", "second");
    write("attempt-1", "first");

    expect(
      rows.get(getBuilderConnectErrorKey("user@example.com", "attempt-1")),
    ).toEqual({
      message: "first",
      attemptId: "attempt-1",
    });
    expect(
      rows.get(getBuilderConnectErrorKey("user@example.com", "attempt-2")),
    ).toEqual({
      message: "second",
      attemptId: "attempt-2",
    });
    expect(getBuilderConnectErrorKey("user@example.com")).toBe(
      "builder-connect-error:user@example.com",
    );
  });
});

describe("resolveOAuthCustodyBuilderKeyStatus", () => {
  it("reports confirmed-absent keys distinctly from a failed key lookup", async () => {
    const confirmedAbsent = await resolveOAuthCustodyBuilderKeyStatus({
      resolveCredentialsDetailed: async () => ({
        privateKey: null,
        publicKey: null,
        orgName: null,
        lookupFailed: false,
      }),
    });
    expect(confirmedAbsent.privateKeyConfigured).toBe(false);
    expect(confirmedAbsent.publicKeyConfigured).toBe(false);
    expect(confirmedAbsent).toMatchObject({ keyLookupFailed: false });

    // The store can also fail "softly" — resolving with lookupFailed: true
    // rather than throwing (e.g. an org-membership lookup error swallowed
    // inside resolveScopedBuilderCredentials). No `try/catch` around the
    // call would ever see this one; it has to come through on the field.
    const softFailure = await resolveOAuthCustodyBuilderKeyStatus({
      resolveCredentialsDetailed: async () => ({
        privateKey: null,
        publicKey: null,
        orgName: null,
        lookupFailed: true,
      }),
    });
    expect(softFailure).toMatchObject({ keyLookupFailed: true });

    const thrown = await resolveOAuthCustodyBuilderKeyStatus({
      resolveCredentialsDetailed: async () => {
        throw new Error("credential store unavailable");
      },
    });
    // A transient failure to read the key pair must not read the same as
    // "the user never configured Builder keys" — the two states need a
    // caller-visible flag, not just an identical pair of `false`s.
    expect(thrown.privateKeyConfigured).toBe(false);
    expect(thrown.publicKeyConfigured).toBe(false);
    expect(thrown).toMatchObject({ keyLookupFailed: true });
  });
});

describe("resolveBuilderConnectionsStatus", () => {
  const bothGrants = {
    org: { connectedAt: 1_000, needsReconnect: false },
    personal: { connectedAt: 2_000, needsReconnect: false, restricted: false },
  };
  const noKeys = async () => ({});

  it("reports both grants and lets a member connect only a personal one", async () => {
    await expect(
      resolveBuilderConnectionsStatus(
        { ownerEmail: "member@example.com", orgId: "org-123", role: "member" },
        { getGrants: async () => bothGrants, getKeyConnections: noKeys },
      ),
    ).resolves.toEqual({
      grants: {
        org: { ...bothGrants.org, kind: "oauth" },
        personal: { ...bothGrants.personal, kind: "oauth" },
      },
      canConnect: { org: false, personal: true },
    });
  });

  it("reports key-pair connections at the scope that stores them", async () => {
    await expect(
      resolveBuilderConnectionsStatus(
        { ownerEmail: "owner@example.com", orgId: "org-123", role: "owner" },
        {
          getGrants: async () => ({}),
          getKeyConnections: async () => ({
            org: { connectedAt: 3_000, needsReconnect: false },
            personal: { connectedAt: 4_000, needsReconnect: true },
          }),
        },
      ),
    ).resolves.toEqual({
      grants: {
        org: { connectedAt: 3_000, needsReconnect: false, kind: "keys" },
        personal: {
          connectedAt: 4_000,
          needsReconnect: true,
          kind: "keys",
          restricted: false,
        },
      },
      canConnect: { org: true, personal: false },
    });
  });

  it("reports the OAuth grant over a key pair stored at the same scope", async () => {
    await expect(
      resolveBuilderConnectionsStatus(
        { ownerEmail: "admin@example.com", orgId: "org-123", role: "admin" },
        {
          getGrants: async () => ({ org: bothGrants.org }),
          getKeyConnections: async () => ({
            org: { connectedAt: 9_000, needsReconnect: false },
          }),
        },
      ),
    ).resolves.toMatchObject({
      grants: { org: { connectedAt: 1_000, kind: "oauth" } },
    });
  });

  it("marks a member's personal connection restricted and stops new ones", async () => {
    isRestrictedMock.mockResolvedValue(true);
    await expect(
      resolveBuilderConnectionsStatus(
        { ownerEmail: "member@example.com", orgId: "org-123", role: "member" },
        {
          getGrants: async () => ({}),
          getKeyConnections: async () => ({
            personal: { connectedAt: 4_000, needsReconnect: false },
          }),
        },
      ),
    ).resolves.toEqual({
      grants: {
        personal: {
          connectedAt: 4_000,
          needsReconnect: false,
          kind: "keys",
          restricted: true,
        },
      },
      canConnect: { org: false, personal: false },
    });
    expect(isRestrictedMock).toHaveBeenCalledWith({
      email: "member@example.com",
      orgId: "org-123",
    });
  });

  it("fails the status read when the restriction can't be read", async () => {
    isRestrictedMock.mockRejectedValue(new Error("settings unavailable"));
    await expect(
      resolveBuilderConnectionsStatus(
        { ownerEmail: "member@example.com", orgId: "org-123", role: "member" },
        { getGrants: async () => ({}), getKeyConnections: noKeys },
      ),
    ).rejects.toThrow("settings unavailable");
  });

  it("lets owners and admins connect only the organization's connection", async () => {
    for (const role of ["owner", "admin"]) {
      await expect(
        resolveBuilderConnectionsStatus(
          { ownerEmail: "admin@example.com", orgId: "org-123", role },
          { getGrants: async () => ({}), getKeyConnections: noKeys },
        ),
      ).resolves.toEqual({
        grants: {},
        canConnect: { org: true, personal: false },
      });
    }
  });

  it("offers no connection without an organization or a signed-in caller", async () => {
    await expect(
      resolveBuilderConnectionsStatus(
        { ownerEmail: "member@example.com", orgId: null, role: null },
        { getGrants: async () => ({}), getKeyConnections: noKeys },
      ),
    ).resolves.toMatchObject({ canConnect: { org: false, personal: false } });
    const getGrants = vi.fn(async () => ({}));
    await expect(
      resolveBuilderConnectionsStatus(
        { ownerEmail: null, orgId: "org-123", role: "owner" },
        { getGrants, getKeyConnections: noKeys },
      ),
    ).resolves.toEqual({
      grants: {},
      canConnect: { org: false, personal: false },
    });
    expect(getGrants).not.toHaveBeenCalled();
  });

  it("reports unreadable grants as null, not as no grants", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      resolveBuilderConnectionsStatus(
        { ownerEmail: "member@example.com", orgId: "org-123", role: "member" },
        {
          getGrants: async () => {
            throw new Error("credential store unavailable");
          },
          getKeyConnections: noKeys,
        },
      ),
    ).resolves.toMatchObject({ grants: null });
    await expect(
      resolveBuilderConnectionsStatus(
        { ownerEmail: "member@example.com", orgId: "org-123", role: "member" },
        {
          getGrants: async () => ({}),
          getKeyConnections: async () => {
            throw new Error("credential store unavailable");
          },
        },
      ),
    ).resolves.toMatchObject({ grants: null });
    warn.mockRestore();
  });

  it("names the effective connection with the UI's scope names", () => {
    expect(builderEffectiveConnectionFor("user")).toBe("personal");
    expect(builderEffectiveConnectionFor("org")).toBe("org");
    expect(builderEffectiveConnectionFor("workspace")).toBe("workspace");
    expect(builderEffectiveConnectionFor("env")).toBe("env");
    expect(builderEffectiveConnectionFor(null)).toBeNull();
  });
});
