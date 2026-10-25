import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findDisabledTests,
  findOracleLoosening,
  isTestFile,
  pragmasIn,
  type AssertionSource,
  type ChangedFile,
  type OracleViolation,
} from "./guard-no-oracle-loosening.js";
import { parseRemovedLines } from "./lib/changed-lines.mjs";

const ROOT = "/repo";

function at(rel: string) {
  return path.resolve(ROOT, rel);
}

function changedFile(
  rel: string,
  source: string,
  added: number[],
): ChangedFile {
  return {
    source: source.split("\n"),
    added: new Set(added),
    pragmas: pragmasIn(rel, source),
  };
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`test setup is missing ${what}`);
  return value;
}

/**
 * Runs the pure check. `files` are the post-change texts of the changed files,
 * `bases` the pre-change texts keyed by old path. A test file in the diff must
 * have an entry in whichever side it exists on.
 */
function findViolations(
  files: Record<string, { source: string; added: number[] }>,
  diff = "",
  bases: Record<string, string> = {},
): OracleViolation[] {
  const added = new Map(
    Object.entries(files).map(([rel, file]) => [
      at(rel),
      changedFile(rel, file.source, file.added),
    ]),
  );
  const removed = parseRemovedLines(diff, ROOT) ?? new Map();
  const assertionSources = new Map<string, AssertionSource>();
  for (const [abs, entry] of removed) {
    if (!isTestFile(entry.path) && !isTestFile(entry.oldPath)) continue;
    assertionSources.set(abs, {
      base: entry.created
        ? null
        : required(bases[entry.oldPath], `base text of ${entry.oldPath}`),
      next: entry.deleted
        ? null
        : required(files[entry.path], `file ${entry.path}`).source,
    });
  }
  return findOracleLoosening({ root: ROOT, added, removed, assertionSources });
}

/** Runs the pure check and reports each violation as `path:line: rule`. */
function flagged(
  files: Record<string, { source: string; added: number[] }>,
  diff = "",
  bases: Record<string, string> = {},
): string[] {
  return findViolations(files, diff, bases).map(
    (violation) => `${violation.file}:${violation.line}: ${violation.rule}`,
  );
}

function allLines(source: string): number[] {
  return source.split("\n").map((_, index) => index + 1);
}

// CI runs a root script test under vitest when its text contains a vitest
// import specifier, so fixtures spell it through this constant.
const VITEST = "vitest";

const SPEC = "templates/mail/actions/send.spec.ts";

