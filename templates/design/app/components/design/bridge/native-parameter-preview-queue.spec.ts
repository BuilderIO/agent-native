import { describe, expect, it, vi } from "vitest";

import { NativeParameterPreviewQueue } from "./native-parameter-preview-queue";
const turn = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("native transient parameter previews", () => {
  it("keeps one application in flight and merges only the latest pending property values", async () => {
    let release!: () => void;
    const apply = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const failure = vi.fn();
    const queue = new NativeParameterPreviewQueue(() => {}, apply, failure);
    queue.enqueue("glass", { thickness: 1 });
    for (let thickness = 2; thickness <= 100; thickness++)
      queue.enqueue("glass", { thickness });
    queue.enqueue("glass", { frost: 4 });
    queue.enqueue("other", { scale: 3 });
    expect(apply).toHaveBeenCalledTimes(1);
    release();
    await turn();
    await turn();
    expect(apply.mock.calls.map(([id, params]) => [id, params])).toEqual([
      ["glass", { thickness: 1 }],
      ["glass", { thickness: 100, frost: 4 }],
      ["other", { scale: 3 }],
    ]);
    expect(failure).not.toHaveBeenCalled();
  });

  it("lets the final cancel or commit value replace older queued previews", async () => {
    let release!: () => void;
    const apply = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const queue = new NativeParameterPreviewQueue(() => {}, apply, vi.fn());
    queue.enqueue("glass", { thickness: 1 });
    queue.enqueue("glass", { thickness: 20 });
    queue.enqueue("glass", { thickness: 28 });
    release();
    await turn();
    await turn();
    expect(apply.mock.calls.map(([, params]) => params)).toEqual([
      { thickness: 1 },
      { thickness: 28 },
    ]);
  });

  it("invalidates old requests across canonical rescans and reports current invalid values", async () => {
    let release!: () => void;
    const applied = vi.fn();
    const failure = vi.fn();
    const apply = vi.fn(async (id, params, isCurrent) => {
      if (params.thickness === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (!isCurrent()) return;
      if (params.thickness === -1) throw new TypeError("invalid thickness");
      applied(id, params);
    });
    const queue = new NativeParameterPreviewQueue(() => {}, apply, failure);
    queue.enqueue("glass", { thickness: 1 });
    queue.enqueue("glass", { thickness: 2 });
    queue.reset();
    queue.enqueue("glass", { thickness: -1 });
    release();
    await turn();
    await turn();
    expect(applied).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledExactlyOnceWith(
      "glass",
      expect.objectContaining({ message: "invalid thickness" }),
    );
  });

  it("rejects inadmissible targets before queueing and does not report late errors after disposal", async () => {
    const failure = vi.fn();
    let reject!: (error: Error) => void;
    const apply = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const queue = new NativeParameterPreviewQueue(
      (id) => {
        if (id !== "glass") throw new TypeError("target missing");
      },
      apply,
      failure,
    );
    queue.enqueue("other", { thickness: 1 });
    expect(failure).toHaveBeenCalledExactlyOnceWith(
      "other",
      expect.objectContaining({ message: "target missing" }),
    );
    failure.mockClear();
    queue.enqueue("glass", { thickness: 1 });
    queue.enqueue("glass", { thickness: 2 });
    queue.dispose();
    reject(new Error("late render error"));
    await turn();
    await turn();
    expect(apply).toHaveBeenCalledOnce();
    expect(failure).not.toHaveBeenCalled();
  });
});
