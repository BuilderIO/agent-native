import { describe, expect, it, vi } from "vitest";

import {
  startModelDispatch,
  type BeforeModelDispatch,
} from "./engine/types.js";
import {
  createRunSafeBoundaryGuards,
  trackExperimentExposureAtDispatch,
  type QueuedRunInterruptBoundaryResult,
} from "./production-agent.js";

/**
 * Fresh-scope model-input validation is planned as an optional
 * `validateModelInput?: () => boolean | Promise<boolean>` on
 * `createRunSafeBoundaryGuards`. When present it must run at the real dispatch
 * boundary: after `flushEvents` and `interruptRequestedAtBoundary`, and before
 * the synchronous provider start and experiment exposure. A refusal, a throw,
 * or an abort must resolve to `{ started: false }` without ever surfacing the
 * raw validation error.
 *
 * These tests are intentionally written before the option exists, so the
 * current implementation (which ignores the unknown option) is expected to
 * fail the strict no-dispatch assertions.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createBoundaryGuard(options: {
  signal: AbortSignal;
  flushEvents: () => Promise<void>;
  interruptRequestedAtBoundary: () => Promise<QueuedRunInterruptBoundaryResult>;
  validateModelInput?: () => boolean | Promise<boolean>;
}) {
  // Deliberately an inferred object variable rather than an inline literal, so
  // the not-yet-declared option is passed structurally without a cast.
  const guardInput = {
    signal: options.signal,
    flushEvents: options.flushEvents,
    interruptRequestedAtBoundary: options.interruptRequestedAtBoundary,
    validateModelInput: options.validateModelInput,
  };
  return createRunSafeBoundaryGuards(guardInput);
}

async function runRefusedDispatch(
  validateModelInput: () => boolean | Promise<boolean>,
) {
  const dispatch = vi.fn(() => "provider-result");
  const onStarted = vi.fn();
  const trackExposure = vi.fn();
  const guards = createBoundaryGuard({
    signal: new AbortController().signal,
    flushEvents: async () => {},
    interruptRequestedAtBoundary: async () => "none",
    validateModelInput,
  });
  const beforeModelDispatch = trackExperimentExposureAtDispatch(
    guards.beforeModelDispatch,
    trackExposure,
  );
  const decision = await startModelDispatch(
    { beforeModelDispatch, onModelDispatchStarted: onStarted },
    dispatch,
  );
  return { decision, dispatch, onStarted, trackExposure };
}

describe("createRunSafeBoundaryGuards model-input scope", () => {
  describe("refused scope", () => {
    it("has zero provider, started notification, and exposure when validation returns false", async () => {
      const { decision, dispatch, onStarted, trackExposure } =
        await runRefusedDispatch(() => false);

      expect(decision).toEqual({ started: false });
      expect(dispatch).not.toHaveBeenCalled();
      expect(onStarted).not.toHaveBeenCalled();
      expect(trackExposure).not.toHaveBeenCalled();
    });

    it("has zero provider, started notification, and exposure when validation throws synchronously", async () => {
      const { decision, dispatch, onStarted, trackExposure } =
        await runRefusedDispatch(() => {
          throw new Error("model input scope changed");
        });

      expect(decision).toEqual({ started: false });
      expect(dispatch).not.toHaveBeenCalled();
      expect(onStarted).not.toHaveBeenCalled();
      expect(trackExposure).not.toHaveBeenCalled();
    });

    it("has zero provider, started notification, and exposure when validation rejects asynchronously", async () => {
      const { decision, dispatch, onStarted, trackExposure } =
        await runRefusedDispatch(async () => {
          throw new Error("model input scope changed");
        });

      expect(decision).toEqual({ started: false });
      expect(dispatch).not.toHaveBeenCalled();
      expect(onStarted).not.toHaveBeenCalled();
      expect(trackExposure).not.toHaveBeenCalled();
    });
  });

  it("runs validation after flush and interrupt but before exposure and provider", async () => {
    const order: string[] = [];
    const dispatch = vi.fn(() => {
      order.push("provider");
      return "provider-result";
    });
    const trackExposure = vi.fn(() => {
      order.push("exposure");
    });
    const onStarted = vi.fn();
    const guards = createBoundaryGuard({
      signal: new AbortController().signal,
      flushEvents: async () => {
        order.push("flush");
      },
      interruptRequestedAtBoundary: async () => {
        order.push("interrupt");
        return "none";
      },
      validateModelInput: async () => {
        order.push("validate");
        return true;
      },
    });
    const beforeModelDispatch = trackExperimentExposureAtDispatch(
      guards.beforeModelDispatch,
      trackExposure,
    );

    const decision = await startModelDispatch(
      { beforeModelDispatch, onModelDispatchStarted: onStarted },
      dispatch,
    );

    expect(decision).toEqual({ started: true, value: "provider-result" });
    expect(order).toEqual([
      "flush",
      "interrupt",
      "validate",
      "exposure",
      "provider",
    ]);
    expect(onStarted).toHaveBeenCalledOnce();
    expect(trackExposure).toHaveBeenCalledOnce();
  });

  it("skips validation when the run is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const validateModelInput = vi.fn(() => true);
    const dispatch = vi.fn(() => "provider-result");
    const onStarted = vi.fn();
    const guards = createBoundaryGuard({
      signal: controller.signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => "none",
      validateModelInput,
    });

    const decision = await startModelDispatch(
      {
        beforeModelDispatch: guards.beforeModelDispatch,
        onModelDispatchStarted: onStarted,
      },
      dispatch,
    );

    expect(decision).toEqual({ started: false });
    expect(validateModelInput).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("refuses when the run aborts while validation is awaited", async () => {
    const controller = new AbortController();
    const dispatch = vi.fn(() => "provider-result");
    const onStarted = vi.fn();
    const trackExposure = vi.fn();
    const guards = createBoundaryGuard({
      signal: controller.signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => "none",
      validateModelInput: async () => {
        controller.abort();
        return true;
      },
    });
    const beforeModelDispatch = trackExperimentExposureAtDispatch(
      guards.beforeModelDispatch,
      trackExposure,
    );

    const decision = await startModelDispatch(
      { beforeModelDispatch, onModelDispatchStarted: onStarted },
      dispatch,
    );

    expect(decision).toEqual({ started: false });
    expect(dispatch).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(trackExposure).not.toHaveBeenCalled();
  });

  it("skips validation when an interrupt is refused at the boundary", async () => {
    let interruptResult: QueuedRunInterruptBoundaryResult = "pending";
    const validateModelInput = vi.fn(() => true);
    const dispatch = vi.fn(() => "provider-result");
    const onStarted = vi.fn();
    const guards = createBoundaryGuard({
      signal: new AbortController().signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => interruptResult,
      validateModelInput,
    });

    const decision = await startModelDispatch(
      {
        beforeModelDispatch: guards.beforeModelDispatch,
        onModelDispatchStarted: onStarted,
      },
      dispatch,
    );

    expect(decision).toEqual({ started: false });
    expect(validateModelInput).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("refuses when scope changes during a delayed credential gate before dispatch", async () => {
    const expectedScopeId = "scope-a";
    let currentScopeId = "scope-a";
    const credentialGate = deferred<void>();
    const dispatch = vi.fn(() => "provider-result");
    const onStarted = vi.fn();
    const trackExposure = vi.fn();
    const guards = createBoundaryGuard({
      signal: new AbortController().signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => "none",
      validateModelInput: () => currentScopeId === expectedScopeId,
    });
    const beforeModelDispatch = trackExperimentExposureAtDispatch(
      guards.beforeModelDispatch,
      trackExposure,
    );

    const pendingDispatch = (async () => {
      await credentialGate.promise;
      return startModelDispatch(
        { beforeModelDispatch, onModelDispatchStarted: onStarted },
        dispatch,
      );
    })();

    currentScopeId = "scope-b";
    credentialGate.resolve();

    const decision = await pendingDispatch;

    expect(decision).toEqual({ started: false });
    expect(dispatch).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(trackExposure).not.toHaveBeenCalled();
  });

  it("invalidates the expected scope when A to B to A yields a fresh nonce", async () => {
    const expected = { scopeId: "scope-a", nonce: "scope-nonce-1" };
    let current = { scopeId: "scope-a", nonce: "scope-nonce-1" };

    // The selection leaves A.
    current = { scopeId: "scope-b", nonce: "scope-nonce-2" };
    // Returning to A resolves a fresh nonce, so the originally expected
    // nonce must no longer authorize a dispatch.
    current = { scopeId: "scope-a", nonce: "scope-nonce-3" };

    const dispatch = vi.fn(() => "provider-result");
    const onStarted = vi.fn();
    const guards = createBoundaryGuard({
      signal: new AbortController().signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => "none",
      validateModelInput: () =>
        current.scopeId === expected.scopeId &&
        current.nonce === expected.nonce,
    });

    const decision = await startModelDispatch(
      {
        beforeModelDispatch: guards.beforeModelDispatch,
        onModelDispatchStarted: onStarted,
      },
      dispatch,
    );

    expect(decision).toEqual({ started: false });
    expect(dispatch).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("preserves an unresolved provider promise identity without awaiting it", async () => {
    const providerPromise = deferred<string>().promise;
    const dispatch = vi.fn(() => providerPromise);
    const onStarted = vi.fn();
    const validateModelInput = vi.fn(async () => true);
    const guards = createBoundaryGuard({
      signal: new AbortController().signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => "none",
      validateModelInput,
    });
    const beforeModelDispatch: BeforeModelDispatch = guards.beforeModelDispatch;

    const decision = await startModelDispatch(
      { beforeModelDispatch, onModelDispatchStarted: onStarted },
      dispatch,
    );

    expect(validateModelInput).toHaveBeenCalledOnce();
    expect(decision.started).toBe(true);
    if (!decision.started) throw new Error("expected dispatch to start");
    expect(decision.value).toBe(providerPromise);
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it("preserves an async-iterator provider object identity", async () => {
    const iterator = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        return { done: true as const, value: undefined };
      },
    };
    const dispatch = vi.fn(() => iterator);
    const guards = createBoundaryGuard({
      signal: new AbortController().signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => "none",
      validateModelInput: () => true,
    });

    const decision = await startModelDispatch(
      {
        beforeModelDispatch: guards.beforeModelDispatch,
        onModelDispatchStarted: vi.fn(),
      },
      dispatch,
    );

    expect(decision.started).toBe(true);
    if (!decision.started) throw new Error("expected dispatch to start");
    expect(decision.value).toBe(iterator);
  });

  it("dispatches unchanged when no validator is configured", async () => {
    const dispatch = vi.fn(() => "provider-result");
    const onStarted = vi.fn();
    const guards = createBoundaryGuard({
      signal: new AbortController().signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => "none",
    });

    const decision = await startModelDispatch(
      {
        beforeModelDispatch: guards.beforeModelDispatch,
        onModelDispatchStarted: onStarted,
      },
      dispatch,
    );

    expect(decision).toEqual({ started: true, value: "provider-result" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(onStarted).toHaveBeenCalledOnce();
  });
});
