import assert from "node:assert/strict";
import test from "node:test";

import { EVENT_CALL } from "./guard-tracking-event-names.mjs";

test("matches optional-member telemetry tracking calls", () => {
  const source = [
    "options.telemetry?.",
    "track",
    "(",
    JSON.stringify("session status"),
    ");",
  ].join("");
  const matches = [...source.matchAll(EVENT_CALL)];

  assert.deepEqual(
    matches.map((match) => [match[1], match[2]]),
    [["track", "session status"]],
  );
});
