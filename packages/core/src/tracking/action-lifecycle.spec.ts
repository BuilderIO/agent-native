import { afterEach, describe, expect, it } from "vitest";

import type { ActionRunContext } from "../action.js";
import { wrapRunWithActionTracking } from "./action-lifecycle.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "./registry.js";
import type { TrackingEvent } from "./types.js";

const PROVIDER_NAME = "qa-action-lifecycle-capture";

function captureEvents(): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  registerTrackingProvider({
    name: PROVIDER_NAME,
    track(event) {
      events.push(event);
    },
  });
  return events;
}

const context: ActionRunContext = {
  caller: "frontend",
  userEmail: "alice@example.com",
  orgId: "org_123",
  appId: "agent-native-clips",
  actionName: "create-clip",
};

describe("action lifecycle tracking", () => {
  afterEach(() => {
    unregisterTrackingProvider(PROVIDER_NAME);
  });

  it("records one start and one successful outcome for a mutation", async () => {
    const events = captureEvents();
    const trackedRun = wrapRunWithActionTracking(
      async () => ({ id: "clip-1" }),
      false,
    );

    await expect(trackedRun({}, context)).resolves.toEqual({ id: "clip-1" });

    expect(events.map((event) => event.name)).toEqual([
      "action_started",
      "action_completed",
    ]);
    expect(events[0]).toMatchObject({
      properties: {
        action_name: "create-clip",
        action_source: "frontend",
        app_name: "clips",
        template_name: "clips",
        action_kind: "write",
        user_id: "alice@example.com",
        user_email: "alice@example.com",
        workspace_id: "org_123",
      },
    });
    expect(events[1]).toMatchObject({
      properties: {
        action_name: "create-clip",
        output_id: "clip-1",
        outcome: "success",
        success: true,
        status: "completed",
      },
    });
    expect(events[0]?.properties?.operation_id).toEqual(
      events[1]?.properties?.operation_id,
    );
  });

  it("records a failed outcome and preserves the original error", async () => {
    const events = captureEvents();
    const failure = new Error("storage unavailable");
    failure.name = "AbortError";
    const trackedRun = wrapRunWithActionTracking(async () => {
      throw failure;
    }, false);

    await expect(trackedRun({}, context)).rejects.toBe(failure);

    expect(events.map((event) => event.name)).toEqual([
      "action_started",
      "action_failed",
    ]);
    expect(events[1]).toMatchObject({
      properties: {
        action_name: "create-clip",
        failure_type: "cancelled",
        operation_id: expect.any(String),
        outcome: "cancelled",
        success: false,
        status: "failed",
      },
    });
    expect(events[0]?.properties?.operation_id).toEqual(
      events[1]?.properties?.operation_id,
    );
  });

  it("classifies framework statusCode failures as HTTP errors", async () => {
    const events = captureEvents();
    const failure = Object.assign(new Error("request failed"), {
      statusCode: 503,
    });
    const trackedRun = wrapRunWithActionTracking(async () => {
      throw failure;
    }, false);

    await expect(trackedRun({}, context)).rejects.toBe(failure);

    expect(events[1]).toMatchObject({
      properties: {
        failure_type: "http_error",
        outcome: "http_error",
      },
    });
  });

  it("keeps arbitrary TypeErrors in the generic error bucket", async () => {
    const events = captureEvents();
    const failure = new TypeError("invalid property access");
    const trackedRun = wrapRunWithActionTracking(async () => {
      throw failure;
    }, false);

    await expect(trackedRun({}, context)).rejects.toBe(failure);

    expect(events[1]).toMatchObject({
      properties: {
        failure_type: "error",
        outcome: "error",
      },
    });
  });

  it("skips reads and high-frequency background/state actions", async () => {
    const events = captureEvents();
    const read = wrapRunWithActionTracking(async () => "read", true);
    const refresh = wrapRunWithActionTracking(async () => "refresh", false);
    const navigate = wrapRunWithActionTracking(async () => "navigate", false);

    await read({}, context);
    await refresh({}, { ...context, actionName: "refresh-list" });
    await navigate({}, { ...context, actionName: "navigate" });

    expect(events).toEqual([]);
  });
});
