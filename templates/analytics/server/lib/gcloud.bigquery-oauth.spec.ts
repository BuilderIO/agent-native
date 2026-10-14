import { generateKeyPairSync } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credentialContext: {
    userEmail: "analyst@example.com",
    orgId: "customer-org",
  } as { userEmail: string; orgId: string | null; credentialScope?: "org" },
  requestContext: {} as Record<string, unknown>,
  resolveCredential: vi.fn(),
  resolveBigQueryOAuthCredential: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: () => mocks.credentialContext,
  getRequestContext: () => mocks.requestContext,
}));

vi.mock("./credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));

vi.mock("./provider-credentials", () => ({
  resolveBigQueryOAuthCredential: mocks.resolveBigQueryOAuthCredential,
}));

const { getBigQueryAccessToken } = await import("./gcloud");

describe("getBigQueryAccessToken", () => {
  beforeEach(() => {
    mocks.credentialContext = {
      userEmail: "analyst@example.com",
      orgId: "customer-org",
    };
    mocks.requestContext = {};
    mocks.resolveCredential.mockReset();
    mocks.resolveCredential.mockResolvedValue("warehouse-project");
    mocks.resolveBigQueryOAuthCredential.mockReset();
    mocks.resolveBigQueryOAuthCredential.mockResolvedValue({
      value: "user-oauth-token",
      key: "BIGQUERY_ACCESS_TOKEN",
      provider: "bigquery",
      source: "workspace_connection",
    });
  });

  it("resolves the project and personal grant once per request", async () => {
    await expect(getBigQueryAccessToken()).resolves.toBe("user-oauth-token");
    await expect(getBigQueryAccessToken()).resolves.toBe("user-oauth-token");

    expect(mocks.resolveCredential).toHaveBeenCalledTimes(1);
    expect(mocks.resolveBigQueryOAuthCredential).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a personal grant across requests", async () => {
    await getBigQueryAccessToken();
    mocks.requestContext = {};
    await getBigQueryAccessToken();

    expect(mocks.resolveBigQueryOAuthCredential).toHaveBeenCalledTimes(2);
  });

  it("keeps default and org grants separate within one request", async () => {
    await getBigQueryAccessToken();
    mocks.credentialContext = {
      userEmail: "analyst@example.com",
      orgId: "customer-org",
      credentialScope: "org",
    };
    await getBigQueryAccessToken();

    expect(mocks.resolveCredential).toHaveBeenCalledTimes(2);
    expect(mocks.resolveBigQueryOAuthCredential).toHaveBeenCalledTimes(2);
  });

  it("uses the service account when personal BigQuery OAuth needs reauthorization", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const serviceAccountJson = JSON.stringify({
      type: "service_account",
      client_email: "analytics@example.test",
      private_key: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    });
    mocks.resolveBigQueryOAuthCredential.mockResolvedValue(null);
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "GOOGLE_APPLICATION_CREDENTIALS_JSON"
        ? serviceAccountJson
        : "warehouse-project",
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "service-account-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(getBigQueryAccessToken()).resolves.toBe(
        "service-account-token",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("prefers configured service-account auth for first-party writes", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const serviceAccountJson = JSON.stringify({
      type: "service_account",
      client_email: "analytics@example.test",
      private_key: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    });
    mocks.credentialContext = {
      userEmail: "writer@example.com",
      orgId: "service-account-preference-test",
    };
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "GOOGLE_APPLICATION_CREDENTIALS_JSON"
        ? serviceAccountJson
        : key === "BIGQUERY_PROJECT_ID"
          ? "warehouse-project"
          : undefined,
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "service-account-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        getBigQueryAccessToken({ preferServiceAccount: true }),
      ).resolves.toBe("service-account-token");
      expect(mocks.resolveBigQueryOAuthCredential).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves transient OAuth lookup failures when no service account is selected", async () => {
    const failure = new Error("OAuth refresh service unavailable");
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "BIGQUERY_PROJECT_ID" ? "warehouse-project" : undefined,
    );
    mocks.resolveBigQueryOAuthCredential.mockRejectedValueOnce(failure);

    await expect(getBigQueryAccessToken()).rejects.toBe(failure);
  });
});
