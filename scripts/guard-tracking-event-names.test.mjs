import assert from "node:assert/strict";
import test from "node:test";

import {
  EVENT_CALL,
  namesBeyondBase,
  renamedFrom,
} from "./guard-tracking-event-names.mjs";

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

void test("lets an existing legacy call change but flags a new one", () => {
  const base = `trackEvent(${JSON.stringify("session status")}, { a: 1 });`;
  const edited = `trackEvent(${JSON.stringify("session status")}, { a: 1, b: 2 });`;
  const added = `${edited}
trackEvent(${JSON.stringify("session status")});`;
  const brandNew = `trackEvent(${JSON.stringify("Clicked Thing")});`;

  assert.deepEqual([...namesBeyondBase(edited, base, ["session status"])], []);
  assert.deepEqual(
    [...namesBeyondBase(added, base, ["session status"])],
    ["session status"],
  );
  assert.deepEqual(
    [...namesBeyondBase(brandNew, "", ["Clicked Thing"])],
    ["Clicked Thing"],
  );
});

void test("reads a renamed file's base text from its old path", () => {
  const renames = renamedFrom(
    [
      "R087\tsrc/old-name.ts\tsrc/new-name.ts",
      "R100\tsrc/moved.ts\tlib/moved.ts",
      "",
    ].join("\n"),
  );

  assert.equal(renames.get("src/new-name.ts"), "src/old-name.ts");
  assert.equal(renames.get("lib/moved.ts"), "src/moved.ts");
  assert.equal(renames.get("src/untouched.ts"), undefined);
});
