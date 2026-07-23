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
  MAX_DASHBOARD_REPORT_RECIPIENTS: 5,
  normalizeDashboardReportRecipients: (recipients: string[]) => {
    const normalized = [
      ...new Set(
        recipients.map((email) => email.trim().toLowerCase()).filter(Boolean),
      ),
    ];
    if (normalized.length === 0)
      throw new Error("At least one recipient is required");
    if (normalized.length > 5)
      throw new Error("Dashboard reports support at most 5 recipients");
    return normalized;
  },
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
    loadingPanels?: Array<{ id: string; title: string }>;
    consoleErrors?: string[];
    requestFailures?: string[];
    responseFailures?: Array<{ url: string; status: number }>;
    unresponsive?: boolean;
    blockReadyWait?: boolean;
  } = {},
) {
  let rejectBlockedReadyWait: ((error: Error) => void) | undefined;
  let resolveReadyWaitStarted: (() => void) | undefined;
  const readyWaitStarted = new Promise<void>((resolve) => {
    resolveReadyWaitStarted = resolve;
  });
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
  const listeners = new Map<string, (value: any) => void>();
  return {
    page: {
      close: vi.fn(async () => {}),
      setDefaultTimeout: vi.fn(),
      emulateMedia: vi.fn(async () => {}),
      addInitScript: vi.fn(async () => {}),
      goto: vi.fn(async (_url: string, _options: unknown) => {
        for (const text of options.consoleErrors ?? []) {
          listeners.get("console")?.({
            type: () => "error",
            text: () => text,
          });
        }
        for (const errorText of options.requestFailures ?? []) {
          listeners.get("requestfailed")?.({
            method: () => "POST",
            url: () =>
              "https://analytics.example.test/_agent-native/actions/query-dashboard-panel",
            failure: () => ({ errorText }),
          });
        }
        for (const failure of options.responseFailures ?? []) {
          listeners.get("response")?.({
            status: () => failure.status,
            url: () => failure.url,
            request: () => ({ method: () => "POST" }),
          });
        }
        if (options.gotoError) throw options.gotoError;
      }),
      locator: vi.fn(() => locator),
      waitForFunction: vi.fn(async () => {
        if (options.blockReadyWait) {
          resolveReadyWaitStarted?.();
          await new Promise<never>((_, reject) => {
            rejectBlockedReadyWait = reject;
          });
        }
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
            loadingPanels: options.loadingPanels ?? [],
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
      on: vi.fn((event: string, listener: (value: any) => void) => {
        listeners.set(event, listener);
      }),
      context: vi.fn(() => ({ addCookies })),
    },
    locator,
    addCookies,
    readyWaitStarted,
    rejectBlockedReadyWait: (error: Error) => rejectBlockedReadyWait?.(error),
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
    const pages = Array.from({ length: 10 }, (_, index) =>
      createPage({
        screenshot: Buffer.from(`image-${index + 1}`),
        renderedPanelIds: ids.slice(index * 4, (index + 1) * 4),
      }),
    );
    const { browser } = createBrowser([...pages]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      screenshotAttached: true,
      screenshotMode: "full",
    });
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(browser.newPage).toHaveBeenCalledTimes(10);
    for (const page of pages) expect(page.page.close).toHaveBeenCalledOnce();
    const urls = pages.map((entry) => entry.page.goto.mock.calls[0]?.[0]);
    expect(urls).toEqual([
      expect.stringContaining("reportPanelOffset=0"),
      expect.stringContaining("reportPanelOffset=4"),
      expect.stringContaining("reportPanelOffset=8"),
      expect.stringContaining("reportPanelOffset=12"),
      expect.stringContaining("reportPanelOffset=16"),
      expect.stringContaining("reportPanelOffset=20"),
      expect.stringContaining("reportPanelOffset=24"),
      expect.stringContaining("reportPanelOffset=28"),
      expect.stringContaining("reportPanelOffset=32"),
      expect.stringContaining("reportPanelOffset=36"),
    ]);
    expect(
      urls.every((url) => (url ?? "").includes("reportPanelLimit=4")),
    ).toBe(true);
    const email = mocks.sendEmail.mock.calls[0]?.[0];
    expect(email.timeoutMs).toBe(12_000);
    expect(
      email.attachments.map(
        (attachment: { content: Buffer }) => attachment.content,
      ),
    ).toEqual(pages.map((_page, index) => Buffer.from(`image-${index + 1}`)));
    expect(
      email.attachments.map(
        (attachment: { contentId: string }) => attachment.contentId,
      ),
    ).toEqual(
      pages.map((_page, index) => `dashboard-report-snapshot-${index + 1}`),
    );
    for (let index = 1; index <= 10; index++) {
      expect(email.html).toContain(`cid:dashboard-report-snapshot-${index}`);
    }
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

  it("gives eight panels two independent four-query serverless readiness windows", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
    mocks.existsSync.mockReturnValue(false);
    mocks.getReportDashboard.mockResolvedValue(dashboard(8));
    const first = createPage({
      renderedPanelIds: ["panel-0", "panel-1", "panel-2", "panel-3"],
    });
    const second = createPage({
      renderedPanelIds: ["panel-4", "panel-5", "panel-6", "panel-7"],
    });
    const { browser } = createBrowser([first, second]);
    mocks.launchPersistentContext.mockResolvedValue(browser);

    await sendDashboardReportSubscription(subscription());

    expect(browser.newPage).toHaveBeenCalledTimes(2);
    for (const page of [first, second]) {
      expect(page.page.waitForFunction).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        undefined,
        { timeout: 45_000 },
      );
      expect(page.page.goto).toHaveBeenCalledWith(
        expect.stringContaining("reportPanelLimit=4"),
        expect.any(Object),
      );
    }
  });

  it("delivers once to a repeated recipient and reports the normalized count", async () => {
    const page = createPage();
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);
    const repeated = {
      ...subscription(),
      recipients: ["STEVE@builder.io", " steve@builder.io "],
    };

    const result = await sendDashboardReportSubscription(repeated);

    expect(result.recipientCount).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "steve@builder.io" }),
    );
  });

  it("does not send completed chunks while a retry still requires a complete capture", async () => {
    mocks.getReportDashboard.mockResolvedValue(dashboard(8));
    const first = createPage({
      renderedPanelIds: Array.from(
        { length: 4 },
        (_, index) => `panel-${index}`,
      ),
    });
    const failed = createPage({
      waitForFails: true,
      renderedPanelIds: ["panel-4", "panel-5", "panel-6", "panel-7"],
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
    expect(first.locator.screenshot).toHaveBeenCalledOnce();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(first.page.close).toHaveBeenCalledOnce();
    expect(failed.page.close).toHaveBeenCalledOnce();
  });

  it("does not let a partial capture satisfy requireScreenshot", async () => {
    mocks.getReportDashboard.mockResolvedValue(dashboard(8));
    const first = createPage({
      renderedPanelIds: Array.from(
        { length: 4 },
        (_, index) => `panel-${index}`,
      ),
    });
    const failed = createPage({
      waitForFails: true,
      renderedPanelIds: ["panel-4", "panel-5", "panel-6", "panel-7"],
    });
    const { browser } = createBrowser([first, failed]);
    mocks.launch.mockResolvedValue(browser);

    await expect(
      sendDashboardReportSubscription(subscription(), {
        requireScreenshot: true,
      }),
    ).rejects.toThrow("Dashboard screenshot unavailable");

    expect(first.locator.screenshot).toHaveBeenCalledOnce();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", []],
    [
      "too many",
      Array.from({ length: 6 }, (_, index) => `person-${index}@example.com`),
    ],
  ] as const)(
    "rejects a legacy subscription with %s recipients before collection, capture, or delivery",
    async (_label, recipients) => {
      const legacy = { ...subscription(), recipients: [...recipients] };

      await expect(
        sendDashboardReportSubscription(legacy, {
          skipEmailWithoutScreenshot: true,
        }),
      ).rejects.toThrow(/recipient|required|maximum/i);

      expect(mocks.getReportDashboard).not.toHaveBeenCalled();
      expect(mocks.launch).not.toHaveBeenCalled();
      expect(mocks.launchPersistentContext).not.toHaveBeenCalled();
      expect(mocks.sendEmail).not.toHaveBeenCalled();
    },
  );

  it("fails before browser launch when a complete dashboard needs more than ten chunks", async () => {
    mocks.getReportDashboard.mockResolvedValue(dashboard(41));

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result).toMatchObject({
      screenshotAttached: false,
      emailsSent: false,
      screenshotError: expect.stringContaining(
        "complete dashboard requires 11 image chunks",
      ),
    });
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.launchPersistentContext).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("discards an oversized complete capture without emailing its images", async () => {
    const page = createPage({
      screenshot: Buffer.alloc(14 * 1024 * 1024 + 1),
    });
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result).toMatchObject({
      screenshotAttached: false,
      emailsSent: false,
      screenshotError: expect.stringContaining(
        "complete dashboard images total",
      ),
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("discards every chunk when a later panel window no longer matches the dashboard snapshot", async () => {
    mocks.getReportDashboard.mockResolvedValue(dashboard(8));
    const first = createPage({
      renderedPanelIds: Array.from(
        { length: 4 },
        (_, index) => `panel-${index}`,
      ),
    });
    const changed = createPage({ renderedPanelIds: [] });
    const { browser } = createBrowser([first, changed]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      screenshotAttached: false,
      screenshotMode: "none",
      emailsSent: true,
      screenshotError: expect.stringContaining(
        'report chunk panel mismatch; expected=["panel-4","panel-5","panel-6","panel-7"] actual=[]',
      ),
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: undefined,
        html: expect.not.stringContaining("dashboard-report-snapshot-1"),
      }),
    );
    expect(first.page.close).toHaveBeenCalledOnce();
    expect(changed.page.close).toHaveBeenCalledOnce();
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
    mocks.getReportDashboard.mockResolvedValue(dashboard(8));
    const first = createPage({
      renderedPanelIds: Array.from(
        { length: 4 },
        (_, index) => `panel-${index}`,
      ),
    });
    const second = createPage({
      renderedPanelIds: ["panel-4", "panel-5", "panel-6", "panel-7"],
    });
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

  it("continues when pre-seeding the signed embed cookie fails", async () => {
    const page = createPage({ cookieError: new Error("context closed") });
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription());

    expect(result).toMatchObject({
      screenshotAttached: true,
      screenshotMode: "full",
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[dashboard-report] Failed to pre-seed embed session cookie:",
      "context closed",
    );
  });

  it("expands wide captures while preserving the bounded viewport height", async () => {
    const page = createPage({ captureBox: { width: 1600, height: 8200 } });
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    await sendDashboardReportSubscription(subscription());

    expect(page.page.setViewportSize).toHaveBeenCalledWith({
      width: 1664,
      height: 1400,
    });
    expect(page.locator.screenshot).toHaveBeenCalledOnce();
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
    vi.stubEnv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "1024");
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
    expect(result.screenshotError).toContain("lambdaMemoryMb=1024");
  });

  it("reports a renderer hang when the diagnostics probe cannot respond", async () => {
    vi.useFakeTimers();
    try {
      const page = createPage({ waitForFails: true, unresponsive: true });
      const { browser } = createBrowser([page]);
      mocks.launch.mockResolvedValue(browser);

      const capture = sendDashboardReportSubscription(subscription(), {
        skipEmailWithoutScreenshot: true,
      });
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await capture;

      expect(result.screenshotError).toContain(
        "page unresponsive (renderer hung or crashed)",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains the final diagnostic marker beyond the old 400-character limit", async () => {
    const marker = "final-stage-marker";
    const page = createPage({
      gotoError: new Error(`${"x".repeat(700)} ${marker}`),
    });
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result.screenshotError).toContain(marker);
    expect(result.screenshotError!.length).toBeGreaterThan(400);
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

  it("identifies the exact report panels still loading when a chunk times out", async () => {
    const page = createPage({
      readyWaitFails: true,
      loadingPanels: [
        { id: "retention-by-cohort", title: "Retention by cohort" },
        { id: "top-countries", title: "Top countries" },
      ],
    });
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result.screenshotError).toContain('"id":"retention-by-cohort"');
    expect(result.screenshotError).toContain('"title":"Retention by cohort"');
    expect(result.screenshotError).toContain('"id":"top-countries"');
    expect(page.page.evaluate).toHaveBeenCalledWith(
      expect.stringContaining("data-dashboard-report-panel-title"),
    );
  });

  it("includes collected console and action HTTP failures when a chunk times out", async () => {
    const page = createPage({
      readyWaitFails: true,
      consoleErrors: ["panel query exceeded its report timeout"],
      requestFailures: ["net::ERR_ABORTED"],
      responseFailures: [
        {
          url: "https://analytics.example.test/_agent-native/actions/query-dashboard-panel",
          status: 500,
        },
      ],
    });
    const { browser } = createBrowser([page]);
    mocks.launch.mockResolvedValue(browser);

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result.screenshotError).toContain(
      "panel query exceeded its report timeout",
    );
    expect(result.screenshotError).toContain("net::ERR_ABORTED");
    expect(result.screenshotError).toContain("HTTP 500");
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

  it("uses the pinned Chromium pack and bounded chunk timeouts in serverless runtimes", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
    mocks.existsSync.mockReturnValue(false);
    const page = createPage();
    const { browser } = createBrowser([page]);
    mocks.launchPersistentContext.mockResolvedValue(browser);

    await sendDashboardReportSubscription(subscription());

    expect(page.page.setDefaultTimeout).toHaveBeenCalledWith(90_000);
    expect(page.page.waitForFunction).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      undefined,
      { timeout: 45_000 },
    );
    expect(page.page.waitForFunction).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      undefined,
      { timeout: 15_000 },
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
      viewport: { width: 1200, height: 1400 },
    });
    expect(browser.newPage).toHaveBeenCalledWith();
  });

  it("cleans the generated serverless profile when Chromium launch fails", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
    mocks.existsSync.mockReturnValue(false);
    mocks.launchPersistentContext.mockRejectedValue(
      new Error("socket unavailable"),
    );

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWithoutScreenshot: true,
    });

    expect(result).toMatchObject({
      screenshotAttached: false,
      emailsSent: false,
      screenshotError: expect.stringContaining("socket unavailable"),
    });
    expect(mocks.rm).toHaveBeenCalledOnce();
    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining("dashboard-report-playwright-"),
      { recursive: true, force: true },
    );
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

  it("sends completed chunks and labels the unavailable part on the final serverless sweep", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("NETLIFY", "true");
      vi.stubEnv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "1024");
      vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
      mocks.existsSync.mockReturnValue(false);
      mocks.getReportDashboard.mockResolvedValue(dashboard(8));
      const first = createPage({
        screenshot: Buffer.from("first"),
        renderedPanelIds: Array.from(
          { length: 4 },
          (_, index) => `panel-${index}`,
        ),
      });
      const second = createPage({
        blockReadyWait: true,
        renderedPanelIds: ["panel-4", "panel-5", "panel-6", "panel-7"],
      });
      const { browser } = createBrowser([first, second]);
      browser.close.mockImplementation(async () => {
        second.rejectBlockedReadyWait(
          new Error("Target page, context or browser has been closed"),
        );
      });
      mocks.launchPersistentContext.mockResolvedValue(browser);

      const capture = sendDashboardReportSubscription(subscription());
      await second.readyWaitStarted;
      await vi.advanceTimersByTimeAsync(180_000);
      const result = await capture;

      expect(first.locator.screenshot).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        screenshotAttached: true,
        screenshotMode: "partial",
        emailsSent: true,
        screenshotError: expect.stringContaining("lambdaMemoryMb=1024"),
      });
      expect(result.screenshotError).toContain("capture exceeded 180000ms");
      expect(mocks.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              content: Buffer.from("first"),
              contentId: "dashboard-report-snapshot-1",
            }),
          ],
          html: expect.stringContaining(
            "Dashboard image part 2 was unavailable for this run.",
          ),
          text: expect.stringContaining(
            "Dashboard image part 2 unavailable for this run.",
          ),
        }),
      );
      expect(first.page.close).toHaveBeenCalledOnce();
      expect(second.page.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
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
      await vi.advanceTimersByTimeAsync(180_000);
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

  it("throws before email delivery when the caller requires a screenshot", async () => {
    mocks.launch.mockRejectedValue(new Error("chromium died"));

    await expect(
      sendDashboardReportSubscription(subscription(), {
        requireScreenshot: true,
      }),
    ).rejects.toThrow(
      "Dashboard screenshot unavailable: chunked: chromium died",
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