describe("disabled-test and expect-anything in test files", () => {
  it("flags every disabling call and expect.anything()", () => {
    const source = [
      'it.skip("a", () => {});',
      'describe.only("b", () => {});',
      'test.todo("c");',
      'test.fixme("d", () => {});',
      'it.skipIf(cond)("e", () => {});',
      'it.runIf(cond)("f", () => {});',
      'it.skip.each([1])("g", () => {});',
      'xit("h", () => {});',
      'xdescribe("i", () => {});',
      'xtest("j", () => {});',
      "expect(value).toEqual(expect.anything());",
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: allLines(source) } }), [
      `${SPEC}:1: disabled-test`,
      `${SPEC}:2: disabled-test`,
      `${SPEC}:3: disabled-test`,
      `${SPEC}:4: disabled-test`,
      `${SPEC}:5: disabled-test`,
      `${SPEC}:6: disabled-test`,
      `${SPEC}:7: disabled-test`,
      `${SPEC}:8: disabled-test`,
      `${SPEC}:9: disabled-test`,
      `${SPEC}:10: disabled-test`,
      `${SPEC}:11: expect-anything`,
    ]);
  });

  it("flags disabling calls chained after .each, and .fails in every form", () => {
    const source = [
      'it.each(cases).skip("a", () => {});',
      'describe.each(rows).only("b", () => {});',
      'test.each(rows).todo("c");',
      'it.fails("d", () => {});',
      'test.fails.each(rows)("e", () => {});',
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: allLines(source) } }), [
      `${SPEC}:1: disabled-test`,
      `${SPEC}:2: disabled-test`,
      `${SPEC}:3: disabled-test`,
      `${SPEC}:4: disabled-test`,
      `${SPEC}:5: disabled-test`,
    ]);
    assert.match(
      findDisabledTests(SPEC, 'it.fails("d", () => {});')[0].message,
      /failing assertion read as passing/,
    );
  });

  it("flags bracket notation with a literal key, but not a computed key", () => {
    const source = [
      'it["skip"]("a", () => {});',
      'test["only"]("b", () => {});',
      'describe["todo"]("c");',
      "it[`fixme`]('d', () => {});",
      'it.each(rows)["skip"]("e", () => {});',
      'it["skip"].each(rows)("f", () => {});',
      'it["fails"]("g", () => {});',
      "it[name]('h', () => {});",
      'const key = "skip"; it[key]("i", () => {});',
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: allLines(source) } }), [
      `${SPEC}:1: disabled-test`,
      `${SPEC}:2: disabled-test`,
      `${SPEC}:3: disabled-test`,
      `${SPEC}:4: disabled-test`,
      `${SPEC}:5: disabled-test`,
      `${SPEC}:6: disabled-test`,
      `${SPEC}:7: disabled-test`,
    ]);
    assert.match(
      findDisabledTests(SPEC, 'it["fails"]("g", () => {});')[0].message,
      /failing assertion read as passing/,
    );
  });

  it("does not flag an .each row that is not a test API", () => {
    const source = [
      "const pages = queue.each(rows).skip(2);",
      "const page = pages.each(rows).only(id);",
    ].join("\n");

    assert.deepEqual(
      flagged({ [SPEC]: { source, added: allLines(source) } }),
      [],
    );
  });

  it("applies to e2e files and anything under an e2e directory", () => {
    const source = 'test.skip("login", async () => {});';
    for (const rel of [
      "apps/web/tests/login.e2e.ts",
      "apps/web/e2e/login.ts",
      "apps/web/actions/login.test.tsx",
    ]) {
      assert.deepEqual(
        flagged({ [rel]: { source, added: [1] } }),
        [`${rel}:1: disabled-test`],
        rel,
      );
    }
  });

  it("ignores same-named methods off test APIs and partial expect.anything() matches", () => {
    const source = [
      "const rest = stream.skip(2);",
      "const one = query.only(id);",
      "expect(send).toHaveBeenCalledWith(expect.anything(), id);",
      "expect(row).toEqual({ id, createdAt: expect.anything() });",
    ].join("\n");

    assert.deepEqual(
      flagged({ [SPEC]: { source, added: allLines(source) } }),
      [],
    );
  });

  it("ignores disabling text inside strings and comments, and in non-test files", () => {
    const source = [
      "const fixture = \"it.skip('x', () => {})\";",
      "// it.only('y', () => {});",
      "const doc = `expect.anything()`;",
    ].join("\n");

    assert.deepEqual(
      flagged({ [SPEC]: { source, added: allLines(source) } }),
      [],
    );
    assert.deepEqual(
      flagged({
        "templates/mail/actions/send.ts": {
          source: 'it.skip("x", () => {});',
          added: [1],
        },
      }),
      [],
    );
  });

  it("only reports lines this branch added", () => {
    const source = 'it.skip("old", () => {});\nit("new", () => {});';
    assert.deepEqual(flagged({ [SPEC]: { source, added: [2] } }), []);
  });

  it("recognises test files by name and directory", () => {
    assert.equal(isTestFile("a/b.spec.ts"), true);
    assert.equal(isTestFile("a/b.test.tsx"), true);
    assert.equal(isTestFile("a/b.e2e.ts"), true);
    assert.equal(isTestFile("a/e2e/b.ts"), true);
    assert.equal(isTestFile("a/b.ts"), false);
    assert.equal(isTestFile("a/e2elsewhere/b.ts"), false);
  });

  it("reports the line of the call, not the line the statement starts on", () => {
    const sites = findDisabledTests(
      SPEC,
      ["const x = [", "  1,", "];", "it.skip('a', () => {});"].join("\n"),
    );
    assert.deepEqual(
      sites.map((site) => [site.line, site.rule]),
      [[4, "disabled-test"]],
    );
  });
});

