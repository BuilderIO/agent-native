import { describe, expect, it, vi } from "vitest";

import { createDashboardSaveQueue } from "./dashboard-save-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("dashboard save queue", () => {
  it("writes rapid full-config edits in interaction order", async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    const save = vi
      .fn<() => Promise<void>>()
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

    firstSave.resolve();
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledWith({ panels: ["second-row"] });
    });
    secondSave.resolve();

    await expect(first).resolves.toEqual({ isLatest: false });
    await expect(second).resolves.toEqual({ isLatest: true });
  });
});
