import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { createLocalQaDescriptor } from "./local-qa-descriptor.js";

test("report A2-LOCAL-QA-DESCRIPTOR-1121: local runs own independent descriptors even when an old descriptor exists", () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "analytics-descriptor-test-"),
  );
  try {
    const old = resolve(directory, "analytics-2-local-qa.json");
    writeFileSync(old, "previous run");
    const first = createLocalQaDescriptor(directory, "first run");
    const second = createLocalQaDescriptor(directory, "second run");
    assert.notEqual(first, second);
    assert.equal(readFileSync(first, "utf8"), "first run");
    assert.equal(readFileSync(second, "utf8"), "second run");
    assert.equal(readFileSync(old, "utf8"), "previous run");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
