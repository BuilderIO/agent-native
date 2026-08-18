import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import {
  flushTracking,
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
    vi.restoreAllMocks();
  });

  it("attributes an event from an action ctx passed straight through", async () => {
    const events = captureEvents();

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

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "project_created",
      userId: "alice@example.com",
      sessionId: "session-1",
      properties: { template: "blank", client_platform: "electron" },
    });
  });

  it("keeps the browser session for callers that pass no source at all", async () => {
    const events = captureEvents();

    await runWithRequestContext({ browserSessionId: "session-2" }, () => {
      track("project_created");
    });

    expect(events[0]?.sessionId).toBe("session-2");
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