describe("runner-loosened in vitest and playwright configs", () => {
  it("flags retries above zero and passWithNoTests", () => {
    const vitest = [
      "export default defineConfig({",
      "  test: {",
      "    retry: 2,",
      "    retries: 0,",
      "    passWithNoTests: true,",
      "    passWithNoTests: false,",
      "  },",
      "});",
    ].join("\n");
    assert.deepEqual(
      flagged({
        "templates/mail/vitest.config.ts": {
          source: vitest,
          added: allLines(vitest),
        },
      }),
      [
        "templates/mail/vitest.config.ts:3: runner-loosened",
        "templates/mail/vitest.config.ts:5: runner-loosened",
      ],
    );
  });

  it("flags a computed retry count unless it is literally zero", () => {
    const playwright = "  retries: process.env.CI ? 2 : 0,";
    assert.deepEqual(
      flagged({
        "playwright.config.ts": { source: playwright, added: [1] },
      }),
      ["playwright.config.ts:1: runner-loosened"],
    );
  });

  it("matches vitest.<name>.config files, not vitest.shared.ts", () => {
    const source = "retry: 3,";
    assert.deepEqual(
      flagged({
        "vitest.unit.config.ts": { source, added: [1] },
        "vitest.shared.ts": { source, added: [1] },
      }),
      ["vitest.unit.config.ts:1: runner-loosened"],
    );
  });
});

describe("runner-loosened in test files", () => {
  it("flags retry or retries above zero in a test API options object", () => {
    const source = [
      'it("a", { retry: 2 }, () => {});',
      'test("b", { retries: 3 }, () => {});',
      'it.each(rows)("c", { retry: 1 }, () => {});',
      'it("d", { retry: 0 }, () => {});',
      'it("e", { timeout: 5 }, () => {});',
      'describe("f", { retries: 2 }, () => {});',
      'it("g", { retry: process.env.CI ? 2 : 0 }, () => {});',
      "const options = { retries: 3 };",
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: allLines(source) } }), [
      `${SPEC}:1: runner-loosened`,
      `${SPEC}:2: runner-loosened`,
      `${SPEC}:3: runner-loosened`,
      `${SPEC}:6: runner-loosened`,
      `${SPEC}:7: runner-loosened`,
    ]);
  });

  it("flags a shorthand retries whose value is a variable", () => {
    const source = [
      "const retries = 3;",
      'it("a", { retries }, () => {});',
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: allLines(source) } }), [
      `${SPEC}:2: runner-loosened`,
    ]);
  });

  it("flags test.describe.configure retries unless zero, and this.retries(N)", () => {
    const source = [
      "test.describe.configure({ retries: 2 });",
      "test.describe.configure({ retries: 0 });",
      'it("a", function () { this.retries(3); });',
      'it("b", function () { this.retries(0); });',
      "ctx.retries(attempts);",
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: allLines(source) } }), [
      `${SPEC}:1: runner-loosened`,
      `${SPEC}:3: runner-loosened`,
      `${SPEC}:5: runner-loosened`,
    ]);
  });

  it("accepts a retry above zero with an oracle-change reason", () => {
    const source = [
      "// oracle-change: the stub drops one request on the first call",
      'it("a", { retry: 1 }, () => {});',
    ].join("\n");

    assert.deepEqual(
      flagged({ [SPEC]: { source, added: allLines(source) } }),
      [],
    );
  });
});

