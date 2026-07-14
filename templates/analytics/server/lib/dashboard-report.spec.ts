import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chromiumArgs: ["--no-sandbox"],
  chromiumExecutablePath: vi.fn(),
  existsSync: vi.fn(),
  rm: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  sendEmail: vi.fn(),
  getReportDashboard: vi.fn(),
  launch: vi.fn(),
  launchPersistentContext: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
}));

vi.mock("node:fs/promises", () => ({
  rm: mocks.rm,
  readdir: mocks.readdir,
  stat: mocks.stat,
}));

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: () => "https://analytics.example.test",
  sendEmail: mocks.sendEmail,
  signEmbedSessionToken: () => "signed-embed-token",
}));

vi.mock("@agent-native/core/shared", () => ({
  EMBED_MODE_QUERY_PARAM: "__an_embed",
  EMBED_SESSION_COOKIE: "an_embed_session",
  EMBED_TOKEN_QUERY_PARAM: "__an_embed_token",
}));

vi.mock("./dashboard-report-subscriptions", () => ({
  getReportDashboard: mocks.getReportDashboard,
}));

vi.mock("playwright-core", () => ({
  chromium: {
    launch: mocks.launch,
    launchPersistentContext: mocks.launchPersistentContext,
  },
}));

vi.mock("@sparticuz/chromium-min", () => ({
  default: {
    args: mocks.chromiumArgs,
    executablePath: mocks.chromiumExecutablePath,
    setGraphicsMode: true,
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

function createBrowser(
  options: {
    waitForFails?: boolean;
    gotoError?: Error;
    captureBox?: { width: number; height: number };
    /** The diagnostics responsiveness probe (`page.evaluate("1")`) never resolves. */
    unresponsive?: boolean;
    pageUrl?: string;
  } = {},
) {
  const captureBox = options.captureBox ?? { width: 960, height: 1200 };
  const locator = {
    waitFor: vi.fn(async () => {
      if (options.waitForFails) {
        throw new Error("Target page, context or browser has been closed");
      }
    }),
    boundingBox: vi.fn(async () => captureBox),
    scrollIntoViewIfNeeded: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.from("png")),
  };
  const addCookies = vi.fn(async () => {});
  const page = {
    setDefaultTimeout: vi.fn(),
    emulateMedia: vi.fn(async () => {}),
    addInitScript: vi.fn(async () => {}),
    goto: vi.fn(async () => {
      if (options.gotoError) throw options.gotoError;
    }),
    locator: vi.fn(() => locator),
    waitForFunction: vi.fn(async () => {}),
    evaluate: vi.fn(async (script: string) => {
      if (options.unresponsive) return new Promise(() => {});
      if (typeof script === "string" && script.includes("document.title")) {
        return { title: "Mock Dashboard", bodyText: "Loading forever" };
      }
      return undefined;
    }),
    waitForTimeout: vi.fn(async () => {}),
    setViewportSize: vi.fn(async () => {}),
    url: vi.fn(
      () =>
        options.pageUrl ?? "https://analytics.example.test/dashboards/example",
    ),
    on: vi.fn(),
    context: vi.fn(() => ({ addCookies })),
  };
  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  return { browser, page, locator, addCookies };
}

describe("dashboard report email", () => {
  beforeEach(() => {
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", process.execPath);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.existsSync.mockReset();
    mocks.existsSync.mockImplementation(
      (candidate: string) => candidate === process.execPath,
    );
    mocks.rm.mockReset();
    mocks.rm.mockResolvedValue(undefined);
    mocks.readdir.mockReset();
    mocks.readdir.mockResolvedValue([]);
    mocks.stat.mockReset();
    mocks.chromiumExecutablePath.mockReset();
    mocks.chromiumExecutablePath.mockResolvedValue("/tmp/chromium");
    mocks.sendEmail.mockResolvedValue(undefined);
    mocks.getReportDashboard.mockResolvedValue(dashboard());
    mocks.launch.mockReset();
    mocks.launchPersistentContext.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mocks.sendEmail.mockReset();
    mocks.getReportDashboard.mockReset();
  });

  it("retries with a lightweight full dashboard screenshot when the first capture closes", async () => {
    const full = createBrowser({ waitForFails: true });
    const lightweight = createBrowser();
    mocks.launch
      .mockResolvedValueOnce(full.browser)
      .mockResolvedValueOnce(lightweight.browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      recipientCount: 1,
      screenshotAttached: true,
      screenshotMode: "full-lightweight",
    });
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(full.page.goto).toHaveBeenCalledWith(
      expect.not.stringContaining("reportPanelLimit"),
      expect.any(Object),
    );
    expect(lightweight.page.goto).toHaveBeenCalledWith(
      expect.stringContaining("reportPanelLimit=8"),
      expect.any(Object),
    );
    expect(lightweight.browser.newPage).toHaveBeenCalledWith({
      viewport: { width: 1200, height: 1400 },
      deviceScaleFactor: 1,
    });
    expect(lightweight.page.emulateMedia).toHaveBeenCalledWith({
      media: "screen",
      colorScheme: "light",
    });
    expect(lightweight.page.addInitScript).toHaveBeenCalledOnce();
    expect(lightweight.page.evaluate).toHaveBeenCalledWith(
      expect.stringContaining('root.style.zoom = "0.7"'),
    );
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
    expect(emailArgs.html).toContain("font-size:15px");
    expect(emailArgs.html).toContain("Here's your report of");
    expect(emailArgs.html).not.toContain("Here's the report of");
    expect(emailArgs.html).not.toContain("Change recipients");
    expect(emailArgs.html).toContain("Edit subscription settings");
    expect(emailArgs.html).toContain("reportSettings=1");
    expect(emailArgs.html).not.toContain("reportPanelLimit");
    expect(emailArgs.html).not.toContain("border:1px solid #e5e7eb");
    expect(emailArgs.html).toContain("border:0;outline:0;border-radius:0");
    expect(emailArgs.text).toContain("reportSettings=1");
  });

  it("pre-seeds the signed embed token as a session cookie before navigating", async () => {
    const full = createBrowser();
    mocks.launch.mockResolvedValueOnce(full.browser);

    await sendDashboardReportSubscription(subscription());

    expect(full.addCookies).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "an_embed_session",
        value: "signed-embed-token",
        url: "https://analytics.example.test/",
      }),
    ]);
    expect(full.addCookies.mock.invocationCallOrder[0]).toBeLessThan(
      full.page.goto.mock.invocationCallOrder[0],
    );
    // The query token remains too — the cookie is belt-and-braces, not a
    // replacement.
    expect(full.page.goto).toHaveBeenCalledWith(
      expect.stringContaining("__an_embed_token=signed-embed-token"),
      expect.any(Object),
    );
  });

  it("does not abort the capture when pre-seeding the embed cookie fails", async () => {
    const full = createBrowser();
    full.addCookies.mockRejectedValueOnce(new Error("context closed"));
    mocks.launch.mockResolvedValueOnce(full.browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      screenshotAttached: true,
      screenshotMode: "full",
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[dashboard-report] Failed to pre-seed embed session cookie:",
      expect.stringContaining("context closed"),
    );
  });

  it("captures tall dashboards without expanding the Chromium render surface", async () => {
    const tall = createBrowser({ captureBox: { width: 960, height: 8200 } });
    mocks.launch.mockResolvedValueOnce(tall.browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      recipientCount: 1,
      screenshotAttached: true,
      screenshotMode: "full",
    });
    expect(tall.page.setViewportSize).not.toHaveBeenCalled();
    expect(tall.locator.screenshot).toHaveBeenCalledWith({
      type: "png",
      animations: "disabled",
    });
  });

  it("only expands wide captures while preserving the bounded viewport height", async () => {
    const wide = createBrowser({ captureBox: { width: 1600, height: 8200 } });
    mocks.launch.mockResolvedValueOnce(wide.browser);

    await sendDashboardReportSubscription(subscription());

    expect(wide.page.setViewportSize).toHaveBeenCalledOnce();
    expect(wide.page.setViewportSize).toHaveBeenCalledWith({
      width: 1664,
      height: 1800,
    });
    expect(wide.locator.screenshot).toHaveBeenCalledOnce();
  });

  it("still sends the report email without a screenshot when browser capture fails", async () => {
    mocks.launch.mockRejectedValue(new Error("chromium died"));

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      recipientCount: 1,
      screenshotAttached: false,
      screenshotMode: "none",
      screenshotError: expect.stringContaining("chromium died"),
      emailsSent: true,
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

  it("skips sending the fallback email when skipEmailWithoutScreenshot is set", async () => {
    mocks.launch.mockRejectedValue(new Error("chromium died"));

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result).toMatchObject({
      recipientCount: 1,
      screenshotAttached: false,
      screenshotMode: "none",
      screenshotError: expect.stringContaining("chromium died"),
      emailsSent: false,
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("allows enough time for full serverless dashboards to become ready", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
    mocks.existsSync.mockReturnValue(false);
    const serverless = createBrowser();
    mocks.launchPersistentContext.mockResolvedValueOnce(serverless.browser);

    await sendDashboardReportSubscription(subscription());

    expect(serverless.page.setDefaultTimeout).toHaveBeenCalledWith(90_000);
    expect(serverless.page.waitForFunction).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      { timeout: 90_000 },
    );
    expect(mocks.chromiumExecutablePath).toHaveBeenCalledWith(
      "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar",
    );
    expect(mocks.launch).not.toHaveBeenCalled();
    const [profilePath, launchOptions] =
      mocks.launchPersistentContext.mock.calls[0];
    expect(profilePath).toMatch(/dashboard-report-playwright-/);
    expect(launchOptions.args).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^--user-data-dir=/)]),
    );
    expect(launchOptions).toMatchObject({
      deviceScaleFactor: 1,
      viewport: { width: 1440, height: 1800 },
    });
    expect(serverless.browser.newPage).toHaveBeenCalledWith();
    expect(mocks.rm).toHaveBeenCalledWith(profilePath, {
      recursive: true,
      force: true,
    });
  });

  it("cleans each serverless Chromium profile when browser launch fails", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
    mocks.existsSync.mockReturnValue(false);
    mocks.launchPersistentContext.mockRejectedValue(
      new Error("socket unavailable"),
    );

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      screenshotAttached: false,
      screenshotMode: "none",
      screenshotError: expect.stringContaining("socket unavailable"),
    });
    expect(mocks.rm).toHaveBeenCalledTimes(2);
    const profilePaths = mocks.rm.mock.calls.map(([path]) => path);
    expect(new Set(profilePaths).size).toBe(2);
    expect(profilePaths).toEqual([
      expect.stringContaining("dashboard-report-playwright-"),
      expect.stringContaining("dashboard-report-playwright-"),
    ]);
  });

  it("closes a serverless browser that finishes launching after the attempt timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("NETLIFY", "true");
      vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
      mocks.existsSync.mockReturnValue(false);
      const late = createBrowser();
      let resolveLateLaunch!: (browser: typeof late.browser) => void;
      mocks.launchPersistentContext
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveLateLaunch = resolve;
            }),
        )
        .mockRejectedValueOnce(new Error("lightweight launch failed"));

      const sendPromise = sendDashboardReportSubscription(subscription());
      await vi.advanceTimersByTimeAsync(125_000);
      const result = await sendPromise;

      expect(result).toMatchObject({
        screenshotAttached: false,
        screenshotMode: "none",
        screenshotError: expect.stringContaining(
          "full capture exceeded 125000ms while launching the screenshot browser",
        ),
      });
      resolveLateLaunch(late.browser);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(late.browser.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweeps stale Chromium profiles before launching in serverless runtimes", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
    mocks.existsSync.mockReturnValue(false);
    mocks.readdir.mockResolvedValue([
      "dashboard-report-playwright-old",
      "dashboard-report-playwright-new",
      "unrelated-dir",
    ]);
    mocks.stat.mockImplementation(async (path: string) => {
      if (path.endsWith("dashboard-report-playwright-old")) {
        return { mtimeMs: Date.now() - 31 * 60_000 };
      }
      return { mtimeMs: Date.now() };
    });
    const serverless = createBrowser();
    mocks.launchPersistentContext.mockResolvedValueOnce(serverless.browser);

    await sendDashboardReportSubscription(subscription());

    const oldPath = join(tmpdir(), "dashboard-report-playwright-old");
    const newPath = join(tmpdir(), "dashboard-report-playwright-new");
    const unrelatedPath = join(tmpdir(), "unrelated-dir");
    expect(mocks.rm).toHaveBeenCalledWith(oldPath, {
      recursive: true,
      force: true,
    });
    expect(mocks.rm).not.toHaveBeenCalledWith(newPath, expect.anything());
    expect(mocks.rm).not.toHaveBeenCalledWith(unrelatedPath, expect.anything());
  });

  it("redacts embed tokens from screenshot errors", async () => {
    const navigationError = new Error(
      "page.goto failed at https://analytics.example.test/dashboards/example?__an_embed_token=example-signed-token&embedded=1",
    );
    const first = createBrowser({ gotoError: navigationError });
    const second = createBrowser({ gotoError: navigationError });
    mocks.launch
      .mockResolvedValueOnce(first.browser)
      .mockResolvedValueOnce(second.browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result.screenshotError).toContain(
      "__an_embed_token=[REDACTED]&embedded=1",
    );
    expect(result.screenshotError).not.toContain("example-signed-token");
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("example-signed-token"),
    );
  });

  it("records page diagnostics when the report surface never becomes visible", async () => {
    const stuck = createBrowser({
      waitForFails: true,
      pageUrl:
        "https://analytics.example.test/dashboards/example?__an_embed_token=super-secret-token&embedded=1",
    });
    const fallback = createBrowser({ waitForFails: true });
    mocks.launch
      .mockResolvedValueOnce(stuck.browser)
      .mockResolvedValueOnce(fallback.browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      screenshotAttached: false,
      screenshotMode: "none",
    });
    expect(result.screenshotError).toContain("page state:");
    expect(result.screenshotError).toContain("Mock Dashboard");
    expect(result.screenshotError).toContain("Loading forever");
    expect(result.screenshotError).toContain("__an_embed_token=[REDACTED]");
    expect(result.screenshotError).not.toContain("super-secret-token");
  });

  it("reports the page as unresponsive when the diagnostics probe hangs", async () => {
    vi.useFakeTimers();
    try {
      const stuck = createBrowser({ waitForFails: true, unresponsive: true });
      const fallback = createBrowser({
        waitForFails: true,
        unresponsive: true,
      });
      mocks.launch
        .mockResolvedValueOnce(stuck.browser)
        .mockResolvedValueOnce(fallback.browser);

      const sendPromise = sendDashboardReportSubscription(subscription());
      // One diagnostics probe timeout (2s) per failed attempt.
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await sendPromise;

      expect(result).toMatchObject({
        screenshotAttached: false,
        screenshotMode: "none",
      });
      expect(result.screenshotError).toContain(
        "page unresponsive (renderer hung or crashed)",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails before sending when the caller requires a screenshot", async () => {
    mocks.launch.mockRejectedValue(new Error("chromium died"));

    await expect(
      sendDashboardReportSubscription(subscription(), {
        requireScreenshot: true,
      }),
    ).rejects.toThrow(
      "Dashboard screenshot unavailable: full: launching the screenshot browser: chromium died",
    );

    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
