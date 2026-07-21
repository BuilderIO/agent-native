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

vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));
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
    filters: { f_timeRange: "30d" },
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

function panel(id: string, chartType = "metric") {
  return {
    id,
    title: id,
    sql: "select 1",
    source: "demo",
    chartType,
    width: 1,
  };
}

function dashboard(panelCount = 1) {
  return {
    id: "agent-native-templates-first-party",
    title: "Agent Native Templates (First-party)",
    config: {
      name: "Agent Native Templates (First-party)",
      description: "Daily template dashboard",
      filters: [],
      panels: Array.from({ length: panelCount }, (_, index) =>
        panel(`panel-${index}`),
      ),
    },
  };
}

function createPage(
  options: {
    waitForFails?: boolean;
    readyWaitFails?: boolean;
    screenshot?: Buffer;
    pageUrl?: string;
    gotoError?: Error;
    cookieError?: Error;
    captureBox?: { width: number; height: number };
    renderedPanelIds?: string[];
    unresponsive?: boolean;
  } = {},
) {
  const locator = {
    waitFor: vi.fn(async () => {
      if (options.waitForFails)
        throw new Error("Target page, context or browser has been closed");
    }),
    boundingBox: vi.fn(
      async () => options.captureBox ?? { width: 960, height: 1200 },
    ),
    scrollIntoViewIfNeeded: vi.fn(async () => {}),
    screenshot: vi.fn(async () => options.screenshot ?? Buffer.from("png")),
  };
  const addCookies = vi.fn(async () => {
    if (options.cookieError) throw options.cookieError;
  });
  return {
    page: {
      close: vi.fn(async () => {}),
      setDefaultTimeout: vi.fn(),
      emulateMedia: vi.fn(async () => {}),
      addInitScript: vi.fn(async () => {}),
      goto: vi.fn(async (_url: string, _options: unknown) => {
        if (options.gotoError) throw options.gotoError;
      }),
      locator: vi.fn(() => locator),
      waitForFunction: vi.fn(async () => {
        if (options.readyWaitFails) {
          throw new Error("dashboard panels did not finish loading");
        }
      }),
      evaluate: vi.fn(async (script: string) => {
        if (options.unresponsive && script === "1") {
          return new Promise(() => {});
        }
        if (script.includes("data-dashboard-report-panel-ids")) {
          return JSON.stringify(options.renderedPanelIds ?? ["panel-0"]);
        }
        if (script.includes("data-dashboard-report-ready")) {
          return {
            ready: "true",
            loadingCount: 1,
            text: "Dashboard still loading",
            url:
              options.pageUrl ??
              "https://analytics.example.test/dashboards/example",
          };
        }
        if (script.includes("document.title")) {
          return { title: "Mock Dashboard", bodyText: "Loading forever" };
        }
        return undefined;
      }),
      waitForTimeout: vi.fn(async () => {}),
      setViewportSize: vi.fn(async () => {}),
      url: vi.fn(
        () =>
          options.pageUrl ??
          "https://analytics.example.test/dashboards/example",
      ),
      on: vi.fn(),
      context: vi.fn(() => ({ addCookies })),
    },
    locator,
    addCookies,
  };
}

