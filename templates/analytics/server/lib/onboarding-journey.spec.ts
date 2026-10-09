import { lexAgentSql } from "@agent-native/core/agent-sql";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryFirstPartyAnalytics: vi.fn(),
  listJourneyRecordings: vi.fn(),
  requestOrigin: "https://analytics.example.test" as string | undefined,
}));

vi.mock("./first-party-analytics.js", () => ({
  queryFirstPartyAnalytics: mocks.queryFirstPartyAnalytics,
}));
vi.mock("./session-replay.js", () => ({
  listJourneyRecordings: mocks.listJourneyRecordings,
}));
vi.mock("@agent-native/core/server", () => ({
  getAppBasePath: () => "",
  getRequestContext: () => ({ requestOrigin: mocks.requestOrigin }),
}));

import {
  buildOnboardingJourneyFollowupSql,
  type OnboardingJourneyEventsFilters,
} from "./first-party-metric-catalog";
import {
  formatJourneyOutline,
  getOnboardingJourney,
  JourneyRecordingsError,
  parseJourneyEventRow,
  parseJourneyTimestampMs,
  type JourneySummary,
  type JourneyTree,
  type OnboardingJourneyArgs,
} from "./onboarding-journey";

const scope = { userEmail: "owner@example.test", orgId: null };
const T0 = Date.parse("2026-10-01T12:00:00.000Z");

const ARGS: OnboardingJourneyArgs = {
  dateFrom: "2026-10-01",
  dateTo: "2026-10-02",
  app: "clips",
  emailFilter: "exclude_builder",
  format: "tree",
  maxDepth: 8,
  minNodeSessions: 1,
  examplesPerNode: 2,
  maxEventRows: 1000,
  maxNodes: 60,
  settleMs: 300,
  recency: "newest",
};

let eventId = 0;
function eventRow(
  sessionId: string,
  eventName: string,
  offsetSeconds: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `ev-${eventId++}`,
    session_id: sessionId,
    timestamp: new Date(T0 + offsetSeconds * 1000).toISOString(),
    event_name: eventName,
    journey_kind: "onboarding",
    template_name: "clips",
    path: null,
    flow: null,
    source: null,
    step_id: null,
    step_index: null,
    method_id: null,
    outcome: null,
    action: null,
    ...extra,
  };
}

function journeyRows() {
  return [
    eventRow("s1", "signup", 0),
    eventRow("s1", "onboarding_step_viewed", 5, { step_id: "role" }),
    eventRow("s1", "onboarding_completed", 10),
    eventRow("s2", "signup", 0),
    eventRow("s2", "onboarding_step_viewed", 5, { step_id: "role" }),
    eventRow("s3", "signup", 0),
  ];
}

function recordingFor(sessionId: string) {
  return {
    id: `rec-${sessionId}`,
    sessionId,
    startedAtMs: T0 - 1000,
    endedAtMs: T0 + 60_000,
    durationMs: 61_000,
    viewport: { status: "known" as const, width: 1280, height: 800 },
  };
}

beforeEach(() => {
  eventId = 0;
  mocks.requestOrigin = "https://analytics.example.test";
  mocks.queryFirstPartyAnalytics.mockReset();
  mocks.listJourneyRecordings.mockReset();
  mocks.listJourneyRecordings.mockResolvedValue({
    recordings: [recordingFor("s1"), recordingFor("s2")],
    complete: true,
  });
});

describe("parseJourneyTimestampMs", () => {
  it("reads the shapes the two backends return", () => {
    expect(parseJourneyTimestampMs("2026-10-01T12:00:00.000Z")).toBe(T0);
    expect(parseJourneyTimestampMs({ value: "2026-10-01T12:00:00.000Z" })).toBe(
      T0,
    );
    expect(parseJourneyTimestampMs(new Date(T0))).toBe(T0);
    expect(parseJourneyTimestampMs(T0)).toBe(T0);
    expect(parseJourneyTimestampMs("2026-10-01 12:00:00+00")).toBe(T0);
  });

  it("returns null instead of guessing", () => {
    expect(parseJourneyTimestampMs("not a time")).toBeNull();
    expect(parseJourneyTimestampMs(null)).toBeNull();
    expect(parseJourneyTimestampMs({})).toBeNull();
  });
});

