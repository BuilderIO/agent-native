import { beforeEach, describe, expect, it, vi } from "vitest";

import { safeRadarEventLabel } from "./event-labels.ts";
import {
  loadUploadRejectionRows,
  parseWatchArgs,
  campaignUnavailableCheck,
  safeCampaignLabel,
  createEventChecks,
  matureFunnelCohortDate,
  runWatch,
  uploadRejectionCheck,
} from "./watch.ts";

const queryMocks = vi.hoisted(() => ({
  resolveRadarOrganizationId: vi.fn(),
  resolveRadarFirstPartyBackend: vi.fn(),
  resolveRadarBigQueryEventsTable: vi.fn(),
  runBigQuery: vi.fn(),
  runPostgresQuery: vi.fn(),
}));

vi.mock("./query.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.ts")>();
  return {
    ...actual,
    ...queryMocks,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("campaign label output", () => {
  it("preserves the reviewed outage campaign and redacts arbitrary labels", () => {
    expect(safeCampaignLabel("outage_recovery_20261026")).toBe(
      "outage_recovery_20261026",
    );
    expect(safeCampaignLabel("alice@example.com | private note")).toBe("other");
    expect(safeCampaignLabel("newsletter_alice@example.com")).toBe("other");
  });
});

describe("watch arguments", () => {
  it.each([["--date"], ["--date", "--window", "daily"]])(
    "rejects a missing --date value",
    (...args) => {
      expect(() => parseWatchArgs(args)).toThrow("--date requires a value.");
    },
  );

  it("rejects impossible calendar dates before querying", async () => {
    await expect(runWatch({ date: "2026-02-30" })).rejects.toMatchObject({
      exitCode: 2,
      message: "--date must be YYYY-MM-DD.",
    });
  });
});

describe("hourly event query", () => {
  it.each(["postgres", "bigquery"] as const)(
    "skips daily linked aggregates for hourly %s queries",
    async (sink) => {
      queryMocks.resolveRadarOrganizationId.mockResolvedValue("org-id");
      queryMocks.resolveRadarFirstPartyBackend.mockResolvedValue({
        sink,
        table: null,
      });
      queryMocks.resolveRadarBigQueryEventsTable.mockResolvedValue(
        "`project_id.analytics.events_raw_query_range`",
      );
      queryMocks.runPostgresQuery.mockResolvedValue({ rows: [] });
      queryMocks.runBigQuery.mockResolvedValue({ rows: [] });

      await runWatch({
        window: "hourly",
        date: "2026-10-26",
        hour: 12,
      });

      const calls =
        sink === "bigquery"
          ? queryMocks.runBigQuery.mock.calls
          : queryMocks.runPostgresQuery.mock.calls;
      expect(calls).toHaveLength(1);
      const query = String(calls[0]?.[0]);
      expect(query).toContain("SELECT * FROM event_stats ORDER BY");
      expect(query).not.toContain(", linked_events AS (");
    },
  );
});

describe("radar event labels", () => {
  it("redacts unreviewed event names before report output", () => {
    expect(safeRadarEventLabel("signup")).toBe("signup");
    expect(safeRadarEventLabel("alice@example.com | private note")).toBe(
      "unreviewed event",
    );
  });
});

function eventChecks(
  rows: Array<Record<string, unknown>>,
  options: {
    window?: "hourly" | "daily";
    targetDate?: string;
    targetHour?: string;
  } = {},
) {
  const targetDate = options.targetDate ?? "2026-10-26";
  const window = options.window ?? "daily";
  return createEventChecks(
    rows,
    [],
    [],
    [],
    [],
    targetDate,
    targetDate,
    options.targetHour ?? `${targetDate}T12`,
    window,
  ).checks;
}

function checkById(
  rows: Array<Record<string, unknown>>,
  id: string,
  app: string,
) {
  return eventChecks(rows).find(
    (check) => check.id === id && check.app === app,
  );
}

describe("selected-period event coverage", () => {
  it("does not treat prior daily history as coverage for the selected date", () => {
    const checks = eventChecks([
      {
        period_start: "2026-10-25T00:00:00.000Z",
        app: "slides",
        event_name: "signup",
      },
    ]);

    expect(
      checks.find(
        (check) => check.id === "event-feed-coverage" && check.app === "slides",
      ),
    ).toMatchObject({ status: "unavailable" });
  });

  it("does not treat another hour on the selected date as hourly coverage", () => {
    const checks = eventChecks(
      [
        {
          period_start: "2026-10-26T11:00:00.000Z",
          app: "design",
          event_name: "signup",
        },
      ],
      { window: "hourly", targetHour: "2026-10-26T12" },
    );

    expect(
      checks.find(
        (check) => check.id === "event-feed-coverage" && check.app === "design",
      ),
    ).toMatchObject({ status: "unavailable" });
  });

  it("accepts event rows in the selected date", () => {
    const checks = eventChecks([
      {
        period_start: "2026-10-26T00:00:00.000Z",
        app: "slides",
        event_name: "signup",
      },
    ]);

    expect(
      checks.some(
        (check) => check.id === "event-feed-coverage" && check.app === "slides",
      ),
    ).toBe(false);
  });
});

describe("linked daily conversion checks", () => {
  it("does not run daily linked conversion checks for an hourly watch", () => {
    const checks = eventChecks(
      [
        {
          period_start: "2026-10-26T12:00:00.000Z",
          app: "slides",
          event_name: "generation_started",
          linked_slides_started_users: 10,
          linked_slides_failed_started_users: 4,
          linked_slides_unlinked_events: 0,
        },
        {
          period_start: "2026-10-26T12:00:00.000Z",
          app: "design",
          event_name: "design_prompt_submitted",
          users: 10,
          linked_design_prompt_output_users: 4,
          linked_design_unlinked_events: 0,
        },
        {
          period_start: "2026-10-26T12:00:00.000Z",
          app: "clips",
          event_name: "recording_started",
          linked_clips_started_attempts: 10,
          linked_clips_ready_attempts: 4,
          linked_clips_unlinked_events: 0,
        },
      ],
      { window: "hourly", targetHour: "2026-10-26T12" },
    );

    expect(
      checks.some((check) =>
        [
          "slides-generation-failure",
          "design-prompt-output",
          "clips-ready-rate",
        ].includes(check.id),
      ),
    ).toBe(false);
  });

  it("uses only same-user attempt-linked Slides failures", () => {
    const result = checkById(
      [
        {
          period_start: "2026-10-26T00:00:00.000Z",
          app: "slides",
          event_name: "generation_started",
          users: 10,
          linked_slides_started_users: 10,
          linked_slides_failed_started_users: 0,
          linked_slides_unlinked_events: 0,
        },
        {
          period_start: "2026-10-26T00:00:00.000Z",
          app: "slides",
          event_name: "generation_failed",
          users: 10,
        },
      ],
      "slides-generation-failure",
      "slides",
    );

    expect(result).toMatchObject({
      status: "clear",
      numerator: 0,
      denominator: 10,
      value: 0,
    });
  });

  it("links Design ready views to a prompt's user and output within the day", () => {
    const result = checkById(
      [
        {
          period_start: "2026-10-26T00:00:00.000Z",
          app: "design",
          event_name: "design_prompt_submitted",
          users: 10,
          linked_design_prompt_output_users: 4,
          linked_design_unlinked_events: 0,
        },
        {
          period_start: "2026-10-26T00:00:00.000Z",
          app: "design",
          event_name: "design_ready_viewed",
          users: 10,
        },
      ],
      "design-prompt-output",
      "design",
    );

    expect(result).toMatchObject({
      status: "fired",
      numerator: 4,
      denominator: 10,
      value: 0.4,
    });
  });

  it("links Clips ready events to distinct started attempts in the same day", () => {
    const result = checkById(
      [
        {
          period_start: "2026-10-26T00:00:00.000Z",
          app: "clips",
          event_name: "recording_started",
          events: 15,
          linked_clips_started_attempts: 10,
          linked_clips_ready_attempts: 4,
          linked_clips_unlinked_events: 0,
        },
        {
          period_start: "2026-10-26T00:00:00.000Z",
          app: "clips",
          event_name: "recording_ready",
          events: 15,
        },
      ],
      "clips-ready-rate",
      "clips",
    );

    expect(result).toMatchObject({
      status: "fired",
      numerator: 4,
      denominator: 10,
      value: 0.4,
    });
  });

  it.each([
    [
      "slides-generation-failure",
      "slides",
      "generation_started",
      "linked_slides_started_users",
      "linked_slides_failed_started_users",
      "linked_slides_unlinked_events",
    ],
    [
      "design-prompt-output",
      "design",
      "design_prompt_submitted",
      "users",
      "linked_design_prompt_output_users",
      "linked_design_unlinked_events",
    ],
    [
      "clips-ready-rate",
      "clips",
      "recording_started",
      "linked_clips_started_attempts",
      "linked_clips_ready_attempts",
      "linked_clips_unlinked_events",
    ],
  ])(
    "reports %s unavailable when source linkage is missing",
    (id, app, eventName, denominatorField, numeratorField, unlinkedField) => {
      const result = checkById(
        [
          {
            period_start: "2026-10-26T00:00:00.000Z",
            app,
            event_name: eventName,
            users: 10,
            events: 10,
            [denominatorField]: 10,
            [numeratorField]: 0,
            [unlinkedField]: 1,
          },
        ],
        id,
        app,
      );

      expect(result?.status).toBe("unavailable");
      expect(result?.value).toBeUndefined();
    },
  );
});

describe("mature funnel cohort date", () => {
  it("caps a recent requested date at the UTC cutoff date minus two days", () => {
    expect(
      matureFunnelCohortDate("2026-10-26", new Date("2026-10-27T23:59:00Z")),
    ).toBe("2026-10-25");
  });

  it("keeps an older requested cohort date", () => {
    expect(
      matureFunnelCohortDate("2026-10-19", new Date("2026-10-27T00:01:00Z")),
    ).toBe("2026-10-19");
  });

  it("uses the mature date for funnel data while event checks keep the requested date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T23:59:00Z"));
    queryMocks.resolveRadarOrganizationId.mockResolvedValue("org-id");
    queryMocks.resolveRadarFirstPartyBackend.mockResolvedValue({
      sink: "postgres",
      table: null,
    });
    queryMocks.runPostgresQuery.mockImplementation(async (sql, params) => {
      const query = String(sql);
      if (query.includes("event_stats AS")) {
        return {
          rows: [
            {
              period_start: "2026-10-25T00:00:00.000Z",
              app: "design",
              event_name: "signup",
              users: 100,
            },
            {
              period_start: "2026-10-26T00:00:00.000Z",
              app: "design",
              event_name: "signup",
              users: 12,
            },
          ],
        };
      }
      if (query.includes("signup_cohort AS")) {
        return {
          rows: [
            {
              signup_date: "2026-10-25",
              app: "design",
              journey_type: "design_web",
              signups: 40,
              completed: 20,
              entered: 15,
              prompted: 10,
              output: 5,
            },
            {
              signup_date: "2026-10-26",
              app: "design",
              journey_type: "design_web",
              signups: 100,
              completed: 100,
              entered: 100,
              prompted: 100,
              output: 100,
            },
          ],
        };
      }
      return { rows: [] };
    });

    try {
      const run = await runWatch({
        date: "2026-10-26",
        includeCampaign: false,
      });
      const funnelQueryCall = queryMocks.runPostgresQuery.mock.calls.find(
        ([sql]) => String(sql).includes("signup_cohort AS"),
      );
      const funnelCheck = run.checks.find(
        (check) =>
          check.id === "first-touch-funnel-drop" &&
          check.app === "design" &&
          check.detail?.startsWith("signup-to-onboarding"),
      );
      const signupCheck = run.checks.find(
        (check) => check.id === "signup-volume-drop" && check.app === "design",
      );

      expect(run.coverage.funnelCohortDate).toBe("2026-10-25");
      expect(funnelQueryCall?.[1]?.slice(0, 2)).toEqual([
        "2026-10-17",
        "2026-10-26",
      ]);
      expect(funnelCheck).toMatchObject({ numerator: 20, denominator: 40 });
      expect(signupCheck?.numerator).toBe(12);
      expect(run.journeyRows.map((row) => row.signup_date)).toEqual([
        "2026-10-25",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("upload rejection evidence routing", () => {
  it("reads rejection events from BigQuery when it is the configured sink", async () => {
    queryMocks.resolveRadarBigQueryEventsTable.mockResolvedValue(
      "`project_id.analytics.events_raw_query_range`",
    );
    queryMocks.runBigQuery.mockResolvedValue({
      rows: [
        {
          app: "clips",
          reason: "storage",
          status: "413",
          rejected_recorders: 2,
          unidentified_rejections: 0,
          rejected_session_ids: ["recording-1", "recording-2"],
        },
        {
          app: "clips",
          reason: "network",
          status: "502",
          rejected_recorders: 1,
          unidentified_rejections: 0,
          rejected_session_ids: ["recording-1"],
        },
      ],
    });
    queryMocks.runPostgresQuery.mockResolvedValue({
      rows: [{ app: "clips", recorders: 8 }],
    });

    const rows = await loadUploadRejectionRows(
      { sink: "bigquery", table: "analytics.events" },
      "2026-10-25",
      "org-id",
    );

    expect(queryMocks.runBigQuery).toHaveBeenCalledWith(
      expect.stringContaining("session_replay_upload_rejected"),
      expect.objectContaining({ cache: false, fresh: true }),
    );
    expect(queryMocks.runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("jsonb_array_elements($4::jsonb)"),
      [
        "2026-10-25",
        "2026-10-25",
        "org-id",
        {
          __radarJsonbParameter: true,
          value: [
            { app: "clips", session_ids: ["recording-1", "recording-2"] },
          ],
        },
      ],
      { fresh: true },
    );
    expect(queryMocks.runPostgresQuery.mock.calls[0]?.[0]).not.toContain(
      "session_replay_upload_rejected",
    );
    expect(rows).toEqual([
      {
        app: "clips",
        reason: "storage",
        status: "413",
        rejected_recorders: 2,
        unidentified_rejections: 0,
        recorders: 8,
      },
      {
        app: "clips",
        reason: "network",
        status: "502",
        rejected_recorders: 1,
        unidentified_rejections: 0,
        recorders: 8,
      },
    ]);
  });

  it("uses the combined Postgres query for Postgres and dual sinks", async () => {
    queryMocks.runPostgresQuery.mockResolvedValue({
      rows: [{ app: "clips", reason: "storage", recorders: 8 }],
    });

    await loadUploadRejectionRows(
      { sink: "dual", table: null },
      "2026-10-25",
      "org-id",
    );

    expect(queryMocks.runBigQuery).not.toHaveBeenCalled();
    expect(queryMocks.runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("session_replay_upload_rejected"),
      ["2026-10-25", "2026-10-25", "org-id"],
    );
  });

  it("reports rejection rows as unavailable when the recorder denominator is missing", () => {
    expect(
      uploadRejectionCheck({
        app: "clips",
        reason: "storage",
        status: "413",
        rejected_recorders: 2,
        unidentified_rejections: 0,
        recorders: null,
      }),
    ).toMatchObject({
      app: "clips",
      status: "unavailable",
      numerator: 2,
      denominator: null,
    });
  });

  it("reports sessionless rejection events as unavailable", () => {
    expect(
      uploadRejectionCheck({
        app: "clips",
        reason: "storage",
        status: "413",
        rejected_recorders: 0,
        unidentified_rejections: 1,
        recorders: 8,
      }),
    ).toMatchObject({ app: "clips", status: "unavailable" });
  });

  it("preserves the typed campaign-unavailable reason in the check detail", () => {
    expect(
      campaignUnavailableCheck(
        "Campaign follow-up is unavailable for the configured sink.",
      ),
    ).toMatchObject({
      id: "campaign-followup",
      status: "unavailable",
      detail:
        "Campaign follow-up unavailable: Campaign follow-up is unavailable for the configured sink.",
    });
  });
});