function createBrowser(pages: ReturnType<typeof createPage>[]) {
  const browser = {
    newPage: vi.fn(async () => {
      const next = pages.shift();
      if (!next) throw new Error("unexpected additional screenshot page");
      return next.page;
    }),
    close: vi.fn(async () => {}),
  };
  return { browser, pages };
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
    mocks.stat.mockResolvedValue(null);
    mocks.chromiumExecutablePath.mockReset();
    mocks.chromiumExecutablePath.mockResolvedValue("/tmp/chromium");
    mocks.sendEmail.mockReset();
    mocks.sendEmail.mockResolvedValue(undefined);
    mocks.getReportDashboard.mockReset();
    mocks.getReportDashboard.mockResolvedValue(dashboard());
    mocks.launch.mockReset();
    mocks.launchPersistentContext.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("captures every chunk in one browser, closes each page, and attaches CID images in order", async () => {
    mocks.getReportDashboard.mockResolvedValue(dashboard(39));
    const ids = Array.from({ length: 39 }, (_, index) => `panel-${index}`);
    const first = createPage({
      screenshot: Buffer.from("first"),
      renderedPanelIds: ids.slice(0, 8),
    });
    const second = createPage({
      screenshot: Buffer.from("second"),
      renderedPanelIds: ids.slice(8, 16),
    });
    const third = createPage({
      screenshot: Buffer.from("third"),
      renderedPanelIds: ids.slice(16, 24),
    });
    const fourth = createPage({
      screenshot: Buffer.from("fourth"),
      renderedPanelIds: ids.slice(24, 32),
    });
    const fifth = createPage({
      screenshot: Buffer.from("fifth"),
      renderedPanelIds: ids.slice(32),
    });
    const { browser } = createBrowser([first, second, third, fourth, fifth]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      screenshotAttached: true,
      screenshotMode: "full",
    });
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(browser.newPage).toHaveBeenCalledTimes(5);
    for (const page of [first, second, third, fourth, fifth])
      expect(page.page.close).toHaveBeenCalledOnce();
    const urls = [first, second, third, fourth, fifth].map(
      (entry) => entry.page.goto.mock.calls[0]?.[0],
    );
    expect(urls).toEqual([
      expect.stringContaining("reportPanelOffset=0"),
      expect.stringContaining("reportPanelOffset=8"),
      expect.stringContaining("reportPanelOffset=16"),
      expect.stringContaining("reportPanelOffset=24"),
      expect.stringContaining("reportPanelOffset=32"),
    ]);
    expect(
      urls.every((url) => (url ?? "").includes("reportPanelLimit=8")),
    ).toBe(true);
    const email = mocks.sendEmail.mock.calls[0]?.[0];
    expect(
      email.attachments.map(
        (attachment: { content: Buffer }) => attachment.content,
      ),
    ).toEqual([
      Buffer.from("first"),
      Buffer.from("second"),
      Buffer.from("third"),
      Buffer.from("fourth"),
      Buffer.from("fifth"),
    ]);
    expect(
      email.attachments.map(
        (attachment: { contentId: string }) => attachment.contentId,
      ),
    ).toEqual([
      "dashboard-report-snapshot-1",
      "dashboard-report-snapshot-2",
      "dashboard-report-snapshot-3",
      "dashboard-report-snapshot-4",
      "dashboard-report-snapshot-5",
    ]);
    expect(email.html).toContain("cid:dashboard-report-snapshot-1");
    expect(email.html).toContain("cid:dashboard-report-snapshot-2");
    expect(email.html).toContain("cid:dashboard-report-snapshot-3");
    expect(email.html).toContain("cid:dashboard-report-snapshot-4");
    expect(email.html).toContain("cid:dashboard-report-snapshot-5");
  });

  it("keeps a single chunk dashboard as one inline image", async () => {
    const page = createPage();
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    await sendDashboardReportSubscription(subscription());

    const email = mocks.sendEmail.mock.calls[0]?.[0];
    expect(browser.newPage).toHaveBeenCalledOnce();
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0].contentId).toBe("dashboard-report-snapshot-1");
    expect(email.html).not.toContain("limited fallback");
  });

  it("fails the entire screenshot when any chunk fails and never sends partial images", async () => {
    mocks.getReportDashboard.mockResolvedValue(dashboard(9));
    const first = createPage({
      renderedPanelIds: Array.from(
        { length: 8 },
        (_, index) => `panel-${index}`,
      ),
    });
    const failed = createPage({
      waitForFails: true,
      renderedPanelIds: ["panel-8"],
    });
    const { browser } = createBrowser([first, failed]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result).toMatchObject({
      screenshotAttached: false,
      emailsSent: false,
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(first.page.close).toHaveBeenCalledOnce();
    expect(failed.page.close).toHaveBeenCalledOnce();
  });

  it("sends the link-only email only when the caller permits it after the complete attempt fails", async () => {
    const failed = createPage({ waitForFails: true });
    const { browser } = createBrowser([failed]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      screenshotAttached: false,
      screenshotMode: "none",
      emailsSent: true,
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: undefined }),
    );
  });

  it("pre-seeds each chunk's signed embed token before navigation", async () => {
    mocks.getReportDashboard.mockResolvedValue(dashboard(9));
    const first = createPage({
      renderedPanelIds: Array.from(
        { length: 8 },
        (_, index) => `panel-${index}`,
      ),
    });
    const second = createPage({ renderedPanelIds: ["panel-8"] });
    const { browser } = createBrowser([first, second]);
    mocks.launch.mockResolvedValue(browser);

    await sendDashboardReportSubscription(subscription());

    for (const entry of [first, second]) {
      expect(entry.addCookies.mock.invocationCallOrder[0]).toBeLessThan(
        entry.page.goto.mock.invocationCallOrder[0],
      );
      expect(entry.page.goto).toHaveBeenCalledWith(
        expect.stringContaining("__an_embed_token=signed-embed-token"),
        expect.any(Object),
      );
    }
  });

  it("redacts embed tokens from complete-capture failures", async () => {
    const page = createPage();
    page.page.goto.mockRejectedValueOnce(
      new Error("failed at ?__an_embed_token=secret-token&embedded=1"),
    );
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result.screenshotError).toContain(
      "__an_embed_token=[REDACTED]&embedded=1",
    );
    expect(result.screenshotError).not.toContain("secret-token");
  });

  it("records redacted page diagnostics when a report chunk never becomes visible", async () => {
    const page = createPage({
      waitForFails: true,
      pageUrl:
        "https://analytics.example.test/dashboards/example?__an_embed_token=secret-token&embedded=1",
    });
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result.screenshotError).toContain("page state:");
    expect(result.screenshotError).toContain("Mock Dashboard");
    expect(result.screenshotError).toContain("__an_embed_token=[REDACTED]");
    expect(result.screenshotError).not.toContain("secret-token");
  });

  it("treats a partially loaded chunk as a complete-capture failure", async () => {
    const page = createPage({ readyWaitFails: true });
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result).toMatchObject({
      screenshotAttached: false,
      emailsSent: false,
    });
    expect(page.locator.screenshot).not.toHaveBeenCalled();
  });

  it("bounds serverless cleanup after a completed capture", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
    mocks.existsSync.mockReturnValue(false);
    const page = createPage();
    const { browser } = createBrowser([page]);
    mocks.launchPersistentContext.mockResolvedValue(browser);

    await sendDashboardReportSubscription(subscription());

    const [profilePath] = mocks.launchPersistentContext.mock.calls[0];
    expect(profilePath).toMatch(/dashboard-report-playwright-/);
    expect(browser.close).toHaveBeenCalledOnce();
    expect(mocks.rm).toHaveBeenCalledWith(profilePath, {
      recursive: true,
      force: true,
    });
  });

  it("cleans stale serverless Chromium profiles before launching", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
    mocks.existsSync.mockReturnValue(false);
    mocks.readdir.mockResolvedValue(["dashboard-report-playwright-old"]);
    mocks.stat.mockResolvedValue({ mtimeMs: Date.now() - 31 * 60_000 });
    const page = createPage();
    const { browser } = createBrowser([page]);
    mocks.launchPersistentContext.mockResolvedValue(browser);

    await sendDashboardReportSubscription(subscription());

    expect(mocks.rm).toHaveBeenCalledWith(
      join(tmpdir(), "dashboard-report-playwright-old"),
      {
        recursive: true,
        force: true,
      },
    );
  });

  it("closes a browser that finishes launching after the serverless capture deadline", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("NETLIFY", "true");
      vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
      mocks.existsSync.mockReturnValue(false);
      const latePage = createPage();
      const { browser: lateBrowser } = createBrowser([latePage]);
      let resolveLateLaunch!: (value: typeof lateBrowser) => void;
      mocks.launchPersistentContext.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLateLaunch = resolve;
          }),
      );

      const capture = sendDashboardReportSubscription(subscription(), {
        skipEmailWithoutScreenshot: true,
      });
      await vi.advanceTimersByTimeAsync(240_000);
      const result = await capture;
      resolveLateLaunch(lateBrowser);
      await Promise.resolve();
      await Promise.resolve();

      expect(result).toMatchObject({
        screenshotAttached: false,
        emailsSent: false,
      });
      expect(lateBrowser.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
