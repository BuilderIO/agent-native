import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DashboardFilter,
  SqlPanel,
} from "../../app/pages/adhoc/sql-dashboard/types";
import type {
  RenderedReportEmail,
  ReportPanelData,
  ReportSnapshot,
} from "./dashboard-report-render";
import type {
  AccessCtx,
  DashboardReportSubscription,
} from "./dashboard-report-subscriptions";

type ReportDashboardRecord = {
  id: string;
  title: string;
  config: Record<string, unknown>;
};

type PanelDataMap = Map<string, ReportPanelData>;

type FetchPanelDataArgs = {
  ownerEmail: string;
  orgId?: string | null;
  snapshot: ReportSnapshot;
  perPanelTimeoutMs?: number;
  deadlineAt?: number;
};

type RenderEmailArgs = { snapshot: ReportSnapshot; panelData: PanelDataMap };

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  timeoutMs: number;
  attachments?: RenderedReportEmail["attachments"];
};

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_payload: unknown) => {}),
  getAppProductionUrl: vi.fn(() => "https://analytics.example.test"),
  getReportDashboard: vi.fn(
    async (
      _dashboardId: string,
      _ctx: AccessCtx,
    ): Promise<ReportDashboardRecord | null> => null,
  ),
  fetchReportPanelData: vi.fn(
    async (_args: FetchPanelDataArgs): Promise<PanelDataMap> => new Map(),
  ),
  renderReportEmail: vi.fn(
    async (_args: RenderEmailArgs): Promise<RenderedReportEmail> => ({
      html: "",
      text: "",
      attachments: [],
      degradedPanelIds: [],
    }),
  ),
}));

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: mocks.getAppProductionUrl,
  sendEmail: mocks.sendEmail,
}));
vi.mock("./dashboard-report-render", () => ({
  fetchReportPanelData: mocks.fetchReportPanelData,
  renderReportEmail: mocks.renderReportEmail,
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

import {
  collectReportSnapshot,
  sendDashboardReportSubscription,
} from "./dashboard-report";

const EMAIL_TIMEOUT_MS = 10_000;
const EMAIL_OVERHEAD_RESERVE_MS = 5_000;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function subscription(): DashboardReportSubscription {
  return {
    id: "sub_1",
    dashboardId: "dash_1",
    name: "Growth daily email",
    recipients: ["steve@builder.io"],
    filters: { f_timeRange: "30d" },
    frequency: "daily",
    timeOfDay: "03:00",
    timezone: "America/Los_Angeles",
    enabled: true,
    nextRunAt: "2026-07-26T10:00:00.000Z",
    lastRunAt: "2026-07-26T10:00:00.000Z",
    lastStatus: "running",
    lastError: null,
    lastCaptureAt: null,
    lastCaptureMode: null,
    lastCaptureError: null,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    ownerEmail: "steve@builder.io",
    orgId: "org_1",
  };
}

function panel(id: string, overrides: Partial<SqlPanel> = {}): SqlPanel {
  return {
    id,
    title: `Panel ${id}`,
    sql: "select 1",
    source: "first-party",
    chartType: "metric",
    width: 1,
    ...overrides,
  };
}

function dashboardWith(
  panels: SqlPanel[],
  filters: DashboardFilter[] = [],
): ReportDashboardRecord {
  return {
    id: "dash_1",
    title: "Growth (stored title)",
    config: {
      name: "Growth",
      description: "Daily growth report",
      filters,
      panels,
    },
  };
}

/** Per-panel statuses the fake `fetchReportPanelData` should report. */
let panelStatuses: Record<string, ReportPanelData> = {};

/**
 * Mirrors the real fetcher's panel classification: sections are never queried,
 * extension panels are reported as not-emailable rather than failed.
 */
function fakePanelData(snapshot: ReportSnapshot): PanelDataMap {
  const data: PanelDataMap = new Map();
  for (const p of (snapshot.panels ?? []) as SqlPanel[]) {
    if (p.chartType === "section") continue;
    if (p.chartType === "extension") {
      data.set(p.id, {
        status: "not-emailable",
        message: "Extension panels only render in the live dashboard",
      });
      continue;
    }
    data.set(
      p.id,
      panelStatuses[p.id] ?? {
        status: "rows",
        rows: [{ n: 1 }],
        schema: [{ name: "n", type: "number" }],
      },
    );
  }
  return data;
}

function fakeRenderedEmail(args: RenderEmailArgs): RenderedReportEmail {
  const degradedPanelIds = args.snapshot.panelIds.filter((id) => {
    const data = args.panelData.get(id);
    return (
      !data ||
      data.status === "query-failed" ||
      data.status === "missing-credential"
    );
  });
  const attachments = args.snapshot.panelIds
    .filter((id) => args.panelData.get(id)?.status === "rows")
    .map((id, index) => ({
      filename: `${id}.png`,
      content: Buffer.from(`png-${id}`),
      contentType: "image/png",
      contentId: `dashboard-report-panel-${index}-${id}`,
      disposition: "inline" as const,
    }));
  return {
    html: `<p>${args.snapshot.title}</p>`,
    text: args.snapshot.title,
    attachments,
    degradedPanelIds,
  };
}

function sentEmails(): EmailPayload[] {
  return mocks.sendEmail.mock.calls.map((call) => call[0] as EmailPayload);
}

describe("dashboard report email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DASHBOARD_REPORT_BASE_URL", "");
    panelStatuses = {};
    mocks.sendEmail.mockImplementation(async () => {});
    mocks.getAppProductionUrl.mockReturnValue("https://analytics.example.test");
    mocks.getReportDashboard.mockImplementation(async () =>
      dashboardWith([panel("p1")]),
    );
    mocks.fetchReportPanelData.mockImplementation(async (args) =>
      fakePanelData(args.snapshot),
    );
    mocks.renderReportEmail.mockImplementation(async (args) =>
      fakeRenderedEmail(args),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emails a complete report with its inline chart attachments", async () => {
    mocks.getReportDashboard.mockResolvedValue(
      dashboardWith([panel("p1"), panel("p2")]),
    );
    const onCaptureOutcome = vi.fn(async () => {});

    const result = await sendDashboardReportSubscription(subscription(), {
      onCaptureOutcome,
    });

    expect(result).toEqual({
      dashboardUrl:
        "https://analytics.example.test/dashboards/dash_1?f_timeRange=30d",
      recipientCount: 1,
      reportMode: "complete",
      degradedPanelIds: [],
      emailsSent: true,
    });
    expect(result.reportError).toBeUndefined();
    expect(onCaptureOutcome).toHaveBeenCalledWith({ mode: "full" });
    expect(onCaptureOutcome.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendEmail.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );

    expect(mocks.fetchReportPanelData.mock.calls[0][0]).toMatchObject({
      ownerEmail: "steve@builder.io",
      orgId: "org_1",
    });
    expect(mocks.renderReportEmail.mock.calls[0][0].snapshot.panelIds).toEqual([
      "p1",
      "p2",
    ]);

    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    const [email] = sentEmails();
    expect(email.to).toBe("steve@builder.io");
    expect(email.subject).toContain("Growth");
    expect(email.timeoutMs).toBe(EMAIL_TIMEOUT_MS);
    expect(email.html).toContain("Growth");
    expect(email.attachments?.map((a) => a.contentId)).toEqual([
      "dashboard-report-panel-0-p1",
      "dashboard-report-panel-1-p2",
    ]);
    expect(email.attachments?.every((a) => a.disposition === "inline")).toBe(
      true,
    );
  });

  it("still emails a degraded report when no retry is scheduled, and names the failed panels", async () => {
    mocks.getReportDashboard.mockResolvedValue(
      dashboardWith([panel("ok"), panel("broken"), panel("nokey")]),
    );
    panelStatuses = {
      broken: { status: "query-failed", message: "syntax error at line 3" },
      nokey: {
        status: "missing-credential",
        message: "Connect your BigQuery account",
      },
    };
    const onCaptureOutcome = vi.fn(async () => {});

    const result = await sendDashboardReportSubscription(subscription(), {
      onCaptureOutcome,
    });

    expect(result.reportMode).toBe("degraded");
    expect(result.degradedPanelIds).toEqual(["broken", "nokey"]);
    expect(result.reportError).toContain("2 of 3");
    expect(result.reportError).toContain("broken, nokey");
    expect(result.emailsSent).toBe(true);
    expect(onCaptureOutcome).toHaveBeenCalledWith({
      mode: "partial",
      error: result.reportError,
    });
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });

  it("holds a degraded report back while a retry window is open, and still reports the degraded panels", async () => {
    mocks.getReportDashboard.mockResolvedValue(
      dashboardWith([panel("ok"), panel("broken")]),
    );
    panelStatuses = {
      broken: { status: "query-failed", message: "upstream timeout" },
    };
    const onCaptureOutcome = vi.fn(async () => {});

    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWhenDegraded: true,
      onCaptureOutcome,
    });

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      emailsSent: false,
      reportMode: "degraded",
      degradedPanelIds: ["broken"],
      recipientCount: 1,
    });
    expect(result.reportError).toContain("broken");
    expect(onCaptureOutcome).toHaveBeenCalledWith({
      mode: "partial",
      error: expect.stringContaining("broken"),
    });
  });

  it("sends a complete report even while a retry window is open", async () => {
    const result = await sendDashboardReportSubscription(subscription(), {
      skipEmailWhenDegraded: true,
    });

    expect(result).toMatchObject({ reportMode: "complete", emailsSent: true });
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });

  it("throws instead of emailing a report in which every queryable panel failed", async () => {
    mocks.getReportDashboard.mockResolvedValue(
      dashboardWith([panel("a"), panel("b")]),
    );
    panelStatuses = {
      a: {
        status: "query-failed",
        message: 'relation "events" does not exist',
      },
      b: { status: "missing-credential", message: "Connect your warehouse" },
    };
    const onCaptureOutcome = vi.fn(async () => {});

    await expect(
      sendDashboardReportSubscription(subscription(), { onCaptureOutcome }),
    ).rejects.toThrow(
      /no usable data: every one of 2 panels failed \(relation "events" does not exist\)/,
    );

    expect(onCaptureOutcome).toHaveBeenCalledWith({
      mode: "none",
      error: expect.stringContaining("every dashboard panel failed to load"),
    });
    expect(mocks.renderReportEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("does not treat a dashboard of only section panels as a total failure", async () => {
    mocks.getReportDashboard.mockResolvedValue(
      dashboardWith([
        panel("intro", { chartType: "section" }),
        panel("outro", { chartType: "section" }),
      ]),
    );
    const onCaptureOutcome = vi.fn(async () => {});

    const result = await sendDashboardReportSubscription(subscription(), {
      onCaptureOutcome,
    });

    expect(result).toMatchObject({
      reportMode: "complete",
      degradedPanelIds: [],
      emailsSent: true,
    });
    expect(onCaptureOutcome).toHaveBeenCalledWith({ mode: "full" });
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(sentEmails()[0].attachments).toBeUndefined();
  });

  it("never reports a dashboard of only extension panels as complete", async () => {
    mocks.getReportDashboard.mockResolvedValue(
      dashboardWith([
        panel("widget-a", { chartType: "extension" }),
        panel("widget-b", { chartType: "extension" }),
      ]),
    );
    const onCaptureOutcome = vi.fn(async () => {});

    const result = await sendDashboardReportSubscription(subscription(), {
      onCaptureOutcome,
    });

    // Nothing failed, so degradedPanelIds is empty — but no panel is backed by
    // data, so the report is a page of "open the dashboard" links and must not
    // claim to be complete.
    expect(result.reportMode).toBe("degraded");
    expect(result.reportError).toBeDefined();
    expect(onCaptureOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "partial" }),
    );
  });

  it("stops before reading the dashboard when the delivery deadline has already passed", async () => {
    await expect(
      sendDashboardReportSubscription(subscription(), {
        deadlineAt: Date.now() - 1,
      }),
    ).rejects.toThrow(
      "Dashboard report snapshot exceeded the report delivery deadline",
    );

    expect(mocks.getReportDashboard).not.toHaveBeenCalled();
    expect(mocks.fetchReportPanelData).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("reserves per-recipient email time out of the panel-query deadline", async () => {
    const deadlineAt = Date.now() + 120_000;

    await sendDashboardReportSubscription(
      { ...subscription(), recipients: ["a@example.test", "b@example.test"] },
      { deadlineAt },
    );

    expect(mocks.fetchReportPanelData.mock.calls[0][0].deadlineAt).toBe(
      deadlineAt - (2 * EMAIL_TIMEOUT_MS + EMAIL_OVERHEAD_RESERVE_MS),
    );
  });

  it("throws rather than starting a send once the deadline is gone", async () => {
    vi.useFakeTimers();
    try {
      const deadlineAt = Date.now() + 20_000;
      mocks.fetchReportPanelData.mockImplementation(async (args) => {
        vi.setSystemTime(Date.now() + 25_000);
        return fakePanelData(args.snapshot);
      });

      // Whichever bounded step notices first, the invariant is that it rejects
      // and nothing is delivered.
      await expect(
        sendDashboardReportSubscription(subscription(), { deadlineAt }),
      ).rejects.toThrow("exceeded the report delivery deadline");
      expect(mocks.sendEmail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers once to each normalized recipient", async () => {
    const result = await sendDashboardReportSubscription({
      ...subscription(),
      recipients: ["STEVE@builder.io", " steve@builder.io ", "Team@builder.io"],
    });

    expect(result.recipientCount).toBe(2);
    expect(sentEmails().map((email) => email.to)).toEqual([
      "steve@builder.io",
      "team@builder.io",
    ]);
  });

  it.each([
    ["zero", []],
    [
      "too many",
      Array.from({ length: 6 }, (_, index) => `person-${index}@example.com`),
    ],
  ] as const)(
    "rejects a subscription with %s recipients before reading the dashboard",
    async (_label, recipients) => {
      await expect(
        sendDashboardReportSubscription({
          ...subscription(),
          recipients: [...recipients],
        }),
      ).rejects.toThrow(/recipient/i);

      expect(mocks.getReportDashboard).not.toHaveBeenCalled();
      expect(mocks.fetchReportPanelData).not.toHaveBeenCalled();
      expect(mocks.sendEmail).not.toHaveBeenCalled();
    },
  );

  it("resolves relative filter defaults and lets the subscription override them", async () => {
    mocks.getReportDashboard.mockResolvedValue(
      dashboardWith(
        [panel("p1"), panel("intro", { chartType: "section" })],
        [
          {
            id: "timeRange",
            label: "Time range",
            type: "date",
            default: "30d",
          },
          { id: "day", label: "Day", type: "date", default: "today" },
          { id: "range", label: "Range", type: "date-range", default: "7d" },
          { id: "env", label: "Env", type: "select", default: "prod" },
          { id: "team", label: "Team", type: "select" },
          { id: "paid", label: "Paid", type: "toggle", default: "true" },
          {
            id: "compare",
            label: "Compare",
            type: "toggle-date",
            default: "14d",
          },
        ],
      ),
    );

    const snapshot = await collectReportSnapshot({
      ...subscription(),
      filters: { f_env: "staging" },
    });

    expect(snapshot.filters).toEqual({
      f_timeRange: daysAgo(30),
      f_day: daysAgo(0),
      f_rangeStart: daysAgo(7),
      f_rangeEnd: daysAgo(0),
      f_env: "staging",
    });
    expect(snapshot.title).toBe("Growth");
    expect(snapshot.panelIds).toEqual(["p1"]);
  });

  it("reads the dashboard under the subscription owner's access scope", async () => {
    await collectReportSnapshot(subscription());

    expect(mocks.getReportDashboard).toHaveBeenCalledWith("dash_1", {
      email: "steve@builder.io",
      orgId: "org_1",
    });
  });

  it("fails loudly when the dashboard is not readable", async () => {
    mocks.getReportDashboard.mockResolvedValue(null);

    await expect(collectReportSnapshot(subscription())).rejects.toThrow(
      "Dashboard not found",
    );
  });

  it("builds the dashboard and report-settings URLs from the production app URL", async () => {
    const snapshot = await collectReportSnapshot(subscription());

    expect(snapshot.dashboardUrl).toBe(
      "https://analytics.example.test/dashboards/dash_1?f_timeRange=30d",
    );
    expect(snapshot.reportSettingsUrl).toBe(
      "https://analytics.example.test/dashboards/dash_1?f_timeRange=30d&reportSettings=1",
    );
  });

  it("prefers DASHBOARD_REPORT_BASE_URL over the production app URL", async () => {
    vi.stubEnv("DASHBOARD_REPORT_BASE_URL", "https://reports.example.test");

    const snapshot = await collectReportSnapshot(subscription());

    expect(snapshot.dashboardUrl).toBe(
      "https://reports.example.test/dashboards/dash_1?f_timeRange=30d",
    );
    expect(snapshot.reportSettingsUrl).toContain("reportSettings=1");
    expect(mocks.getAppProductionUrl).not.toHaveBeenCalled();
  });
});
