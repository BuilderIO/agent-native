import { describe, expect, it } from "vitest";

import {
  buildSessionSteps,
  deriveJourneyStep,
  JOURNEY_COHORT_EVENT_NAMES,
  JOURNEY_STEP_EVENT_NAMES,
  normalizeJourneyPath,
  type JourneyEventRow,
} from "./journey-steps";

let nextId = 0;
function row(
  eventName: string,
  tsMs: number,
  extra: Partial<JourneyEventRow> = {},
): JourneyEventRow {
  return {
    id: `e${nextId++}`,
    sessionId: "s1",
    tsMs,
    eventName,
    path: null,
    flow: null,
    stepId: null,
    stepIndex: null,
    methodId: null,
    outcome: null,
    action: null,
    ...extra,
  };
}

describe("normalizeJourneyPath", () => {
  it("replaces record ids and drops query and hash", () => {
    expect(
      normalizeJourneyPath("/deck/3f2a9c1e-7b4d-4e11-9a0f-1c2d3e4f5a6b?x=1"),
    ).toBe("/deck/:id");
    expect(normalizeJourneyPath("/clips/12345/edit#top")).toBe(
      "/clips/:id/edit",
    );
    expect(normalizeJourneyPath("/design/aB3dE5gH7jK9mN2pQ4")).toBe(
      "/design/:id",
    );
  });

  it("replaces a segment that holds an email address", () => {
    expect(normalizeJourneyPath("/invite/alice@example.com")).toBe(
      "/invite/:email",
    );
    expect(normalizeJourneyPath("/invite/alice%40example.com/accept")).toBe(
      "/invite/:email/accept",
    );
  });

  it("keeps readable segments and the root", () => {
    expect(normalizeJourneyPath("/home/")).toBe("/home");
    expect(normalizeJourneyPath("/")).toBe("/");
    expect(normalizeJourneyPath("/sign-in")).toBe("/sign-in");
  });

  it("returns null when there is no path", () => {
    expect(normalizeJourneyPath(null)).toBeNull();
    expect(normalizeJourneyPath("  ")).toBeNull();
  });
});

describe("deriveJourneyStep", () => {
  it("maps each onboarding event to a stable key and label", () => {
    const cases: Array<[JourneyEventRow, string, string]> = [
      [row("pageview", 1, { path: "/home" }), "page:/home", "/home"],
      [
        row("onboarding_step_viewed", 1, { stepId: "Role" }),
        "step:role",
        "Onboarding step: role",
      ],
      [
        row("onboarding_method_clicked", 1, {
          methodId: "builder_create_account",
        }),
        "method:builder_create_account",
        "Chose: Use Builder.io",
      ],
      [
        row("onboarding_step_skipped", 1, { stepId: "private-step-name" }),
        "onboarding:step_skipped",
        "Onboarding step skipped",
      ],
      [
        row("onboarding_abandoned", 1, { stepId: "private-step-name" }),
        "onboarding:abandoned",
        "Onboarding abandoned",
      ],
      [
        row("onboarding_method_outcome", 1, {
          methodId: "custom_keys",
          outcome: "settings_opened",
        }),
        "outcome:custom_keys:settings_opened",
        "Configure custom keys: settings_opened",
      ],
      [row("signup", 1), "signup", "Signed up"],
      [
        row("onboarding_completed", 1),
        "onboarding:completed",
        "Onboarding completed",
      ],
      [row("onboarding_app_entered", 1), "app:entered", "Entered app"],
      [
        row("app.first_action", 1, { action: "chat_submit" }),
        "action:first:chat_submit",
        "First action: chat_submit",
      ],
      [
        row("generation_completed", 1),
        "output:generation_completed",
        "Generation completed",
      ],
      [row("recording_ready", 1), "output:recording_ready", "Recording ready"],
    ];
    for (const [input, key, label] of cases) {
      expect(deriveJourneyStep(input)).toEqual({ key, label });
    }
  });

  it("gives the dotted and underscored auth events one key", () => {
    expect(deriveJourneyStep(row("auth.signup_viewed", 1))?.key).toBe(
      deriveJourneyStep(row("auth_signup_viewed", 1))?.key,
    );
    expect(deriveJourneyStep(row("auth.signup_clicked", 1))?.key).toBe(
      "auth:signup_clicked",
    );
  });

  it("marks a missing property as unknown instead of dropping the step", () => {
    expect(deriveJourneyStep(row("onboarding_step_viewed", 1))?.key).toBe(
      "step:unknown",
    );
    expect(deriveJourneyStep(row("app.first_action", 1))?.key).toBe(
      "action:first:unknown",
    );
  });

  it("returns null for events with no step meaning, and a pageview with no path", () => {
    expect(deriveJourneyStep(row("button_click", 1))).toBeNull();
    expect(deriveJourneyStep(row("pageview", 1))).toBeNull();
  });

  it("covers every event name the SQL selects", () => {
    for (const name of JOURNEY_STEP_EVENT_NAMES) {
      const input = row(name, 1, { path: "/x" });
      expect(deriveJourneyStep(input), name).not.toBeNull();
    }
    for (const name of JOURNEY_COHORT_EVENT_NAMES) {
      if (name === "onboarding_started") continue;
      expect(JOURNEY_STEP_EVENT_NAMES, name).toContain(name);
    }
  });

  it("uses bounded labels for skipped and abandoned events", () => {
    expect(
      deriveJourneyStep(
        row("onboarding_step_skipped", 1, { stepId: "a-user-defined-step" }),
      ),
    ).toEqual({
      key: "onboarding:step_skipped",
      label: "Onboarding step skipped",
    });
    expect(
      deriveJourneyStep(
        row("onboarding_abandoned", 1, { stepId: "a-user-defined-step" }),
      ),
    ).toEqual({
      key: "onboarding:abandoned",
      label: "Onboarding abandoned",
    });
  });
});

