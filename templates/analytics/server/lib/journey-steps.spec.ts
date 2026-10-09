import { describe, expect, it } from "vitest";

import {
  buildSessionSteps,
  deriveJourneyStep,
  JOURNEY_COHORT_EVENT_NAMES,
  JOURNEY_STEP_EVENT_NAMES,
  normalizeJourneyPath,
  SLIDES_GENERATION_ATTEMPT_EVENT_NAMES,
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
    journeyKind: "onboarding",
    tsMs,
    eventName,
    templateName: "clips",
    path: null,
    flow: null,
    source: null,
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
    expect(normalizeJourneyPath("/r/ifsHSxM8iCbH")).toBe("/r/:id");
  });

  it("replaces a segment that holds an email address", () => {
    expect(normalizeJourneyPath("/invite/alice@example.com")).toBe(
      "/invite/:email",
    );
    expect(normalizeJourneyPath("/invite/alice%40example.com/accept")).toBe(
      "/invite/:email/accept",
    );
  });

  it("normalizes short resource ids at resource routes", () => {
    for (const route of [
      "r",
      "deck",
      "design",
      "recording",
      "share",
      "visual-edit",
    ]) {
      expect(normalizeJourneyPath(`/${route}/AbCdEfGhIj`)).toBe(
        `/${route}/:id`,
      );
      expect(normalizeJourneyPath(`/${route}/x_y-Z/present?q=1#slide`)).toBe(
        `/${route}/:id/present`,
      );
    }
    expect(normalizeJourneyPath("/design-systems/setup")).toBe(
      "/design-systems/setup",
    );
    expect(normalizeJourneyPath("/settings/model")).toBe("/settings/model");
    expect(normalizeJourneyPath("/templates/landing-page")).toBe(
      "/templates/landing-page",
    );
    expect(normalizeJourneyPath("/design/new-copy")).toBe("/design/:id");
  });

  it("preserves static share sub-routes while replacing their resource id", () => {
    expect(normalizeJourneyPath("/share/meeting/m123?token=secret")).toBe(
      "/share/meeting/:id",
    );
  });

  it("preserves the static Visual Edit shell route", () => {
    expect(normalizeJourneyPath("/visual-edit/shell")).toBe(
      "/visual-edit/shell",
    );
    expect(normalizeJourneyPath("/visual-edit/design_1")).toBe(
      "/visual-edit/:id",
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
  it("retains chat setup exposure, choices, and connection outcomes separately from onboarding", () => {
    const steps = buildSessionSteps([
      row("onboarding_method_clicked", 1, {
        methodId: "custom_keys",
        flow: "first_run",
      }),
      row("integration_setup_exposed", 2, {
        methodId: "setup_card",
        flow: "chat_setup",
      }),
      row("integration_method_clicked", 3, {
        methodId: "custom_keys",
        flow: "chat_setup",
      }),
      row("integration_method_clicked", 4, {
        methodId: "builder",
        flow: "chat_setup",
      }),
      row("integration_method_outcome", 5, {
        methodId: "builder",
        flow: "chat_setup",
        outcome: "connected",
      }),
    ]);
    expect(steps.map((step) => step.key)).toEqual([
      "method:custom_keys",
      "integration:chat_setup:exposed:setup_card",
      "integration:chat_setup:method:custom_keys",
      "integration:chat_setup:method:builder",
      "integration:chat_setup:outcome:builder:connected",
    ]);
    for (const event of [
      "integration_setup_exposed",
      "integration_method_clicked",
      "integration_method_outcome",
    ]) {
      expect(JOURNEY_STEP_EVENT_NAMES).toContain(event);
      expect(JOURNEY_COHORT_EVENT_NAMES).not.toContain(event);
    }
  });

  it("keeps unexpected chat setup properties out of journey labels and keys", () => {
    expect(
      deriveJourneyStep(
        row("integration_method_outcome", 1, {
          flow: "private-user-value",
          methodId: "private-provider-name",
          outcome: "customer-error-message",
        }),
      ),
    ).toEqual({
      key: "integration:unknown:outcome:unknown:unknown",
      label: "unknown: unknown",
    });
  });

  it("retains the actual custom-key outcome contract", () => {
    for (const outcome of [
      "credential_entry_started",
      "credential_validated",
      "credential_saved",
      "credential_skipped",
      "credential_abandoned",
      "local_endpoint_saved",
      "local_endpoint_skipped",
      "local_endpoint_abandoned",
    ]) {
      expect(
        deriveJourneyStep(
          row("onboarding_method_outcome", 1, {
            methodId: "custom_keys",
            outcome,
          }),
        ),
      ).toMatchObject({ key: `outcome:custom_keys:${outcome}` });
    }
  });

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
        row("onboarding_method_started", 1, { methodId: "custom_keys" }),
        "method:custom_keys:started",
        "Configure custom keys: setup started",
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
        row("generation_completed", 1, {
          templateName: "slides",
        }),
        "output:generation_completed",
        "Generation completed",
      ],
      [
        row("design_output_created", 1, {
          templateName: "design",
        }),
        "output:design_output_created",
        "Design output created",
      ],
      [row("recording_ready", 1), "output:recording_ready", "Clip saved"],
    ];
    for (const [input, key, label] of cases) {
      expect(deriveJourneyStep(input)).toEqual({ key, label });
    }
  });

  it("keeps generation and recording attempts separate from saved outputs", () => {
    expect(deriveJourneyStep(row("generation_started", 1))).toEqual({
      key: "attempt:generation_started",
      label: "Generation attempt started",
    });
    expect(deriveJourneyStep(row("recording_started", 1))).toEqual({
      key: "attempt:recording_started",
      label: "Recording attempt started",
    });

    for (const eventName of [
      "recording_completed",
      "clip_viewed",
      "deck_edited",
      "output_viewed",
    ]) {
      expect(deriveJourneyStep(row(eventName, 2))).toBeNull();
      expect(JOURNEY_STEP_EVENT_NAMES).not.toContain(eventName);
    }
    expect(JOURNEY_STEP_EVENT_NAMES).toContain("recording_started");
    expect(JOURNEY_STEP_EVENT_NAMES).toContain("generation_started");
  });

  it("keeps Slides request and outcome events as distinct attempt steps", () => {
    const cases: Array<[string, string, string]> = [
      [
        "generation_request_accepted",
        "attempt:generation_request_accepted",
        "Generation request accepted",
      ],
      [
        "generation_outcome_unresolved",
        "attempt:generation_outcome_unresolved",
        "Generation outcome unresolved",
      ],
      [
        "generation_failed",
        "attempt:generation_failed",
        "Generation attempt failed",
      ],
      [
        "generation_stuck",
        "attempt:generation_stuck",
        "Generation attempt stalled",
      ],
      [
        "generation_cancelled",
        "attempt:generation_cancelled",
        "Generation attempt cancelled",
      ],
      [
        "generation_abandoned",
        "attempt:generation_abandoned",
        "Generation attempt abandoned",
      ],
    ];

    for (const [eventName, key, label] of cases) {
      expect(
        deriveJourneyStep(row(eventName, 2, { templateName: "slides" })),
      ).toEqual({ key, label });
      expect(
        deriveJourneyStep(row(eventName, 2, { templateName: "clips" })),
      ).toBeNull();
      expect(JOURNEY_STEP_EVENT_NAMES).toContain(eventName);
    }
  });

  it("requires the app's source-confirmed saved-output event shape", () => {
    expect(
      deriveJourneyStep(
        row("generation_completed", 1, {
          templateName: "slides",
        }),
      )?.key,
    ).toBe("output:generation_completed");
    expect(
      deriveJourneyStep(
        row("generation_completed", 1, {
          templateName: "clips",
        }),
      ),
    ).toBeNull();
    expect(
      deriveJourneyStep(
        row("recording_ready", 1, {
          templateName: "clips",
        }),
      )?.key,
    ).toBe("output:recording_ready");
    expect(
      deriveJourneyStep(
        row("recording_ready", 1, {
          templateName: "slides",
        }),
      ),
    ).toBeNull();
  });

  it("maps Builder connection aliases to bounded shared steps", () => {
    const cases: Array<[string, string, string]> = [
      [
        "builder_connect_clicked",
        "builder:connect:clicked",
        "Builder connection CTA clicked",
      ],
      [
        "builder connect clicked",
        "builder:connect:clicked",
        "Builder connection CTA clicked",
      ],
      [
        "builder_connect_popup_blocked",
        "builder:connect:popup_blocked",
        "Builder connection popup blocked",
      ],
      [
        "builder_connect_started",
        "builder:connect:started",
        "Builder connection started",
      ],
      [
        "builder_connect_succeeded",
        "builder:connect:succeeded",
        "Builder connected",
      ],
      [
        "builder_connect_failed",
        "builder:connect:failed",
        "Builder connection failed",
      ],
    ];

    for (const [eventName, key, label] of cases) {
      expect(deriveJourneyStep(row(eventName, 1))).toEqual({ key, label });
    }
  });

  it("keeps custom-key validation and save outcomes distinct and bounded", () => {
    expect(
      deriveJourneyStep(
        row("onboarding_method_outcome", 1, {
          methodId: "custom_keys",
          outcome: "credential_validated",
        }),
      )?.key,
    ).toBe("outcome:custom_keys:credential_validated");
    expect(
      deriveJourneyStep(
        row("onboarding_method_outcome", 1, {
          methodId: "custom_keys",
          outcome: "credential_saved",
        }),
      )?.key,
    ).toBe("outcome:custom_keys:credential_saved");
    expect(
      deriveJourneyStep(
        row("integration_key_validation_outcome", 1, {
          flow: "settings",
          outcome: "accepted",
        }),
      ),
    ).toEqual({
      key: "custom_key:settings:validation:accepted",
      label: "Custom key validation (settings): accepted",
    });
    expect(
      deriveJourneyStep(
        row("integration_key_save_outcome", 1, {
          flow: "settings",
          outcome: "saved",
        }),
      ),
    ).toEqual({
      key: "custom_key:settings:save:saved",
      label: "Custom key save (settings): saved",
    });
    expect(
      deriveJourneyStep(
        row("integration_key_validation_outcome", 1, {
          flow: "user-controlled-flow",
          outcome: "customer-secret-like-value",
        }),
      ),
    ).toEqual({
      key: "custom_key:unknown:validation:unknown",
      label: "Custom key validation (unknown): unknown",
    });

    for (const outcome of ["constructor", "__proto__"]) {
      expect(
        deriveJourneyStep(
          row("integration_key_validation_outcome", 1, {
            flow: "settings",
            outcome,
          }),
        ),
      ).toEqual({
        key: "custom_key:settings:validation:unknown",
        label: "Custom key validation (settings): unknown",
      });
    }
  });

  it("does not treat inherited method labels as configured labels", () => {
    expect(
      deriveJourneyStep(
        row("onboarding_method_clicked", 1, { methodId: "constructor" }),
      ),
    ).toEqual({ key: "method:constructor", label: "Chose: constructor" });
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
      const input = row(name, 1, {
        path: "/x",
        ...(SLIDES_GENERATION_ATTEMPT_EVENT_NAMES.includes(name) ||
        name === "generation_completed"
          ? { templateName: "slides" }
          : {}),
        ...(name === "design_output_created" ? { templateName: "design" } : {}),
      });
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
  it("keeps failure, unresolved, retry, and completion states distinct", () => {
    const slides = (eventName: string, tsMs: number) =>
      row(eventName, tsMs, { templateName: "slides" });
    const steps = buildSessionSteps([
      slides("generation_started", 1),
      slides("generation_failed", 2),
      slides("generation_started", 3),
      slides("generation_outcome_unresolved", 4),
      slides("generation_started", 5),
      slides("generation_completed", 6),
      slides("generation_started", 7),
    ]);

    expect(steps.map((step) => step.key)).toEqual([
      "attempt:generation_started",
      "attempt:generation_failed",
      "attempt:generation_started",
      "attempt:generation_outcome_unresolved",
      "attempt:generation_started",
      "output:generation_completed",
      "attempt:generation_started",
    ]);
  });

  it("deduplicates legacy and canonical aliases and orders first-run Builder events", () => {
    const steps = buildSessionSteps([
      row("onboarding_method_outcome", 100, {
        id: "z-outcome",
        methodId: "builder_create_account",
        outcome: "connected",
      }),
      row("builder_connect_started", 100, {
        id: "d-builder-started",
        source: "first_run_onboarding",
      }),
      row("builder_connect_clicked", 100, {
        id: "b-builder-clicked",
        source: "first_run_onboarding",
      }),
      row("onboarding_method_started", 100, {
        id: "a-method-started",
        methodId: "builder_create_account",
      }),
      row("onboarding_method_clicked", 100, {
        id: "c-method-clicked",
        methodId: "builder_create_account",
      }),
      row("builder connect clicked", 100, {
        id: "e-legacy-builder-clicked",
        source: "first_run_onboarding",
      }),
    ]);

    expect(steps.map((step) => step.key)).toEqual([
      "method:builder_create_account",
      "method:builder_create_account:started",
      "builder:connect:clicked",
      "builder:connect:started",
      "outcome:builder_create_account:connected",
    ]);
  });

  it("groups same-time Builder aliases before collapsing them", () => {
    const steps = buildSessionSteps([
      row("builder connect clicked", 100, { id: "a-legacy" }),
      row("integration_key_entry_started", 100, {
        id: "b-key-entry",
        flow: "settings",
      }),
      row("builder_connect_clicked", 100, { id: "c-canonical" }),
    ]);

    expect(steps.map((step) => step.key)).toEqual([
      "builder:connect:clicked",
      "custom_key:settings:entry_started",
    ]);
  });

  it("deduplicates an alias pair across interleaved events and keeps a later retry", () => {
    const steps = buildSessionSteps([
      row("builder connect clicked", 100, {
        id: "a-legacy-clicked",
        aliasId: "click-pair-1",
      }),
      row("builder_connect_popup_blocked", 100, {
        id: "b-popup-blocked",
      }),
      row("builder_connect_clicked", 102, {
        id: "c-canonical-clicked",
        aliasId: "click-pair-1",
      }),
      row("onboarding_method_outcome", 103, {
        id: "d-retry-outcome",
        methodId: "builder_create_account",
        outcome: "failed",
      }),
      row("builder connect clicked", 104, {
        id: "e-retry-legacy-clicked",
        aliasId: "click-pair-2",
      }),
      row("builder_connect_clicked", 105, {
        id: "f-retry-canonical-clicked",
        aliasId: "click-pair-2",
      }),
    ]);

    expect(steps.map((step) => step.key)).toEqual([
      "builder:connect:clicked",
      "builder:connect:popup_blocked",
      "outcome:builder_create_account:failed",
      "builder:connect:clicked",
    ]);
  });

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

  it("orders a renderable design output after generation activity", () => {
    const steps = buildSessionSteps([
      row("design_output_created", 110, {
        templateName: "design",
      }),
      row("generation_started", 100),
      row("design_output_created", 120, {
        templateName: "design",
      }),
    ]);

    expect(steps.map((step) => [step.key, step.tsMs])).toEqual([
      ["attempt:generation_started", 100],
      ["output:design_output_created", 110],
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
