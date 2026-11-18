import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("dispatches root tests by runtime imports across fixtures and multiline syntax", () => {
  const temp = path.resolve(import.meta.dirname, "../.tmp");
  mkdirSync(temp, { recursive: true });
  const dir = mkdtempSync(path.join(temp, "ci-script-tests-"));
  const run = (files?: string[]) =>
    spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        path.join(import.meta.dirname, "ci-run-script-tests.ts"),
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_TEST_CONTEXT: undefined,
          SCRIPT_TESTS: files && JSON.stringify(files),
        },
      },
    );
  const tests = {
    "source-fixture.test.ts": [
      'import assert from "node:assert/strict";',
      'import { writeFileSync } from "node:fs";',
      'import { test } from "node:test";',
      "const fixture = `",
      'import { test } from "vitest";',
      "`;",
      'test("node fixture", () => {',
      "  assert.match(fixture, /vitest/);",
      '  writeFileSync("source-fixture.test.ts.ran", "");',
      "});",
    ],
    "type-fixture.test.ts": [
      'import { writeFileSync } from "node:fs";',
      'import { test } from "node:test";',
      'import type { Task } from "vitest";',
      'import { type TestContext } from "vitest";',
      'test("node with types", () => writeFileSync("type-fixture.test.ts.ran", ""));',
    ],
    "vitest-fixture.test.ts": [
      'import { writeFileSync } from "node:fs";',
      "import { expect, test, type TestContext }",
      "  from",
      '    "vitest";',
      'test("vitest fixture", () => {',
      "  expect(1 + 1).toBe(2);",
      '  writeFileSync("vitest-fixture.test.ts.ran", "");',
      "});",
    ],
  };
  try {
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n');
    for (const [file, lines] of Object.entries(tests)) {
      writeFileSync(path.join(dir, file), lines.join("\n"));
    }
    const result = run(Object.keys(tests));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const file of Object.keys(tests)) {
      assert.ok(
        existsSync(path.join(dir, `${file}.ran`)),
        `${file} did not run`,
      );
    }

    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /SCRIPT_TESTS must be set/);
    assert.equal(run([]).status, 0);

    const vitestReceipt = path.join(dir, "vitest-fixture.test.ts.ran");
    for (const [runner, moduleName] of [
      ["node", "node:test"],
      ["vitest", "vitest"],
    ]) {
      const file = `${runner}-failure.test.ts`;
      writeFileSync(
        path.join(dir, file),
        `import { test } from "${moduleName}";\ntest("fails", () => { throw new Error("intentional runner failure"); });`,
      );
      rmSync(vitestReceipt);
      const failed = run([file, "vitest-fixture.test.ts"]);
      assert.equal(failed.status, 1, failed.stdout + failed.stderr);
      assert.match(failed.stdout + failed.stderr, /intentional runner failure/);
      assert.ok(existsSync(vitestReceipt), "the Vitest fixture still runs");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
