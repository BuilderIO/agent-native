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
    path: null,
    flow: null,
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
    expect(parseJourneyEventRow(eventRow("s1", "signup", 0))).toMatchObject({
      sessionId: "s1",
      eventName: "signup",
      tsMs: T0,
    });
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
    expect(tree.notes?.join(" ")).toMatch(/maxEventRows=3.*last session/);
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
      .mockResolvedValueOnce({ rows: secondPage, schema: [] });
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
    expect(tree).not.toHaveProperty("notes");
  });

  it("says a multi-page read of a window that includes today can miss rows at the live edge", async () => {
    const firstPage = Array.from({ length: 4000 }, (_, i) =>
      eventRow(`p${String(i).padStart(5, "0")}`, "signup", i),
    );
    mocks.queryFirstPartyAnalytics
      .mockResolvedValueOnce({ rows: firstPage, schema: [] })
      .mockResolvedValueOnce({
        rows: [eventRow("z-last", "signup", 0)],
        schema: [],
      });
    mocks.listJourneyRecordings.mockResolvedValue({
      recordings: [],
      complete: true,
    });

    const tree = (await getOnboardingJourney(scope, {
      ...ARGS,
      dateTo: new Date().toISOString().slice(0, 10),
      maxEventRows: 10_000,
    })) as JourneyTree;
    expect(tree.notes?.join(" ")).toMatch(/includes today.*2 pages.*live edge/);

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
  });

  it("formats an empty tree as an empty outline", () => {
    expect(formatJourneyOutline([], 8)).toBe("");
  });
});
