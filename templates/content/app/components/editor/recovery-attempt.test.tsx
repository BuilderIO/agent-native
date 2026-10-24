// @vitest-environment happy-dom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  pageRecoveryIdentity,
  RecoveryAttemptEnded,
  useRecoveryAttemptOwner,
} from "./recovery-attempt";

type Session = { email?: string | null; orgId?: string | null } | null;
type Page = { id: string; createdAt?: string | null };
interface Read {
  session: Session;
  page: Page;
  pending?: boolean;
}

let root: Root;
let begin: ReturnType<typeof useRecoveryAttemptOwner>;

function Owner({ session, page, pending = false }: Read) {
  begin = useRecoveryAttemptOwner(pageRecoveryIdentity(session, page, pending));
  return null;
}

function render(read: Read, strict = false) {
  const owner = React.createElement(Owner, read);
  act(() =>
    root.render(strict ? React.createElement(StrictMode, null, owner) : owner),
  );
}

function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// Records how a step settled without settling anything itself.
function watch<T>(step: Promise<T>) {
  const seen: { settled: PromiseSettledResult<T> | null } = { settled: null };
  void step.then(
    (value) => (seen.settled = { status: "fulfilled", value }),
    (reason) => (seen.settled = { status: "rejected", reason }),
  );
  return seen;
}

const flush = () => act(async () => {});

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
});

const writer = { email: "writer", orgId: "org" };
const page = { id: "page", createdAt: "created" };
const opened: Read = { session: writer, page };
const signedOut: Read = { session: null, page };
const reader: Read = { session: { email: "reader", orgId: "org" }, page };

