import { describe, expect, it, vi } from "vitest";

import { createDashboardSaveQueue } from "./dashboard-save-queue";

function deferred() {
  let resolve!: (result: { changed: boolean; updatedAt?: string }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ changed: boolean; updatedAt?: string }>(
    (done, fail) => {
      resolve = done;
      reject = fail;
    },
  );
  return { promise, resolve, reject };
}

describe("dashboard save queue", () => {
  it("writes rapid full-config edits in interaction order", async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    const save = vi
      .fn<() => Promise<{ changed: boolean }>>()
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);
    const queue = createDashboardSaveQueue(save);

    const first = queue.enqueue({ panels: ["first-row-b", "second-row"] });
    const second = queue.enqueue({ panels: ["second-row"] });

    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        panels: ["first-row-b", "second-row"],
      });
    });
    expect(save).toHaveBeenCalledTimes(1);

    firstSave.resolve({ changed: true, updatedAt: "v1" });
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledWith({ panels: ["second-row"] });
    });
    secondSave.resolve({ changed: false });

    await expect(first).resolves.toEqual({
      isLatest: false,
      changed: true,
      updatedAt: "v1",
    });
    await expect(second).resolves.toEqual({ isLatest: true, changed: false });
  });

  it("counts the saves still queued when an earlier one fails", async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    const save = vi
      .fn<() => Promise<{ changed: boolean }>>()
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);
    const queue = createDashboardSaveQueue(save);

    const first = queue.enqueue({ panels: ["a"] });
    const second = queue.enqueue({ panels: ["a", "b"] });
    expect(queue.pending()).toBe(2);

    firstSave.reject(new Error("Conflict"));
    await expect(first).rejects.toThrow("Conflict");
    expect(queue.pending()).toBe(1);

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    secondSave.resolve({ changed: true });
    await expect(second).resolves.toEqual({ isLatest: true, changed: true });
    expect(queue.pending()).toBe(0);
  });
});
