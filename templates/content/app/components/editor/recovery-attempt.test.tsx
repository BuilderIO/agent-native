// @vitest-environment happy-dom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  pageRecoveryIdentity,
  RecoveryAttemptEnded,
  useRecoveryAttemptOwner,
  type RecoveryIdentity,
} from "./recovery-attempt";

let root: Root;
let begin: ReturnType<typeof useRecoveryAttemptOwner>;

function Owner({ identity }: { identity: RecoveryIdentity }) {
  begin = useRecoveryAttemptOwner(identity);
  return null;
}

function render(identity: RecoveryIdentity, strict = false) {
  const owner = React.createElement(Owner, { identity });
  act(() =>
    root.render(strict ? React.createElement(StrictMode, null, owner) : owner),
  );
}

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
});

const writer = ["writer", "org", "page", "created"] as const;

describe("useRecoveryAttemptOwner", () => {
  it.each([
    ["the account is read", [undefined, undefined, "page", "created"]],
    [
      "the server confirms the page's creation",
      ["writer", "org", "page", undefined],
    ],
  ] as const)("keeps an attempt while %s", (_case, opened) => {
    render(opened);
    const attempt = begin();
    const epoch = begin.epoch;

    render(writer);

    expect(attempt.isActive()).toBe(true);
    expect(begin.epoch).toBe(epoch);
  });

  it("keeps an attempt while the account is briefly unknown", () => {
    render(writer);
    const attempt = begin();

    render([undefined, undefined, "page", "created"]);
    render(writer);

    expect(attempt.isActive()).toBe(true);
  });

  it.each([
    ["another account", [["reader", "org", "page", "created"]]],
    ["another org", [["writer", "other-org", "page", "created"]]],
    ["no org", [["writer", null, "page", "created"]]],
    ["a page created later under its id", [["writer", "org", "page", "later"]]],
    [
      "another account after an unknown read",
      [
        [undefined, undefined, "page", "created"],
        ["reader", "org", "page", "created"],
      ],
    ],
  ] as const)("ends an attempt for %s", (_case, reads) => {
    render(writer);
    const attempt = begin();
    const epoch = begin.epoch;

    for (const identity of reads) render(identity);

    expect(attempt.isActive()).toBe(false);
    expect(() => attempt.assertActive()).toThrow(RecoveryAttemptEnded);
    expect(begin.epoch).not.toBe(epoch);
  });

  it("never revives an attempt when the first account comes back", () => {
    render(writer);
    const first = begin();
    const epoch = begin.epoch;

    render(["reader", "org", "page", "created"]);
    render(writer);

    expect(first.isActive()).toBe(false);
    expect(begin().isActive()).toBe(true);
    expect(begin.epoch).not.toBe(epoch);
  });

  it("ends an attempt when the owner unmounts", () => {
    render(writer);
    const attempt = begin();

    act(() => root.unmount());
    root = createRoot(document.createElement("div"));

    expect(attempt.isActive()).toBe(false);
  });

  it("starts attempts that stay active after a Strict Mode remount", () => {
    render(writer, true);

    expect(begin().isActive()).toBe(true);
  });

  it("ends a step whose owner changed while it ran", async () => {
    render(writer);
    const attempt = begin();
    let finish!: () => void;
    const step = attempt.step(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    render(["reader", "org", "page", "created"]);
    finish();

    await expect(step).rejects.toBeInstanceOf(RecoveryAttemptEnded);
  });
});

describe("pageRecoveryIdentity", () => {
  const page = { id: "page", createdAt: "created" };

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
    expect(
      pageRecoveryIdentity({ email: "writer", orgId: "org" }, page, true),
    ).toEqual(["writer", "org", "page", undefined]);
  });
});
