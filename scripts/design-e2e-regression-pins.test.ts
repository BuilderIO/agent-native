import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
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

test("fixed regression pins reject skipped, expected-failure, and focused declarations", () => {
  for (const modifier of ["skip", "fixme", "fail", "only"]) {
    assert.throws(
      () =>
        findDesignE2ETestLine(
          `test.${modifier}("pinned behavior", () => {});`,
          "pinned behavior",
        ),
      /must run without test modifiers/,
    );
  }
});

test("fixed regression pins reject enclosing disabled or focused suites", () => {
  for (const modifier of ["fail", "skip", "fixme", "only"]) {
    const source = [
      'test.describe("outer suite", () => {',
      '  test.describe("nested suite", () => {',
      `    test.describe.${modifier}("inner suite", () => {`,
      '      test("pinned behavior", () => {});',
      "    });",
      "  });",
      "});",
    ].join("\n");

    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /must run without/,
      `test.describe.${modifier} must not disable a nested pin`,
    );
  }
});

test("fixed regression pins reject focused sibling tests and suites", () => {
  const siblingTestOnly = [
    'test.describe("active suite", () => {',
    '  test("pinned behavior", () => {});',
    '  test.only("another test", () => {});',
    "});",
  ].join("\n");
  const siblingDescribeOnly = [
    'test.describe("active suite", () => {',
    '  test("pinned behavior", () => {});',
    "});",
    'test.describe.only("focused suite", () => {',
    '  test("another test", () => {});',
    "});",
  ].join("\n");

  assert.throws(
    () => findDesignE2ETestLine(siblingTestOnly, "pinned behavior"),
    /must run without/,
  );
  assert.throws(
    () => findDesignE2ETestLine(siblingDescribeOnly, "pinned behavior"),
    /must run without/,
  );
});

test("unrelated skipped suites and skipped sibling tests do not hide a pin", () => {
  const source = [
    'test.describe("active suite", () => {',
    '  test("pinned behavior", () => {});',
    '  test.skip("skipped sibling", () => {});',
    '  test("runtime-skipped sibling", () => { test.skip(true, "skip sibling"); });',
    '  test("runtime-fixme sibling", () => { test.fixme(true, "fix sibling"); });',
    '  test("expected-failure sibling", () => { test.fail(true, "expected failure"); });',
    "});",
    'test.describe.skip("unrelated suite", () => {',
    '  test("another test", () => {});',
    "});",
    'test.describe("another unrelated suite", () => {',
    '  test.skip(true, "skip this suite");',
    '  test("a skipped suite test", () => {});',
    "});",
    'test("a skipped sibling", () => { test.skip(true, "skip only this test"); });',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 2);
});

test("runtime skip, fixme, and fail annotations reject a pinned test body", () => {
  for (const modifier of ["skip", "fixme", "fail"]) {
    assert.throws(
      () =>
        findDesignE2ETestLine(
          `test("pinned behavior", () => { test.${modifier}(true, "runtime annotation"); });`,
          "pinned behavior",
        ),
      /must run without/,
      `test.${modifier} inside the pinned body must not mask its result`,
    );
  }
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'test("pinned behavior", ({ isMobile }) => { test.fixme(isMobile, "mobile unsupported"); });',
        "pinned behavior",
      ),
    /Unable to inspect conditional test\.fixme/,
  );
});

test("describe details overloads preserve enclosing and unrelated suite scope", () => {
  const nestedDetails = [
    'test.describe("outer", { tag: "@outer" }, () => {',
    '  test.describe("inner", { tag: "@inner" }, () => {',
    '    test("pinned behavior", () => {});',
    "  });",
    "});",
  ].join("\n");
  const unrelatedDetailsSuite = [
    'test.describe("other", { tag: "@other" }, () => {',
    '  test.skip(true, "skip only this suite");',
    '  test("other behavior", () => {});',
    "});",
    'test("pinned behavior", () => {});',
  ].join("\n");
  const unrelatedModifiedDetailsSuite = [
    'test.describe.skip("other", { tag: "@other" }, () => {',
    '  test.skip(true, "skip only this suite");',
    '  test("other behavior", () => {});',
    "});",
    'test("pinned behavior", () => {});',
  ].join("\n");
  const disabledDetailsSuite = [
    'test.describe.skip("disabled", { tag: "@disabled" }, () => {',
    '  test("pinned behavior", () => {});',
    "});",
  ].join("\n");
  const fileSkipInsideDetailsSuite = [
    'test.describe("conditional suite", { tag: "@conditional" }, () => {',
    '  test.skip(true, "skip this suite");',
    '  test("pinned behavior", () => {});',
    "});",
  ].join("\n");

  assert.equal(findDesignE2ETestLine(nestedDetails, "pinned behavior"), 3);
  assert.equal(
    findDesignE2ETestLine(unrelatedDetailsSuite, "pinned behavior"),
    5,
  );
  assert.equal(
    findDesignE2ETestLine(unrelatedModifiedDetailsSuite, "pinned behavior"),
    5,
  );
  assert.throws(
    () => findDesignE2ETestLine(disabledDetailsSuite, "pinned behavior"),
    /must run without/,
  );
  assert.throws(
    () => findDesignE2ETestLine(fileSkipInsideDetailsSuite, "pinned behavior"),
    /must run without/,
  );
});

