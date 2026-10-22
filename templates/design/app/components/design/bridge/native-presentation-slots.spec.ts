// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { isNativePresentationPairSwap } from "./native-presentation-pair";
import { NativePresentationSlots } from "./native-presentation-slots";

afterEach(() => document.body.replaceChildren());
const surface = (pixel: number) => ({
  canvas: document.createElement("canvas"),
  context: { pixel },
});
function fixture() {
  const first = surface(1);
  first.canvas.width = 20;
  first.canvas.height = 10;
  first.canvas.style.left = "4px";
  document.body.append(first.canvas);
  const retired: ReturnType<typeof surface>[] = [];
  const slots = new NativePresentationSlots(
    first,
    () => surface(0),
    (entry) => retired.push(entry),
  );
  return { first, slots, retired };
}

describe("three-slot presentation leases", () => {
  it("reserves two distinct detached surfaces without a fourth allocation", () => {
    const { first, slots } = fixture();
    const a = slots.reserve();
    const b = slots.reserve();
    expect(a.surface).not.toBe(b.surface);
    expect(a.surface).not.toBe(first);
    expect(a.surface.canvas.isConnected).toBe(false);
    expect(a.surface.canvas.width).toBe(20);
    expect(a.surface.canvas.height).toBe(10);
    expect(a.surface.canvas.style.left).toBe("4px");
    expect(slots.surfaces()).toHaveLength(3);
    expect(() => slots.reserve()).toThrow("presentation-slots-full");
    slots.rollback(a);
    slots.finalize(a);
    expect(slots.reserve().surface).toBe(a.surface);
    expect(slots.surfaces()).toHaveLength(3);
  });
  it("captures the current front at FIFO preflight so frame two rollback preserves frame one", () => {
    const { slots } = fixture();
    const a = slots.reserve();
    const b = slots.reserve();
    a.surface.context.pixel = 10;
    b.surface.context.pixel = 20;
    slots.assertPublishable(a);
    slots.publish(a);
    slots.finalize(a);
    expect(slots.visible().context.pixel).toBe(10);
    slots.assertPublishable(b);
    slots.publish(b);
    expect(slots.visible().context.pixel).toBe(20);
    slots.rollback(b);
    slots.finalize(b);
    expect(slots.visible()).toBe(a.surface);
    expect(document.body.firstElementChild).toBe(a.surface.canvas);
    expect(slots.visible().context.pixel).toBe(10);
  });
  it("keeps rollback resources occupied until whole-transaction finalization", () => {
    const { slots } = fixture();
    const a = slots.reserve();
    const b = slots.reserve();
    slots.assertPublishable(a);
    slots.publish(a);
    expect(() => slots.reserve()).toThrow("presentation-slots-full");
    slots.rollback(a);
    expect(() => slots.reserve()).toThrow("presentation-slots-full");
    slots.finalize(a);
    expect(slots.reserve().surface).toBe(a.surface);
    slots.rollback(b);
    slots.finalize(b);
  });
  it("can cancel an unasserted participant after another participant fails preflight", () => {
    const { first, slots } = fixture();
    const lease = slots.reserve();
    slots.rollback(lease);
    slots.finalize(lease);
    expect(slots.visible()).toBe(first);
    expect(first.canvas.isConnected).toBe(true);
  });
  it("rejects duplicate, foreign and stale operations without replacing the visible front", () => {
    const { slots } = fixture();
    const lease = slots.reserve();
    expect(() => slots.publish(lease)).toThrow(
      "presentation-lease-state-invalid",
    );
    expect(() => slots.finalize(lease)).toThrow(
      "presentation-lease-state-invalid",
    );
    expect(() => slots.assertPublishable({ surface: lease.surface })).toThrow(
      "presentation-lease-stale",
    );
    slots.assertPublishable(lease);
    slots.publish(lease);
    expect(() => slots.publish(lease)).toThrow(
      "presentation-lease-state-invalid",
    );
    slots.finalize(lease);
    expect(() => slots.finalize(lease)).toThrow("presentation-lease-stale");
    expect(() => slots.rollback(lease)).toThrow("presentation-lease-stale");
    expect(slots.visible()).toBe(lease.surface);
  });
  it("rejects a preflight whose expected front changed instead of rolling back another commit", () => {
    const { slots } = fixture();
    const a = slots.reserve();
    const b = slots.reserve();
    slots.assertPublishable(a);
    slots.assertPublishable(b);
    slots.publish(a);
    slots.finalize(a);
    expect(() => slots.publish(b)).toThrow("presentation-front-changed");
    slots.rollback(b);
    slots.finalize(b);
    expect(slots.visible()).toBe(a.surface);
  });
  it("retires all nonfront surfaces once and leaves current front for serial adoption", () => {
    const { slots, first, retired } = fixture();
    const a = slots.reserve();
    const b = slots.reserve();
    slots.assertPublishable(a);
    slots.publish(a);
    slots.finalize(a);
    slots.dispose();
    slots.dispose();
    expect(new Set(retired)).toEqual(new Set([first, b.surface]));
    expect(slots.visible()).toBe(a.surface);
    expect(a.surface.canvas.isConnected).toBe(true);
    expect(() => slots.rollback(b)).toThrow("presentation-slots-retired");
  });
  it("recognizes swaps of either hidden slot and rejects unrelated mutation nodes", () => {
    const { slots } = fixture();
    const a = slots.reserve();
    const b = slots.reserve();
    slots.assertPublishable(a);
    slots.publish(a);
    slots.finalize(a);
    slots.assertPublishable(b);
    slots.publish(b);
    slots.finalize(b);
    const record = {
      type: "childList",
      addedNodes: [b.surface.canvas],
      removedNodes: [a.surface.canvas],
    } as unknown as MutationRecord;
    expect(isNativePresentationPairSwap(record, slots)).toBe(true);
    expect(
      isNativePresentationPairSwap(
        {
          ...record,
          removedNodes: [document.createElement("canvas")],
        } as unknown as MutationRecord,
        slots,
      ),
    ).toBe(false);
  });
});
