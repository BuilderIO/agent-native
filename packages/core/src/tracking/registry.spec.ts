import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
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

vi.mock("../observability/tracing.js", () => ({
  queueTrackingEvent: mockQueueTrackingEvent,
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

  it("emits a canonical alias with provenance for legacy event names", () => {
    const events = captureEvents();
    const legacyName = "session status";

    track(legacyName, { signed_in: true });

    expect(events).toHaveLength(2);
    expect(events[0]?.name).toBe(legacyName);
    expect(events[1]).toMatchObject({
      name: "session_status",
      properties: {
        signed_in: true,
        canonical_event_name: "session_status",
        legacy_event_name: legacyName,
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
