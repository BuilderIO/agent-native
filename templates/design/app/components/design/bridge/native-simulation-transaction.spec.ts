import { expect, it, vi } from "vitest";

import {
  createNativeSimulationTransaction,
  NativeSimulationTransactionError,
} from "./native-simulation-transaction";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps the committed particle bank untouched through multi-step catch-up until the GPU fence", async () => {
  const fence = deferred();
  const promote = vi.fn();
  const release = vi.fn();
  const validate = vi.fn();
  const frame = createNativeSimulationTransaction({
    committedBank: 1,
    completedStep: 40,
    steps: [41, 42, 43, 44],
    onSubmittedWorkDone: () => fence.promise,
    release,
    promote,
  });
  expect(frame.bankSteps).toEqual([
    { step: 41, readBank: 1, writeBank: 0 },
    { step: 42, readBank: 0, writeBank: 2 },
    { step: 43, readBank: 2, writeBank: 0 },
    { step: 44, readBank: 0, writeBank: 2 },
  ]);
  expect(frame.bankSteps.every(({ writeBank }) => writeBank !== 1)).toBe(true);
  frame.markSubmitted();
  const settled = frame.settle(validate);
  expect(promote).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  fence.resolve();
  await settled;
  expect(validate).toHaveBeenCalledOnce();
  expect(promote).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  frame.promote();
  expect(promote).toHaveBeenCalledOnce();
  expect(promote).toHaveBeenCalledWith(2, 44);
  expect(release).toHaveBeenCalledOnce();
});

it("does not promote rejected submitted particle state and releases it only after the fence", async () => {
  const fence = deferred();
  const promote = vi.fn();
  const release = vi.fn();
  const frame = createNativeSimulationTransaction({
    committedBank: 0,
    completedStep: -1,
    steps: [0, 1],
    onSubmittedWorkDone: () => fence.promise,
    release,
    promote,
  });
  frame.markSubmitted();
  const rejected = frame.rejectSubmitted();
  expect(promote).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  fence.resolve();
  await rejected;
  expect(promote).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it("leaves published particle state unchanged when source validation fails after the fence", async () => {
  const promote = vi.fn();
  const release = vi.fn();
  const frame = createNativeSimulationTransaction({
    committedBank: 2,
    completedStep: 7,
    steps: [8],
    onSubmittedWorkDone: async () => {},
    release,
    promote,
  });
  frame.markSubmitted();
  const failure = new Error("source-revision-changed");
  await expect(
    frame.commit(() => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(promote).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it("rejects noncontiguous step plans and cannot commit an unsubmitted frame", async () => {
  expect(() =>
    createNativeSimulationTransaction({
      committedBank: 0,
      completedStep: 7,
      steps: [8, 10],
      onSubmittedWorkDone: async () => {},
      release() {},
      promote() {},
    }),
  ).toThrowError(
    expect.objectContaining<Partial<NativeSimulationTransactionError>>({
      code: "simulation-transaction-invalid",
    }),
  );
  const release = vi.fn();
  const frame = createNativeSimulationTransaction({
    committedBank: 0,
    completedStep: -1,
    steps: [0],
    onSubmittedWorkDone: async () => {},
    release,
    promote() {},
  });
  await expect(frame.commit()).rejects.toMatchObject({
    code: "simulation-transaction-closed",
  });
  await frame.abandon();
  expect(release).toHaveBeenCalledOnce();
});
