import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(() => ({
    executeRequest: vi.fn(),
    fetchDocs: vi.fn(),
    listCatalog: vi.fn(),
  })),
  getCredentialContext: vi.fn(() => ({
    userEmail: "member@example.test",
    orgId: "org-one",
  })),
  listProviderApiIdsForTemplateUse: vi.fn(() => ["figma", "github"]),
}));

vi.mock("@agent-native/core/provider-api", () => ({
  createProviderApiRuntime: mocks.create,
  listProviderApiIdsForTemplateUse: mocks.listProviderApiIdsForTemplateUse,
}));
vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: mocks.getCredentialContext,
}));

import { getDesignProviderApiRuntime } from "./provider-api.js";

describe("Design provider API runtime", () => {
  it("keeps Core's default workspace-connection credential resolver", () => {
    getDesignProviderApiRuntime();

    expect(mocks.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ resolveCredential: expect.any(Function) }),
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "design",
        providerIds: ["figma", "github"],
        getCredentialContext: expect.any(Function),
      }),
    );
  });
});