test("suppression-like comments, strings, and templates do not affect a pin", () => {
  const source = [
    '// test.describe.skip("fake suite", () => {});',
    'const string = "test.only(\\"fake test\\", () => {});";',
    'const template = `test.describe.fixme("fake suite", () => {});`;',
    'const pattern = /test\\.skip\\(true, ".*"\\)/;',
    '/* test.describe.only("fake focused suite", () => {}); */',
    'test.describe("active suite", () => {',
    '  test("pinned behavior", () => {});',
    "});",
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 7);
});

test("template expressions are inspected while raw text and regex braces stay masked", () => {
  const source = [
    'const label = `value ${(() => ({ text: "}", pattern: /[{}]/ }))()}`;',
    'test("pinned behavior", () => {});',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 2);
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'const label = `${test.skip(true, "disable file")}`;\ntest("pinned behavior", () => {});',
        "pinned behavior",
      ),
    /must run without/,
  );
  assert.equal(
    findDesignE2ETestLine(
      'const label = `${"test.skip(true, \\"disabled\\")"}`;\ntest("pinned behavior", () => {});',
      "pinned behavior",
    ),
    2,
  );
});

test("statically unconditional file and enclosing suite skips reject pins", () => {
  const fileSkip = [
    'test.skip(true, "the whole file is disabled");',
    'test("pinned behavior", () => {});',
  ].join("\n");
  const suiteSkip = [
    'test.describe("outer suite", () => {',
    '  test.describe("nested suite", () => {',
    '    test.skip(true, "the suite is disabled");',
    '    test("pinned behavior", () => {});',
    "  });",
    "});",
  ].join("\n");

  assert.throws(
    () => findDesignE2ETestLine(fileSkip, "pinned behavior"),
    /must run without/,
  );
  assert.throws(
    () => findDesignE2ETestLine(suiteSkip, "pinned behavior"),
    /must run without/,
  );
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'test.fixme(true, "the whole file is marked fixme");\ntest("pinned behavior", () => {});',
        "pinned behavior",
      ),
    /must run without/,
  );
  assert.equal(
    findDesignE2ETestLine(
      'test.skip(false, "keep the file enabled");\ntest("pinned behavior", () => {});',
      "pinned behavior",
    ),
    2,
  );
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'test.skip(process.platform === "win32", "platform skip");\ntest("pinned behavior", () => {});',
        "pinned behavior",
      ),
    /Unable to inspect conditional test\.skip/,
  );
});

test("modifier text inside an ordinary pinned title does not disable it", () => {
  assert.equal(
    findDesignE2ETestLine(
      'test("test.skip in a title", () => {});',
      "test.skip in a title",
    ),
    1,
  );
});

test("the resolver CLI distinguishes disabled pins from unreadable sources", () => {
  const root = mkdtempSync(join(tmpdir(), "design-disabled-pin-"));
  try {
    const scripts = join(root, "scripts");
    const specs = join(root, "templates/design/e2e");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(specs, { recursive: true });
    copyFileSync(
      fileURLToPath(
        new URL("./design-e2e-regression-pins.ts", import.meta.url),
      ),
      join(scripts, "design-e2e-regression-pins.ts"),
    );
    const pins = DESIGN_E2E_REGRESSION_PINS.filter(
      ({ shard }) => shard === "inspector-1a",
    );
    const firstPinFile = join(specs, pins[0]!.file);
    const firstFilePins = pins.filter(({ file }) => file === pins[0]!.file);
    for (const file of new Set(pins.map((pin) => pin.file))) {
      writeFileSync(
        join(specs, file),
        pins
          .filter((pin) => pin.file === file)
          .map(
            (pin) =>
              `test${pin === pins[0] ? ".skip" : ""}(${JSON.stringify(pin.title)}, () => {});`,
          )
          .join("\n"),
      );
    }
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scripts, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /must run without test modifiers/);
    assert.equal(result.stdout, "");

    writeFileSync(
      firstPinFile,
      [
        ...firstFilePins.map(
          (pin) => `test(${JSON.stringify(pin.title)}, () => {});`,
        ),
        'test.only("another test", () => {});',
      ].join("\n"),
    );
    const focused = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scripts, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { encoding: "utf8" },
    );
    assert.equal(focused.status, 1, focused.stderr);
    assert.match(focused.stderr, /test\.only/);
    assert.equal(focused.stdout, "");

    writeFileSync(
      firstPinFile,
      [
        'test.skip(process.platform === "win32", "conditional file skip");',
        ...firstFilePins.map(
          (pin) => `test(${JSON.stringify(pin.title)}, () => {});`,
        ),
      ].join("\n"),
    );
    const conditional = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scripts, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { encoding: "utf8" },
    );
    assert.equal(conditional.status, 2, conditional.stderr);
    assert.match(
      conditional.stderr,
      /Unable to inspect conditional test\.skip/,
    );
    assert.equal(conditional.stdout, "");

    rmSync(firstPinFile);
    const unavailable = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scripts, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { encoding: "utf8" },
    );
    assert.equal(unavailable.status, 2, unavailable.stderr);
    assert.match(unavailable.stderr, /ENOENT/);
    assert.equal(unavailable.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
