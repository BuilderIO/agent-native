import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  getReportDashboard: vi.fn(),
  launch: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: () => "https://analytics.example.test",
  sendEmail: mocks.sendEmail,
  signEmbedSessionToken: () => "signed-embed-token",
}));

vi.mock("@agent-native/core/shared", () => ({
  EMBED_MODE_QUERY_PARAM: "__an_embed",
  EMBED_TOKEN_QUERY_PARAM: "__an_embed_token",
}));

vi.mock("./dashboard-report-subscriptions", () => ({
  getReportDashboard: mocks.getReportDashboard,
}));

vi.mock("playwright-core", () => ({
  chromium: {
    launch: mocks.launch,
  },
}));

import { sendDashboardReportSubscription } from "./dashboard-report";
import type { DashboardReportSubscription } from "./dashboard-report-subscriptions";

function subscription(): DashboardReportSubscription {
  return {
    id: "sub_1",
    dashboardId: "agent-native-templates-first-party",
    name: "Agent Native Builder.io daily email",
    recipients: ["steve@builder.io"],
    filters: { f_timeRange: "30d", f_emailFilter: "all" },
    frequency: "daily",
    timeOfDay: "03:00",
    timezone: "America/Los_Angeles",
    enabled: true,
    nextRunAt: "2026-06-28T10:00:00.000Z",
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    ownerEmail: "steve@builder.io",
    orgId: "org_1",
  };
}

function dashboard() {
  return {
    id: "agent-native-templates-first-party",
    title: "Agent Native Templates (First-party)",
    config: {
      name: "Agent Native Templates (First-party)",
      description: "Daily template dashboard",
      filters: [],
      panels: [],
    },
  };
}

function createBrowser(options: { waitForFails?: boolean } = {}) {
  const locator = {
    waitFor: vi.fn(async () => {
      if (options.waitForFails) {
        throw new Error("Target page, context or browser has been closed");
      }
    }),
    boundingBox: vi.fn(async () => ({ width: 960, height: 1200 })),
    scrollIntoViewIfNeeded: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.from("png")),
  };
  const page = {
    setDefaultTimeout: vi.fn(),
    emulateMedia: vi.fn(async () => {}),
    addInitScript: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    locator: vi.fn(() => locator),
    waitForFunction: vi.fn(async () => {}),
    evaluate: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    setViewportSize: vi.fn(async () => {}),
  };
  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  return { browser, page, locator };
}

describe("dashboard report email", () => {
  beforeEach(() => {
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", process.execPath);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendEmail.mockResolvedValue(undefined);
    mocks.getReportDashboard.mockResolvedValue(dashboard());
    mocks.launch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mocks.sendEmail.mockReset();
    mocks.getReportDashboard.mockReset();
  });

  it("retries with a compact dashboard screenshot when the full capture closes", async () => {
    const full = createBrowser({ waitForFails: true });
    const compact = createBrowser();
    mocks.launch
      .mockResolvedValueOnce(full.browser)
      .mockResolvedValueOnce(compact.browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      recipientCount: 1,
      screenshotAttached: true,
      screenshotMode: "compact",
    });
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(compact.page.goto).toHaveBeenCalledWith(
      expect.stringContaining("reportPanelLimit=12"),
      expect.any(Object),
    );
    expect(compact.page.emulateMedia).toHaveBeenCalledWith({
      media: "screen",
      colorScheme: "light",
    });
    expect(compact.page.addInitScript).toHaveBeenCalledOnce();
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "steve@builder.io",
        html: expect.not.stringContaining("Daily template dashboard"),
        text: expect.stringContaining("Edit subscription settings:"),
        attachments: [
          expect.objectContaining({
            content: Buffer.from("png"),
            contentId: "dashboard-report-snapshot",
          }),
        ],
      }),
    );
    const emailArgs = mocks.sendEmail.mock.calls[0]?.[0];
    expect(emailArgs.html).toContain("Edit subscription settings");
    expect(emailArgs.html).toContain("reportSettings=1");
    expect(emailArgs.text).toContain("reportSettings=1");
  });

  it("still sends the report email without a screenshot when browser capture fails", async () => {
    mocks.launch.mockRejectedValue(new Error("chromium died"));

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      recipientCount: 1,
      screenshotAttached: false,
      screenshotMode: "none",
      screenshotError: "chromium died",
    });
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "steve@builder.io",
        attachments: undefined,
        html: expect.stringContaining("dashboard image was unavailable"),
        text: expect.stringContaining("Dashboard image unavailable"),
      }),
    );
  });
});
