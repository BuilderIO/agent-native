import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlockFieldSaveController } from "./blockFieldSaveController";
import {
  __resetBlockFieldSaveRegistry,
  acquireBlockFieldSaveController,
  activeControllerCount,
  blockFieldSaveImplRef,
  peekBlockFieldSaveController,
  releaseBlockFieldSaveController,
} from "./blockFieldSaveRegistry";

afterEach(() => {
  vi.useRealTimers();
  __resetBlockFieldSaveRegistry();
});

// A controller factory wired to a save spy and the per-key impl ref, so the test
// can drive saves exactly as the hook does.
function factoryFor(key: string, initialContent = "") {
  const impl = blockFieldSaveImplRef(key);
  return () =>
    createBlockFieldSaveController({
      initialContent,
      save: (value) => impl.current(value),
    });
}

describe("blockFieldSaveRegistry", () => {
  it("returns the SAME controller instance for a key while ref-count > 0", () => {
    const key = "doc:field";
    const a = acquireBlockFieldSaveController(key, factoryFor(key));
    const b = acquireBlockFieldSaveController(key, factoryFor(key));
    expect(b).toBe(a);
    expect(activeControllerCount()).toBe(1);

    // Releasing one of two references keeps the controller alive and identical.
    releaseBlockFieldSaveController(key);
    const c = acquireBlockFieldSaveController(key, factoryFor(key));
    expect(c).toBe(a);
    expect(activeControllerCount()).toBe(1);
  });

  it("evicts only AFTER ref-count hits 0 and the final flush settles", async () => {
    const key = "doc:field";
    const resolvers: Array<() => void> = [];
    const saved: string[] = [];
    blockFieldSaveImplRef(key).current = (value) => {
      saved.push(value);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    };

    vi.useFakeTimers();
    const controller = acquireBlockFieldSaveController(key, factoryFor(key));

    // Dirty content with no debounce fired yet.
    controller.change("draft");

    // Release the only reference → flush-then-evict begins. The flush issues the
    // save immediately, but the controller is NOT evicted until that save settles.
    releaseBlockFieldSaveController(key);
    expect(saved).toEqual(["draft"]);
    expect(activeControllerCount()).toBe(1); // still present: flush in flight.

    // A peek before settle still finds the live controller.
    expect(peekBlockFieldSaveController(key)).toBe(controller);

    // Settle the flush save → now it evicts.
    await act(() => {
      resolvers[0]!();
    });
    expect(activeControllerCount()).toBe(0);
    expect(peekBlockFieldSaveController(key)).toBeUndefined();
  });

  it("keeps a dirty controller after a failed release flush so reopen can retry", async () => {
    const key = "doc:field";
    blockFieldSaveImplRef(key).current = () =>
      Promise.reject(new Error("network"));

    const controller = acquireBlockFieldSaveController(key, factoryFor(key));
    controller.change("draft");

    releaseBlockFieldSaveController(key);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(activeControllerCount()).toBe(1);
    expect(peekBlockFieldSaveController(key)).toBe(controller);
    expect(controller.pending).toBe("draft");
    expect(controller.lastSaved).toBe("");

    const saved: string[] = [];
    blockFieldSaveImplRef(key).current = (value) => {
      saved.push(value);
      return Promise.resolve();
    };
    const reopened = acquireBlockFieldSaveController(key, factoryFor(key));
    expect(reopened).toBe(controller);

    releaseBlockFieldSaveController(key);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(saved).toEqual(["draft"]);
    expect(activeControllerCount()).toBe(0);
  });

  it("a flush during release still persists the latest dirty content", async () => {
    const key = "doc:field";
    const saved: string[] = [];
    blockFieldSaveImplRef(key).current = (value) => {
      saved.push(value);
      return Promise.resolve();
    };

    const controller = acquireBlockFieldSaveController(key, factoryFor(key));
    controller.change("unsaved final edit");

    // No debounce has fired; release must flush it so it is not dropped, then
    // evict once the flush settles (a few microtasks: flush → save → settle).
    releaseBlockFieldSaveController(key);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(saved).toContain("unsaved final edit");
    expect(activeControllerCount()).toBe(0);
  });

  it("reopen BEFORE the flush settles reuses the same controller (eviction cancelled)", async () => {
    const key = "doc:field";
    const resolvers: Array<() => void> = [];
    blockFieldSaveImplRef(key).current = (value) =>
      new Promise<void>((resolve) => resolvers.push(resolve));

    const first = acquireBlockFieldSaveController(key, factoryFor(key));
    first.change("content");

    // Release → flush-then-evict starts; the save goes in flight (unresolved).
    releaseBlockFieldSaveController(key);
    expect(activeControllerCount()).toBe(1);

    // Reopen before the flush settles: same instance, eviction cancelled.
    const second = acquireBlockFieldSaveController(key, factoryFor(key));
    expect(second).toBe(first);

    // Even after the in-flight flush save settles, the entry is NOT evicted
    // because it was re-acquired (refCount > 0, evicting cleared).
    await act(() => {
      resolvers.forEach((r) => r());
    });
    expect(activeControllerCount()).toBe(1);
    expect(peekBlockFieldSaveController(key)).toBe(second);
  });

  it("evicting a controller also removes its saveImpls entry; re-acquire rebuilds it and saves work", async () => {
    const key = "doc:field";
    const saved: string[] = [];
    blockFieldSaveImplRef(key).current = (value) => {
      saved.push(value);
      return Promise.resolve();
    };

    const first = acquireBlockFieldSaveController(key, factoryFor(key));
    first.change("first content");

    // Release → flush-then-evict; settle the microtasks so the entry evicts.
    releaseBlockFieldSaveController(key);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(activeControllerCount()).toBe(0);
    expect(saved).toContain("first content");

    // The impl ref must have been dropped on eviction. blockFieldSaveImplRef
    // recreates it lazily; a never-registered ref rejects when invoked, proving
    // the prior impl closure did NOT survive (no stale closure leaks across
    // eviction).
    const freshRef = blockFieldSaveImplRef(key);
    await expect(freshRef.current("anything")).rejects.toThrow(
      /No save impl registered/,
    );

    // Re-acquire the SAME key after eviction: a brand-new controller is created
    // and wired through a freshly rebuilt impl ref. Re-register an impl (as a new
    // mount would) and confirm saves flow to it cleanly.
    const saved2: string[] = [];
    blockFieldSaveImplRef(key).current = (value) => {
      saved2.push(value);
      return Promise.resolve();
    };
    const second = acquireBlockFieldSaveController(key, factoryFor(key));
    expect(second).not.toBe(first);
    expect(activeControllerCount()).toBe(1);

    second.change("second content");
    await second.flush();
    expect(saved2).toEqual(["second content"]);
    // The rebuilt controller did NOT write through the old impl.
    expect(saved).toEqual(["first content"]);
  });

  it("different keys are fully independent (no shared state or stalls)", async () => {
    const k1 = "doc:f1";
    const k2 = "doc:f2";
    const saved1: string[] = [];
    const saved2: string[] = [];
    let resolveK1!: () => void;
    blockFieldSaveImplRef(k1).current = (value) => {
      saved1.push(value);
      return new Promise<void>((resolve) => (resolveK1 = resolve));
    };
    blockFieldSaveImplRef(k2).current = (value) => {
      saved2.push(value);
      return Promise.resolve();
    };

    const c1 = acquireBlockFieldSaveController(k1, factoryFor(k1));
    const c2 = acquireBlockFieldSaveController(k2, factoryFor(k2));
    expect(c1).not.toBe(c2);
    expect(activeControllerCount()).toBe(2);

    // k1's save blocks indefinitely (its resolver is held). k2 must still persist
    // fully — independent controllers, no cross-key stall. We do NOT await k1's
    // flush (it would never resolve until resolveK1).
    c1.change("k1 value");
    const k1Flush = c1.flush(); // in flight, intentionally not awaited yet.
    void k1Flush;
    expect(saved1).toEqual(["k1 value"]); // k1's save started but is stuck.

    c2.change("k2 value");
    await c2.flush(); // resolves immediately — not blocked by k1.
    expect(saved2).toEqual(["k2 value"]);

    // Unblock k1 so the test leaves no dangling promise.
    resolveK1();
    await k1Flush;
  });
});

// Minimal act() shim: the registry has no React, but settling promises after a
// resolver mirrors how the hook awaits flushes. Keeps assertions deterministic.
async function act(fn: () => void): Promise<void> {
  fn();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
