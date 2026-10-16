import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCredential: undefined as
    | ((options: unknown) => Promise<unknown>)
    | undefined,
  inspectSourceCredentialAvailability: vi.fn(),
  resolveSourceCredentialWithProvenance: vi.fn(),
}));

vi.mock("@agent-native/core/provider-api", () => ({
  PROVIDER_API_IDS: ["gong"],
  createProviderApiRuntime: vi.fn(
    (options: { resolveCredential?: unknown }) => {
      mocks.resolveCredential = options.resolveCredential as
        | ((options: unknown) => Promise<unknown>)
        | undefined;
      return {};
    },
  ),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: vi.fn(),
}));

vi.mock("./source-credentials.js", () => ({
  hasCredentialLookupError: (availability: {
    checked: Array<{ status: string }>;
  }) => availability.checked.some((check) => check.status === "error"),
  inspectSourceCredentialAvailability:
    mocks.inspectSourceCredentialAvailability,
  resolveSourceCredentialWithProvenance:
    mocks.resolveSourceCredentialWithProvenance,
}));

import "./provider-api.js";

describe("Brain provider API credential resolver", () => {
  beforeEach(() => {
    mocks.inspectSourceCredentialAvailability
      .mockReset()
      .mockResolvedValue({ available: true, checked: [] });
    mocks.resolveSourceCredentialWithProvenance.mockReset().mockResolvedValue({
      value: "credential-value",
      provenance: {
        source: "workspace_connection",
        key: "GONG_API_BASE",
        provider: "gong",
        scope: "org",
        scopeId: "org-1",
        connectionId: "conn-1",
        connectionLabel: "Team Gong",
      },
    });
  });

  it("preserves the resolved credential ownership and connection identity", async () => {
    const resolveCredential = mocks.resolveCredential;
    if (!resolveCredential)
      throw new Error("Brain resolver was not registered");

    await expect(
      resolveCredential({
        provider: "gong",
        key: "GONG_API_BASE",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      key: "GONG_API_BASE",
      value: "credential-value",
      source: "workspace_connection",
      provider: "gong",
      connectionId: "conn-1",
      connectionLabel: "Team Gong",
      scope: "org",
      scopeId: "org-1",
    });

    expect(mocks.resolveSourceCredentialWithProvenance).toHaveBeenCalledWith({
      provider: "gong",
      key: "GONG_API_BASE",
      ctx: {
        userEmail: "owner@example.test",
        orgId: "org-1",
        credentialScope: "org",
      },
      workspaceConnectionId: undefined,
    });
  });

  it.each(["GONG_ACCESS_KEY", "GONG_ACCESS_SECRET"])(
    "requests the organization-scoped Gong %s",
    async (key) => {
      const resolveCredential = mocks.resolveCredential;
      if (!resolveCredential)
        throw new Error("Brain resolver was not registered");
      const ctx = { userEmail: "owner@example.test", orgId: "org-1" };
      mocks.resolveSourceCredentialWithProvenance.mockResolvedValue({
        value: "credential-value",
        provenance: {
          source: "registered_secret",
          key,
          provider: "gong",
          scope: "org",
          scopeId: "org-1",
        },
      });

      await expect(
        resolveCredential({ provider: "gong", key, ctx }),
      ).resolves.toMatchObject({ key, scope: "org", scopeId: "org-1" });

      expect(mocks.resolveSourceCredentialWithProvenance).toHaveBeenCalledWith({
        provider: "gong",
        key,
        ctx: { ...ctx, credentialScope: "org" },
        workspaceConnectionId: undefined,
      });
    },
  );

  it("preserves the default credential scope for other providers", async () => {
    const resolveCredential = mocks.resolveCredential;
    if (!resolveCredential)
      throw new Error("Brain resolver was not registered");
    const ctx = { userEmail: "owner@example.test", orgId: "org-1" };

    await resolveCredential({ provider: "slack", key: "SLACK_BOT_TOKEN", ctx });

    expect(mocks.resolveSourceCredentialWithProvenance).toHaveBeenCalledWith({
      provider: "slack",
      key: "SLACK_BOT_TOKEN",
      ctx,
      workspaceConnectionId: undefined,
    });
  });

  it("fails closed when the optional Gong base URL vault lookup errors", async () => {
    const resolveCredential = mocks.resolveCredential;
    if (!resolveCredential)
      throw new Error("Brain resolver was not registered");
    const ctx = { userEmail: "owner@example.test", orgId: "org-1" };
    mocks.inspectSourceCredentialAvailability.mockResolvedValue({
      available: false,
      checked: [{ status: "error" }],
    });

    await expect(
      resolveCredential({
        provider: "gong",
        key: "GONG_API_BASE",
        ctx,
      }),
    ).rejects.toThrow(
      "Brain could not verify the organization Gong API base URL from its credential vault.",
    );
    expect(mocks.resolveSourceCredentialWithProvenance).not.toHaveBeenCalled();
  });

  it("keeps the default Gong base when the optional override is absent", async () => {
    const resolveCredential = mocks.resolveCredential;
    if (!resolveCredential)
      throw new Error("Brain resolver was not registered");
    mocks.inspectSourceCredentialAvailability.mockResolvedValue({
      available: false,
      checked: [],
    });

    await expect(
      resolveCredential({
        provider: "gong",
        key: "GONG_API_BASE",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBeNull();
    expect(mocks.resolveSourceCredentialWithProvenance).not.toHaveBeenCalled();
  });

  it("fails closed if an available Gong base URL cannot be resolved on request", async () => {
    const resolveCredential = mocks.resolveCredential;
    if (!resolveCredential)
      throw new Error("Brain resolver was not registered");
    mocks.inspectSourceCredentialAvailability.mockResolvedValue({
      available: true,
      checked: [],
    });
    mocks.resolveSourceCredentialWithProvenance.mockResolvedValue(undefined);

    await expect(
      resolveCredential({
        provider: "gong",
        key: "GONG_API_BASE",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).rejects.toThrow(
      "Brain could not verify the organization Gong API base URL from its credential vault.",
    );
  });
});
