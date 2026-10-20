import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DESIGN_E2E_REGRESSION_PINS,
  resolveDesignE2ERegressionPinsForShard,
} from "./design-e2e-regression-pins.ts";

const CLI_PATH = fileURLToPath(
  new URL("./design-e2e-regression-pin-identities.ts", import.meta.url),
);

test("the identity CLI pairs each selector with its manifest title", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", CLI_PATH, "inspector-1a"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);

  const identities = JSON.parse(result.stdout) as {
    selector: string;
    title: string;
  }[];
  const pins = DESIGN_E2E_REGRESSION_PINS.filter(
    (pin) => pin.shard === "inspector-1a",
  );
  const selectors = resolveDesignE2ERegressionPinsForShard("inspector-1a");
  assert.deepEqual(
    identities,
    pins.map((pin, index) => ({
      selector: selectors[index],
      title: pin.title,
    })),
  );
});

test("the identity CLI rejects unknown shards", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", CLI_PATH, "unknown-shard"],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown Design regression shard/);
  assert.equal(result.stdout, "");
});
