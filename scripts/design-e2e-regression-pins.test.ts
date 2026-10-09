import assert from "node:assert/strict";
import test from "node:test";

import {
  DESIGN_E2E_REGRESSION_PINS,
  DESIGN_E2E_REGRESSION_SHARDS,
  findDesignE2ETestLine,
  resolveDesignE2ERegressionPin,
  resolveDesignE2ERegressionPinsForShard,
} from "./design-e2e-regression-pins.ts";

test("regression pins resolve unique test titles to the current source lines", () => {
  assert.equal(DESIGN_E2E_REGRESSION_PINS.length, 46);
  assert.deepEqual(
    [...new Set(DESIGN_E2E_REGRESSION_PINS.map(({ shard }) => shard))],
    DESIGN_E2E_REGRESSION_SHARDS,
  );

  const resolved = DESIGN_E2E_REGRESSION_SHARDS.flatMap((shard) =>
    resolveDesignE2ERegressionPinsForShard(shard),
  );
  assert.equal(resolved.length, DESIGN_E2E_REGRESSION_PINS.length);
  assert.equal(new Set(resolved).size, resolved.length);
});

test("a moved test title resolves to its new line", () => {
  const pin = {
    shard: "fixture",
    file: "fixture.spec.ts",
    title: "the pinned behavior",
  } as const;
  const source = [
    'import { test } from "@playwright/test";',
    'test("another behavior", async () => {});',
    'test("the pinned behavior", async () => {});',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, pin.title), 3);
  assert.equal(
    resolveDesignE2ERegressionPin(pin, {
      readSource: () => source,
    }),
    "e2e/fixture.spec.ts:3",
  );
});

test("missing, duplicate, and unknown regression pins fail closed", () => {
  assert.throws(
    () => findDesignE2ETestLine('test("other", () => {});', "missing"),
    /must match exactly one test title/,
  );
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'test("same", () => {});\ntest("same", () => {});',
        "same",
      ),
    /must match exactly one test title/,
  );
  assert.throws(
    () => resolveDesignE2ERegressionPinsForShard("unknown-shard"),
    /Unknown Design regression shard/,
  );
});
