import { expect, it } from "vitest";

import { normalizeQueuedTurns } from "./queued-turns.js";

it("keeps one durable turn queued across lease replays and reload without declaring it run", () => {
  const original = {
    id: "queue-one",
    turnId: "request-one",
    text: "Direction",
    engine: "unconfigured",
  };
  const replay = { ...original, id: "queue-two" };
  const restored = normalizeQueuedTurns(
    JSON.parse(JSON.stringify([original, replay])),
  );
  expect(restored).toEqual([original]);
  expect(
    normalizeQueuedTurns([...restored, { ...replay, id: "queue-three" }]),
  ).toEqual([original]);
  expect(restored[0]).not.toHaveProperty("runId");
});
it("does not deduplicate ordinary identical messages or distinct source-batch turns", () => {
  const messages = [
    { id: "a", text: "Same text" },
    { id: "b", text: "Same text" },
    { id: "c", turnId: "source-batch-one" },
    { id: "d", turnId: "source-batch-two" },
  ];
  expect(normalizeQueuedTurns(messages)).toEqual(messages);
});
it("retains promoted turn state and attachments when a submission is replayed", () => {
  const first = {
    turnId: "stable",
    promoted: true,
    attachments: [{ id: "real-attachment" }],
  };
  expect(
    normalizeQueuedTurns([
      first,
      { turnId: "stable", promoted: false, attachments: [] },
    ])[0],
  ).toBe(first);
});