describe("parseJourneyEventRow", () => {
  it("requires an id, a session, a name, and a readable timestamp", () => {
    expect(
      parseJourneyEventRow(
        eventRow("s1", "signup", 0, {
          alias_id: "alias-pair-1",
          output_id: "private-output-id",
          generation_attempt_id: "private-attempt-id",
        }),
      ),
    ).toMatchObject({
      sessionId: "s1",
      eventName: "signup",
      templateName: "clips",
      tsMs: T0,
      aliasId: "alias-pair-1",
    });
    const parsed = parseJourneyEventRow(
      eventRow("s1", "signup", 0, {
        output_id: "private-output-id",
        generation_attempt_id: "private-attempt-id",
      }),
    );
    expect(parsed).not.toHaveProperty("outputId");
    expect(parsed).toHaveProperty("attemptId", null);
    expect(
      parseJourneyEventRow(
        eventRow("s1", "generation_started", 0, {
          attempt_id: "private-attempt-id",
        }),
      )?.attemptId,
    ).toBe("private-attempt-id");
    for (const broken of [
      { ...eventRow("s1", "signup", 0), id: "" },
      { ...eventRow("s1", "signup", 0), session_id: null },
      { ...eventRow("s1", "signup", 0), event_name: undefined },
      { ...eventRow("s1", "signup", 0), timestamp: "garbled" },
      { ...eventRow("s1", "signup", 0), journey_kind: "other" },
    ]) {
      expect(parseJourneyEventRow(broken)).toBeNull();
    }
  });

  it("parses the onboarding step index used for causal tie ordering", () => {
    expect(
      parseJourneyEventRow(
        eventRow("s1", "onboarding_step_skipped", 0, {
          flow: "first_run",
          step_index: "2",
        }),
      )?.stepIndex,
    ).toBe(2);
    expect(
      parseJourneyEventRow(
        eventRow("s1", "onboarding_step_skipped", 0, {
          step_index: "not-an-index",
        }),
      )?.stepIndex,
    ).toBeNull();
  });
});

