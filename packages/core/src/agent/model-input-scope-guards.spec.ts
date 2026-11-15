import { describe, expect, it, vi } from "vitest";

import { isRequestedStopAbortReason } from "./abort-reasons.js";
import {
  createModelInputScopeGuardRegistry,
  MODEL_INPUT_SCOPE_ABORT_REASON,
  type ModelInputScopeGuard,
} from "./model-input-scope-guards.js";

/**
 * Runtime-value guard factory. Some tests must feed non-boolean results through
 * the guard seam; this routes the value through `unknown` so the cast is a
 * deliberate runtime probe rather than an unchecked `any`.
 */
const asGuard = (fn: () => unknown): ModelInputScopeGuard =>
  fn as unknown as ModelInputScopeGuard;

const CANARY = "CANARY-scope-guard-error-body-4F1A";

describe("model input scope guard registry", () => {
  it("classifies invalidated input as a requested stop", () => {
    expect(isRequestedStopAbortReason(MODEL_INPUT_SCOPE_ABORT_REASON)).toBe(
      true,
    );
  });

  it("notifies the owning run once when a scope is refused", async () => {
    const onRefused = vi.fn();
    const registry = createModelInputScopeGuardRegistry(onRefused);
    registry.register(() => false);
    expect(await registry.validate()).toBe(false);
    expect(await registry.validate()).toBe(false);
    expect(registry.register(() => true)).toBe(false);
    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it("validates an empty registry as the literal true, synchronously", () => {
    const registry = createModelInputScopeGuardRegistry();

    const outcome = registry.validate();

    expect(outcome).toBe(true);
    expect(typeof outcome).toBe("boolean");
    expect(outcome).not.toBeInstanceOf(Promise);
  });

  it("invokes every registered guard on each validation", async () => {
    const registry = createModelInputScopeGuardRegistry();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    expect(registry.register(first)).toBe(true);
    expect(registry.register(second)).toBe(true);

    await expect(registry.validate()).resolves.toBe(true);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops dispatching once an earlier guard refuses", async () => {
    const registry = createModelInputScopeGuardRegistry();
    const refusing = vi.fn(() => false);
    const later = vi.fn(() => true);
    registry.register(refusing);
    registry.register(later);

    await expect(registry.validate()).resolves.toBe(false);

    expect(refusing).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
  });

  it("latches a refusal and never recovers or accepts new guards", async () => {
    const registry = createModelInputScopeGuardRegistry();
    let conditionsHealthy = true;
    const gate = vi.fn(() => conditionsHealthy);
    registry.register(gate);

    conditionsHealthy = false;
    await expect(registry.validate()).resolves.toBe(false);

    conditionsHealthy = true;
    await expect(registry.validate()).resolves.toBe(false);
    expect(registry.register(() => true)).toBe(false);
  });

  it("latches a refusal on an async false and cannot be healed", async () => {
    const registry = createModelInputScopeGuardRegistry();
    let conditionsHealthy = true;
    registry.register(asGuard(() => Promise.resolve(conditionsHealthy)));

    conditionsHealthy = false;
    await expect(registry.validate()).resolves.toBe(false);

    conditionsHealthy = true;
    await expect(registry.validate()).resolves.toBe(false);
    expect(registry.register(() => true)).toBe(false);
  });

  it("latches a synchronous throw without surfacing or forwarding its body", async () => {
    const registry = createModelInputScopeGuardRegistry();
    const downstream = vi.fn(() => true);
    registry.register(
      asGuard(() => {
        throw new Error(CANARY);
      }),
    );
    registry.register(downstream);

    const outcome = await registry.validate();

    expect(outcome).toBe(false);
    expect(String(outcome)).not.toContain(CANARY);
    expect(JSON.stringify({ outcome })).not.toContain(CANARY);
    expect(downstream).not.toHaveBeenCalled();
    expect(registry.register(() => true)).toBe(false);
  });

  it("latches an async rejection without surfacing or forwarding its body", async () => {
    const registry = createModelInputScopeGuardRegistry();
    const downstream = vi.fn(() => true);
    registry.register(asGuard(() => Promise.reject(new Error(CANARY))));
    registry.register(downstream);

    const outcome = await registry.validate();

    expect(outcome).toBe(false);
    expect(String(outcome)).not.toContain(CANARY);
    expect(downstream).not.toHaveBeenCalled();
    expect(registry.register(() => true)).toBe(false);
  });

  it("does not let an earlier true finishing later heal a concurrent refusal", async () => {
    const registry = createModelInputScopeGuardRegistry();
    const resolvers: Array<(value: boolean) => void> = [];
    const gate: ModelInputScopeGuard = () =>
      new Promise<boolean>((resolve) => {
        resolvers.push(resolve);
      });
    registry.register(gate);

    const earlier = registry.validate();
    const concurrent = registry.validate();
    await Promise.resolve();
    expect(resolvers).toHaveLength(2);

    // The concurrent validation refuses first...
    resolvers[1](false);
    await expect(concurrent).resolves.toBe(false);

    // ...and the earlier validation, whose guard later reports true, cannot heal it.
    resolvers[0](true);
    await expect(earlier).resolves.toBe(false);
    await expect(registry.validate()).resolves.toBe(false);
  });

  it("deduplicates the same guard function registered twice", async () => {
    const registry = createModelInputScopeGuardRegistry();
    const guard = vi.fn(() => true);
    expect(registry.register(guard)).toBe(true);
    expect(registry.register(guard)).toBe(true);

    await expect(registry.validate()).resolves.toBe(true);

    expect(guard).toHaveBeenCalledTimes(1);
  });

  it("refuses any guard whose runtime result is not the literal true", async () => {
    const nonBooleanResults: Array<() => unknown> = [
      () => "true",
      () => 1,
      () => undefined,
      () => null,
      () => ({ ok: true }),
      () => Promise.resolve("yes"),
    ];

    for (const produce of nonBooleanResults) {
      const registry = createModelInputScopeGuardRegistry();
      expect(registry.register(asGuard(produce))).toBe(true);
      await expect(registry.validate()).resolves.toBe(false);
      expect(registry.register(() => true)).toBe(false);
    }
  });

  it("enumerates callback fields and never serializes guard payloads", () => {
    const registry = createModelInputScopeGuardRegistry();
    const sourceMarker = "SOURCE-CALLBACK-MARKER-9F2C";
    const guard = asGuard(() => true);
    Object.defineProperty(guard, "sourceLabel", {
      value: sourceMarker,
      enumerable: true,
    });
    registry.register(guard);

    const fields = Object.entries(registry);
    expect(fields.map(([key]) => key).sort()).toEqual(["register", "validate"]);
    for (const [, value] of fields) {
      expect(typeof value).toBe("function");
    }

    const serialized = JSON.stringify(registry);
    expect(serialized).not.toContain(sourceMarker);
    expect(serialized).not.toContain("sourceLabel");

    // Scope note: this covers only the registry surface. It does not claim the
    // guards protect an entire turn, nor does it make any request-body claim.
  });
});
