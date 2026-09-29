import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  findSourceReadViolations,
  isTestFile,
} from "./lib/source-read-detector.mjs";

const TEST_PATH = "app/Editor.layout.test.ts";

function flagged(source: string, file = TEST_PATH): number[] {
  return findSourceReadViolations(file, source).map((found) => found.line);
}

function reasons(source: string, file = TEST_PATH): string[] {
  return findSourceReadViolations(file, source).map((found) => found.reason);
}

test("flags readFileSync with a string literal path to a .tsx file", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const source = readFileSync("app/Editor.tsx", "utf8");
`),
    [3],
  );
});

test("flags every source extension the repo compiles", () => {
  for (const ext of ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]) {
    assert.equal(
      flagged(`
import { readFileSync } from "node:fs";
readFileSync("src/thing.${ext}", "utf8");
`).length,
      1,
      ext,
    );
  }
});

test("flags a read built with path.join and __dirname", () => {
  assert.deepEqual(
    flagged(`
import fs from "node:fs";
import path from "node:path";
const source = fs.readFileSync(path.join(__dirname, "Editor.tsx"), "utf8");
`),
    [4],
  );
});

test("flags path.resolve and a multi-line call, at the line the read starts", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const source = readFileSync(
  resolve(__dirname, "..", "components", "Editor.tsx"),
  "utf8",
);
`),
    [4],
  );
});

test("flags a read of new URL(..., import.meta.url)", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./Editor.tsx", import.meta.url), "utf8");
`),
    [3],
  );
});

test("flags fileURLToPath(new URL(...)) and the promises API", () => {
  assert.deepEqual(
    flagged(`
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const a = await readFile(fileURLToPath(new URL("./a.ts", import.meta.url)), "utf8");
const b = await readFile(new URL("./b.ts", import.meta.url), { encoding: "utf8" });
`),
    [4, 5],
  );
  assert.deepEqual(
    flagged(`
import fs from "node:fs";
const source = await fs.promises.readFile("src/a.ts", "utf8");
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
import * as fsp from "node:fs/promises";
const source = await fsp.readFile("src/a.ts", "utf8");
`),
    [3],
  );
});

test("flags a read through an aliased fs import", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync as read } from "node:fs";
const source = read("src/a.ts", "utf8");
`),
    [3],
  );
});

test("flags a ?raw import of a source module", () => {
  assert.deepEqual(
    flagged(`
import source from "./Editor.tsx?raw";
`),
    [2],
  );
  assert.deepEqual(
    flagged(`
const source = (await import("./Editor.ts?raw")).default;
`),
    [2],
  );
});

test("does not flag ?raw imports of non-source files", () => {
  assert.deepEqual(
    flagged(`
import css from "./editor.css?raw";
import md from "./notes.md?raw";
import html from "./page.html?raw";
`),
    [],
  );
});

test("flags a read whose path is a const declared on a nearby line", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
const FILE = path.join(__dirname, "Editor.tsx");
const source = readFileSync(FILE, "utf8");
`),
    [5],
  );
});

test("flags a read whose path is an object property or loop variable", () => {
  assert.equal(
    flagged(`
import { readFileSync } from "node:fs";
const targets = { editor: "src/Editor.tsx" };
const source = readFileSync(targets.editor, "utf8");
`).length,
    1,
  );
  assert.equal(
    flagged(`
import { readFileSync } from "node:fs";
for (const file of ["src/a.ts", "src/b.ts"]) {
  const source = readFileSync(file, "utf8");
}
`).length,
    1,
  );
});

test("flags a call to a same-file helper that reads source", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
const read = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");
const source = read("Editor.tsx");
const styles = read("editor.css");
`),
    [5],
  );
});

test("does not flag a helper that is only handed non-source or temp paths", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
const read = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");
const pkg = read("package.json");
const doc = read("README.md");
`),
    [],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
const read = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");
const dir = makeTempDir();
const out = read(path.join(dir, "generated.ts"));
`),
    [],
  );
});

