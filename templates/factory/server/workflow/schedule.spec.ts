import { isValidCron, nextOccurrence } from "@agent-native/core/jobs";
import { describe, expect, it } from "vitest";

import {
  workflowGraphSchema,
  type WorkflowGraph,
  type WorkflowNodeOfKind,
} from "./contract.js";
import {
  SUPPORTED_CHECK_CADENCES_MINUTES,
  WorkflowScheduleError,
  deriveJobSchedule,
  nextTriggerDue,
  type TriggerSettings,
} from "./schedule.js";

type NodeInput = Record<string, unknown>;

function trigger(settings: NodeInput, id = "start"): NodeInput {
  return {
    id,
    kind: "trigger",
    name: `Trigger_${id}`,
    position: { x: 0, y: 0 },
    settings,
  };
}

function waitNode(): NodeInput {
  return {
    id: "pause",
    kind: "wait",
    name: "Pause",
    position: { x: 0, y: 0 },
    settings: { wait: "time", duration: { amount: 1, unit: "hours" } },
  };
}

function graphOf(
  nodes: NodeInput[],
  settings: Record<string, unknown> = {},
): WorkflowGraph {
  return workflowGraphSchema.parse({ nodes, edges: [], settings });
}

function settingsOf(
  schedule: Record<string, unknown>,
  timezone?: string,
): TriggerSettings {
  const graph = graphOf([trigger({ schedule, timezone })]);
  const node = graph.nodes[0] as WorkflowNodeOfKind<"trigger">;
  return node.settings;
}

const NEW_YORK = "America/New_York";

describe("deriveJobSchedule: the Trigger's own cadence when nothing waits", () => {
  it.each([
    [{ every: "5m" }, "*/5 * * * *", "every"],
    [{ every: "10m" }, "*/10 * * * *", "every"],
    [{ every: "60m" }, "0 * * * *", "every"],
    [{ daily: { at: "07:00" } }, "0 7 * * *", "daily"],
    [{ daily: { at: "23:45" } }, "45 23 * * *", "daily"],
    [{ weekdays: { at: "08:00" } }, "0 8 * * 1-5", "weekdays"],
    [{ weekly: { day: 0, at: "09:30" } }, "30 9 * * 0", "weekly"],
    [{ weekly: { day: 6, at: "00:05" } }, "5 0 * * 6", "weekly"],
  ])("%j becomes %s", (schedule, cron, triggerKind) => {
    const derived = deriveJobSchedule(
      graphOf([trigger({ schedule, timezone: NEW_YORK })]),
    );
    expect(derived).toEqual({
      cron,
      timezone: NEW_YORK,
      hasWait: false,
      triggerKind,
    });
    expect(isValidCron(derived.cron)).toBe(true);
  });

  it("leaves the zone out of an `every` schedule that names none", () => {
    expect(
      deriveJobSchedule(graphOf([trigger({ schedule: { every: "15m" } })])),
    ).toMatchObject({ cron: "*/15 * * * *", timezone: null });
  });

  it("takes the zone from the workflow settings when the Trigger has none", () => {
    const derived = deriveJobSchedule(
      graphOf([trigger({ schedule: { weekdays: { at: "08:00" } } })], {
        timezone: "Europe/London",
      }),
    );
    expect(derived.timezone).toBe("Europe/London");
  });

  it("lets the Trigger's own zone win over the workflow's", () => {
    const derived = deriveJobSchedule(
      graphOf(
        [
          trigger({
            schedule: { daily: { at: "08:00" } },
            timezone: "Asia/Tokyo",
          }),
        ],
        { timezone: "Europe/London" },
      ),
    );
    expect(derived.timezone).toBe("Asia/Tokyo");
  });

  it("refuses a time-of-day Trigger with no zone anywhere", () => {
    for (const schedule of [
      { daily: { at: "08:00" } },
      { weekdays: { at: "08:00" } },
      { weekly: { day: 1, at: "08:00" } },
    ]) {
      const attempt = () =>
        deriveJobSchedule(graphOf([trigger({ schedule }, "morning")]));
      expect(attempt).toThrow(WorkflowScheduleError);
      expect(attempt).toThrow(/time zone/);
      try {
        attempt();
      } catch (error) {
        expect(error).toMatchObject({
          code: "timezone_required",
          nodeId: "morning",
        });
      }
    }
  });

  it("refuses a graph that has no Trigger or more than one", () => {
    expect(() => deriveJobSchedule(graphOf([]))).toThrow(
      expect.objectContaining({ code: "trigger_count" }),
    );
    expect(() =>
      deriveJobSchedule(
        graphOf([
          trigger({ schedule: { every: "5m" } }, "a"),
          trigger({ schedule: { every: "5m" } }, "b"),
        ]),
      ),
    ).toThrow(expect.objectContaining({ code: "trigger_count" }));
  });

  it("does not read the check cadence when nothing waits", () => {
    const derived = deriveJobSchedule(
      graphOf([trigger({ schedule: { every: "30m" } })], {
        checkCadenceMinutes: 7,
      }),
    );
    expect(derived.cron).toBe("*/30 * * * *");
  });
});

