import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("title-shaped text in comments, strings, templates, and regexes is ignored", () => {
  const source = [
    '// test("the pinned behavior", () => {});',
    'const text = "test(\\"the pinned behavior\\")";',
    'const template = `test("the pinned behavior")`;',
    "const multilineTemplate = `",
    '  test("the pinned behavior", () => {});',
    "`;",
    "/*",
    'test("the pinned behavior", () => {});',
    "*/",
    'const pattern = /test\\("the pinned behavior"\\)/;',
    'const patternFromArrow = () => /test\\("the pinned behavior"\\)/;',
    'const negatedPattern = !/test\\("the pinned behavior"\\)/;',
    'test("the pinned behavior", () => {});',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "the pinned behavior"), 13);
});

test("inline test registrations are found without matching properties or larger identifiers", () => {
  const source = [
    'fixture.test("the pinned behavior", () => {});',
    'contest("the pinned behavior", () => {});',
    'enabled && test("the pinned behavior", () => {});',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "the pinned behavior"), 3);
});

test("a static template literal can be used as a test title", () => {
  assert.equal(
    findDesignE2ETestLine(
      "test(`the pinned behavior`, () => {});",
      "the pinned behavior",
    ),
    1,
  );
});

test("the resolver CLI works without installed workspace dependencies", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "design-pin-resolver-"));
  try {
    const scriptsDirectory = join(temporaryRoot, "scripts");
    const specDirectory = join(temporaryRoot, "templates/design/e2e");
    mkdirSync(scriptsDirectory, { recursive: true });
    mkdirSync(specDirectory, { recursive: true });
    copyFileSync(
      fileURLToPath(
        new URL("./design-e2e-regression-pins.ts", import.meta.url),
      ),
      join(scriptsDirectory, "design-e2e-regression-pins.ts"),
    );
    for (const { file } of DESIGN_E2E_REGRESSION_PINS.filter(
      ({ shard }) => shard === "inspector-1a",
    )) {
      const source = new URL(
        `../templates/design/e2e/${file}`,
        import.meta.url,
      );
      assert.equal(existsSync(source), true);
      copyFileSync(fileURLToPath(source), join(specDirectory, file));
    }

    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scriptsDirectory, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { cwd: temporaryRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /e2e\/canvas-invariants\.spec\.ts:\d+\0/);
    assert.match(result.stdout, /e2e\/inspector-styles\.spec\.ts:\d+\0/);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
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
