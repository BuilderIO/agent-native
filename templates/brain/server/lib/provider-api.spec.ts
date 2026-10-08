import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCredential: undefined as
    | ((options: unknown) => Promise<unknown>)
    | undefined,
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
  resolveSourceCredentialWithProvenance:
    mocks.resolveSourceCredentialWithProvenance,
}));

import "./provider-api.js";

describe("Brain provider API credential resolver", () => {
  beforeEach(() => {
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
  });
});