describe("deriveJobSchedule: the finer clock when a Wait parks items", () => {
  const withWait = (
    schedule: Record<string, unknown>,
    settings: Record<string, unknown> = {},
    timezone: string | undefined = NEW_YORK,
  ) =>
    deriveJobSchedule(
      graphOf([trigger({ schedule, timezone }), waitNode()], settings),
    );

  it("ticks at the default 15 minutes for a daily Trigger and says it waits", () => {
    expect(withWait({ daily: { at: "08:00" } })).toEqual({
      cron: "*/15 * * * *",
      timezone: NEW_YORK,
      hasWait: true,
      triggerKind: "daily",
    });
  });

  it("ticks at the check cadence the workflow sets", () => {
    expect(
      withWait({ weekdays: { at: "08:00" } }, { checkCadenceMinutes: 30 }).cron,
    ).toBe("*/30 * * * *");
    expect(
      withWait({ weekly: { day: 1, at: "08:00" } }, { checkCadenceMinutes: 60 })
        .cron,
    ).toBe("0 * * * *");
  });

  it("keeps a shorter Trigger cadence so new items are not delayed", () => {
    expect(withWait({ every: "5m" }, {}, undefined).cron).toBe("*/5 * * * *");
    expect(
      withWait({ every: "10m" }, { checkCadenceMinutes: 5 }, undefined).cron,
    ).toBe("*/5 * * * *");
  });

  it("uses the check cadence when it is the shorter clock", () => {
    expect(withWait({ every: "60m" }, {}, undefined).cron).toBe("*/15 * * * *");
  });

  it("expresses whole-hour cadences that divide the day", () => {
    expect(
      withWait({ daily: { at: "08:00" } }, { checkCadenceMinutes: 120 }).cron,
    ).toBe("0 */2 * * *");
    expect(
      withWait({ daily: { at: "08:00" } }, { checkCadenceMinutes: 1440 }).cron,
    ).toBe("0 0 * * *");
  });

  it("accepts exactly the cadences that repeat evenly, and every one is valid cron", () => {
    for (let minutes = 5; minutes <= 1440; minutes += 1) {
      const attempt = () =>
        withWait({ daily: { at: "08:00" } }, { checkCadenceMinutes: minutes });
      if (
        (SUPPORTED_CHECK_CADENCES_MINUTES as readonly number[]).includes(
          minutes,
        )
      ) {
        expect(isValidCron(attempt().cron)).toBe(true);
      } else {
        expect(attempt).toThrow(
          expect.objectContaining({ code: "cadence_unsupported" }),
        );
      }
    }
  });

  it("refuses an uneven check cadence even when the Trigger is the shorter clock", () => {
    expect(() =>
      withWait({ every: "5m" }, { checkCadenceMinutes: 45 }, undefined),
    ).toThrow(expect.objectContaining({ code: "cadence_unsupported" }));
    expect(() =>
      withWait({ daily: { at: "08:00" } }, { checkCadenceMinutes: 300 }),
    ).toThrow(/does not repeat evenly/);
  });
});

