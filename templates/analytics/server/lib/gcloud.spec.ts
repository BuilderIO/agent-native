import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveCredential } from "./credentials.js";
import {
  fetchGoogleWithRetry,
  getAccessToken,
  getBigQueryAccess,
  getBigQueryAccessToken,
} from "./gcloud.js";

const resolveBigQueryOAuthCredential = vi.hoisted(() => vi.fn());

vi.mock("./credentials.js", () => ({
  resolveCredential: vi.fn(),
}));
vi.mock("./provider-credentials.js", () => ({
  resolveBigQueryOAuthCredential,
}));
vi.mock("./sign-jwt.js", () => ({ signRs256Jwt: async () => "signed-jwt" }));

vi.mock("./credentials-context.js", () => ({
  credentialCacheScope: vi.fn(() => "test-scope"),
  requireRequestCredentialContext: vi.fn(() => ({})),
  scopedCredentialCacheKey: vi.fn(() => "test-scope"),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGoogleWithRetry", () => {
  it("retries transient network failures within a bounded attempt count", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGoogleWithRetry("https://example.test", {}, "test request"),
    ).resolves.toMatchObject({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns permanent HTTP errors without retrying them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGoogleWithRetry("https://example.test", {}, "test request"),
    ).resolves.toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight retry request when the caller deadline expires", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchGoogleWithRetry(
      "https://example.test",
      {},
      "test request",
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("labels an exhausted network failure with the operation and attempt count", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGoogleWithRetry("https://example.test", {}, "BigQuery insertAll"),
    ).rejects.toThrow(
      "Google BigQuery insertAll failed after 4 attempt(s): TypeError: fetch failed",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("getAccessToken", () => {
  it("stops waiting on credential resolution when the caller deadline expires", async () => {
    let resolveCredentials!: (value: string) => void;
    const credentialRead = new Promise<string>((resolve) => {
      resolveCredentials = resolve;
    });
    vi.mocked(resolveCredential).mockReturnValueOnce(credentialRead);

    const controller = new AbortController();
    const pending = getAccessToken(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolveCredentials("{}");
  });
});

describe("getBigQueryAccessToken", () => {
  it("uses the connected BigQuery OAuth token before a service account key", async () => {
    vi.mocked(resolveCredential).mockReset();
    resolveBigQueryOAuthCredential.mockReset();
    vi.mocked(resolveCredential).mockResolvedValue("test-project");
    resolveBigQueryOAuthCredential.mockResolvedValue({
      value: "user-google-token",
    });

    await expect(getBigQueryAccessToken()).resolves.toBe("user-google-token");
    expect(resolveBigQueryOAuthCredential).toHaveBeenCalledWith({});
  });

  it("reuses resolved project and OAuth credentials", async () => {
    vi.mocked(resolveCredential).mockReset();
    resolveBigQueryOAuthCredential.mockReset();
    const oauthCredential = {
      value: "user-google-token",
      key: "BIGQUERY_OAUTH_TOKEN",
      provider: "bigquery",
      source: "workspace_connection" as const,
    };

    await expect(
      getBigQueryAccessToken({
        projectId: "test-project",
        oauthCredential,
      }),
    ).resolves.toBe("user-google-token");
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(resolveBigQueryOAuthCredential).not.toHaveBeenCalled();
  });
});

describe("getBigQueryAccess", () => {
  const serviceAccount = (clientEmail: string, keyId: string) =>
    JSON.stringify({
      type: "service_account",
      client_email: clientEmail,
      private_key: `PRIVATE-KEY-FOR-${keyId}`,
      private_key_id: keyId,
    });

  it("names a service account by its email and a hash of its key ID, never the key, and keeps the principal its cached token was minted for", async () => {
    vi.mocked(resolveCredential).mockReset();
    resolveBigQueryOAuthCredential.mockReset();
    resolveBigQueryOAuthCredential.mockResolvedValue(null);
    let stored = serviceAccount(
      "runner-a@test-project.iam.gserviceaccount.com",
      "key-a",
    );
    vi.mocked(resolveCredential).mockImplementation(async (key: string) =>
      key === "BIGQUERY_PROJECT_ID" ? "test-project" : stored,
    );
    const minted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        minted.push("token");
        return new Response(
          JSON.stringify({
            access_token: `token-${minted.length}`,
            expires_in: 3600,
          }),
        );
      }),
    );

    const first = await getBigQueryAccess();
    expect(first.token).toBe("token-1");
    expect(first.principal).toMatch(
      /^sa:runner-a@test-project\.iam\.gserviceaccount\.com#[0-9a-f]{16}$/,
    );
    expect(first.principal).not.toContain("key-a");
    expect(first.principal).not.toContain("PRIVATE-KEY");

    stored = serviceAccount(
      "runner-b@test-project.iam.gserviceaccount.com",
      "key-b",
    );
    expect(await getBigQueryAccess()).toEqual(first);
    expect(minted).toHaveLength(1);
  });

  it("names an OAuth account by a hash, and no principal when the grant names none", async () => {
    const credential = {
      value: "user-google-token",
      key: "BIGQUERY_OAUTH_TOKEN",
      provider: "bigquery",
      source: "workspace_connection" as const,
    };
    const named = await getBigQueryAccess({
      projectId: "test-project",
      oauthCredential: { ...credential, accountId: "alice@example.com" },
    });
    expect(named.token).toBe("user-google-token");
    expect(named.principal).toMatch(/^oauth:[0-9a-f]{16}$/);
    expect(named.principal).not.toContain("alice");
    await expect(
      getBigQueryAccess({
        projectId: "test-project",
        oauthCredential: credential,
      }),
    ).resolves.toEqual({ token: "user-google-token", principal: null });
  });
});
