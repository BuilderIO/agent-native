import assert from "node:assert/strict";
import test from "node:test";

import { EVENT_CALL } from "./guard-tracking-event-names.mjs";

test("matches optional-member and optional-call telemetry tracking calls", () => {
  const sources = [
    `options.telemetry?.track(${JSON.stringify("session status")});`,
    `options.telemetry.track?.(${JSON.stringify("session status")});`,
    `options.telemetry?.track?.(${JSON.stringify("session status")});`,
  ];

  for (const source of sources) {
    const matches = [...source.matchAll(EVENT_CALL)];

    assert.deepEqual(
      matches.map((match) => [match[1], match[2]]),
      [["track", "session status"]],
    );
  }
});