describe("nextTriggerDue: weekdays at 08:00 in New York", () => {
  const settings = settingsOf({ weekdays: { at: "08:00" } }, NEW_YORK);
  const due = (last: string | null, now: string) =>
    nextTriggerDue(settings, last, now, NEW_YORK);

  it("is due at 08:00 local on a weekday, which is 12:00Z in October", () => {
    expect(due("2026-10-16T12:00:00.000Z", "2026-10-19T12:07:30.000Z")).toBe(
      "2026-10-19T12:00:00.000Z",
    );
  });

  it("is not due a second before 08:00", () => {
    expect(
      due("2026-10-16T12:00:00.000Z", "2026-10-19T11:59:59.000Z"),
    ).toBeNull();
  });

  it("is not due again for the same morning", () => {
    expect(
      due("2026-10-19T12:00:00.000Z", "2026-10-19T12:20:00.000Z"),
    ).toBeNull();
  });

  it("skips the weekend and fires on Monday", () => {
    expect(
      due("2026-10-16T12:00:00.000Z", "2026-10-17T15:00:00.000Z"),
    ).toBeNull();
    expect(
      due("2026-10-16T12:00:00.000Z", "2026-10-18T23:59:00.000Z"),
    ).toBeNull();
    expect(due("2026-10-16T12:00:00.000Z", "2026-10-19T12:15:00.000Z")).toBe(
      "2026-10-19T12:00:00.000Z",
    );
  });

  it("collapses several missed mornings into one fire for the latest", () => {
    expect(due("2026-10-14T12:00:00.000Z", "2026-10-19T12:10:00.000Z")).toBe(
      "2026-10-19T12:00:00.000Z",
    );
  });

  it("is 13:00Z in winter, when New York is on standard time", () => {
    expect(due("2026-12-04T13:00:00.000Z", "2026-12-07T13:02:00.000Z")).toBe(
      "2026-12-07T13:00:00.000Z",
    );
    expect(
      due("2026-12-04T13:00:00.000Z", "2026-12-07T12:59:00.000Z"),
    ).toBeNull();
  });

  it("is never due for an instant that is later than now", () => {
    expect(
      due("2026-10-21T12:00:00.000Z", "2026-10-19T12:07:30.000Z"),
    ).toBeNull();
  });

  it("accepts Date objects as well as ISO strings", () => {
    expect(
      nextTriggerDue(
        settings,
        new Date("2026-10-16T12:00:00.000Z"),
        new Date("2026-10-19T12:07:30.000Z"),
        NEW_YORK,
      ),
    ).toBe("2026-10-19T12:00:00.000Z");
  });
});

describe("nextTriggerDue: a Trigger that has never fired", () => {
  const settings = settingsOf({ weekdays: { at: "08:00" } }, NEW_YORK);

  it("fires for an instant it just missed", () => {
    expect(
      nextTriggerDue(settings, null, "2026-10-19T12:10:00.000Z", NEW_YORK),
    ).toBe("2026-10-19T12:00:00.000Z");
  });

  it("does not send the morning digest at once when enabled in the afternoon", () => {
    expect(
      nextTriggerDue(settings, null, "2026-10-19T18:00:00.000Z", NEW_YORK),
    ).toBeNull();
  });

  it("looks back as far as the caller allows", () => {
    expect(
      nextTriggerDue(settings, null, "2026-10-19T12:10:00.000Z", NEW_YORK, {
        firstRunLookbackMinutes: 5,
      }),
    ).toBeNull();
    expect(
      nextTriggerDue(settings, null, "2026-10-19T13:50:00.000Z", NEW_YORK, {
        firstRunLookbackMinutes: 120,
      }),
    ).toBe("2026-10-19T12:00:00.000Z");
  });
});

