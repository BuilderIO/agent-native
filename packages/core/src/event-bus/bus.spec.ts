import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  __resetEventBus,
  emit,
  listSubscriptions,
  subscribe,
  unsubscribe,
} from "./bus.js";
import { __resetEventRegistry, registerEvent, getEvent } from "./registry.js";

describe("event-bus", () => {
  beforeEach(() => {
    __resetEventBus();
    __resetEventRegistry();
    // Silence the bus's intentional console warnings/errors for negative paths.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __resetEventBus();
    __resetEventRegistry();
    vi.restoreAllMocks();
  });

  describe("subscribe / emit / unsubscribe", () => {
    it("delivers the payload and synthesized meta to a subscriber", () => {
      registerEvent({
        name: "thing.happened",
        description: "test",
        payloadSchema: z.object({ n: z.number() }) as any,
      });
      const handler = vi.fn();
      subscribe("thing.happened", handler);

      emit("thing.happened", { n: 42 }, { owner: "alice@example.com" });

      expect(handler).toHaveBeenCalledTimes(1);
      const [payload, meta] = handler.mock.calls[0];
      expect(payload).toEqual({ n: 42 });
      expect(meta.owner).toBe("alice@example.com");
      expect(typeof meta.eventId).toBe("string");
      expect(meta.eventId.length).toBeGreaterThan(0);
      expect(typeof meta.emittedAt).toBe("string");
      // emittedAt is an ISO timestamp.
      expect(Number.isNaN(Date.parse(meta.emittedAt))).toBe(false);
    });

    it("returns a distinct id per subscription and tracks them", () => {
      const id1 = subscribe("e", () => {});
      const id2 = subscribe("e", () => {});
      expect(id1).not.toBe(id2);
      const subs = listSubscriptions("e");
      expect(subs.map((s) => s.id).sort()).toEqual([id1, id2].sort());
    });

    it("stops delivering after unsubscribe and returns true once", () => {
      const handler = vi.fn();
      const id = subscribe("e", handler);

      unsubscribe(id);
      emit("e", {});

      expect(handler).not.toHaveBeenCalled();
      // Second unsubscribe of the same id is a no-op false.
      expect(unsubscribe(id)).toBe(false);
      expect(listSubscriptions("e")).toHaveLength(0);
    });

    it("unsubscribe of an unknown id returns false", () => {
      expect(unsubscribe("does-not-exist")).toBe(false);
    });

    it("rejects invalid subscribe arguments", () => {
      expect(() => subscribe("", () => {})).toThrow(/event name is required/);
      // @ts-expect-error testing runtime guard
      expect(() => subscribe("e", null)).toThrow(/handler must be a function/);
    });

    it("rejects emit with no event name", () => {
      // @ts-expect-error testing runtime guard
      expect(() => emit("", {})).toThrow(/event name is required/);
    });

    it("only delivers to subscribers of the matching event", () => {
      const a = vi.fn();
      const b = vi.fn();
      subscribe("event.a", a);
      subscribe("event.b", b);

      emit("event.a", {});

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).not.toHaveBeenCalled();
    });
  });

  describe("ordering and multiple subscribers", () => {
    it("invokes handlers in subscription order", () => {
      const order: number[] = [];
      subscribe("e", () => order.push(1));
      subscribe("e", () => order.push(2));
      subscribe("e", () => order.push(3));

      emit("e", {});

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe("handler error isolation", () => {
    it("a throwing sync handler does not prevent later handlers", () => {
      const after = vi.fn();
      subscribe("e", () => {
        throw new Error("boom");
      });
      subscribe("e", after);

      expect(() => emit("e", {})).not.toThrow();
      expect(after).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalled();
    });

    it("a rejected async handler is caught and logged, not unhandled", async () => {
      subscribe("e", async () => {
        throw new Error("async boom");
      });
      const after = vi.fn();
      subscribe("e", after);

      expect(() => emit("e", {})).not.toThrow();
      expect(after).toHaveBeenCalledTimes(1);
      // Let the rejected microtask settle so the .catch runs.
      await Promise.resolve();
      await Promise.resolve();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Async handler"),
        expect.any(Error),
      );
    });
  });

  describe("listener snapshot during dispatch", () => {
    it("a handler that subscribes mid-dispatch does not run in the same emission", () => {
      const late = vi.fn();
      subscribe("e", () => {
        subscribe("e", late);
      });

      emit("e", {});
      expect(late).not.toHaveBeenCalled();

      // But it does run on the next emission.
      emit("e", {});
      expect(late).toHaveBeenCalledTimes(1);
    });

    it("a handler that unsubscribes another mid-dispatch still delivers to the snapshotted listener", () => {
      const calls: string[] = [];
      let secondId = "";
      subscribe("e", () => {
        calls.push("first");
        unsubscribe(secondId);
      });
      secondId = subscribe("e", () => calls.push("second"));

      emit("e", {});
      // "second" was in the snapshot taken before dispatch, so it still fires.
      expect(calls).toEqual(["first", "second"]);

      // On the next emission "second" is gone.
      calls.length = 0;
      emit("e", {});
      expect(calls).toEqual(["first"]);
    });
  });

  describe("payload validation against registered schema", () => {
    it("passes the schema-parsed (coerced) value to handlers", () => {
      registerEvent({
        name: "coerce.event",
        description: "test",
        payloadSchema: z.object({
          n: z.coerce.number(),
        }) as any,
      });
      const handler = vi.fn();
      subscribe("coerce.event", handler);

      emit("coerce.event", { n: "7" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ n: 7 });
    });

    it("drops the emission when payload validation fails", () => {
      registerEvent({
        name: "strict.event",
        description: "test",
        payloadSchema: z.object({ n: z.number() }) as any,
      });
      const handler = vi.fn();
      subscribe("strict.event", handler);

      emit("strict.event", { n: "not-a-number" });

      expect(handler).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("Payload validation failed"),
        expect.anything(),
      );
    });

    it("dispatches unvalidated and warns for an unregistered event", () => {
      const handler = vi.fn();
      subscribe("unregistered.event", handler);

      emit("unregistered.event", { anything: true });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ anything: true });
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("unregistered event"),
      );
    });

    it("dispatches unvalidated and warns when a schema validates asynchronously", () => {
      registerEvent({
        name: "async.event",
        description: "test",
        // A schema whose validate() returns a Promise — unsupported path.
        payloadSchema: {
          "~standard": {
            version: 1,
            vendor: "test",
            validate: async () => ({ value: { ok: true } }),
          },
        } as any,
      });
      const handler = vi.fn();
      subscribe("async.event", handler);

      emit("async.event", { raw: 1 });

      // Falls through to dispatching the original (unvalidated) payload.
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ raw: 1 });
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("async validation is not supported"),
      );
    });
  });
});

