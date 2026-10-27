import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetAppConfigForTests,
  setAppConfigLayer,
} from "../app-config/store.js";
import {
  loadFirstRunBuilderCreditsV2Assignment,
  recordFirstRunBuilderCreditsV2Exposure,
} from "../onboarding/first-run-builder-credits-experiment.js";
import { runWithRequestContext } from "../server/request-context.js";
import { assignFirstRunBuilderCreditsV2 } from "../shared/first-run-builder-credits-experiment.js";
import { isQaTestEmail } from "../shared/qa-test-email.js";
import {
  flushTracking,
  identify,
  registerTrackingProvider,
  track,
  unregisterTrackingProvider,
} from "./registry.js";
import type { TrackingEvent } from "./types.js";

const mockQueueTrackingEvent = vi.hoisted(() => vi.fn());
const mockExperimentAssignments = vi.hoisted(() => ({
  getAssignment: vi.fn(),
  upsertAssignment: vi.fn(),
}));
const mockQuestionIntakeAssignment = vi.hoisted(() => vi.fn());

vi.mock("../observability/tracing.js", () => ({
  queueTrackingEvent: mockQueueTrackingEvent,
}));

vi.mock("../observability/store.js", () => mockExperimentAssignments);
vi.mock("../observability/question-intake-experiment.js", () => ({
  resolveQuestionIntakeExperimentAssignment: mockQuestionIntakeAssignment,
}));

function captureEvents(): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  registerTrackingProvider({
    name: "qa-capture",
    track(event) {
      events.push(event);
    },
  });
  return events;
}

