import { describe, expect, it, vi } from "vitest";

import { NativeSubmissionPipeline } from "./native-submission-pipeline";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("native submission staging", () => {
  it("submits independent work before prior validation resolves without overlapping encoding scopes", async () => {
    const pipeline = new NativeSubmissionPipeline();
    const validations = [deferred(), deferred()];
    const events: string[] = [];
    let scopes = 0;
    const render = (index: number) => async (submitted: () => void) => {
      expect(scopes++).toBe(0);
      events.push(`submit${index}`);
      scopes--;
      submitted();
      await validations[index]!.promise;
      events.push(`publish${index}`);
    };
    await pipeline.submit("first", render(0));
    await pipeline.submit("second", render(1));
    expect(events).toEqual(["submit0", "submit1"]);
    const dependency = vi.fn();
    const read = pipeline.pending("first")!.then(dependency);
    await Promise.resolve();
    expect(dependency).not.toHaveBeenCalled();
    validations[0]!.resolve();
    validations[1]!.resolve();
    await pipeline.flush();
    await read;
    expect(dependency).toHaveBeenCalledOnce();
    expect(events).toEqual(["submit0", "submit1", "publish0", "publish1"]);
  });

  it("retains prior publication on validation failure and drains every task before reporting it", async () => {
    const pipeline = new NativeSubmissionPipeline();
    const validation = deferred();
    let front = { owner: "last-good", child: "last-good" };
    await pipeline.submit("first", async (submitted) => {
      submitted();
      await validation.promise;
      front = { owner: "candidate", child: "candidate" };
    });
    const other = vi.fn();
    await pipeline.submit("second", async (submitted) => {
      submitted();
      other();
    });
    validation.reject(new Error("gpu-validation"));
    expect(await pipeline.flush()).toEqual([
      { status: "rejected", reason: new Error("gpu-validation") },
      { status: "fulfilled", value: undefined },
    ]);
    expect(front).toEqual({ owner: "last-good", child: "last-good" });
    expect(other).toHaveBeenCalledOnce();
    expect(pipeline.pending("first")).toBeUndefined();
  });

  it("releases the stage after encoding failure rather than deadlocking the next submission", async () => {
    const pipeline = new NativeSubmissionPipeline();
    await pipeline.submit("broken", async () => {
      throw new Error("encode-failed");
    });
    const next = vi.fn();
    await pipeline.submit("next", async (submitted) => {
      next();
      submitted();
    });
    expect((await pipeline.flush())[0]).toEqual({
      status: "rejected",
      reason: new Error("encode-failed"),
    });
    expect(next).toHaveBeenCalledOnce();
  });
});

it("waits for an encoding scope to close before failed validation can restore GPU resources", async () => {
  const pipeline = new NativeSubmissionPipeline();
  const validation = deferred();
  const encoding = deferred();
  const restoring = vi.fn();
  await pipeline.submit("first", async (submitted) => {
    submitted();
    try {
      await validation.promise;
    } catch (error) {
      const release = await pipeline.acquireCommit();
      try {
        restoring();
        throw error;
      } finally {
        release();
      }
    }
  });
  let encodingStarted = false;
  const second = pipeline.submit("second", async (submitted) => {
    encodingStarted = true;
    await encoding.promise;
    submitted();
  });
  await vi.waitFor(() => expect(encodingStarted).toBe(true));
  validation.reject(new Error("gpu-validation"));
  await Promise.resolve();
  await Promise.resolve();
  expect(restoring).not.toHaveBeenCalled();
  encoding.resolve();
  await second;
  const outcomes = await pipeline.flush();
  expect(restoring).toHaveBeenCalledOnce();
  expect(outcomes[0]).toEqual({
    status: "rejected",
    reason: new Error("gpu-validation"),
  });
});
