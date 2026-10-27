import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listActiveIntegrationInstallationsForTenantMock = vi.hoisted(() =>
  vi.fn(),
);
const getActiveIntegrationInstallationByKeyMock = vi.hoisted(() => vi.fn());
const resolveIntegrationTokenBundleMock = vi.hoisted(() => vi.fn());

vi.mock("../installations-store.js", () => ({
  listActiveIntegrationInstallationsForTenant:
    listActiveIntegrationInstallationsForTenantMock,
  getActiveIntegrationInstallationByKey:
    getActiveIntegrationInstallationByKeyMock,
  listIntegrationInstallations: vi.fn(async () => []),
  resolveIntegrationTokenBundle: resolveIntegrationTokenBundleMock,
}));

const { resolveSlackBotTokenForIncoming, slackAdapter } =
  await import("./slack.js");

let tokenSequence = 0;

const installation = (
  installationKey: string,
  apiAppId: string | null = null,
) => ({
  id: installationKey,
  platform: "slack",
  installationKey,
  apiAppId,
  status: "connected",
});

describe("slack outbound installation selection", () => {
  beforeEach(() => {
    delete process.env.SLACK_BOT_TOKEN;
    getActiveIntegrationInstallationByKeyMock.mockResolvedValue(null);
    resolveIntegrationTokenBundleMock.mockResolvedValue({
      accessToken: `xoxb-not-a-real-token-${++tokenSequence}`,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("refuses to send when a tenant has several connected Slack apps", async () => {
    listActiveIntegrationInstallationsForTenantMock.mockResolvedValue([
      installation("T1:fusion-analytics"),
      installation("T1:agent-native"),
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      slackAdapter().sendMessageToTarget!(
        { text: "hello", platformContext: {} },
        { destination: "C123", tenantId: "T1" },
      ),
    ).rejects.toThrow("no bot token for outbound target");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(" ")).toContain(
      "connected Slack apps",
    );
  });

  it("sends when the caller names the installation explicitly", async () => {
    getActiveIntegrationInstallationByKeyMock.mockResolvedValue(
      installation("T1:agent-native", "agent-native"),
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (new URL(url).pathname.endsWith("/api/auth.test")) {
        return new Response(
          JSON.stringify({ ok: true, team_id: "T1", bot_id: "B1" }),
        );
      }
      if (new URL(url).pathname.endsWith("/api/bots.info")) {
        return new Response(
          JSON.stringify({ ok: true, bot: { app_id: "agent-native" } }),
        );
      }
      return new Response(JSON.stringify({ ok: true, ts: "1.0" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await slackAdapter().sendMessageToTarget!(
      { text: "hello", platformContext: {} },
      {
        destination: "C123",
        tenantId: "T1",
        installationKey: "T1:agent-native",
      },
    );

    expect(getActiveIntegrationInstallationByKeyMock).toHaveBeenCalledWith(
      "slack",
      "T1:agent-native",
    );
    expect(fetchMock).toHaveBeenCalled();
    expect(
      listActiveIntegrationInstallationsForTenantMock,
    ).not.toHaveBeenCalled();
  });

  it("rejects a named legacy installation without an app id", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-deploy-token";
    getActiveIntegrationInstallationByKeyMock.mockResolvedValue(
      installation("T1:agent-native"),
    );
    resolveIntegrationTokenBundleMock.mockResolvedValue({
      accessToken: "xoxb-selected-token",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      slackAdapter().sendMessageToTarget!(
        { text: "hello", platformContext: {} },
        {
          destination: "C123",
          tenantId: "T1",
          installationKey: "T1:agent-native",
        },
      ),
    ).rejects.toThrow("no bot token for outbound target");

    expect(resolveIntegrationTokenBundleMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when a named installation is missing", async () => {
    getActiveIntegrationInstallationByKeyMock.mockResolvedValue(null);
    listActiveIntegrationInstallationsForTenantMock.mockResolvedValue([
      installation("T1:other-app", "A-OTHER"),
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      slackAdapter().sendMessageToTarget!(
        { text: "hello", platformContext: {} },
        {
          destination: "C123",
          tenantId: "T1",
          installationKey: "T1:stale-app",
        },
      ),
    ).rejects.toThrow("no bot token for outbound target");

    expect(
      listActiveIntegrationInstallationsForTenantMock,
    ).not.toHaveBeenCalled();
    expect(resolveIntegrationTokenBundleMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a named installation token from another Slack app", async () => {
    getActiveIntegrationInstallationByKeyMock.mockResolvedValue(
      installation("T1:agent-native", "A-NAMED"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (new URL(url).pathname.endsWith("/api/auth.test")) {
          return new Response(
            JSON.stringify({ ok: true, team_id: "T1", bot_id: "B-WRONG" }),
          );
        }
        if (new URL(url).pathname.endsWith("/api/bots.info")) {
          return new Response(
            JSON.stringify({ ok: true, bot: { app_id: "A-WRONG" } }),
          );
        }
        return new Response(JSON.stringify({ ok: true, ts: "1.0" }));
      }),
    );

    await expect(
      slackAdapter().sendMessageToTarget!(
        { text: "hello", platformContext: {} },
        {
          destination: "C123",
          tenantId: "T1",
          installationKey: "T1:agent-native",
        },
      ),
    ).rejects.toThrow("no bot token for outbound target");
  });

  it("sends without an app id when only one app is connected", async () => {
    listActiveIntegrationInstallationsForTenantMock.mockResolvedValue([
      installation("T1:agent-native"),
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      if (new URL(url).pathname.endsWith("/api/auth.test")) {
        return new Response(
          JSON.stringify({ ok: true, team_id: "T1", bot_id: "B1" }),
        );
      }
      return new Response(JSON.stringify({ ok: true, ts: "1.0" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await slackAdapter().sendMessageToTarget!(
      { text: "hello", platformContext: {} },
      { destination: "C123", tenantId: "T1" },
    );

    expect(fetchMock).toHaveBeenCalled();
  });

  it("falls back to the deploy token when a saved installation belongs to another app", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-deploy-token";
    getActiveIntegrationInstallationByKeyMock.mockResolvedValue(
      installation("T1:A1"),
    );
    resolveIntegrationTokenBundleMock.mockResolvedValue({
      accessToken: "xoxb-stale-managed-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const token = new Headers(init?.headers).get("authorization");
        if (token === "Bearer xoxb-stale-managed-token") {
          return new Response(
            JSON.stringify({ ok: true, team_id: "T1", bot_id: "B-STALE" }),
          );
        }
        if (String(_url).endsWith("/api/auth.test")) {
          return new Response(
            JSON.stringify({ ok: true, team_id: "T1", bot_id: "B1" }),
          );
        }
        return new Response(
          JSON.stringify({ ok: true, bot: { app_id: "A1" } }),
        );
      }),
    );

    await expect(
      resolveSlackBotTokenForIncoming({
        platform: "slack",
        externalThreadId: "A1:T1:D1:1.0",
        text: "hello",
        tenantId: "T1",
        conversationType: "dm",
        platformContext: { teamId: "T1", apiAppId: "A1" },
        timestamp: Date.now(),
      }),
    ).resolves.toBe("xoxb-deploy-token");
  });
});
