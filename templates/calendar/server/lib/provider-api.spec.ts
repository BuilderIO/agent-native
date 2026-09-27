import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCredential: undefined as
    | ((options: unknown) => Promise<unknown>)
    | undefined,
}));

vi.mock("@agent-native/core/provider-api", () => ({
  createProviderApiRuntime: vi.fn(
    (options: { resolveCredential?: unknown }) => {
      mocks.resolveCredential = options.resolveCredential as
        | ((options: unknown) => Promise<unknown>)
        | undefined;
      return {};
    },
  ),
  defaultProviderApiCredentialResolver: vi.fn(async () => null),
  listProviderApiIdsForTemplateUse: vi.fn(() => ["gong", "hubspot"]),
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredentialDetailed: vi.fn(
    async (key: string, ctx: { userEmail: string }) =>
      key === "GONG_API_KEY"
        ? {
            value: "legacy-access-key:legacy-access-secret",
            scope: "user",
            scopeId: ctx.userEmail,
          }
        : undefined,
  ),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: vi.fn(),
}));

import "./provider-api.js";

describe("Calendar provider API credential resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["GONG_ACCESS_KEY", "legacy-access-key"],
    ["GONG_ACCESS_SECRET", "legacy-access-secret"],
  ])("preserves legacy Gong ownership for %s", async (key, value) => {
    const resolveCredential = mocks.resolveCredential;
    if (!resolveCredential) {
      throw new Error("Calendar resolver was not registered");
    }

    await expect(
      resolveCredential({
        provider: "gong",
        key,
        ctx: { userEmail: "owner@example.test" },
      }),
    ).resolves.toMatchObject({
      key: "GONG_API_KEY",
      value,
      source: "calendar_legacy_credentials",
      provider: "gong",
      scope: "user",
      scopeId: "owner@example.test",
    });
  });
});
