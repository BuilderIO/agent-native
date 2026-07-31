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

const { slackAdapter } = await import("./slack.js");

const installation = (installationKey: string) => ({
  id: installationKey,
  platform: "slack",
  installationKey,
  status: "connected",
});

describe("slack outbound installation selection", () => {
  beforeEach(() => {
    delete process.env.SLACK_BOT_TOKEN;
    getActiveIntegrationInstallationByKeyMock.mockResolvedValue(null);
    resolveIntegrationTokenBundleMock.mockResolvedValue({
      accessToken: "xoxb-not-a-real-token",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("refuses to send when a tenant has several connected Slack apps", async () => {
    // Two apps connected to one workspace — picking either would post under a
    // bot identity the caller never named.
    listActiveIntegrationInstallationsForTenantMock.mockResolvedValue([
      installation("T1:fusion-analytics"),
      installation("T1:agent-native"),
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await slackAdapter().sendMessageToTarget!(
      { text: "hello", platformContext: {} },
      { destination: "C123", tenantId: "T1" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(" ")).toContain(
      "connected Slack apps",
    );
  });

  it("sends when the caller names the installation explicitly", async () => {
    getActiveIntegrationInstallationByKeyMock.mockResolvedValue(
      installation("T1:agent-native"),
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, ts: "1.0" }),
    }));
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
    // Ambiguity resolution is skipped entirely when the app is named.
    expect(
      listActiveIntegrationInstallationsForTenantMock,
    ).not.toHaveBeenCalled();
  });

  it("sends without an app id when only one app is connected", async () => {
    listActiveIntegrationInstallationsForTenantMock.mockResolvedValue([
      installation("T1:agent-native"),
    ]);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, ts: "1.0" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await slackAdapter().sendMessageToTarget!(
      { text: "hello", platformContext: {} },
      { destination: "C123", tenantId: "T1" },
    );

    expect(fetchMock).toHaveBeenCalled();
  });
});