describe("buildSessionSteps", () => {
  it("orders by timestamp, then by journey position, then by id", () => {
    const steps = buildSessionSteps([
      row("onboarding_step_viewed", 200, { stepId: "role" }),
      row("signup", 200),
      row("pageview", 100, { path: "/sign-in" }),
    ]);
    expect(steps.map((step) => step.key)).toEqual([
      "page:/sign-in",
      "signup",
      "step:role",
    ]);
  });

  it("keeps skip and abandonment in the observed sequence", () => {
    const steps = buildSessionSteps([
      row("onboarding_step_viewed", 100, { stepId: "role" }),
      row("onboarding_step_skipped", 110, { stepId: "role" }),
      row("onboarding_step_viewed", 120, { stepId: "choice" }),
      row("onboarding_abandoned", 130, { stepId: "choice" }),
    ]);
    expect(steps.map((step) => step.key)).toEqual([
      "step:role",
      "onboarding:step_skipped",
      "step:choice",
      "onboarding:abandoned",
    ]);
  });

  it("orders equal-timestamp skip events between the skipped and next steps", () => {
    const steps = buildSessionSteps([
      row("onboarding_step_viewed", 100, {
        id: "z-current-view",
        flow: "first_run",
        stepId: "choice",
        stepIndex: 1,
      }),
      row("onboarding_step_skipped", 100, {
        id: "a-current-skip",
        flow: "first_run",
        stepId: "choice",
        stepIndex: 1,
      }),
      row("onboarding_step_viewed", 100, {
        id: "m-next-view",
        flow: "first_run",
        stepId: "connecting",
        stepIndex: 2,
      }),
    ]);

    expect(steps.map((step) => step.key)).toEqual([
      "step:choice",
      "onboarding:step_skipped:1:flow:first_run",
      "step:connecting",
    ]);
  });

  it("keeps consecutive skipped steps with distinct indices", () => {
    const steps = buildSessionSteps([
      row("onboarding_step_skipped", 100, {
        flow: "first_run",
        stepId: "role",
        stepIndex: 0,
      }),
      row("onboarding_step_skipped", 110, {
        flow: "first_run",
        stepId: "choice",
        stepIndex: 1,
      }),
    ]);

    expect(steps.map((step) => step.key)).toEqual([
      "onboarding:step_skipped:0:flow:first_run",
      "onboarding:step_skipped:1:flow:first_run",
    ]);
    expect(steps.map((step) => step.label)).toEqual([
      "Onboarding step skipped",
      "Onboarding step skipped",
    ]);
  });

  it("uses a total order for indexed steps across onboarding flows", () => {
    const rows = [
      row("onboarding_step_viewed", 100, {
        id: "z-first-flow-step-1",
        flow: "first_run",
        stepId: "first",
        stepIndex: 1,
      }),
      row("onboarding_step_skipped", 100, {
        id: "b-first-flow-skip",
        flow: "first_run",
        stepId: "first",
        stepIndex: 1,
      }),
      row("onboarding_step_viewed", 100, {
        id: "a-first-flow-step-2",
        flow: "first_run",
        stepId: "second",
        stepIndex: 2,
      }),
      row("onboarding_step_viewed", 100, {
        id: "m-second-flow-step-1",
        flow: "chat_setup",
        stepId: "other",
        stepIndex: 1,
      }),
    ];
    const expected = [
      "step:other",
      "step:first",
      "onboarding:step_skipped:1:flow:first_run",
      "step:second",
    ];

    expect(buildSessionSteps(rows).map((step) => step.key)).toEqual(expected);
    expect(
      buildSessionSteps([...rows].reverse()).map((step) => step.key),
    ).toEqual(expected);
  });

  it("keeps consecutive skips from different flows with the same index", () => {
    const steps = buildSessionSteps([
      row("onboarding_step_skipped", 100, {
        flow: "first_run",
        stepId: "role",
        stepIndex: 0,
      }),
      row("onboarding_step_skipped", 110, {
        flow: "chat_setup",
        stepId: "connect_ai",
        stepIndex: 0,
      }),
    ]);

    expect(steps.map((step) => step.key)).toEqual([
      "onboarding:step_skipped:0:flow:first_run",
      "onboarding:step_skipped:0:flow:chat_setup",
    ]);
    expect(steps.map((step) => step.label)).toEqual([
      "Onboarding step skipped",
      "Onboarding step skipped",
    ]);
  });

  it("collapses consecutive repeats into the first and keeps its timestamp", () => {
    const steps = buildSessionSteps([
      row("pageview", 100, { path: "/home" }),
      row("pageview", 150, { path: "/home" }),
      row("app_entered", 160),
      row("pageview", 170, { path: "/home" }),
    ]);
    expect(steps.map((step) => [step.key, step.tsMs])).toEqual([
      ["page:/home", 100],
      ["app:entered", 160],
      ["page:/home", 170],
    ]);
  });

  it("skips events with no step meaning without breaking a repeat", () => {
    const steps = buildSessionSteps([
      row("signup", 1),
      row("button_click", 2),
      row("signup", 3),
    ]);
    expect(steps).toHaveLength(1);
  });

  it("is independent of input order", () => {
    const rows = [
      row("signup", 10),
      row("onboarding_step_viewed", 20, { stepId: "role" }),
      row("onboarding_step_viewed", 30, { stepId: "choice" }),
    ];
    expect(buildSessionSteps([...rows].reverse())).toEqual(
      buildSessionSteps(rows),
    );
  });
});