describe("event registry", () => {
  beforeEach(() => {
    __resetEventRegistry();
  });
  afterEach(() => {
    __resetEventRegistry();
  });

  it("seeds the built-in events on reset", () => {
    expect(getEvent("test.event.fired")?.name).toBe("test.event.fired");
    expect(getEvent("agent.turn.completed")?.name).toBe("agent.turn.completed");
  });

  it("registers and looks up a definition", () => {
    registerEvent({
      name: "my.event",
      description: "desc",
      payloadSchema: z.object({}) as any,
    });
    expect(getEvent("my.event")?.description).toBe("desc");
  });

  it("later registration with the same name replaces the previous one", () => {
    registerEvent({
      name: "dup",
      description: "first",
      payloadSchema: z.object({}) as any,
    });
    registerEvent({
      name: "dup",
      description: "second",
      payloadSchema: z.object({}) as any,
    });
    expect(getEvent("dup")?.description).toBe("second");
  });

  it("validates required fields on registration", () => {
    expect(() =>
      registerEvent({ description: "d", payloadSchema: z.object({}) } as any),
    ).toThrow(/def.name is required/);
    expect(() =>
      registerEvent({ name: "x", payloadSchema: z.object({}) } as any),
    ).toThrow(/def.description is required/);
    expect(() => registerEvent({ name: "x", description: "d" } as any)).toThrow(
      /def.payloadSchema is required/,
    );
  });

  it("getEvent returns undefined for an unknown name", () => {
    expect(getEvent("nope.nope")).toBeUndefined();
  });
});
