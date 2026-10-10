import assert from "node:assert/strict";
import test from "node:test";

import {
  appendFixtureInput,
  captureFixtureInput,
  parseFixtureInput,
  type FixtureInputBucket,
} from "../../../templates/content/e2e/editor-input-lineage";

test("bounded input lineage explicitly reports discarded snapshots", () => {
  const bucket: FixtureInputBucket = {
    inputLineage: [],
    inputLineageTruncated: false,
  };
  const snapshot = {
    phase: "after-input",
    edit: "A5",
    present: { A5: 1 },
    selectionCollapsed: true,
  };
  for (let index = 0; index < 32; index++) appendFixtureInput(bucket, snapshot);
  assert.equal(bucket.inputLineage.length, 32);
  assert.equal(bucket.inputLineageTruncated, false);
  appendFixtureInput(bucket, snapshot);
  assert.equal(bucket.inputLineage.length, 32);
  assert.equal(bucket.inputLineageTruncated, true);
});

test("input lineage retains only bounded fixture presence and caret state", () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector: () => ({
        textContent: "private body zq1234A1x zq1234A3x zq1234A3x zq5678B2x",
      }),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      getSelection: () => ({ isCollapsed: false }),
    },
  });
  try {
    const snapshot = captureFixtureInput({
      phase: "before-input",
      text: " zq1234A5x",
      editor: ".fixture",
    });
    assert.deepEqual(snapshot, {
      phase: "before-input",
      edit: "A5",
      present: { A1: 1, A3: 2 },
      selectionCollapsed: false,
    });
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["private", "1234", "5678", "zq", "B2"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.equal(
      captureFixtureInput({
        phase: "before-input",
        text: "private user input",
        editor: ".fixture",
      }),
      null,
    );
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("browser reports cannot persist arbitrary fields or unbounded markers", () => {
  const valid = {
    phase: "after-input",
    edit: "A5",
    present: { A3: 1, A5: 1 },
    selectionCollapsed: true,
  };
  assert.deepEqual(
    parseFixtureInput({ ...valid, secret: "do not retain" }),
    valid,
  );
  for (const invalid of [
    { ...valid, phase: "private content" },
    { ...valid, edit: "private identity" },
    { ...valid, present: { private: 1 } },
    { ...valid, present: { A3: 33 } },
    { ...valid, present: { A3: 1.5 } },
    {
      ...valid,
      present: Object.fromEntries(
        Array.from({ length: 33 }, (_, i) => [`A${i + 1}`, 1]),
      ),
    },
    { ...valid, selectionCollapsed: "private selection" },
  ])
    assert.equal(parseFixtureInput(invalid), null);
});
