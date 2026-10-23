import { expect, it, vi } from "vitest";

import {
  NativeStatelessFrameRetirementError,
  NativeStatelessFrameTransaction,
} from "./native-stateless-frame-transaction";

function publication(id: string, events: string[]) {
  return {
    assert: vi.fn(() => {
      events.push(`assert:${id}`);
    }),
    commit: vi.fn(() => {
      events.push(`commit:${id}`);
    }),
    rollback: vi.fn(() => {
      events.push(`rollback:${id}`);
    }),
    retire: vi.fn(() => {
      events.push(`retire:${id}`);
    }),
  };
}
it("validates every job before synchronous registration-order publication and retirement", async () => {
  const transaction = new NativeStatelessFrameTransaction<object>();
  const events: string[] = [];
  transaction.register("first");
  transaction.register("second");
  let complete = false;
  const second = transaction.prepare("second", publication("second", events));
  const first = transaction
    .prepare("first", publication("first", events))
    .then(() => {
      complete = true;
    });
  await Promise.resolve();
  expect(complete).toBe(false);
  expect(events).toEqual([]);
  await transaction.finish();
  await Promise.all([first, second]);
  expect(events).toEqual([
    "assert:first",
    "assert:second",
    "commit:first",
    "commit:second",
    "retire:first",
    "retire:second",
  ]);
});
it("waits for asynchronous preparation and exposes staged nested dependency aliases", async () => {
  const transaction = new NativeStatelessFrameTransaction<object>();
  const candidate = {};
  transaction.register("owner");
  transaction.stage(
    "owner",
    new Map([
      ["owner", candidate],
      ["nested", candidate],
    ]),
  );
  expect(transaction.hasCandidate("nested")).toBe(true);
  expect(transaction.candidate("nested")).toBe(candidate);
  let finished = false;
  const finish = transaction.finish().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  const prepared = transaction.prepare("owner", publication("owner", []));
  await finish;
  await prepared;
});
it("preserves a GPU validation failure and rolls back all prepared jobs without publishing", async () => {
  const transaction = new NativeStatelessFrameTransaction<object>();
  const events: string[] = [];
  const error = { code: "gpu-validation", message: "Rejected candidate" };
  transaction.register("first");
  transaction.register("second");
  const first = transaction.prepare("first", publication("first", events));
  const second = transaction.prepare("second", publication("second", events));
  const settled = Promise.allSettled([first, second]);
  transaction.fail("second", error);
  await expect(transaction.finish()).rejects.toBe(error);
  expect(await settled).toEqual([
    { status: "rejected", reason: error },
    { status: "rejected", reason: error },
  ]);
  expect(events).toEqual(["rollback:second", "rollback:first"]);
});
it.each(["assert", "commit"] as const)(
  "rolls back in reverse order when %s fails and never retires",
  async (phase) => {
    const transaction = new NativeStatelessFrameTransaction<object>();
    const events: string[] = [];
    const error = new Error(`${phase}-failed`);
    transaction.register("first");
    transaction.register("second");
    const secondPublication = publication("second", events);
    secondPublication[phase].mockImplementation(() => {
      events.push(`${phase}:second`);
      throw error;
    });
    const completions = Promise.allSettled([
      transaction.prepare("first", publication("first", events)),
      transaction.prepare("second", secondPublication),
    ]);
    await expect(transaction.finish()).rejects.toBe(error);
    await completions;
    expect(events.slice(-2)).toEqual(["rollback:second", "rollback:first"]);
    expect(events.some((event) => event.startsWith("retire:"))).toBe(false);
    if (phase === "assert")
      expect(events.some((event) => event.startsWith("commit:"))).toBe(false);
  },
);
it("reports post-publication retirement failure without rolling back committed outputs", async () => {
  const transaction = new NativeStatelessFrameTransaction<object>();
  const events: string[] = [];
  transaction.register("first");
  transaction.register("second");
  const firstPublication = publication("first", events);
  const failure = new Error("retirement failed");
  firstPublication.retire.mockImplementation(() => {
    throw failure;
  });
  const completions = Promise.allSettled([
    transaction.prepare("first", firstPublication),
    transaction.prepare("second", publication("second", events)),
  ]);
  await expect(transaction.finish()).rejects.toMatchObject({
    published: true,
    phase: "retirement",
    failures: [failure],
  });
  expect((await completions)[0]).toMatchObject({
    status: "rejected",
    reason: expect.any(NativeStatelessFrameRetirementError),
  });
  expect(events).toEqual([
    "assert:first",
    "assert:second",
    "commit:first",
    "commit:second",
    "retire:second",
  ]);
});
it("surfaces rollback failures together with the original rejection", async () => {
  const transaction = new NativeStatelessFrameTransaction<object>();
  transaction.register("first");
  const candidate = publication("first", []);
  const error = new Error("validation failed");
  const cleanupError = new Error("rollback failed");
  candidate.assert.mockImplementation(() => {
    throw error;
  });
  candidate.rollback.mockImplementation(() => {
    throw cleanupError;
  });
  const completion = Promise.allSettled([
    transaction.prepare("first", candidate),
  ]);
  await expect(transaction.finish()).rejects.toMatchObject({
    code: "stateless-frame-rollback-failed",
    failures: [error, cleanupError],
  });
  await completion;
});

it("keeps a failed job closed to later successful preparation", async () => {
  const transaction = new NativeStatelessFrameTransaction<object>();
  const error = { code: "source-stale" };
  transaction.register("failed");
  transaction.fail("failed", error);
  expect(() =>
    transaction.prepare("failed", publication("failed", [])),
  ).toThrow(
    expect.objectContaining({
      code: "stateless-frame-prepare-closed",
      failures: [error],
    }),
  );
  await expect(transaction.finish()).rejects.toBe(error);
});
