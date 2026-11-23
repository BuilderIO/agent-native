import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction, type ActionRunContext } from "../action.js";
import { runWithRequestContext } from "../server/request-context.js";
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
        status: "started",
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

  it("omits output IDs for private actions and inherited private turns", async () => {
    const events = captureEvents();
    const privateAction = wrapRunWithActionTracking(
      async () => ({ id: "private-record-id" }),
      false,
      { includeOutputId: false },
    );
    const inheritedPrivateTurn = wrapRunWithActionTracking(
      async () => ({ id: "private-result-id" }),
      false,
    );

    await privateAction({}, context);
    await inheritedPrivateTurn(
      {},
      {
        ...context,
        omitFromPersistedHistory: true,
      },
    );

    expect(
      events.filter((event) => event.name === "action_completed"),
    ).toHaveLength(2);
    expect(
      events
        .filter((event) => event.name === "action_completed")
        .every((event) => !("output_id" in (event.properties ?? {}))),
    ).toBe(true);
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

  describe("action_kind", () => {
    const kinds = (events: TrackingEvent[]) =>
      events.map((event) => event.properties?.action_kind);
    const fromApp = <T>(run: () => Promise<T>) =>
      runWithRequestContext({ appPageRequest: true }, run);

    it("labels every event of a write the app makes on its own automatic", async () => {
      const events = captureEvents();
      const save = defineAction({
        description: "Save where playback stopped.",
        schema: z.object({ positionMs: z.number() }),
        automatic: true,
        run: async () => ({ saved: true }),
      });
      const failing = defineAction({
        description: "Record an exposure.",
        schema: z.object({}),
        automatic: true,
        run: async () => {
          throw new Error("storage unavailable");
        },
      });

      await fromApp(() =>
        save.run(
          { positionMs: 1_000 },
          { ...context, actionName: "save-playback-position" },
        ),
      );
      await expect(
        fromApp(() =>
          failing.run({}, { ...context, actionName: "record-exposure" }),
        ),
      ).rejects.toThrow("storage unavailable");

      expect(events.map((event) => event.name)).toEqual([
        "action_started",
        "action_completed",
        "action_started",
        "action_failed",
      ]);
      expect(kinds(events)).toEqual([
        "automatic",
        "automatic",
        "automatic",
        "automatic",
      ]);
    });

    it("labels per call when only some calls are automatic", async () => {
      const events = captureEvents();
      const sync = defineAction({
        description: "Sync the inbox.",
        schema: z.object({ force: z.boolean().optional() }),
        automatic: (input) => !input.force,
        run: async () => ({ synced: true }),
      });
      const ctx = { ...context, actionName: "sync-inbox" };

      await fromApp(async () => {
        await sync.run({}, ctx);
        await sync.run({ force: true }, ctx);
        await sync.run({}, { ...ctx, caller: "tool" });
      });

      expect(
        events
          .filter((event) => event.name === "action_completed")
          .map((event) => event.properties?.action_kind),
      ).toEqual(["automatic", "write", "write"]);
    });

    it("labels a call its planMode declares a read as read, whatever else it declares", async () => {
      const events = captureEvents();
      const policy = defineAction({
        description: "Read or change a setting.",
        schema: z.object({ set: z.boolean().optional() }),
        planMode: {
          effect: (args) => (args.set === undefined ? "read" : "write"),
        },
        automatic: true,
        run: async () => ({ restricted: false }),
      });
      const ctx = { ...context, actionName: "manage-provider-key-policy" };

      await fromApp(async () => {
        await policy.run({}, ctx);
        await policy.run({ set: true }, ctx);
      });

      expect(
        events
          .filter((event) => event.name === "action_completed")
          .map((event) => event.properties?.action_kind),
      ).toEqual(["read", "automatic"]);
    });

    it("counts a call as a write when its automatic predicate throws", async () => {
      const events = captureEvents();
      const write = defineAction({
        description: "Write something.",
        schema: z.object({}),
        automatic: () => {
          throw new Error("predicate bug");
        },
        run: async () => ({ ok: true }),
      });

      await write.run({}, { ...context, actionName: "write-something" });

      expect(kinds(events)).toEqual(["write", "write"]);
    });

    it("keeps write for an action that declares nothing", async () => {
      const events = captureEvents();
      const create = defineAction({
        description: "Create a clip.",
        schema: z.object({}),
        run: async () => ({ id: "clip-2" }),
      });

      await create.run({}, context);

      expect(kinds(events)).toEqual(["write", "write"]);
    });

    it("labels a call from a copy of its arguments, leaving the handler's own", async () => {
      const events = captureEvents();
      const received: number[] = [];
      const reschedule = defineAction({
        description: "Reschedule a reminder.",
        schema: z.object({ at: z.date() }),
        automatic: (input) => {
          input.at.setTime(0);
          return true;
        },
        run: async (args) => {
          received.push(args.at.getTime());
          return { ok: true };
        },
      });

      await fromApp(() =>
        reschedule.run(
          { at: new Date(1_000) },
          { ...context, actionName: "reschedule-reminder" },
        ),
      );

      expect(received).toEqual([1_000]);
      expect(kinds(events)).toEqual(["automatic", "automatic"]);
    });
  });
});
