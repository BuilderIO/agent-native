import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCredential = vi.fn();
const isBlockedExtensionUrlWithDns = vi.fn();
const createSsrfSafeDispatcher = vi.fn();

vi.mock("../credentials/index.js", () => ({
  resolveCredential,
}));

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
}));

const { createProviderApiRuntime } = await import("./index.js");

const credentialContext = {
  userEmail: "ada@example.com",
  orgId: "org-1",
};

describe("provider API runtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resolveCredential.mockReset();
    isBlockedExtensionUrlWithDns.mockReset();
    createSsrfSafeDispatcher.mockReset();
    isBlockedExtensionUrlWithDns.mockResolvedValue(false);
    createSsrfSafeDispatcher.mockResolvedValue(null);
    resolveCredential.mockResolvedValue(null);
  });

  it("enforces provider allowlists for specific catalog lookups", () => {
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    expect(() => runtime.listCatalog("gmail")).toThrow(
      /Provider API gmail is not enabled/,
    );
  });

  it("does not fall back after a custom credential resolver returns null", async () => {
    resolveCredential.mockResolvedValue("local-token");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
      resolveCredential: async () => null,
    });

    await expect(
      runtime.executeRequest({
        provider: "hubspot",
        path: "/crm/v3/objects/deals",
      }),
    ).rejects.toThrow(/hubspot credential not configured/);

    expect(resolveCredential).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