describe("getOnboardingJourney", () => {
  it("returns exactly the JourneyTree contract", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows(),
      schema: [],
    });
    const tree = (await getOnboardingJourney(scope, ARGS)) as JourneyTree;

    expect(Object.keys(tree).sort()).toEqual([
      "app",
      "coverage",
      "followUp",
      "nodes",
      "rootN",
      "window",
    ]);
    expect(tree.window).toEqual({ from: "2026-10-01", to: "2026-10-02" });
    expect(tree.app).toBe("clips");
    expect(tree.rootN).toBe(3);
    expect(tree.coverage).toEqual({
      sessionsWithEvents: 3,
      sessionsWithReplay: 2,
      truncated: false,
    });
    expect(tree.nodes.map((node) => [node.key, node.n, node.dropoffN])).toEqual(
      [
        ["signup", 3, 1],
        ["signup > step:role", 2, 1],
        ["signup > step:role > onboarding:completed", 1, 1],
      ],
    );
    for (const node of tree.nodes) {
      expect(Object.keys(node).sort()).toEqual([
        "deeperN",
        "depth",
        "dropoffN",
        "dropoffPct",
        "examples",
        "key",
        "kind",
        "label",
        "n",
        "parentKey",
        "pctOfParent",
        "pctOfRoot",
      ]);
    }
    expect(tree.nodes[0]!.examples[0]).toEqual({
      sessionId: "s1",
      recordingId: "rec-s1",
      ts: new Date(T0).toISOString(),
      offsetMs: 1300,
      viewport: { width: 1280, height: 800 },
      replayUrl: "https://analytics.example.test/sessions/rec-s1?atMs=1300",
    });
    expect(tree.nodes[0]!.examples[2]).toBeUndefined();
  });

  it("counts explicit saved outputs without exposing output or attempt ids", async () => {
    const rows = journeyRows();
    rows.push(
      eventRow("s1", "generation_completed", 15, {
        template_name: "slides",
        output_type: "deck",
        output_id: "private-output-id",
        generation_attempt_id: "private-attempt-id",
      }),
    );
    mocks.queryFirstPartyAnalytics.mockResolvedValue({ rows, schema: [] });

    const tree = (await getOnboardingJourney(scope, ARGS)) as JourneyTree;
    const serialized = JSON.stringify(tree);

    expect(tree.nodes.map((node) => node.key)).toContain(
      "signup > step:role > onboarding:completed > output:generation_completed",
    );
    expect(serialized).not.toContain("private-output-id");
    expect(serialized).not.toContain("private-attempt-id");
    expect(serialized).not.toContain("output_id");
    expect(serialized).not.toContain("generation_attempt_id");
  });

  it("keeps distinct consecutive Slides attempts in the tree without exposing ids", async () => {
    const rows = journeyRows();
    rows.push(
      eventRow("s1", "generation_started", 11, {
        template_name: "slides",
        attempt_id: "private-attempt-one",
      }),
      eventRow("s1", "generation_started", 12, {
        template_name: "slides",
        attempt_id: "private-attempt-two",
      }),
      eventRow("s1", "generation_completed", 13, {
        template_name: "slides",
        attempt_id: "private-completion-attempt-one",
      }),
      eventRow("s1", "generation_completed", 14, {
        template_name: "slides",
        attempt_id: "private-completion-attempt-two",
      }),
    );
    mocks.queryFirstPartyAnalytics.mockResolvedValue({ rows, schema: [] });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      app: "slides",
    })) as JourneyTree;
    const serialized = JSON.stringify(tree);

    expect(tree.nodes.map((node) => node.key)).toContain(
      "signup > step:role > onboarding:completed > attempt:generation_started",
    );
    expect(tree.nodes.map((node) => node.key)).toContain(
      "signup > step:role > onboarding:completed > attempt:generation_started > attempt:generation_started:2",
    );
    expect(tree.nodes.map((node) => node.key)).toContain(
      "signup > step:role > onboarding:completed > attempt:generation_started > attempt:generation_started:2 > output:generation_completed > output:generation_completed:2",
    );
    expect(serialized).not.toContain("private-attempt-one");
    expect(serialized).not.toContain("private-attempt-two");
    expect(serialized).not.toContain("private-completion-attempt-one");
    expect(serialized).not.toContain("private-completion-attempt-two");
    expect(serialized).not.toContain("attempt_id");
  });

  it("reports later and no-later aggregates with a frozen, right-censored observation window", async () => {
    const fixedNow = Date.parse("2026-10-09T12:00:00.000Z");
    const now = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    mocks.queryFirstPartyAnalytics
      .mockResolvedValueOnce({ rows: journeyRows(), schema: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            terminal_step_key: "onboarding:completed",
            cohort_sessions: 1,
            later_recorded_activity: 1,
          },
          {
            terminal_step_key: "signup",
            cohort_sessions: 1,
            later_recorded_activity: 0,
          },
          {
            terminal_step_key: "step:role",
            cohort_sessions: 1,
            later_recorded_activity: 0,
          },
        ],
        schema: [],
      });

    const tree = (await getOnboardingJourney(scope, ARGS)) as JourneyTree;
    const cutoff = "2026-10-03T00:00:00.000Z";
    expect(now).toHaveBeenCalledTimes(1);
    expect(tree.followUp).toEqual({
      status: "complete",
      observationCutoff: cutoff,
      observationFollowupDurationMs: {
        min: Date.parse(cutoff) - (T0 + 10_000),
        max: Date.parse(cutoff) - T0,
        mean: Date.parse(cutoff) - (T0 + 5_000),
      },
      rightCensoredAtWindowEnd: true,
      coverage: {
        journeyEventRead: {
          rows: 6,
          pages: 1,
          truncated: false,
          paginationConsistency: "stable",
        },
        followupAggregateRead: { rows: 3, queries: 1, truncated: false },
        cohortSessions: 3,
      },
      laterRecordedActivityWithinWindow: {
        total: 1,
        byTerminalStepKey: {
          "onboarding:completed": 1,
          signup: 0,
          "step:role": 0,
        },
      },
      noLaterRecordedActivityWithinWindow: {
        total: 2,
        byTerminalStepKey: {
          "onboarding:completed": 0,
          signup: 1,
          "step:role": 1,
        },
      },
    });
    const followupSql = mocks.queryFirstPartyAnalytics.mock
      .calls[1]![0] as string;
    expect(followupSql).toContain(cutoff);
    expect(followupSql).toContain("'s1' AS session_id");
    expect(followupSql).toContain(
      "'onboarding:completed' AS terminal_step_key",
    );
    expect(followupSql).toContain(
      "NULLIF('2026-10-01T12:00:10.000Z', '')::timestamptz",
    );
    now.mockRestore();
  });

  it("keeps selected tree counts but nulls follow-up cohorts when journey events truncate", async () => {
    const rows = [
      eventRow("s1", "signup", 0),
      eventRow("s1", "onboarding_completed", 5),
      eventRow("s2", "signup", 0),
      eventRow("s2", "onboarding_completed", 5),
    ];
    mocks.queryFirstPartyAnalytics.mockResolvedValue({ rows, schema: [] });
    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 3,
    })) as JourneyTree;

    expect(tree.rootN).toBe(1);
    expect(tree.coverage.truncated).toBe(true);
    expect(tree.followUp).toMatchObject({
      status: "incomplete",
      rightCensoredAtWindowEnd: true,
      coverage: {
        journeyEventRead: { truncated: true },
        followupAggregateRead: { rows: null, queries: 0, truncated: false },
        cohortSessions: null,
      },
      laterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      noLaterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      observationFollowupDurationMs: null,
    });
    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledTimes(1);
  });

  it("nulls all follow-up cohort counts when the aggregate query truncates", async () => {
    mocks.queryFirstPartyAnalytics
      .mockResolvedValueOnce({ rows: journeyRows(), schema: [] })
      .mockResolvedValueOnce({ rows: [], schema: [], truncated: true });

    const tree = (await getOnboardingJourney(scope, ARGS)) as JourneyTree;

    expect(tree.rootN).toBe(3);
    expect(tree.followUp.status).toBe("incomplete");
    expect(tree.followUp.incompleteReason).toBe("followup_aggregate_truncated");
    expect(tree.followUp.coverage.followupAggregateRead).toEqual({
      rows: null,
      queries: 1,
      truncated: true,
    });
    expect(tree.followUp.coverage.cohortSessions).toBeNull();
    expect(tree.followUp.laterRecordedActivityWithinWindow.total).toBeNull();
    expect(tree.followUp.noLaterRecordedActivityWithinWindow.total).toBeNull();
  });

  it("marks multi-page offset reads incomplete while preserving the tree", async () => {
    const firstPage = Array.from({ length: 4000 }, (_, index) =>
      eventRow(`page-${String(index).padStart(4, "0")}`, "signup", index),
    );
    const pageQueue = [firstPage, [eventRow("last-page", "signup", 4000)]];
    const querySql: string[] = [];
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-10-09T12:00:00.000Z"));
    mocks.queryFirstPartyAnalytics.mockImplementation(async (sql: string) => {
      querySql.push(sql);
      if (sql.includes("terminal_steps AS (")) {
        const cohortSessions = sql.match(/ AS session_id/g)?.length ?? 0;
        return {
          rows: [
            {
              terminal_step_key: "signup",
              cohort_sessions: cohortSessions,
              later_recorded_activity: 0,
            },
          ],
          schema: [],
        };
      }
      return { rows: pageQueue.shift() ?? [], schema: [] };
    });
    mocks.listJourneyRecordings.mockResolvedValue({
      recordings: [],
      complete: true,
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 5000,
    })) as JourneyTree;
    const cutoff = "2026-10-03T00:00:00.000Z";
    const eventSql = querySql.filter(
      (sql) => !sql.includes("terminal_steps AS ("),
    );
    const followupSql = querySql.filter((sql) =>
      sql.includes("terminal_steps AS ("),
    );

    expect(now).toHaveBeenCalledTimes(1);
    expect(eventSql).toHaveLength(2);
    expect(followupSql).toHaveLength(0);
    expect(querySql.every((sql) => sql.includes(cutoff))).toBe(true);
    expect(tree.notes?.join(" ")).toMatch(
      /2 OFFSET pages.*late-arriving events.*in any window.*incomplete/,
    );
    expect(tree.followUp).toMatchObject({
      status: "incomplete",
      observationCutoff: cutoff,
      rightCensoredAtWindowEnd: true,
      coverage: {
        journeyEventRead: {
          rows: 4001,
          pages: 2,
          truncated: false,
          paginationConsistency: "may_have_shifted",
        },
        followupAggregateRead: { rows: null, queries: 0, truncated: false },
        cohortSessions: null,
      },
      laterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      noLaterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      observationFollowupDurationMs: null,
    });
    now.mockRestore();
  });

  it("aggregates a complete one-page cohort in one follow-up query", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) =>
      eventRow(`cohort-${String(index).padStart(4, "0")}`, "signup", index),
    );
    const querySql: string[] = [];
    mocks.queryFirstPartyAnalytics.mockImplementation(async (sql: string) => {
      querySql.push(sql);
      if (sql.includes("terminal_steps AS (")) {
        const cohortSessions = sql.match(/ AS session_id/g)?.length ?? 0;
        return {
          rows: [
            {
              terminal_step_key: "signup",
              cohort_sessions: cohortSessions,
              later_recorded_activity: 0,
            },
          ],
          schema: [],
        };
      }
      return { rows, schema: [] };
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 2000,
    })) as JourneyTree;
    const cutoff = "2026-10-03T00:00:00.000Z";
    const eventSql = querySql.filter(
      (sql) => !sql.includes("terminal_steps AS ("),
    );
    const followupSql = querySql.filter((sql) =>
      sql.includes("terminal_steps AS ("),
    );

    expect(eventSql).toHaveLength(1);
    expect(followupSql).toHaveLength(1);
    expect(querySql.every((sql) => sql.includes(cutoff))).toBe(true);
    expect(tree.rootN).toBe(1001);
    expect(tree.followUp).toMatchObject({
      status: "complete",
      observationCutoff: cutoff,
      coverage: {
        journeyEventRead: {
          rows: 1001,
          pages: 1,
          truncated: false,
          paginationConsistency: "stable",
        },
        followupAggregateRead: { rows: 1, queries: 1, truncated: false },
        cohortSessions: 1001,
      },
      laterRecordedActivityWithinWindow: {
        total: 0,
        byTerminalStepKey: { signup: 0 },
      },
      noLaterRecordedActivityWithinWindow: {
        total: 1001,
        byTerminalStepKey: { signup: 1001 },
      },
    });
  });

  it("preserves the tree when a terminal cohort exceeds the SQL parser token limit", async () => {
    const rows = Array.from({ length: 3000 }, (_, index) =>
      eventRow(`cohort-${String(index).padStart(4, "0")}`, "signup", index),
    );
    mocks.queryFirstPartyAnalytics.mockResolvedValue({ rows, schema: [] });
    mocks.listJourneyRecordings.mockResolvedValue({
      recordings: [],
      complete: true,
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 4000,
    })) as JourneyTree;

    expect(tree.rootN).toBe(3000);
    expect(tree.nodes[0]?.n).toBe(3000);
    expect(tree.coverage.truncated).toBe(false);
    expect(tree.followUp).toMatchObject({
      status: "incomplete",
      incompleteReason: "terminal_cohort_query_too_large",
      coverage: {
        followupAggregateRead: { rows: null, queries: 0, truncated: false },
        cohortSessions: null,
      },
      laterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      noLaterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      observationFollowupDurationMs: null,
    });
    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledTimes(1);
  });

  it("returns an incomplete follow-up when valid terminal rows exceed the SQL text cap", async () => {
    const terminals = Array.from({ length: 2200 }, (_, index) => ({
      sessionId: `${String(index).padStart(4, "0")}-${"x".repeat(248)}`,
      stepKey: "signup",
      tsMs: T0,
    }));
    const filters: OnboardingJourneyEventsFilters = {
      dateFrom: ARGS.dateFrom,
      dateTo: ARGS.dateTo,
      app: ARGS.app,
      emailFilter: ARGS.emailFilter,
    };
    const sql = buildOnboardingJourneyFollowupSql(filters, terminals, {
      observationCutoff: "2026-10-03T00:00:00.000Z",
      observationDate: "2026-10-03",
    });
    expect(sql.length).toBeGreaterThan(800_000);
    expect(
      lexAgentSql(sql, { dialect: "postgres" }).length,
    ).toBeLessThanOrEqual(50_000);

    const rows = terminals.map(({ sessionId }, index) =>
      eventRow(sessionId, "signup", index),
    );
    mocks.queryFirstPartyAnalytics.mockResolvedValue({ rows, schema: [] });
    mocks.listJourneyRecordings.mockResolvedValue({
      recordings: [],
      complete: true,
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 3000,
    })) as JourneyTree;

    expect(tree.rootN).toBe(2200);
    expect(tree.nodes[0]?.n).toBe(2200);
    expect(tree.followUp).toMatchObject({
      status: "incomplete",
      incompleteReason: "terminal_cohort_query_too_large",
      coverage: {
        followupAggregateRead: { rows: null, queries: 0, truncated: false },
        cohortSessions: null,
      },
      laterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      noLaterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      observationFollowupDurationMs: null,
    });
    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledTimes(1);
  });

  it("nulls follow-up counts when aggregate session coverage mismatches", async () => {
    mocks.queryFirstPartyAnalytics
      .mockResolvedValueOnce({ rows: journeyRows(), schema: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            terminal_step_key: "signup",
            cohort_sessions: 2,
            later_recorded_activity: 1,
          },
          {
            terminal_step_key: "step:role",
            cohort_sessions: 1,
            later_recorded_activity: 0,
          },
          {
            terminal_step_key: "onboarding:completed",
            cohort_sessions: 1,
            later_recorded_activity: 0,
          },
        ],
        schema: [],
      });

    const tree = (await getOnboardingJourney(scope, ARGS)) as JourneyTree;

    expect(tree.rootN).toBe(3);
    expect(tree.followUp).toMatchObject({
      status: "incomplete",
      incompleteReason: "terminal_cohort_mismatch",
      coverage: {
        followupAggregateRead: { rows: 3, queries: 1, truncated: false },
        cohortSessions: null,
      },
      laterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      noLaterRecordedActivityWithinWindow: {
        total: null,
        byTerminalStepKey: null,
      },
      observationFollowupDurationMs: null,
    });
  });

  it("omits replayUrl when the request has no origin", async () => {
    mocks.requestOrigin = undefined;
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows(),
      schema: [],
    });
    const tree = (await getOnboardingJourney(scope, ARGS)) as JourneyTree;
    expect(tree.nodes[0]!.examples[0]).not.toHaveProperty("replayUrl");
  });

  it("returns standalone chat setup sessions with a separate denominator", async () => {
    const standaloneRows = [
      eventRow("home-setup", "pageview", 1, {
        path: "/home",
        journey_kind: "standalone_setup",
      }),
      eventRow("home-setup", "integration_setup_exposed", 2, {
        flow: "chat_setup",
        method_id: "setup_card",
        journey_kind: "standalone_setup",
      }),
      eventRow("home-setup", "integration_method_clicked", 3, {
        flow: "chat_setup",
        method_id: "custom_keys",
        journey_kind: "standalone_setup",
      }),
      eventRow("home-setup", "integration_method_outcome", 4, {
        flow: "chat_setup",
        method_id: "custom_keys",
        outcome: "credential_saved",
        journey_kind: "standalone_setup",
      }),
    ];
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [...journeyRows(), ...standaloneRows],
      schema: [],
    });
    mocks.listJourneyRecordings.mockResolvedValue({
      recordings: [
        recordingFor("s1"),
        recordingFor("s2"),
        recordingFor("home-setup"),
      ],
      complete: true,
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxNodes: 3,
    })) as JourneyTree;

    expect(tree.rootN).toBe(3);
    expect(tree.coverage.sessionsWithEvents).toBe(3);
    expect(tree.coverage.sessionsWithReplay).toBe(2);
    expect(tree.nodes[0]?.key).toBe("signup");
    expect(tree.coverage.truncated).toBe(false);
    expect(tree.standaloneSetup).toMatchObject({
      rootN: 1,
      coverage: {
        sessionsWithEvents: 1,
        sessionsWithReplay: 1,
        truncated: true,
      },
    });
    expect(tree.standaloneSetup?.nodes.map((node) => node.key)).toEqual([
      "page:/home",
      "page:/home > integration:chat_setup:exposed:setup_card",
      "page:/home > integration:chat_setup:exposed:setup_card > integration:chat_setup:method:custom_keys",
    ]);
    expect(tree.standaloneSetup?.nodes[2]).toMatchObject({ deeperN: 1 });
  });

  it("flags a cut event read instead of presenting a partial tree as whole", async () => {
    // maxEventRows 3 reads one row past the budget; the 4th row proves a cut.
    const rows = [
      eventRow("s1", "signup", 0),
      eventRow("s1", "onboarding_completed", 5),
      eventRow("s2", "signup", 0),
      eventRow("s2", "onboarding_completed", 5),
    ];
    mocks.queryFirstPartyAnalytics.mockResolvedValue({ rows, schema: [] });
    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 3,
    })) as JourneyTree;

    expect(mocks.queryFirstPartyAnalytics.mock.calls[0]![0]).toMatch(
      /LIMIT 4 OFFSET 0$/,
    );
    expect(tree.coverage.truncated).toBe(true);
    // s2 was cut off mid-session, so it is not in the tree.
    expect(tree.rootN).toBe(1);
    expect(tree.notes?.join(" ")).toMatch(
      /maxEventRows=3.*last onboarding session/,
    );
  });

  it("keeps onboarding coverage complete when only standalone rows exceed the read cap", async () => {
    const standaloneRows = [
      eventRow("home-a", "pageview", 1, {
        path: "/home",
        journey_kind: "standalone_setup",
      }),
      eventRow("home-b", "pageview", 1, {
        path: "/home",
        journey_kind: "standalone_setup",
      }),
      eventRow("home-b", "integration_setup_exposed", 2, {
        flow: "chat_setup",
        method_id: "setup_card",
        journey_kind: "standalone_setup",
      }),
    ];
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [...journeyRows(), ...standaloneRows],
      schema: [],
    });
    mocks.listJourneyRecordings.mockResolvedValue({
      recordings: [...["s1", "s2", "s3", "home-a"].map(recordingFor)],
      complete: true,
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 8,
    })) as JourneyTree;

    expect(tree.coverage.truncated).toBe(false);
    expect(tree.standaloneSetup?.coverage).toMatchObject({
      sessionsWithEvents: 1,
      truncated: true,
    });
    expect(tree.notes?.join(" ")).toMatch(
      /standalone setup results may be incomplete or absent/,
    );
    expect(tree.notes?.join(" ")).not.toMatch(
      /onboarding counts are a partial sample/,
    );
  });

  it("marks unseen standalone results incomplete when onboarding exhausts the row cap", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [
        eventRow("cohort", "signup", 1),
        eventRow("cohort", "onboarding_completed", 2),
        eventRow("later-cohort", "signup", 3),
        eventRow("home-setup", "integration_setup_exposed", 4, {
          flow: "chat_setup",
          method_id: "setup_card",
          journey_kind: "standalone_setup",
        }),
      ],
      schema: [],
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 2,
    })) as JourneyTree;

    expect(tree.coverage.truncated).toBe(true);
    expect(tree.standaloneSetup).toMatchObject({
      rootN: 0,
      coverage: {
        sessionsWithEvents: 0,
        truncated: true,
      },
      nodes: [],
    });
    expect(tree.notes?.join(" ")).toMatch(
      /maxEventRows=2.*standalone setup results may be incomplete or absent/,
    );
  });

  it("does not flag a read that ends exactly at the budget", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows().slice(0, 3),
      schema: [],
    });
    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 3,
    })) as JourneyTree;
    expect(tree.coverage.truncated).toBe(false);
    expect(tree).not.toHaveProperty("notes");
  });

  it("pages through large reads with OFFSET and de-duplicates by event id", async () => {
    const firstPage = Array.from({ length: 4000 }, (_, i) =>
      eventRow(`p${String(i).padStart(5, "0")}`, "signup", i),
    );
    const secondPage = [firstPage[3999]!, eventRow("z-last", "signup", 0)];
    mocks.queryFirstPartyAnalytics
      .mockResolvedValueOnce({ rows: firstPage, schema: [] })
      .mockResolvedValueOnce({ rows: secondPage, schema: [] })
      .mockResolvedValue({ rows: [], schema: [] });
    mocks.listJourneyRecordings.mockResolvedValue({
      recordings: [],
      complete: true,
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxEventRows: 10_000,
    })) as JourneyTree;
    expect(mocks.queryFirstPartyAnalytics.mock.calls[1]![0]).toMatch(
      /LIMIT 4000 OFFSET 4000$/,
    );
    expect(tree.rootN).toBe(4001);
    expect(tree.coverage.truncated).toBe(false);
    expect(tree.notes?.join(" ")).toMatch(
      /2 OFFSET pages.*late-arriving events.*in any window.*incomplete/,
    );
  });

  it("warns that multi-page OFFSET reads can shift tree rows", async () => {
    const firstPage = Array.from({ length: 4000 }, (_, i) =>
      eventRow(`p${String(i).padStart(5, "0")}`, "signup", i),
    );
    mocks.queryFirstPartyAnalytics
      .mockResolvedValueOnce({ rows: firstPage, schema: [] })
      .mockResolvedValueOnce({
        rows: [eventRow("z-last", "signup", 0)],
        schema: [],
      })
      .mockResolvedValue({ rows: [], schema: [] });
    mocks.listJourneyRecordings.mockResolvedValue({
      recordings: [],
      complete: true,
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      dateTo: new Date().toISOString().slice(0, 10),
      maxEventRows: 10_000,
    })) as JourneyTree;
    expect(tree.notes?.join(" ")).toMatch(
      /2 OFFSET pages.*late-arriving events.*in any window.*incomplete/,
    );
    expect(tree.followUp.status).toBe("incomplete");
    expect(tree.followUp.coverage.journeyEventRead.paginationConsistency).toBe(
      "may_have_shifted",
    );
    expect(tree.followUp.laterRecordedActivityWithinWindow.total).toBeNull();
    expect(tree.followUp.noLaterRecordedActivityWithinWindow.total).toBeNull();

    mocks.queryFirstPartyAnalytics.mockReset();
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows(),
      schema: [],
    });
    const single = (await getOnboardingJourney(scope, {
      ...ARGS,
      dateTo: new Date().toISOString().slice(0, 10),
    })) as JourneyTree;
    expect(single).not.toHaveProperty("notes");
  });

  it("counts rows it cannot read, and says so", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [
        ...journeyRows(),
        { ...eventRow("s9", "signup", 0), timestamp: "x" },
      ],
      schema: [],
    });
    const tree = (await getOnboardingJourney(scope, ARGS)) as JourneyTree;
    expect(tree.rootN).toBe(3);
    expect(tree.notes?.join(" ")).toMatch(/1 event rows had no id/);
  });

  it("cuts to maxNodes keeping the largest nodes, and flags it", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows(),
      schema: [],
    });
    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxNodes: 2,
    })) as JourneyTree;
    expect(tree.nodes.map((node) => node.key)).toEqual([
      "signup",
      "signup > step:role",
    ]);
    expect(tree.coverage.truncated).toBe(true);
    expect(tree.notes?.join(" ")).toMatch(/cut to the 2 largest of 3/);
    expect(tree.nodes[1]).toMatchObject({ deeperN: 1 });
  });

  it("fails loudly when recordings are unreadable or incomplete for a tree", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows(),
      schema: [],
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listJourneyRecordings.mockRejectedValueOnce(new Error("db down"));
    await expect(getOnboardingJourney(scope, ARGS)).rejects.toBeInstanceOf(
      JourneyRecordingsError,
    );
    mocks.listJourneyRecordings.mockResolvedValueOnce({
      recordings: [],
      complete: false,
    });
    await expect(getOnboardingJourney(scope, ARGS)).rejects.toBeInstanceOf(
      JourneyRecordingsError,
    );
    log.mockRestore();
  });

  it("does not turn an unreadable event store into an empty tree", async () => {
    mocks.queryFirstPartyAnalytics.mockRejectedValue(new Error("bq timeout"));
    await expect(getOnboardingJourney(scope, ARGS)).rejects.toThrow(
      "bq timeout",
    );
  });

  it("gives an empty window an empty tree with zero coverage", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({ rows: [], schema: [] });
    const tree = (await getOnboardingJourney(scope, ARGS)) as JourneyTree;
    expect(tree).toMatchObject({
      rootN: 0,
      nodes: [],
      coverage: {
        sessionsWithEvents: 0,
        sessionsWithReplay: 0,
        truncated: false,
      },
    });
    expect(mocks.listJourneyRecordings).not.toHaveBeenCalled();
  });
});

