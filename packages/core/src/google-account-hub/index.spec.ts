import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signA2ATokenMock = vi.hoisted(() => vi.fn());
const appIdentity = vi.hoisted(() => ({
  id: undefined as string | undefined,
  workspaceId: undefined as string | undefined,
}));

vi.mock("../a2a/client.js", () => ({ signA2AToken: signA2ATokenMock }));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({ app: appIdentity }),
}));
vi.mock("../server/credential-provider.js", () => ({
  readDeployCredentialEnv: (key: string) => process.env[key],
}));

import {
  clearGoogleAccountHubCache,
  getHubGoogleAccount,
  GoogleAccountHubError,
  isGoogleAccountHubConfigured,
  listHubGoogleAccounts,
} from "./index.js";

const OPTIONS = {
  appId: "calendar",
  userEmail: "Person@Example.test",
  provider: "google_calendar",
};

function hubAnswer(expiresIn = 3600) {
  return Response.json({
    accounts: [
      {
        account_email: "Work@Example.test",
        connection_id: "conn-1",
        access_token: "access-1",
        expires_in: expiresIn,
        scope: "openid https://www.googleapis.com/auth/calendar.readonly",
      },
    ],
    errors: [
      {
        account_email: "old@example.test",
        connection_id: "conn-2",
        error: "invalid_grant",
        needs_reconnect: true,
      },
    ],
  });
}

const fetchMock = vi.fn();

describe("Google account hub client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    vi.stubEnv(
      "AGENT_NATIVE_GOOGLE_ACCOUNT_HUB_URL",
      "https://dispatch.example.test/",
    );
    vi.stubEnv("AGENT_NATIVE_IDENTITY_FEDERATION_SECRET", "calendar-secret");
    appIdentity.id = undefined;
    appIdentity.workspaceId = undefined;
    clearGoogleAccountHubCache();
    signA2ATokenMock.mockReset().mockResolvedValue("signed-assertion");
    fetchMock.mockReset().mockImplementation(async () => hubAnswer());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is configured only with a safe hub URL and this app's secret", () => {
    expect(isGoogleAccountHubConfigured()).toBe(true);
    vi.stubEnv("AGENT_NATIVE_IDENTITY_FEDERATION_SECRET", "");
    expect(isGoogleAccountHubConfigured()).toBe(false);
    vi.stubEnv("AGENT_NATIVE_IDENTITY_FEDERATION_SECRET", "calendar-secret");
    vi.stubEnv(
      "AGENT_NATIVE_GOOGLE_ACCOUNT_HUB_URL",
      "http://dispatch.example.test",
    );
    expect(isGoogleAccountHubConfigured()).toBe(false);
    vi.stubEnv("AGENT_NATIVE_GOOGLE_ACCOUNT_HUB_URL", "http://localhost:4183");
    expect(isGoogleAccountHubConfigured()).toBe(true);
    vi.stubEnv(
      "AGENT_NATIVE_GOOGLE_ACCOUNT_HUB_URL",
      "https://user:pass@dispatch.example.test",
    );
    expect(isGoogleAccountHubConfigured()).toBe(false);
  });

  it("signs a short assertion naming the person and the app, and parses the answer", async () => {
    const result = await listHubGoogleAccounts(OPTIONS);

    expect(signA2ATokenMock).toHaveBeenCalledTimes(1);
    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "person@example.test",
      undefined,
      "calendar-secret",
      expect.objectContaining({
        expiresIn: "2m",
        extraClaims: {
          app_id: "calendar",
          scope: "google-account-hub",
          jti: expect.any(String),
        },
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dispatch.example.test/_agent-native/google-accounts/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer signed-assertion",
        }),
        body: JSON.stringify({ provider: "google_calendar" }),
        redirect: "error",
      }),
    );

    expect(result).toEqual({
      accounts: [
        {
          accountEmail: "Work@Example.test",
          connectionId: "conn-1",
          accessToken: "access-1",
          expiresAt: Date.now() + 3_600_000,
          scopes: [
            "openid",
            "https://www.googleapis.com/auth/calendar.readonly",
          ],
        },
      ],
      errors: [
        {
          accountEmail: "old@example.test",
          connectionId: "conn-2",
          error: "invalid_grant",
          needsReconnect: true,
        },
      ],
    });
  });

  it("signs as the configured app identity when there is one", async () => {
    appIdentity.id = "calendar-staging";
    await listHubGoogleAccounts(OPTIONS);
    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "person@example.test",
      undefined,
      "calendar-secret",
      expect.objectContaining({
        extraClaims: expect.objectContaining({ app_id: "calendar-staging" }),
      }),
    );
  });

  it("reuses tokens until a minute before they expire", async () => {
    await listHubGoogleAccounts(OPTIONS);
    vi.advanceTimersByTime(58 * 60_000);
    await listHubGoogleAccounts({
      ...OPTIONS,
      userEmail: "person@example.test",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    await listHubGoogleAccounts(OPTIONS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks once for concurrent callers", async () => {
    await Promise.all([
      listHubGoogleAccounts(OPTIONS),
      listHubGoogleAccounts(OPTIONS),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps each person's tokens apart", async () => {
    await listHubGoogleAccounts(OPTIONS);
    await listHubGoogleAccounts({
      ...OPTIONS,
      userEmail: "other@example.test",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forgets a person's tokens on request", async () => {
    await listHubGoogleAccounts(OPTIONS);
    clearGoogleAccountHubCache("person@example.test");
    await listHubGoogleAccounts(OPTIONS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches an empty answer only briefly", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ accounts: [], errors: [] }),
    );
    await listHubGoogleAccounts(OPTIONS);
    await listHubGoogleAccounts(OPTIONS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await listHubGoogleAccounts(OPTIONS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws the hub's status when it refuses", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const failure = await listHubGoogleAccounts(OPTIONS).catch((e) => e);
    expect(failure).toBeInstanceOf(GoogleAccountHubError);
    expect(failure.status).toBe(401);
  });

  it("refuses to ask without a signed-in person", async () => {
    await expect(
      listHubGoogleAccounts({ ...OPTIONS, userEmail: "  " }),
    ).rejects.toBeInstanceOf(GoogleAccountHubError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("finds one account by email, ignoring case", async () => {
    const account = await getHubGoogleAccount({
      ...OPTIONS,
      accountEmail: "work@example.TEST",
    });
    expect(account?.connectionId).toBe("conn-1");
    expect(
      await getHubGoogleAccount({
        ...OPTIONS,
        accountEmail: "no@example.test",
      }),
    ).toBeNull();
  });
});