describe("test API roots from imports", () => {
  it("treats aliased test APIs from a test runner import as roots", () => {
    const source = [
      `import { it as spec, test as t } from "${VITEST}";`,
      'spec.skip("a", () => {});',
      't.only("b", () => {});',
      'import { test as bt } from "bun:test";',
      'bt.todo("c");',
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: allLines(source) } }), [
      `${SPEC}:2: disabled-test`,
      `${SPEC}:3: disabled-test`,
      `${SPEC}:5: disabled-test`,
    ]);
  });

  it("treats members of a namespace import from a test runner as test APIs", () => {
    const source = [
      `import * as v from "${VITEST}";`,
      'v.it.skip("a", () => {});',
      'import * as p from "@playwright/test";',
      "p.test.describe.configure({ retries: 2 });",
      'p.describe.only("b", () => {});',
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: allLines(source) } }), [
      `${SPEC}:2: disabled-test`,
      `${SPEC}:4: runner-loosened`,
      `${SPEC}:5: disabled-test`,
    ]);
  });

  it("does not treat names from other modules as test roots", () => {
    const source = [
      'import { it as spec } from "./helpers";',
      'import * as v from "./stream";',
      `import { skip as only } from "${VITEST}";`,
      "spec.skip(1);",
      "v.it.skip(2);",
      "only.skip(3);",
      `import { it as more } from "${VITEST}";`,
      "more.skip(4);",
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: allLines(source) } }), [
      `${SPEC}:8: disabled-test`,
    ]);
  });
});

describe("script-loosened in package.json", () => {
  it("flags --passWithNoTests and vitest -u / --update in scripts", () => {
    const source = [
      "{",
      '  "scripts": {',
      '    "test:unit": "vitest run --passWithNoTests",',
      '    "test:snap": "vitest run -u",',
      '    "test:update": "vitest --update",',
      '    "test": "vitest run"',
      "  }",
      "}",
    ].join("\n");
    assert.deepEqual(
      flagged({
        "templates/mail/package.json": { source, added: allLines(source) },
      }),
      [
        "templates/mail/package.json:3: script-loosened",
        "templates/mail/package.json:4: script-loosened",
        "templates/mail/package.json:5: script-loosened",
      ],
    );
  });
});

