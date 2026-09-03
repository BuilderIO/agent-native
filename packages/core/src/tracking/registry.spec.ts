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
          browserSessionId: "session-1",
          clientPlatform: "electron",
        },
        () => {
          track(
            "project_created",
            { template: "blank" },
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
        deployment_environment: "local",
        client_platform: "electron",
      },
    });
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
    const email = "signup+qa-test-bot-123@example.com";

    expect(isQaTestEmail(email)).toBe(true);
    track("signup", { email }, { userId: email });
    track("client_event", undefined, { userId: email });
    track("property_event", { userEmail: email });
    identify(email, { email });
    identify("auth-user-qa", { email });
    identify("auth-user-qa", { userEmail: email });

    expect(events).toEqual([]);
    expect(identified).toEqual([]);
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
