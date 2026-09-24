import { describe, expect, it, vi } from "vitest";

import { normalizeCalendarViewPreferences } from "@/lib/calendar-view-preferences";

import {
  enqueueSourcePreferenceMutation,
  enqueueVisualPreferenceMutation,
  mergePendingVisualPreferences,
  rollbackVisualPreferencePatch,
  shouldApplyPreferencePoll,
} from "./use-view-preferences";

describe("source preference sequencing", () => {
  it("keeps an optimistic visual preference over a stale poll", () => {
    const remote = normalizeCalendarViewPreferences({
      numberOfDays: 7,
      showWeekNumbers: false,
    });
    const merged = mergePendingVisualPreferences(remote, {
      numberOfDays: 5,
    });

    expect(merged.numberOfDays).toBe(5);
    expect(merged.showWeekNumbers).toBe(false);
  });

  it("rolls back only the failed preference fields", () => {
    const current = normalizeCalendarViewPreferences({
      numberOfDays: 5,
      showWeekNumbers: true,
    });
    const rolledBack = rollbackVisualPreferencePatch(
      current,
      { numberOfDays: 5 },
      { numberOfDays: 7 },
      ["numberOfDays"],
    );

    expect(rolledBack.numberOfDays).toBe(7);
    expect(rolledBack.showWeekNumbers).toBe(true);
  });

  it("does not roll back a newer update to the same preference", () => {
    const current = normalizeCalendarViewPreferences({ numberOfDays: 6 });
    const rolledBack = rollbackVisualPreferencePatch(
      current,
      { numberOfDays: 5 },
      { numberOfDays: 7 },
      ["numberOfDays"],
    );

    expect(rolledBack.numberOfDays).toBe(6);
  });

  it("discards a poll that started before a confirmed mutation", () => {
    expect(shouldApplyPreferencePoll(4, 5)).toBe(false);
    expect(shouldApplyPreferencePoll(5, 5)).toBe(true);
  });

  it("sends rapid mutations for one source in invocation order", async () => {
    const chains: Record<string, Promise<unknown>> = {};
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = enqueueSourcePreferenceMutation(
      chains,
      "friends",
      async () => {
        order.push("first-start");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push("first-end");
      },
    );
    const secondRun = vi.fn(async () => order.push("second"));
    const second = enqueueSourcePreferenceMutation(
      chains,
      "friends",
      secondRun,
    );

    await Promise.resolve();
    expect(secondRun).not.toHaveBeenCalled();
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("preserves invocation order across color and mode updates for one account", async () => {
    const chains: Record<string, Promise<unknown>> = {};
    const order: string[] = [];
    let releaseColor: (() => void) | undefined;
    const color = enqueueSourcePreferenceMutation(
      chains,
      "alice@example.com",
      async () => {
        order.push("color-start");
        await new Promise<void>((resolve) => {
          releaseColor = resolve;
        });
        order.push("color-end");
      },
    );
    const mode = enqueueSourcePreferenceMutation(
      chains,
      "alice@example.com",
      async () => order.push("mode"),
    );

    await Promise.resolve();
    expect(order).toEqual(["color-start"]);
    releaseColor?.();
    await Promise.all([color, mode]);
    expect(order).toEqual(["color-start", "color-end", "mode"]);
  });

  it("preserves reverse-order rapid clicks for one calendar", async () => {
    const chains: Record<string, Promise<unknown>> = {};
    const order: string[] = [];
    const mode = enqueueSourcePreferenceMutation(chains, "friends", async () =>
      order.push("mode"),
    );
    const color = enqueueSourcePreferenceMutation(chains, "friends", async () =>
      order.push("color"),
    );

    await Promise.all([mode, color]);
    expect(order).toEqual(["mode", "color"]);
  });

  it("persists rapid visual-preference updates in invocation order", async () => {
    const chains: Record<string, Promise<unknown>> = {};
    const persistedValues: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = enqueueVisualPreferenceMutation(chains, async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      persistedValues.push(5);
    });
    const second = enqueueVisualPreferenceMutation(chains, async () => {
      persistedValues.push(6);
    });

    await Promise.resolve();
    expect(persistedValues).toEqual([]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(persistedValues).toEqual([5, 6]);
  });
});
