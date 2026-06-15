import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCredential = vi.fn();
const isBlockedExtensionUrlWithDns = vi.fn();
const createSsrfSafeDispatcher = vi.fn();
const listOAuthAccountsByOwner = vi.fn();
const saveOAuthTokens = vi.fn();

vi.mock("../credentials/index.js", () => ({
  resolveCredential,
}));

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
}));

vi.mock("../oauth-tokens/index.js", () => ({
  listOAuthAccountsByOwner,
  saveOAuthTokens,
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
    listOAuthAccountsByOwner.mockReset();
    saveOAuthTokens.mockReset();
    isBlockedExtensionUrlWithDns.mockResolvedValue(false);
    createSsrfSafeDispatcher.mockResolvedValue(null);
    resolveCredential.mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("enforces provider allowlists for specific catalog lookups", async () => {
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    await expect(runtime.listCatalog("gmail")).rejects.toThrow(
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

  it("allows templates to override the OAuth provider for built-in provider APIs", async () => {
    listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "docs@example.com",
        displayName: "Docs Account",
        tokens: {
          access_token: "docs-access-token",
          expiry_date: Date.now() + 60_000,
        },
      },
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const runtime = createProviderApiRuntime({
      appId: "slides",
      providerIds: ["google_drive"],
      getCredentialContext: () => credentialContext,
      oauthProviderOverrides: {
        google_drive: "google-docs",
      },
    });

    await runtime.executeRequest({
      provider: "google_drive",
      path: "/files",
    });

    expect(listOAuthAccountsByOwner).toHaveBeenCalledWith(
      "google-docs",
      credentialContext.userEmail,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer docs-access-token",
        }),
      }),
    );
  });
});