describe("summary format", () => {
  it("returns an indented outline with counts and drop-off, no examples", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows(),
      schema: [],
    });
    const summary = (await getOnboardingJourney(scope, {
      ...ARGS,
      format: "summary",
    })) as JourneySummary;
    expect(summary.format).toBe("summary");
    expect(summary.coverage.sessionsWithReplay).toBe(2);
    expect(summary.coverage.truncated).toBe(false);
    expect(summary.outline.split("\n")).toEqual([
      "Signed up - n=3 (100% of all, 100% of parent), dropoff 1 (33.33%)",
      "  Onboarding step: role - n=2 (66.67% of all, 66.67% of parent), dropoff 1 (50%)",
      "    Onboarding completed - n=1 (33.33% of all, 50% of parent), dropoff 1 (100%)",
    ]);
    expect(summary).not.toHaveProperty("nodes");
  });

  it("reports an unreadable recordings read as unknown, never zero", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows(),
      schema: [],
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listJourneyRecordings.mockRejectedValueOnce(new Error("db down"));
    const summary = (await getOnboardingJourney(scope, {
      ...ARGS,
      format: "summary",
    })) as JourneySummary;
    expect(summary.coverage.sessionsWithReplay).toBeNull();
    log.mockRestore();
  });

  it("labels continuation omitted by the node cap without adding it to drop-off", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows(),
      schema: [],
    });
    const summary = (await getOnboardingJourney(scope, {
      ...ARGS,
      format: "summary",
      maxNodes: 2,
    })) as JourneySummary;

    expect(summary.coverage.truncated).toBe(true);
    expect(summary.outline.split("\n")).toEqual([
      "Signed up - n=3 (100% of all, 100% of parent), dropoff 1 (33.33%)",
      "  Onboarding step: role - n=2 (66.67% of all, 66.67% of parent), dropoff 1 (50%), deeperN=1 continue below this node",
    ]);
  });

  it("says how many sessions carried on past the depth cap", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: journeyRows(),
      schema: [],
    });
    const summary = (await getOnboardingJourney(scope, {
      ...ARGS,
      format: "summary",
      maxDepth: 2,
    })) as JourneySummary;
    expect(summary.outline.split("\n")).toEqual([
      "Signed up - n=3 (100% of all, 100% of parent), dropoff 1 (33.33%)",
      "  Onboarding step: role - n=2 (66.67% of all, 66.67% of parent), dropoff 1 (50%), 1 continue past depth 2",
    ]);
    expect(summary.coverage.truncated).toBe(true);
    expect(summary.notes?.join(" ")).toMatch(/maxDepth=2.*deeperN/);
  });

  it("tracks standalone setup depth and replay coverage separately", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [
        eventRow("cohort", "signup", 1),
        eventRow("home-setup", "pageview", 1, {
          path: "/home",
          journey_kind: "standalone_setup",
        }),
        eventRow("home-setup", "integration_setup_exposed", 2, {
          flow: "chat_setup",
          method_id: "setup_card",
          journey_kind: "standalone_setup",
        }),
        eventRow("home-setup", "integration_method_clicked", 3, {
          flow: "chat_setup",
          method_id: "custom_keys",
          journey_kind: "standalone_setup",
        }),
      ],
      schema: [],
    });
    mocks.listJourneyRecordings.mockResolvedValue({
      recordings: [recordingFor("cohort"), recordingFor("home-setup")],
      complete: true,
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxDepth: 2,
    })) as JourneyTree;

    expect(tree.coverage).toMatchObject({
      sessionsWithEvents: 1,
      sessionsWithReplay: 1,
      truncated: false,
    });
    expect(tree.standaloneSetup?.coverage).toMatchObject({
      sessionsWithEvents: 1,
      sessionsWithReplay: 1,
      truncated: true,
    });
    expect(tree.standaloneSetup?.nodes[1]).toMatchObject({ deeperN: 1 });
    expect(tree.notes?.join(" ")).toMatch(/standalone setup sessions continue/);
  });

  it("flags onboarding depth without marking a short standalone tree", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [
        eventRow("cohort", "signup", 1),
        eventRow("cohort", "onboarding_completed", 2),
        eventRow("home-setup", "integration_setup_exposed", 1, {
          flow: "chat_setup",
          method_id: "setup_card",
          journey_kind: "standalone_setup",
        }),
      ],
      schema: [],
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      maxDepth: 1,
    })) as JourneyTree;

    expect(tree.coverage.truncated).toBe(true);
    expect(tree.nodes[0]).toMatchObject({ deeperN: 1 });
    expect(tree.standaloneSetup?.coverage.truncated).toBe(false);
    expect(tree.standaloneSetup?.nodes[0]).toMatchObject({ deeperN: 0 });
  });

  it("formats an empty tree as an empty outline", () => {
    expect(formatJourneyOutline([], 8)).toBe("");
  });
});
