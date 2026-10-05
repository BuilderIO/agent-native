import assert from "node:assert/strict";
import test from "node:test";

import {
  raceWithTimeout,
  SetupDeadlineError,
  withHostDeadline,
} from "./deadline";

const never = () => new Promise<never>(() => {});

test("a host that hangs fails with its name and the step it was in", async () => {
  const lines: string[] = [];
  await assert.rejects(
    withHostDeadline(
      "chat",
      20,
      async (step) => {
        step("bootstrapping session");
        step("installing OpenAI key");
        return never();
      },
      (line) => lines.push(line),
    ),
    (error: unknown) => {
      assert.ok(error instanceof SetupDeadlineError);
      assert.equal(error.host, "chat");
      assert.equal(error.step, "installing OpenAI key");
      assert.match(error.message, /^chat: setup exceeded its 0s deadline/);
      assert.match(error.message, /installing OpenAI key/);
      return true;
    },
  );
  assert.deepEqual(lines, [
    "[beta-e2e]   chat: bootstrapping session…",
    "[beta-e2e]   chat: installing OpenAI key…",
  ]);
});

test("a host that finishes returns its value", async () => {
  const value = await withHostDeadline(
    "slides",
    1_000,
    async (step) => {
      step("bootstrapping session");
      return "ok";
    },
    () => {},
  );
  assert.equal(value, "ok");
});

test("a host that fails before the deadline keeps its own error", async () => {
  await assert.rejects(
    withHostDeadline("slides", 1_000, async () => {
      throw new Error("session rejected");
    }),
    /session rejected/,
  );
});

test("abandoned work that rejects later is not an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await assert.rejects(
      withHostDeadline(
        "chat",
        10,
        () =>
          new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(new Error("late failure")), 40),
          ),
        () => {},
      ),
      SetupDeadlineError,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});

test("raceWithTimeout names the call that never finished", async () => {
  await assert.rejects(
    raceWithTimeout("install OpenAI key on chat", 15, never()),
    /install OpenAI key on chat did not finish within 0s/,
  );
  assert.equal(
    await raceWithTimeout("quick call", 1_000, Promise.resolve(3)),
    3,
  );
});