describe("opt-out pragma", () => {
  it("suppresses a flag with a reason on the flagged line", () => {
    const source =
      'it.skip("upstream", () => {}); // oracle-change: upstream outage tracked in INC-42';
    assert.deepEqual(flagged({ [SPEC]: { source, added: [1] } }), []);
  });

  it("suppresses a flag with a reason on the added line directly above", () => {
    const source = [
      "// oracle-change: quarantined while the fixture is rebuilt",
      'it.skip("upstream", () => {});',
    ].join("\n");
    assert.deepEqual(flagged({ [SPEC]: { source, added: [1, 2] } }), []);
  });

  it("suppresses an it.fails with a pragma comment on the line above", () => {
    const source = [
      "// oracle-change: the series recurrence bug is documented in the oracle report",
      'it.fails("keeps the series id", () => {});',
    ].join("\n");
    assert.deepEqual(flagged({ [SPEC]: { source, added: [1, 2] } }), []);
  });

  it("does not use a pragma above the flagged line when that line is not added", () => {
    const source = [
      "// oracle-change: quarantined while the fixture is rebuilt",
      'it.skip("upstream", () => {});',
    ].join("\n");
    assert.deepEqual(flagged({ [SPEC]: { source, added: [2] } }), [
      `${SPEC}:2: disabled-test`,
    ]);
  });

  it("does not suppress with a reason shorter than ten characters", () => {
    const source = 'it.skip("flaky", () => {}); // oracle-change: flaky';
    const violations = findOracleLoosening({
      root: ROOT,
      added: new Map([[at(SPEC), changedFile(SPEC, source, [1])]]),
      removed: new Map(),
      assertionSources: new Map(),
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "disabled-test");
    assert.match(violations[0].message, /shorter than 10 characters/);
  });

  it("suppresses retry and passWithNoTests flags with a reason", () => {
    const source = [
      "// oracle-change: CI runner flakes on cold browser start",
      "retry: 2,",
    ].join("\n");
    assert.deepEqual(
      flagged({ "vitest.config.ts": { source, added: [1, 2] } }),
      [],
    );
  });

  it("accepts a pragma written as a block comment", () => {
    const source = [
      "/* oracle-change: the assertion moved into the shared helper */",
      'it.skip("moved", () => {});',
    ].join("\n");
    assert.deepEqual(flagged({ [SPEC]: { source, added: [1, 2] } }), []);
  });

  it("does not accept the pragma text from a string or template literal", () => {
    const source = [
      'const note = "// oracle-change: fixture text, not a reason";',
      "const tpl = `/* oracle-change: also only text */`;",
      'it.skip("x", () => {}); const s = "// oracle-change: still a string";',
    ].join("\n");
    assert.deepEqual(flagged({ [SPEC]: { source, added: [1, 2, 3] } }), [
      `${SPEC}:3: disabled-test`,
    ]);
  });
});

describe("assertions-removed", () => {
  it("flags a spec that drops two expect lines and adds a skip, with exactly those violations", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      "index 1111111..2222222 100644",
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -10,2 +10,1 @@",
      "-  expect(result.status).toBe(200);",
      '-  expect(result.body.id).toBe("msg_1");',
      '+  it.skip("sends the message", async () => {',
    ].join("\n");
    const lines = Array.from(
      { length: 9 },
      (_, index) => `// line ${index + 1}`,
    );
    const source = [
      ...lines,
      '  it.skip("sends the message", async () => {',
      "  });",
    ].join("\n");
    const base = [
      ...lines,
      "  expect(result.status).toBe(200);",
      '  expect(result.body.id).toBe("msg_1");',
      "  });",
    ].join("\n");

    assert.deepEqual(
      flagged({ [SPEC]: { source, added: [10] } }, diff, { [SPEC]: base }),
      [`${SPEC}:10: disabled-test`, `${SPEC}:10: assertions-removed`],
    );
  });

  it("counts calls, not lines: one line that loses one of two assertions is flagged", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -3 +3 @@",
      "-  expect(a).toBe(1); expect(b).toBe(2);",
      "+  expect(a).toBe(1);",
    ].join("\n");
    const base = "\n\n  expect(a).toBe(1); expect(b).toBe(2);";
    const source = "\n\n  expect(a).toBe(1);";

    assert.deepEqual(
      flagged({ [SPEC]: { source, added: [3] } }, diff, { [SPEC]: base }),
      [`${SPEC}:3: assertions-removed`],
    );
  });

  it("does not flag a file that moves an assertion to another line and keeps the count", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -2 +1,0 @@",
      "-  expect(b).toBe(2);",
      "@@ -4,0 +4 @@",
      "+  expect(c).toBe(3);",
    ].join("\n");
    const base = "  expect(a).toBe(1);\n  expect(b).toBe(2);\n// kept";
    const source = "  expect(a).toBe(1);\n// kept\n\n  expect(c).toBe(3);";

    assert.deepEqual(
      flagged({ [SPEC]: { source, added: [4] } }, diff, { [SPEC]: base }),
      [],
    );
  });

  it("does not count expect( inside a string or a comment as an assertion", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -1,2 +0,0 @@",
      '-const s = "expect(x)";',
      "-// expect(y)",
    ].join("\n");
    const base = 'const s = "expect(x)";\n// expect(y)';

    assert.deepEqual(
      flagged({ [SPEC]: { source: "", added: [] } }, diff, { [SPEC]: base }),
      [],
    );
  });

  it("counts expect.soft and assert.x calls and reports the call count", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -1,2 +0,0 @@",
      "-  expect.soft(a).toBe(1);",
      "-  assert.strictEqual(b, 2);",
    ].join("\n");
    const base = "  expect.soft(a).toBe(1);\n  assert.strictEqual(b, 2);";

    assert.deepEqual(
      findViolations({ [SPEC]: { source: "", added: [] } }, diff, {
        [SPEC]: base,
      }).map((violation) => violation.message),
      ["removed 2 assertion call(s): 2 before, 0 now"],
    );
  });

  it("counts an assertion written through an aliased expect import", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -2 +1,0 @@",
      "-check(value).toBe(1);",
    ].join("\n");
    const base = `import { expect as check } from "${VITEST}";\ncheck(value).toBe(1);`;
    const source = `import { expect as check } from "${VITEST}";\n// kept`;

    assert.deepEqual(
      findViolations({ [SPEC]: { source, added: [] } }, diff, {
        [SPEC]: base,
      }).map((violation) => violation.message),
      ["removed 1 assertion call(s): 1 before, 0 now"],
    );
    assert.deepEqual(
      flagged({ [SPEC]: { source, added: [] } }, diff, { [SPEC]: base }),
      [`${SPEC}:1: assertions-removed`],
    );
  });

  it("counts assert and namespace-imported assertions, and ignores aliases from other modules", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -4,4 +3,0 @@",
      "-assert.equal(a, 1);",
      "-strict.ok(b);",
      "-v.expect(c).toBe(3);",
      "-v.expect.soft(d).toBe(4);",
    ].join("\n");
    const base = [
      'import assert from "node:assert";',
      'import * as strict from "node:assert/strict";',
      `import * as v from "${VITEST}";`,
      "assert.equal(a, 1);",
      "strict.ok(b);",
      "v.expect(c).toBe(3);",
      "v.expect.soft(d).toBe(4);",
    ].join("\n");
    const source = base.split("\n").slice(0, 3).join("\n");

    assert.deepEqual(
      findViolations({ [SPEC]: { source, added: [] } }, diff, {
        [SPEC]: base,
      }).map((violation) => violation.message),
      ["removed 4 assertion call(s): 4 before, 0 now"],
    );

    const otherDiff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -2 +1,0 @@",
      "-check(value).toBe(1);",
    ].join("\n");
    const otherBase = [
      'import { expect as check } from "./helpers";',
      "check(value).toBe(1);",
    ].join("\n");
    assert.deepEqual(
      flagged(
        {
          [SPEC]: {
            source: 'import { expect as check } from "./helpers";',
            added: [],
          },
        },
        otherDiff,
        { [SPEC]: otherBase },
      ),
      [],
    );
  });

  it("does not flag a file that is new on this branch", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${SPEC}`,
      "@@ -0,0 +1,2 @@",
      "+  expect(a).toBe(1);",
      "+  expect(b).toBe(2);",
    ].join("\n");
    const source = "  expect(a).toBe(1);\n  expect(b).toBe(2);";

    assert.deepEqual(flagged({ [SPEC]: { source, added: [1, 2] } }, diff), []);
  });

  it("does not flag a rename whose assertion count is unchanged", () => {
    const diff = [
      "diff --git a/templates/mail/actions/old-name.spec.ts b/templates/mail/actions/new-name.spec.ts",
      "similarity index 90%",
      "rename from templates/mail/actions/old-name.spec.ts",
      "rename to templates/mail/actions/new-name.spec.ts",
      "index 1111111..2222222 100644",
      "--- a/templates/mail/actions/old-name.spec.ts",
      "+++ b/templates/mail/actions/new-name.spec.ts",
      "@@ -4 +4 @@",
      "-  expect(result.status).toBe(201);",
      "+  expect(response.status).toBe(201);",
    ].join("\n");
    const source = "\n\n\n  expect(response.status).toBe(201);";

    assert.deepEqual(
      flagged(
        {
          "templates/mail/actions/new-name.spec.ts": {
            source,
            added: [4],
          },
        },
        diff,
        {
          "templates/mail/actions/old-name.spec.ts":
            "\n\n\n  expect(result.status).toBe(201);",
        },
      ),
      [],
    );
  });

  it("flags a rename that also removed assertions, under the new path", () => {
    const diff = [
      "diff --git a/templates/mail/actions/old-name.spec.ts b/templates/mail/actions/new-name.spec.ts",
      "similarity index 80%",
      "rename from templates/mail/actions/old-name.spec.ts",
      "rename to templates/mail/actions/new-name.spec.ts",
      "--- a/templates/mail/actions/old-name.spec.ts",
      "+++ b/templates/mail/actions/new-name.spec.ts",
      "@@ -4,2 +4,0 @@",
      "-  expect(result.status).toBe(201);",
      "-  expect(result.body).toBeDefined();",
    ].join("\n");

    assert.deepEqual(
      flagged(
        {
          "templates/mail/actions/new-name.spec.ts": {
            source: "// kept",
            added: [],
          },
        },
        diff,
        {
          "templates/mail/actions/old-name.spec.ts":
            "\n\n\n  expect(result.status).toBe(201);\n  expect(result.body).toBeDefined();",
        },
      ),
      ["templates/mail/actions/new-name.spec.ts:4: assertions-removed"],
    );
  });

  it("counts every removed assertion call in a deleted test file", () => {
    const gone = "templates/mail/actions/gone.spec.ts";
    const diff = [
      `diff --git a/${gone} b/${gone}`,
      "deleted file mode 100644",
      `--- a/${gone}`,
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-  expect(a).toBe(1);",
      "-  assert.ok(b);",
    ].join("\n");

    assert.deepEqual(
      flagged({}, diff, { [gone]: "  expect(a).toBe(1);\n  assert.ok(b);" }),
      [`${gone}:1: assertions-removed`],
    );
  });

  it("accepts a deleted file's pragma on any added line in the diff", () => {
    const gone = "templates/mail/actions/gone.spec.ts";
    const diff = [
      `diff --git a/${gone} b/${gone}`,
      "deleted file mode 100644",
      `--- a/${gone}`,
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-  expect(a).toBe(1);",
    ].join("\n");

    assert.deepEqual(
      flagged(
        {
          "templates/mail/actions/index.ts": {
            source:
              "// oracle-change(templates/mail/actions/gone.spec.ts): endpoint removed with its tests",
            added: [1],
          },
        },
        diff,
        { [gone]: "  expect(a).toBe(1);" },
      ),
      [],
    );
  });

  it("accepts an assertions-removed pragma on any added line in the file", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -3,1 +3,1 @@",
      "-  expect(result.status).toBe(200);",
      "+  // oracle-change: the status check moved into the contract test",
    ].join("\n");

    assert.deepEqual(
      flagged(
        {
          [SPEC]: {
            source: [
              "describe('send', () => {",
              "  it('sends', () => {",
              "  // oracle-change: the status check moved into the contract test",
            ].join("\n"),
            added: [3],
          },
        },
        diff,
        { [SPEC]: "\n\n  expect(result.status).toBe(200);" },
      ),
      [],
    );
  });

  it("keeps a removed line that starts with -- as content, not a file header", () => {
    const diff = [
      `diff --git a/${SPEC} b/${SPEC}`,
      `--- a/${SPEC}`,
      `+++ b/${SPEC}`,
      "@@ -1,2 +1,0 @@",
      "--- old note about the status check",
      "-  expect(result.status).toBe(200);",
    ].join("\n");
    const removed = parseRemovedLines(diff, ROOT);
    assert.deepEqual(
      removed?.get(at(SPEC))?.lines.map((line: { text: string }) => line.text),
      [
        "-- old note about the status check",
        "  expect(result.status).toBe(200);",
      ],
    );
  });
});

describe("guard command", () => {
  it("exits 2, not 0, when it cannot determine the added lines", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(import.meta.dirname, "guard-no-oracle-loosening.ts"),
      ],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          GUARD_DIFF_BASE: "origin/branch-that-does-not-exist-for-this-test",
        },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /could not determine which lines/);
  });
});
