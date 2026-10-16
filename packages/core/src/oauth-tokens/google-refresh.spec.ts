import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOAuthAccounts: vi.fn(),
  saveOAuthTokens: vi.fn(),
  resolveGoogleProviderCredentialCandidates: vi.fn(),
}));

vi.mock("./store.js", () => ({
  listOAuthAccounts: mocks.listOAuthAccounts,
  saveOAuthTokens: mocks.saveOAuthTokens,
}));

vi.mock("../server/google-oauth-credentials.js", () => ({
  resolveGoogleProviderCredentialCandidates:
    mocks.resolveGoogleProviderCredentialCandidates,
}));

vi.mock("../server/interval-job.js", () => ({
  startIntervalJob: vi.fn(),
}));

import { refreshExpiringGoogleTokens } from "./google-refresh.js";

describe("refreshExpiringGoogleTokens", () => {
  beforeEach(() => {
    mocks.listOAuthAccounts.mockReset();
    mocks.saveOAuthTokens.mockReset();
    mocks.resolveGoogleProviderCredentialCandidates.mockReset();
    mocks.resolveGoogleProviderCredentialCandidates.mockReturnValue([
      { clientId: "google-client-id", clientSecret: "google-client-secret" },
    ]);
    mocks.listOAuthAccounts.mockImplementation(async (provider: string) => [
      {
        accountId: `${provider}-account`,
        owner: "user@example.com",
        tokens: { refresh_token: `${provider}-refresh`, expiry_date: 0 },
      },
    ]);
    mocks.saveOAuthTokens.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Response(
            JSON.stringify({
              access_token: "fresh-google-access",
              expires_in: 3600,
              token_type: "Bearer",
            }),
            { status: 200 },
          ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes shared Google and isolated Google Sheets token rows separately", async () => {
    await refreshExpiringGoogleTokens();

    expect(mocks.listOAuthAccounts).toHaveBeenNthCalledWith(1, "google");
    expect(mocks.listOAuthAccounts).toHaveBeenNthCalledWith(2, "google_sheets");
    expect(mocks.saveOAuthTokens).toHaveBeenNthCalledWith(
      1,
      "google",
      "google-account",
      expect.objectContaining({ access_token: "fresh-google-access" }),
    );
    expect(mocks.saveOAuthTokens).toHaveBeenNthCalledWith(
      2,
      "google_sheets",
      "google_sheets-account",
      expect.objectContaining({ access_token: "fresh-google-access" }),
    );
  });
});