describe("useRecoveryAttemptOwner", () => {
  it.each([
    ["the account is read", signedOut],
    [
      "the server confirms the page's creation",
      { session: writer, page, pending: true },
    ],
    [
      "the page read first shows its creation time",
      { session: writer, page: { id: "page" } },
    ],
  ] as const)("keeps an attempt while %s", (_case, first) => {
    render(first);
    const attempt = begin();
    const epoch = begin.epoch;

    render(opened);

    expect(attempt.isActive()).toBe(true);
    expect(begin.epoch).toBe(epoch);
  });

  it.each([
    ["the account", signedOut],
    ["the page's creation time", { session: writer, page: { id: "page" } }],
  ] as const)("keeps an attempt while %s is briefly unknown", (_, unknown) => {
    render(opened);
    const attempt = begin();

    render(unknown);
    render(opened);

    expect(attempt.isActive()).toBe(true);
  });

  it.each([
    ["another account", [reader]],
    ["another org", [{ session: { email: "writer", orgId: "other" }, page }]],
    ["no org", [{ session: { email: "writer" }, page }]],
    [
      "a page created later under its id",
      [{ session: writer, page: { id: "page", createdAt: "later" } }],
    ],
    [
      "a page known to have no creation time",
      [{ session: writer, page: { id: "page", createdAt: null } }],
    ],
    ["another account after an unknown read", [signedOut, reader]],
    [
      "another page after its creation time went missing",
      [
        { session: writer, page: { id: "page" } },
        { session: writer, page: { id: "page", createdAt: "later" } },
      ],
    ],
  ] as const)("ends an attempt for %s", (_case, reads) => {
    render(opened);
    const attempt = begin();
    const epoch = begin.epoch;

    for (const read of reads) render(read);

    expect(attempt.isActive()).toBe(false);
    expect(() => attempt.assertActive()).toThrow(RecoveryAttemptEnded);
    expect(begin.epoch).not.toBe(epoch);
  });

  it("ends an attempt for a page that gains a creation time after it had none", () => {
    render({ session: writer, page: { id: "page", createdAt: null } });
    const attempt = begin();

    render(opened);

    expect(attempt.isActive()).toBe(false);
  });

  it("never revives an attempt when the first account comes back", () => {
    render(opened);
    const first = begin();
    const epoch = begin.epoch;

    render(reader);
    render(opened);

    expect(first.isActive()).toBe(false);
    expect(begin().isActive()).toBe(true);
    expect(begin.epoch).not.toBe(epoch);
  });

  it("ends an attempt when the owner unmounts", () => {
    render(opened);
    const attempt = begin();

    act(() => root.unmount());
    root = createRoot(document.createElement("div"));

    expect(attempt.isActive()).toBe(false);
  });

  it("starts attempts that stay active after a Strict Mode remount", () => {
    render(opened, true);

    expect(begin().isActive()).toBe(true);
  });

  it("ends a step whose owner changed while it ran", async () => {
    render(opened);
    const attempt = begin();
    let finish!: () => void;
    const step = attempt.step(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    render(reader);
    finish();

    await expect(step).rejects.toBeInstanceOf(RecoveryAttemptEnded);
  });
});

describe("a step while its owner is not known", () => {
  it.each([
    ["the account", signedOut],
    ["the page's creation time", { session: writer, page: { id: "page" } }],
  ] as const)(
    "holds an answer that arrives while %s is unknown, then resumes once for the same owner",
    async (_, unknown) => {
      render(opened);
      const request = held<string>();
      const seen = watch(begin().step(() => request.promise));

      render(unknown);
      request.resolve("answer");
      await flush();
      expect(seen.settled).toBeNull();

      render(opened);
      await flush();
      expect(seen.settled).toEqual({ status: "fulfilled", value: "answer" });
    },
  );

  it("holds a failure that arrives while the account is unknown, then reports it for the same owner", async () => {
    render(opened);
    const request = held<string>();
    const failure = new Error("Network down");
    const seen = watch(begin().step(() => request.promise));

    render(signedOut);
    request.reject(failure);
    await flush();
    expect(seen.settled).toBeNull();

    render(opened);
    await flush();
    expect(seen.settled).toEqual({ status: "rejected", reason: failure });
  });

  it.each([
    ["another account is read", () => render(reader)],
    [
      "the owner unmounts",
      () => {
        act(() => root.unmount());
        root = createRoot(document.createElement("div"));
      },
    ],
    [
      "another account, then the first again, is read",
      () => {
        render(reader);
        render(opened);
      },
    ],
  ] as const)(
    "ends a held step with its own answer when %s",
    async (_, end) => {
      render(opened);
      const request = held<string>();
      const seen = watch(begin().step(() => request.promise));

      render(signedOut);
      request.resolve("answer");
      await flush();
      end();
      await flush();

      expect(seen.settled?.status).toBe("rejected");
      const ended = (seen.settled as PromiseRejectedResult).reason;
      expect(ended).toBeInstanceOf(RecoveryAttemptEnded);
      expect(ended.answer).toEqual({ status: "fulfilled", value: "answer" });
    },
  );

  it("does not start a step's operation until the owner is known", async () => {
    render(signedOut);
    let runs = 0;
    const seen = watch(begin().step(async () => ++runs));
    await flush();
    expect(runs).toBe(0);

    render(opened);
    await flush();
    expect(runs).toBe(1);
    expect(seen.settled).toEqual({ status: "fulfilled", value: 1 });
  });

  it("ends a step that never started with no answer when another account is read", async () => {
    render(opened);
    render(signedOut);
    let runs = 0;
    const seen = watch(begin().step(async () => ++runs));

    render(reader);
    await flush();

    expect(runs).toBe(0);
    const ended = (seen.settled as PromiseRejectedResult).reason;
    expect(ended).toBeInstanceOf(RecoveryAttemptEnded);
    expect(ended.answer).toBeNull();
  });

  it("holds through a Strict Mode remount while the account is unknown", async () => {
    render(signedOut, true);
    let runs = 0;
    const seen = watch(begin().step(async () => ++runs));
    await flush();
    expect(runs).toBe(0);

    render(opened, true);
    await flush();
    expect(seen.settled).toEqual({ status: "fulfilled", value: 1 });
  });
});

describe("what a step's answer changes", () => {
  const state = (attempt: ReturnType<typeof begin>) =>
    attempt.isActive() ? "current" : "ended";

  it("happens in the turn the answer is admitted, before a render queued behind it ends the owner", async () => {
    render(opened);
    const attempt = begin();
    const request = held<string>();
    const order: string[] = [];
    const step = attempt.step(
      () => request.promise,
      (value) => {
        order.push(`${value} applied while ${state(attempt)}`);
        return value.length;
      },
    );
    const resumed = step.then(() =>
      order.push(`caller resumed while ${state(attempt)}`),
    );

    request.resolve("answer");
    // Queued behind the answer, as React queues a synchronous render.
    queueMicrotask(() => {
      render(reader);
      order.push("another account read");
    });
    await resumed;

    expect(order).toEqual([
      "answer applied while current",
      "another account read",
      "caller resumed while ended",
    ]);
    await expect(step).resolves.toBe(6);
  });

  it("waits with an answer that arrived while the account was unknown, then happens once for the same owner", async () => {
    render(opened);
    const request = held<string>();
    const applied: string[] = [];
    const seen = watch(
      begin().step(
        () => request.promise,
        (value) => applied.push(value),
      ),
    );

    render(signedOut);
    request.resolve("answer");
    await flush();
    expect(applied).toEqual([]);

    render(opened);
    await flush();
    expect(applied).toEqual(["answer"]);
    expect(seen.settled).toEqual({ status: "fulfilled", value: 1 });
  });

  it("never happens for an owner that ended first, which hands on the answer", async () => {
    render(opened);
    const request = held<string>();
    const applied: string[] = [];
    const seen = watch(
      begin().step(
        () => request.promise,
        (value) => applied.push(value),
      ),
    );

    render(reader);
    request.resolve("answer");
    await flush();

    expect(applied).toEqual([]);
    const ended = (seen.settled as PromiseRejectedResult).reason;
    expect(ended).toBeInstanceOf(RecoveryAttemptEnded);
    expect(ended.answer).toEqual({ status: "fulfilled", value: "answer" });
  });

  it("reports its own failure as the step's", async () => {
    render(opened);
    const failure = new Error("The draft changed");

    await expect(
      begin().step(
        async () => "answer",
        () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
  });
});

describe("pageRecoveryIdentity", () => {
  it("leaves the account unknown until the session is read", () => {
    expect(pageRecoveryIdentity(null, page, false)).toEqual([
      undefined,
      undefined,
      "page",
      "created",
    ]);
  });

  it("names a known account without an org as having none", () => {
    expect(
      pageRecoveryIdentity({ email: " Writer@Example.test " }, page, false),
    ).toEqual(["writer@example.test", null, "page", "created"]);
  });

  it("leaves a page's creation time unknown while its creation is pending", () => {
    expect(pageRecoveryIdentity(writer, page, true)).toEqual([
      "writer",
      "org",
      "page",
      undefined,
    ]);
  });

  it("leaves a page's creation time unknown until a read shows it", () => {
    expect(pageRecoveryIdentity(writer, { id: "page" }, false)).toEqual([
      "writer",
      "org",
      "page",
      undefined,
    ]);
  });

  it("keeps a page known to have no creation time as having none", () => {
    expect(
      pageRecoveryIdentity(writer, { id: "page", createdAt: null }, false),
    ).toEqual(["writer", "org", "page", null]);
  });
});
