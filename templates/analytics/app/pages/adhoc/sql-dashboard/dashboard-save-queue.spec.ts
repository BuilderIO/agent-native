import { describe, expect, it, vi } from "vitest";

import {
  DashboardSaveQueueConflictError,
  createDashboardSaveQueue,
  type DashboardSaveOutcome,
} from "./dashboard-save-queue";

function deferred() {
  let resolve!: (result: DashboardSaveOutcome) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DashboardSaveOutcome>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function queueOf(...saves: ReturnType<typeof deferred>[]) {
  const save =
    vi.fn<
      (
        config: { panels: string[] },
        expectedUpdatedAt: string | undefined,
      ) => Promise<DashboardSaveOutcome>
    >();
  for (const pending of saves) save.mockReturnValueOnce(pending.promise);
  return { save, queue: createDashboardSaveQueue(save) };
}

describe("dashboard save queue", () => {
  it("writes rapid full-config edits in interaction order", async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    const { save, queue } = queueOf(firstSave, secondSave);

    const first = queue.enqueue(
      { panels: ["first-row-b", "second-row"] },
      "v0",
    );
    const second = queue.enqueue({ panels: ["second-row"] }, "v0");

    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        { panels: ["first-row-b", "second-row"] },
        "v0",
      );
    });
    expect(save).toHaveBeenCalledTimes(1);

    firstSave.resolve({ changed: true, updatedAt: "v1", revisionId: "rev1" });
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledWith({ panels: ["second-row"] }, "v1");
    });
    secondSave.resolve({ changed: false });

    await expect(first).resolves.toEqual({
      isLatest: false,
      changed: true,
      updatedAt: "v1",
      revisionId: "rev1",
      config: { panels: ["first-row-b", "second-row"] },
    });
    await expect(second).resolves.toEqual({
      isLatest: true,
      changed: false,
      config: { panels: ["second-row"] },
    });
  });

  it("keeps a queued save's base when it was edited from another version", async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    const { save, queue } = queueOf(firstSave, secondSave);

    void queue.enqueue({ panels: ["a"] }, "v0");
    // Edited after the page adopted someone else's save, which made "vR".
    const second = queue.enqueue({ panels: ["b"] }, "vR");

    firstSave.resolve({ changed: true, updatedAt: "v1" });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith({ panels: ["b"] }, "vR");
    secondSave.resolve({ changed: true, updatedAt: "v2" });
    await expect(second).resolves.toMatchObject({ isLatest: true });
  });

  it("counts the saves still queued when an earlier one fails, and keeps their base", async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    const { save, queue } = queueOf(firstSave, secondSave);

    const first = queue.enqueue({ panels: ["a"] }, "v0");
    const second = queue.enqueue({ panels: ["a", "b"] }, "v0");
    expect(queue.pending()).toBe(2);

    firstSave.reject(new Error("Conflict"));
    await expect(first).rejects.toThrow("Conflict");
    expect(queue.pending()).toBe(1);

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith({ panels: ["a", "b"] }, "v0");
    secondSave.resolve({ changed: true });
    await expect(second).resolves.toEqual({
      isLatest: true,
      changed: true,
      config: { panels: ["a", "b"] },
    });
    expect(queue.pending()).toBe(0);
  });

  it("reapplies a later edit without carrying a failed queued edit", async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    const { save, queue } = queueOf(firstSave, secondSave);
    const base = { panels: ["saved"] };
    const failedUpdate = (current: { panels: string[] }) => ({
      panels: [...current.panels, "failed"],
    });
    const laterUpdate = (current: { panels: string[] }) => ({
      panels: [...current.panels, "later"],
    });
    const firstConfig = failedUpdate(base);

    const first = queue.enqueue(firstConfig, "v0", failedUpdate, base);
    const second = queue.enqueue(
      laterUpdate(firstConfig),
      "v0",
      laterUpdate,
      firstConfig,
    );

    firstSave.reject(new Error("Resize failed"));
    await expect(first).rejects.toThrow("Resize failed");
    await vi.waitFor(() => {
      expect(save).toHaveBeenLastCalledWith(
        { panels: ["saved", "later"] },
        "v0",
      );
    });
    secondSave.resolve({ changed: true, updatedAt: "v1" });

    await expect(second).resolves.toMatchObject({ isLatest: true });
  });

  it("does not save a diverged config after an earlier queued save fails", async () => {
    const firstSave = deferred();
    const { save, queue } = queueOf(firstSave);
    const base = { panels: ["saved"] };
    const failedUpdate = (current: { panels: string[] }) => ({
      panels: [...current.panels, "failed"],
    });
    const firstConfig = failedUpdate(base);
    const adoptedConfig = { panels: ["saved", "failed", "remote"] };
    const laterUpdate = (current: { panels: string[] }) => ({
      panels: [...current.panels, "later"],
    });

    const first = queue.enqueue(firstConfig, "v0", failedUpdate, base);
    const second = queue.enqueue(
      laterUpdate(adoptedConfig),
      "v0",
      laterUpdate,
      adoptedConfig,
    );

    firstSave.reject(new Error("Resize failed"));
    await expect(first).rejects.toThrow("Resize failed");
    await expect(second).rejects.toBeInstanceOf(
      DashboardSaveQueueConflictError,
    );
    expect(save).toHaveBeenCalledTimes(1);
  });
});