test("does not flag json, yaml, md, html, css, sql, txt or snapshot reads", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
readFileSync(path.join(__dirname, "package.json"), "utf8");
readFileSync(path.join(__dirname, "config.yaml"), "utf8");
readFileSync(path.join(__dirname, "config.yml"), "utf8");
readFileSync(path.join(__dirname, "README.md"), "utf8");
readFileSync(path.join(__dirname, "index.html"), "utf8");
readFileSync(path.join(__dirname, "global.css"), "utf8");
readFileSync(path.join(__dirname, "schema.sql"), "utf8");
readFileSync(path.join(__dirname, "notes.txt"), "utf8");
readFileSync(path.join(__dirname, "__snapshots__", "Editor.snap"), "utf8");
readFileSync(new URL("./data.json", import.meta.url), "utf8");
`),
    [],
  );
});

test("does not flag a source-extension file that lives in a fixtures directory", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
readFileSync(path.join(__dirname, "fixtures", "sample.ts"), "utf8");
readFileSync(path.join(__dirname, "__fixtures__/sample.tsx"), "utf8");
readFileSync(path.join(__dirname, "test-fixtures", "sample.tsx"), "utf8");
`),
    [],
  );
});

test("does not flag a read of output the test generated in a temp directory", () => {
  assert.deepEqual(
    flagged(`
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(os.tmpdir(), "gen-"));
const generated = readFileSync(path.join(dir, "server.mjs"), "utf8");
`),
    [],
  );
});

test("does not flag a read that yields a Buffer instead of text", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const bytes = readFileSync("src/a.ts");
`),
    [],
  );
});

test("flags a Buffer read that is turned into a string on the spot", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const text = readFileSync("src/a.ts").toString();
`),
    [3],
  );
});

test("does not flag readFileSync on something that is not fs", () => {
  assert.deepEqual(
    flagged(`
const store = { readFileSync(_file: string, _enc: string) { return ""; } };
const value = store.readFileSync("src/a.ts", "utf8");
`),
    [],
  );
});

test("the pragma on the same line allows the read", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const source = readFileSync("src/a.ts", "utf8"); // source-read-ok: architecture boundary check
`),
    [],
  );
});

test("the pragma on the line above allows the read", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
// source-read-ok: the file is the subject, it is a workflow definition
const source = readFileSync("src/a.ts", "utf8");
`),
    [],
  );
});

test("a pragma at the top of a comment block above the read allows it", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
// source-read-ok: keeps the lazy import out of the eager bundle
// (see docs/perf.md for why this cannot be observed at runtime)
const source = readFileSync("src/a.ts", "utf8");
`),
    [],
  );
});

test("a block-comment pragma with a reason allows the read", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
/* source-read-ok: generated barrel must list every module */
const source = readFileSync("src/a.ts", "utf8");
`),
    [],
  );
});

test("a pragma with no reason does not allow the read", () => {
  const source = `
import { readFileSync } from "node:fs";
const source = readFileSync("src/a.ts", "utf8"); // source-read-ok:
`;
  assert.deepEqual(flagged(source), [3]);
  assert.match(reasons(source)[0]!, /pragma needs a reason/u);
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
// source-read-ok:
const source = readFileSync("src/a.ts", "utf8");
`),
    [4],
  );
});

test("a pragma two lines above, or on another statement, does not apply", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
// source-read-ok: this one is fine
const ok = readFileSync("src/a.ts", "utf8");

const notOk = readFileSync("src/b.ts", "utf8");
`),
    [6],
  );
});

test("a pragma works in a file with Windows line endings", () => {
  const source = [
    'import { readFileSync } from "node:fs";',
    "// source-read-ok: architecture check",
    'const a = readFileSync("src/a.ts", "utf8");',
    'const b = readFileSync("src/b.ts", "utf8"); // source-read-ok: same reason',
    'const c = readFileSync("src/c.ts", "utf8");',
  ].join("\r\n");
  assert.deepEqual(flagged(source), [5]);
});

