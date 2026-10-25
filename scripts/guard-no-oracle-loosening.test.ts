import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findDisabledTests,
  findOracleLoosening,
  isTestFile,
  type ChangedFile,
} from "./guard-no-oracle-loosening.js";
import { parseRemovedLines } from "./lib/changed-lines.mjs";

const ROOT = "/repo";

function at(rel: string) {
  return path.resolve(ROOT, rel);
}

function changedFile(source: string, added: number[]): ChangedFile {
  return { source: source.split("\n"), added: new Set(added) };
}

/** Runs the pure check and reports each violation as `path:line: rule`. */
function flagged(
  files: Record<string, { source: string; added: number[] }>,
  diff = "",
): string[] {
  const added = new Map(
    Object.entries(files).map(([rel, file]) => [
      at(rel),
      changedFile(file.source, file.added),
    ]),
  );
  const removed = parseRemovedLines(diff, ROOT) ?? new Map();
  return findOracleLoosening({ root: ROOT, added, removed }).map(
    (violation) => `${violation.file}:${violation.line}: ${violation.rule}`,
  );
}

function allLines(source: string): number[] {
  return source.split("\n").map((_, index) => index + 1);
}

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
    const added = new Map([[at(SPEC), changedFile(source, [1])]]);
    const violations = findOracleLoosening({
      root: ROOT,
      added,
      removed: new Map(),
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
    const source = [
      ...Array.from({ length: 9 }, (_, index) => `// line ${index + 1}`),
      '  it.skip("sends the message", async () => {',
      "  });",
    ].join("\n");

    assert.deepEqual(flagged({ [SPEC]: { source, added: [10] } }, diff), [
      `${SPEC}:10: disabled-test`,
      `${SPEC}:10: assertions-removed`,
    ]);
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
      ),
      ["templates/mail/actions/new-name.spec.ts:4: assertions-removed"],
    );
  });

  it("counts every removed assertion in a deleted test file", () => {
    const diff = [
      "diff --git a/templates/mail/actions/gone.spec.ts b/templates/mail/actions/gone.spec.ts",
      "deleted file mode 100644",
      "--- a/templates/mail/actions/gone.spec.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-  expect(a).toBe(1);",
      "-  assert.ok(b);",
    ].join("\n");

    assert.deepEqual(flagged({}, diff), [
      "templates/mail/actions/gone.spec.ts:1: assertions-removed",
    ]);
  });

  it("accepts a deleted file's pragma on any added line in the diff", () => {
    const diff = [
      "diff --git a/templates/mail/actions/gone.spec.ts b/templates/mail/actions/gone.spec.ts",
      "deleted file mode 100644",
      "--- a/templates/mail/actions/gone.spec.ts",
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