describe("tracking registry", () => {
  afterEach(() => {
    unregisterTrackingProvider("qa-throwing-track");
    unregisterTrackingProvider("qa-rejecting-flush");
    unregisterTrackingProvider("qa-capture");
    unregisterTrackingProvider("qa-identify");
    mockQueueTrackingEvent.mockClear();
    mockExperimentAssignments.getAssignment.mockReset();
    mockExperimentAssignments.upsertAssignment.mockReset();
    mockQuestionIntakeAssignment.mockReset().mockResolvedValue(null);
    resetAppConfigForTests();
    vi.restoreAllMocks();
  });

  it("attributes an event from an action ctx passed straight through", async () => {
    const events = captureEvents();
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    try {
      await runWithRequestContext(
        {
          userEmail: "alice@example.com",
          authUserId: "better-auth-user-1",
          browserSessionId: "session-1",
          clientPlatform: "electron",
        },
        () => {
          track(
            "project_created",
            { template: "blank", auth_user_id: "client-spoof" },
            { caller: "frontend", userEmail: "alice@example.com" },
          );
        },
      );
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnvironment;
      }
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "project_created",
      userId: "alice@example.com",
      sessionId: "session-1",
      properties: {
        template: "blank",
        auth_user_id: "better-auth-user-1",
        deployment_environment: "local",
        client_platform: "electron",
      },
    });
  });

  it("does not attach the ambient session to a mismatched action caller", async () => {
    const events = captureEvents();

    await runWithRequestContext(
      {
        userEmail: "alice@example.com",
        authUserId: "better-auth-user-1",
        browserSessionId: "session-1",
      },
      () =>
        track(
          "background_action",
          {},
          {
            caller: "agent",
            userEmail: "bob@example.com",
          },
        ),
    );

    expect(events[0]).toMatchObject({ userId: "bob@example.com" });
    expect(events[0]?.sessionId).toBeUndefined();
    expect(events[0]?.properties).not.toHaveProperty("auth_user_id");
  });

  it("joins explicit user sources to matching ambient authenticated identity", async () => {
    const events = captureEvents();

    await runWithRequestContext(
      {
        userEmail: "alice@example.com",
        authUserId: "better-auth-user-1",
        browserSessionId: "session-1",
      },
      () => {
        track(
          "recording_ready",
          { recording_attempt_id: "recording-1" },
          { userId: "alice@example.com" },
        );
        track("background_event", undefined, {
          userId: "different@example.com",
        });
      },
    );

    expect(events[0]).toMatchObject({
      userId: "alice@example.com",
      sessionId: "session-1",
      properties: {
        auth_user_id: "better-auth-user-1",
        recording_attempt_id: "recording-1",
      },
    });
    expect(events[1]).toMatchObject({ userId: "different@example.com" });
    expect(events[1]?.sessionId).toBeUndefined();
    expect(events[1]?.properties).not.toHaveProperty("auth_user_id");
  });

  it("persists an exposed first-run credits arm on durable product events", async () => {
    const events = captureEvents();
    mockExperimentAssignments.getAssignment.mockResolvedValue(null);
    mockExperimentAssignments.upsertAssignment.mockResolvedValue(undefined);

    await runWithRequestContext(
      {
        userEmail: "alice@example.com",
        authUserId: "better-auth-user-1",
      },
      async () => {
        const assignment = await recordFirstRunBuilderCreditsV2Exposure({
          flagEnabled: true,
        });
        expect(assignment).toMatchObject({
          authUserId: "better-auth-user-1",
          experiment_id: "first_run_builder_credits_v2",
          experiment_variant: expect.stringMatching(/^(control|credits)$/),
        });
        track("run_started", {});
        track("design_created", {});
        track("deck_created", {});
        track("recording_ready", {});
        track("unrelated_event", {});
      },
    );

    expect(events).toHaveLength(5);
    const assignments = events.slice(0, 4).map(({ properties }) => ({
      experiment_id: properties.experiment_id,
      experiment_variant: properties.experiment_variant,
    }));
    expect(
      assignments.every(
        (assignment) =>
          assignment.experiment_id === "first_run_builder_credits_v2",
      ),
    ).toBe(true);
    expect(
      new Set(assignments.map(({ experiment_variant }) => experiment_variant))
        .size,
    ).toBe(1);
    expect(events[4]?.properties).not.toHaveProperty("experiment_id");
    expect(mockExperimentAssignments.upsertAssignment).toHaveBeenCalledWith({
      experimentId: "first_run_builder_credits_v2",
      userId: "better-auth-user-1",
      variantId: assignments[0]?.experiment_variant,
      assignedAt: expect.any(Number),
    });
  });

  it("does not persist or tag when the v2 feature flag is off", async () => {
    const events = captureEvents();

    await runWithRequestContext(
      { userEmail: "alice@example.com", authUserId: "better-auth-user-1" },
      async () => {
        await expect(
          recordFirstRunBuilderCreditsV2Exposure({ flagEnabled: false }),
        ).resolves.toBeNull();
        track("run_started", {});
      },
    );

    expect(mockExperimentAssignments.getAssignment).not.toHaveBeenCalled();
    expect(mockExperimentAssignments.upsertAssignment).not.toHaveBeenCalled();
    expect(events[0]?.properties).not.toHaveProperty("experiment_id");
  });

  it("loads the durable arm into a later request before tagging run events", async () => {
    const events = captureEvents();
    const authUserId = "better-auth-user-2";
    const expected = assignFirstRunBuilderCreditsV2(authUserId);
    mockExperimentAssignments.getAssignment.mockResolvedValue({
      experimentId: "first_run_builder_credits_v2",
      userId: authUserId,
      variantId: expected?.experiment_variant,
      assignedAt: 123,
    });

    await runWithRequestContext(
      { userEmail: "bob@example.com", authUserId },
      async () => {
        await loadFirstRunBuilderCreditsV2Assignment();
        track("run_started", {});
      },
    );

    expect(events[0]?.properties).toMatchObject({
      experiment_id: "first_run_builder_credits_v2",
      experiment_variant: expected?.experiment_variant,
    });
  });

  it("keeps unassigned events joinable without reading the arm on every run", async () => {
    const events = captureEvents();

    await runWithRequestContext(
      { userEmail: "alice@example.com", authUserId: "better-auth-user-1" },
      () => {
        track("run_started", {});
        track("design_created", {}, { anonymousId: "visitor-1" });
      },
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.properties?.auth_user_id).toBe("better-auth-user-1");
    expect(events[0]?.properties).not.toHaveProperty("experiment_id");
    expect(events[1]?.properties).not.toHaveProperty("experiment_id");
    expect(mockExperimentAssignments.getAssignment).not.toHaveBeenCalled();
  });

  it("stamps configured client funnel events from the stored signup assignment", async () => {
    const events = captureEvents();
    const pending: Promise<unknown>[] = [];
    setAppConfigLayer("app", {
      agent: {
        questionIntake: {
          enabled: true,
          experimentId: "design_no_questions",
          questionToolNames: ["show-design-questions"],
          treatmentInstructions: "Design first.",
          trackedEventNames: ["design_prompt_submitted"],
        },
      },
    });
    mockQuestionIntakeAssignment.mockResolvedValue({
      authUserId: "better-auth-user-3",
      experimentId: "design_no_questions",
      variantId: "no_questions",
    });

    await runWithRequestContext(
      {
        userEmail: "carol@example.com",
        authUserId: "better-auth-user-3",
        run: { waitUntil: (promise) => pending.push(promise) },
      },
      () => {
        track("design_prompt_submitted", {
          experiment_id: "client-spoof",
          experiment_variant: "control",
        });
        track("design_ready_viewed", {});
      },
    );
    await Promise.all(pending);

    expect(events).toHaveLength(2);
    const promptEvent = events.find(
      (event) => event.name === "design_prompt_submitted",
    );
    const readyEvent = events.find(
      (event) => event.name === "design_ready_viewed",
    );
    expect(promptEvent?.properties).toMatchObject({
      experiment_id: "design_no_questions",
      experiment_variant: "no_questions",
    });
    expect(readyEvent?.properties).not.toHaveProperty("experiment_id");
    expect(mockQuestionIntakeAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: "design_no_questions" }),
      "better-auth-user-3",
    );
  });

  it("does not trust client-supplied experiment metadata when no signup assignment exists", async () => {
    const events = captureEvents();
    const pending: Promise<unknown>[] = [];
    setAppConfigLayer("app", {
      agent: {
        questionIntake: {
          enabled: true,
          experimentId: "design_no_questions",
          questionToolNames: ["show-design-questions"],
          treatmentInstructions: "Design first.",
          trackedEventNames: ["design_prompt_submitted"],
        },
      },
    });

    await runWithRequestContext(
      {
        userEmail: "carol@example.com",
        authUserId: "better-auth-user-3",
        run: { waitUntil: (promise) => pending.push(promise) },
      },
      () =>
        track("design_prompt_submitted", {
          experiment_id: "client-spoof",
          experiment_variant: "no_questions",
        }),
    );
    await Promise.all(pending);

    expect(events[0]?.properties).not.toHaveProperty("experiment_id");
    expect(events[0]?.properties).not.toHaveProperty("experiment_variant");
  });

  it("drops client-supplied experiment metadata from unconfigured event names", () => {
    const events = captureEvents();

    track(
      "arbitrary_client_event",
      {
        experiment_id: "client-spoof",
        experiment_variant: "no_questions",
      },
      { userId: "carol@example.com", telemetryOrigin: "client" },
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.properties).not.toHaveProperty("experiment_id");
    expect(events[0]?.properties).not.toHaveProperty("experiment_variant");
  });

  it("does not emit experiment funnel events when assignment lookup fails", async () => {
    const events = captureEvents();
    const pending: Promise<unknown>[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setAppConfigLayer("app", {
      agent: {
        questionIntake: {
          enabled: true,
          experimentId: "design_no_questions",
          questionToolNames: ["show-design-questions"],
          treatmentInstructions: "Design first.",
          trackedEventNames: ["design_prompt_submitted"],
        },
      },
    });
    mockQuestionIntakeAssignment.mockRejectedValue(new Error("db unavailable"));

    await runWithRequestContext(
      {
        userEmail: "carol@example.com",
        authUserId: "better-auth-user-4",
        run: { waitUntil: (promise) => pending.push(promise) },
      },
      () => track("design_prompt_submitted", {}),
    );
    await Promise.all(pending);

    expect(events).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(
      "[tracking] question-intake assignment lookup failed",
      {
        experimentId: "design_no_questions",
        eventName: "design_prompt_submitted",
      },
    );
  });

  it("uses a run's authenticated assignment without another assignment lookup", async () => {
    const events = captureEvents();
    setAppConfigLayer("app", {
      agent: {
        questionIntake: {
          enabled: true,
          experimentId: "design_no_questions",
          questionToolNames: ["show-design-questions"],
          treatmentInstructions: "Design first.",
          trackedEventNames: ["design_exported"],
        },
      },
    });

    await runWithRequestContext(
      {
        userEmail: "carol@example.com",
        authUserId: "better-auth-user-3",
        run: {
          questionIntakeExperimentAssignment: {
            authUserId: "better-auth-user-3",
            experimentId: "design_no_questions",
            variantId: "control",
          },
        },
      },
      () => track("design_exported", {}),
    );

    expect(events[0]?.properties).toMatchObject({
      experiment_id: "design_no_questions",
      experiment_variant: "control",
    });
    expect(mockExperimentAssignments.getAssignment).not.toHaveBeenCalled();
  });

  it("derives experiment exposure only from the authenticated request id", async () => {
    const events = captureEvents();

    await runWithRequestContext(
      { userEmail: "alice@example.com", agentRunAnonymous: true },
      async () => {
        await expect(
          recordFirstRunBuilderCreditsV2Exposure({ flagEnabled: true }),
        ).resolves.toBeNull();
        track("run_started", {});
      },
    );

    expect(events[0]?.properties).not.toHaveProperty("experiment_id");
  });

  it("keeps an explicitly absent session distinct from the ambient session", async () => {
    const events = captureEvents();

    await runWithRequestContext(
      {
        userEmail: "alice@example.com",
        authUserId: "better-auth-user-1",
        browserSessionId: "completion-session",
      },
      () =>
        track(
          "generation_completed",
          {},
          { userId: "alice@example.com", sessionId: null },
        ),
    );

    expect(events[0]?.sessionId).toBeUndefined();
    expect(events[0]?.properties).not.toHaveProperty("session_id");
  });

  it("keeps an action source while pinning its session as absent", async () => {
    const events = captureEvents();
    const source = {
      caller: "frontend" as const,
      userEmail: "alice@example.com",
      orgId: "org-1",
      sessionId: null,
    };

    await runWithRequestContext(
      {
        userEmail: "alice@example.com",
        authUserId: "better-auth-user-1",
        browserSessionId: "completion-session",
      },
      () => track("generation_completed", {}, source),
    );

    expect(events[0]?.sessionId).toBeUndefined();
    expect(events[0]?.properties).not.toHaveProperty("session_id");
    expect(events[0]?.properties).toMatchObject({
      user_email: "alice@example.com",
      workspace_id: "org-1",
      auth_user_id: "better-auth-user-1",
    });
  });

  it("does not attach ambient identity or session to explicit anonymous events", async () => {
    const events = captureEvents();

    await runWithRequestContext(
      {
        userEmail: "alice@example.com",
        authUserId: "better-auth-user-1",
        browserSessionId: "session-1",
      },
      () => track("anonymous_event", {}, { anonymousId: "visitor-1" }),
    );

    expect(events[0]).toMatchObject({ anonymousId: "visitor-1" });
    expect(events[0]?.userId).toBeUndefined();
    expect(events[0]?.sessionId).toBeUndefined();
    expect(events[0]?.properties).not.toHaveProperty("auth_user_id");
  });

  it("does not attach an ambient session to a conflicting explicit auth ID", async () => {
    const events = captureEvents();

    await runWithRequestContext(
      {
        userEmail: "alice@example.com",
        authUserId: "better-auth-user-1",
        browserSessionId: "session-1",
      },
      () => track("explicit_auth_event", {}, { authUserId: "other-auth-user" }),
    );

    expect(events[0]?.properties?.auth_user_id).toBe("other-auth-user");
    expect(events[0]?.sessionId).toBeUndefined();
  });

  it("removes auth_user_id when no verified identity is available", () => {
    const events = captureEvents();

    track(
      "client_event",
      { auth_user_id: "client-spoof", authUserId: "camel-case-spoof" },
      { userId: "alice@example.com", telemetryOrigin: "client" },
    );

    expect(events[0]?.properties).not.toHaveProperty("auth_user_id");
    expect(events[0]?.properties).not.toHaveProperty("authUserId");
  });

  it("overwrites a client auth_user_id with authenticated tracking metadata", () => {
    const events = captureEvents();

    track(
      "client_event",
      { auth_user_id: "client-spoof" },
      {
        userId: "alice@example.com",
        authUserId: "better-auth-user-1",
        telemetryOrigin: "client",
      },
    );

    expect(events[0]?.properties?.auth_user_id).toBe("better-auth-user-1");
  });

  it("keeps the browser session for callers that pass no source at all", async () => {
    const events = captureEvents();

    await runWithRequestContext({ browserSessionId: "session-2" }, () => {
      track("project_created");
    });

    expect(events[0]?.sessionId).toBe("session-2");
  });

  it("emits a canonical output event alongside legacy share telemetry", () => {
    const events = captureEvents();

    track(
      "share_link_copied",
      {
        app: "agent-native-clips",
        recording_id: "recording-1",
        resource_type: "clip",
      },
      { userId: "alice@example.com", sessionId: "session-share" },
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.name).toBe("share_link_copied");
    expect(events[1]).toMatchObject({
      name: "output_shared",
      userId: "alice@example.com",
      sessionId: "session-share",
      properties: {
        app_name: "clips",
        output_id: "recording-1",
        output_type: "clip",
        session_id: "session-share",
        share_method: "copy_link",
      },
    });
  });

  it("classifies the pre-navigation deck event as a CTA", () => {
    const events = captureEvents();

    track("generate deck", { app: "agent-native-docs" });

    expect(events).toHaveLength(3);
    expect(events[0]?.name).toBe("generate deck");
    expect(events[1]).toMatchObject({
      name: "generate_deck",
      properties: {
        canonical_event_name: "generate_deck",
        legacy_event_name: "generate deck",
      },
    });
    expect(events[2]).toMatchObject({
      name: "cta_clicked",
      properties: {
        app_name: "docs",
        cta_name: "generate_deck",
      },
    });
  });

  it.each(["builder connect clicked", "builder_connect_clicked"])(
    "records %s as builder_connect_clicked and a CTA click",
    (name) => {
      const events = captureEvents();

      track(name, { connect_url_kind: "provision" });

      const names = events.map((event) => event.name);
      expect(names.filter((n) => n === "builder_connect_clicked")).toHaveLength(
        1,
      );
      expect(
        events.find((event) => event.name === "cta_clicked"),
      ).toMatchObject({ properties: { cta_name: "builder_connect_clicked" } });
    },
  );

  it("emits a canonical alias with provenance for legacy event names", () => {
    const events = captureEvents();
    const legacyName = "session status";

    track(legacyName, { signed_in: true });

    expect(events).toHaveLength(2);
    expect(events[0]?.name).toBe(legacyName);
    expect(events[0]?.properties).toHaveProperty(
      "event_alias_id",
      expect.any(String),
    );
    expect(events[1]).toMatchObject({
      name: "session_status",
      properties: {
        signed_in: true,
        canonical_event_name: "session_status",
        legacy_event_name: legacyName,
        event_alias_id: events[0]?.properties.event_alias_id,
      },
    });
  });

  it("suppresses reserved QA identities before track or identify reaches providers", () => {
    const events = captureEvents();
    const identified: string[] = [];
    registerTrackingProvider({
      name: "qa-identify",
      track() {},
      identify(userId) {
        identified.push(userId);
      },
    });
    const email = "signup+autoz-run-123@example.com";

    expect(isQaTestEmail(email)).toBe(true);
    track("signup", { email }, { userId: email });
    track("client_event", undefined, { userId: email });
    track("property_event", { userEmail: email });
    track("canonical_property_event", { user_email: email });
    identify(email, { email });
    identify("auth-user-qa", { email });
    identify("auth-user-qa", { userEmail: email });

    expect(events).toEqual([]);
    expect(identified).toEqual([]);
  });

  it("suppresses +autoz identities from ambient request tracking", async () => {
    const events = captureEvents();
    const email = "signup+autoz-run-123@example.com";

    expect(isQaTestEmail(email)).toBe(true);
    await runWithRequestContext({ userEmail: email }, () => {
      track("ambient_event");
      identify("auth-user");
    });

    expect(events).toEqual([]);
  });

  it("suppresses reserved-domain and deployment-declared test identities", async () => {
    const events = captureEvents();
    vi.stubEnv("AGENT_NATIVE_TEST_IDENTITY_EMAILS", "qa-lead@builder.io");
    try {
      track("signup", undefined, { userId: "qa-owner@example.test" });
      track("signup", undefined, { userId: "qa-lead@builder.io" });
      await runWithRequestContext({ userEmail: "qa-lead@builder.io" }, () => {
        track("ambient_event");
      });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(events).toEqual([]);
    expect(mockQueueTrackingEvent).not.toHaveBeenCalled();
  });

  it("keeps a test identity's exceptions, flagged, for providers that opt in", async () => {
    const plain = captureEvents();
    const firstParty: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-first-party",
      acceptsTestIdentityExceptions: true,
      track(event) {
        firstParty.push(event);
      },
    });
    try {
      await runWithRequestContext(
        { userEmail: "qa-owner@example.test" },
        () => {
          track("$exception", { exceptionMessage: "boom" });
          track("page_viewed");
        },
      );
    } finally {
      unregisterTrackingProvider("qa-first-party");
    }

    expect(plain).toEqual([]);
    expect(firstParty.map((event) => event.name)).toEqual(["$exception"]);
    expect(firstParty[0]?.properties).toMatchObject({
      test_identity: true,
      test_identity_email: "qa-owner@example.test",
    });
    expect(mockQueueTrackingEvent).not.toHaveBeenCalled();
  });

  it("suppresses synthetic browser traffic before providers", async () => {
    const events = captureEvents();
    await runWithRequestContext(
      { isSyntheticTraffic: true, userEmail: "alice@example.com" },
      () => {
        track("synthetic_event", { source: "beta-e2e" });
        identify("alice@example.com");
      },
    );

    expect(events).toEqual([]);
  });

  it("keeps ordinary plus-addresses trackable", () => {
    const events = captureEvents();
    const email = "signup+experiment-123@example.com";

    expect(isQaTestEmail(email)).toBe(false);
    track("signup", { email }, { userId: email });

    expect(events).toHaveLength(1);
  });

  it("leaves the session absent for callers with no browser", () => {
    const events = captureEvents();

    track("nightly_rollup", undefined, { userId: "cron@example.com" });

    expect(events[0]?.userId).toBe("cron@example.com");
    expect(events[0]?.sessionId).toBeUndefined();
  });

  it("mirrors timing server events to the OTel bridge", () => {
    captureEvents();

    track("http.response", { duration_ms: 12, status_code: 200 });

    expect(mockQueueTrackingEvent).toHaveBeenCalledWith(
      "http.response",
      expect.objectContaining({ duration_ms: 12, status_code: 200 }),
      "server",
    );
  });

  it("marks browser-forwarded events as client-originated", () => {
    captureEvents();

    track(
      "action.response",
      { duration_ms: 12, success: true },
      { telemetryOrigin: "client" },
    );

    expect(mockQueueTrackingEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({ duration_ms: 12, success: true }),
      "client",
    );
  });

  it("lets an explicit session override the ambient request", async () => {
    const events = captureEvents();

    await runWithRequestContext({ browserSessionId: "ambient" }, () => {
      track("client_event", undefined, {
        userId: "alice@example.com",
        sessionId: "from-header",
      });
    });

    expect(events[0]?.sessionId).toBe("from-header");
  });

  it("does not let a throwing provider break track callers", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    registerTrackingProvider({
      name: "qa-throwing-track",
      track() {
        throw new Error("provider offline");
      },
    });

    expect(() => track("qa.event", { local: true })).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      '[tracking] Provider "qa-throwing-track" threw:',
      expect.any(Error),
    );
  });

  it("treats async flush failures as best-effort", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    registerTrackingProvider({
      name: "qa-rejecting-flush",
      track() {},
      async flush() {
        throw new Error("flush failed");
      },
    });

    await expect(flushTracking()).resolves.toEqual([undefined]);
    expect(errorSpy).toHaveBeenCalledWith(
      '[tracking] Provider "qa-rejecting-flush" flush rejected:',
      expect.any(Error),
    );
  });
});