test("only lines the branch added are reported", () => {
  const source = `
import { readFileSync } from "node:fs";
const old = readFileSync("src/old.ts", "utf8");
const added = readFileSync("src/new.ts", "utf8");
`;
  assert.deepEqual(flagged(source), [3, 4]);
  assert.deepEqual(
    findSourceReadViolations(TEST_PATH, source, new Set([4])).map(
      (found) => found.line,
    ),
    [4],
  );
  assert.deepEqual(
    findSourceReadViolations(TEST_PATH, source, new Set([2])),
    [],
  );
});

test("a multi-line read is reported when any of its lines was added", () => {
  const source = `
import { readFileSync } from "node:fs";
const source = readFileSync(
  "src/a.ts",
  "utf8",
);
`;
  assert.equal(
    findSourceReadViolations(TEST_PATH, source, new Set([4])).length,
    1,
  );
});

test("a violation carries the file, line, source text and a reason", () => {
  const [found] = findSourceReadViolations(
    TEST_PATH,
    `import { readFileSync } from "node:fs";
const source = readFileSync("src/a.ts", "utf8");
`,
  );
  assert.equal(found?.file, TEST_PATH);
  assert.equal(found?.line, 2);
  assert.match(found?.text ?? "", /readFileSync\("src\/a\.ts"/u);
  assert.match(found?.reason ?? "", /source file as text/u);
});

test("ignores files that are not tests", () => {
  const source = `
import { readFileSync } from "node:fs";
const source = readFileSync("src/a.ts", "utf8");
`;
  assert.deepEqual(
    findSourceReadViolations("scripts/build-thing.ts", source),
    [],
  );
  assert.deepEqual(findSourceReadViolations("app/Editor.tsx", source), []);
  assert.deepEqual(
    findSourceReadViolations("scripts/lib/util.mjs", source),
    [],
  );
});

test("recognizes test files by name and by __tests__ directory", () => {
  for (const file of [
    "a/b.test.ts",
    "a/b.test.tsx",
    "a/b.spec.ts",
    "a/b.spec.mjs",
    "a/b.integration.test.ts",
    "a/__tests__/helper.ts",
    "a\\b.test.ts",
  ]) {
    assert.equal(isTestFile(file), true, file);
  }
  for (const file of [
    "a/b.ts",
    "a/test-utils.ts",
    "a/b.test.md",
    "a/testing/helper.ts",
    "node_modules/x/b.test.ts",
    "packages/x/dist/b.test.js",
    "a/.tmp/b.test.ts",
  ]) {
    assert.equal(isTestFile(file), false, file);
  }
});

test("scans a test under __tests__ that has no .test suffix", () => {
  assert.deepEqual(
    flagged(
      `
import { readFileSync } from "node:fs";
readFileSync("src/a.ts", "utf8");
`,
      "parity/__tests__/notion.ts",
    ),
    [3],
  );
});

test("does not read strings or comments as code", () => {
  assert.deepEqual(
    flagged(`
// readFileSync("src/a.ts", "utf8")
const example = 'readFileSync("src/a.ts", "utf8")';
const other = \`import x from "./a.tsx?raw"\`;
`),
    [],
  );
});

test("a source that does not parse cleanly does not throw", () => {
  assert.doesNotThrow(() =>
    findSourceReadViolations(
      TEST_PATH,
      `import { readFileSync } from "node:fs"; const x = readFileSync("a.ts", ;`,
    ),
  );
});

const GUARD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "guard-no-source-reading-tests.mjs",
);

test("--help prints usage and the pragma, and exits 0", () => {
  const result = spawnSync(process.execPath, [GUARD, "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /source-read-ok/u);
  assert.match(result.stdout, /--all/u);
});

test("an unknown option exits 2 without scanning", () => {
  const result = spawnSync(process.execPath, [GUARD, "--nope"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option/u);
});