describe("nextTriggerDue: clock changes", () => {
  it("fires a time that never happens once, shifted by the jump (US spring forward)", () => {
    const settings = settingsOf({ daily: { at: "02:30" } }, NEW_YORK);
    // 2026-03-08: 02:00 became 03:00, so 02:30 EST is 03:30 EDT, 07:30Z.
    expect(
      nextTriggerDue(
        settings,
        "2026-03-07T07:30:00.000Z",
        "2026-03-08T07:31:00.000Z",
        NEW_YORK,
      ),
    ).toBe("2026-03-08T07:30:00.000Z");
    expect(
      nextTriggerDue(
        settings,
        "2026-03-07T07:30:00.000Z",
        "2026-03-08T07:29:00.000Z",
        NEW_YORK,
      ),
    ).toBeNull();
    // The next day is back to 02:30 EDT, 06:30Z.
    expect(
      nextTriggerDue(
        settings,
        "2026-03-08T07:30:00.000Z",
        "2026-03-09T06:30:00.000Z",
        NEW_YORK,
      ),
    ).toBe("2026-03-09T06:30:00.000Z");
  });

  it("fires a time that happens twice only the first time (US fall back)", () => {
    const settings = settingsOf({ daily: { at: "01:30" } }, NEW_YORK);
    // 2026-11-01: 01:30 EDT is 05:30Z; 01:30 EST, an hour later, is not a second fire.
    expect(
      nextTriggerDue(
        settings,
        "2026-10-31T05:30:00.000Z",
        "2026-11-01T05:31:00.000Z",
        NEW_YORK,
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(
      nextTriggerDue(
        settings,
        "2026-11-01T05:30:00.000Z",
        "2026-11-01T06:45:00.000Z",
        NEW_YORK,
      ),
    ).toBeNull();
  });

  it("keeps 08:00 on the wall clock across the change, so the UTC hour moves", () => {
    const settings = settingsOf({ weekdays: { at: "08:00" } }, NEW_YORK);
    // Friday 2026-03-06 was EST (13:00Z); Monday 2026-03-09 is EDT (12:00Z).
    expect(
      nextTriggerDue(
        settings,
        "2026-03-06T13:00:00.000Z",
        "2026-03-09T12:30:00.000Z",
        NEW_YORK,
      ),
    ).toBe("2026-03-09T12:00:00.000Z");
    expect(
      nextTriggerDue(
        settings,
        "2026-03-06T13:00:00.000Z",
        "2026-03-09T11:59:00.000Z",
        NEW_YORK,
      ),
    ).toBeNull();
  });

  it("works for a zone whose clock moves by thirty minutes", () => {
    const settings = settingsOf(
      { daily: { at: "08:00" } },
      "Australia/Lord_Howe",
    );
    // 2026-10-04 is the spring-forward day there (UTC+10:30 to UTC+11).
    const first = nextTriggerDue(
      settings,
      "2026-10-03T21:30:00.000Z",
      "2026-10-04T21:05:00.000Z",
      "Australia/Lord_Howe",
    );
    expect(first).toBe("2026-10-04T21:00:00.000Z");
  });
});

describe("nextTriggerDue: every-N-minutes and weekly", () => {
  it("sits on a UTC grid and ignores the zone", () => {
    const settings = settingsOf({ every: "15m" });
    expect(
      nextTriggerDue(
        settings,
        "2026-10-19T10:00:00.000Z",
        "2026-10-19T10:07:00.000Z",
        null,
      ),
    ).toBeNull();
    expect(
      nextTriggerDue(
        settings,
        "2026-10-19T10:00:00.000Z",
        "2026-10-19T10:15:02.000Z",
        "Asia/Kolkata",
      ),
    ).toBe("2026-10-19T10:15:00.000Z");
  });

  it("collapses missed intervals into one fire", () => {
    const settings = settingsOf({ every: "5m" });
    expect(
      nextTriggerDue(
        settings,
        "2026-10-19T10:00:00.000Z",
        "2026-10-19T11:42:10.000Z",
        null,
      ),
    ).toBe("2026-10-19T11:40:00.000Z");
  });

  it("counts a Sunday trigger as day 0", () => {
    const settings = settingsOf({ weekly: { day: 0, at: "09:00" } }, "UTC");
    // 2026-10-18 is a Sunday.
    expect(
      nextTriggerDue(
        settings,
        "2026-10-11T09:00:00.000Z",
        "2026-10-18T09:05:00.000Z",
        "UTC",
      ),
    ).toBe("2026-10-18T09:00:00.000Z");
    expect(
      nextTriggerDue(
        settings,
        "2026-10-18T09:00:00.000Z",
        "2026-10-21T09:05:00.000Z",
        "UTC",
      ),
    ).toBeNull();
  });
});

describe("nextTriggerDue: input it cannot read", () => {
  const settings = settingsOf({ weekdays: { at: "08:00" } }, NEW_YORK);

  it("refuses a time-of-day Trigger with no zone", () => {
    expect(() =>
      nextTriggerDue(settings, null, "2026-10-19T12:10:00.000Z", null),
    ).toThrow(expect.objectContaining({ code: "timezone_required" }));
  });

  it("refuses an unknown zone", () => {
    expect(() =>
      nextTriggerDue(settings, null, "2026-10-19T12:10:00.000Z", "Mars/Base"),
    ).toThrow(expect.objectContaining({ code: "timezone_invalid" }));
  });

  it("refuses an instant that is not a date", () => {
    expect(() =>
      nextTriggerDue(settings, null, "yesterday-ish", NEW_YORK),
    ).toThrow(expect.objectContaining({ code: "instant_invalid" }));
    expect(() =>
      nextTriggerDue(settings, "nope", "2026-10-19T12:10:00.000Z", NEW_YORK),
    ).toThrow(expect.objectContaining({ code: "instant_invalid" }));
  });
});

describe("the engine and the job scheduler agree on every fire", () => {
  const CASES: [string, Record<string, unknown>][] = [
    ["America/New_York", { daily: { at: "02:30" } }],
    ["America/New_York", { daily: { at: "01:30" } }],
    ["America/New_York", { weekdays: { at: "08:00" } }],
    ["Europe/London", { daily: { at: "01:30" } }],
    ["Europe/London", { weekdays: { at: "08:00" } }],
    ["Australia/Sydney", { daily: { at: "02:30" } }],
    ["Asia/Kolkata", { weekly: { day: 0, at: "09:30" } }],
    ["America/Sao_Paulo", { weekdays: { at: "00:30" } }],
  ];

  it.each(CASES)(
    "%s %j fires on the instants the cron parser reports, and on no others",
    (timezone, schedule) => {
      const graph = graphOf([trigger({ schedule, timezone })]);
      const { cron } = deriveJobSchedule(graph);
      const settings = (graph.nodes[0] as WorkflowNodeOfKind<"trigger">)
        .settings;

      let previous = nextOccurrence(
        cron,
        new Date("2025-12-30T00:00:00.000Z"),
        timezone,
      );
      const end = Date.parse("2027-01-05T00:00:00.000Z");
      let fires = 0;
      while (previous.getTime() < end) {
        const fire = nextOccurrence(cron, previous, timezone);
        expect(
          nextTriggerDue(
            settings,
            previous.toISOString(),
            fire.toISOString(),
            timezone,
          ),
        ).toBe(fire.toISOString());
        expect(
          nextTriggerDue(
            settings,
            previous.toISOString(),
            new Date(fire.getTime() - 1).toISOString(),
            timezone,
          ),
        ).toBeNull();
        previous = fire;
        fires += 1;
      }
      expect(fires).toBeGreaterThan(50);
    },
    30_000,
  );
});
