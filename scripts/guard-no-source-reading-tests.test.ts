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

test("does not flag ?raw imports of fixtures", () => {
  assert.deepEqual(
    flagged(`
import example from "./fixtures/Example.tsx?raw";
import snap from "./__snapshots__/Card.ts?raw";
const lazy = (await import("./__fixtures__/Lazy.tsx?raw")).default;
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

test("flags a read when any alternative path is a real source file", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
for (const file of ["src/Editor.tsx", "fixtures/sample.tsx"]) {
  readFileSync(path.join(__dirname, file), "utf8");
}
`),
    [5],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const target = process.env.CI ? "fixtures/sample.ts" : "src/Editor.ts";
readFileSync(target, "utf8");
`),
    [4],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const targets = [path.join(os.tmpdir(), "gen.ts"), "src/a.ts"];
for (const file of targets) readFileSync(file, "utf8");
`),
    [6],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
it.each([["a", "fixtures/a.tsx"], ["b", "src/b.tsx"]])("%s", (_name, file) => {
  readFileSync(path.join(__dirname, file), "utf8");
});
`),
    [5],
  );
});

test("a scratch directory assigned over an empty placeholder stays temp", () => {
  assert.deepEqual(
    flagged(`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
let rootPath = "";
beforeAll(() => {
  rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "work-"));
});
it("reads what the build wrote", () => {
  fs.readFileSync(path.join(rootPath, "src", "App.tsx"), "utf8");
});
`),
    [],
  );
});

test("does not flag a read when every alternative path is a fixture or non-source", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
for (const file of ["fixtures/a.tsx", "__fixtures__/b.tsx"]) {
  readFileSync(path.join(__dirname, file), "utf8");
}
`),
    [],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
for (const file of ["data.json", "fixtures/sample.tsx"]) {
  readFileSync(path.join(__dirname, file), "utf8");
}
`),
    [],
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

test("does not flag a read of a literal temp path", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
readFileSync("/tmp/generated.ts", "utf8");
readFileSync("/var/tmp/generated.ts", "utf8");
readFileSync("/var/folders/ab/cd/T/generated.ts", "utf8");
readFileSync("/private/var/folders/ab/cd/T/generated.ts", "utf8");
`),
    [],
  );
  assert.deepEqual(
    flagged(String.raw`
import { readFileSync } from "node:fs";
readFileSync("C:\\Users\\x\\AppData\\Local\\Temp\\gen.ts", "utf8");
readFileSync("c:/users/x/appdata/local/temp/gen.ts", "utf8");
readFileSync("C:\\Temp\\gen.ts", "utf8");
`),
    [],
  );
  // A temp root joined to a source file name is still temp output.
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import path from "node:path";
readFileSync(path.join("/tmp", "generated.ts"), "utf8");
const out = "/tmp/out";
readFileSync(out + "/generated.ts", "utf8");
`),
    [],
  );
});

test("a temp-looking literal inside the repo is still flagged", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
readFileSync("src/tmp/Editor.ts", "utf8");
readFileSync("tmp.ts", "utf8");
readFileSync("packages/temp/Editor.ts", "utf8");
`),
    [3, 4, 5],
  );
});

test("does not flag a read with a null or undefined encoding", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
readFileSync("src/a.ts", { encoding: null });
readFileSync("src/a.ts", { encoding: undefined });
readFileSync("src/a.ts", { encoding: null, flag: "r" });
await readFile("src/a.ts", { encoding: undefined });
`),
    [],
  );
});

test("flags a read whose encoding is any other value", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const encoding = "utf8";
readFileSync("src/a.ts", { encoding: "utf8" });
readFileSync("src/a.ts", { encoding });
readFileSync("src/a.ts", { encoding: encoding });
readFileSync("src/a.ts", { ...options });
`),
    [4, 5, 6, 7],
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
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
const text = String(readFileSync("src/a.ts"));
const awaited = String(await readFile("src/b.ts"));
`),
    [4, 5],
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

test("flags a read through an fs-named receiver the file does not declare", () => {
  assert.deepEqual(
    flagged(`
fs.readFileSync("src/a.ts", "utf8");
`),
    [2],
  );
  assert.deepEqual(
    flagged(`
const fs = require("node:fs");
fs.readFileSync("src/a.ts", "utf8");
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
fs.readFileSync("src/a.ts", "utf8");
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
import fs from "node:fs";
const alias = fs;
alias.readFileSync("src/a.ts", "utf8");
`),
    [4],
  );
  assert.deepEqual(
    flagged(`
let fs: typeof import("node:fs");
beforeAll(async () => {
  fs = await import("node:fs");
});
fs.readFileSync("src/a.ts", "utf8");
`),
    [6],
  );
});

test("flags a read through the fs module a dynamic import hands to .then", () => {
  assert.deepEqual(
    flagged(`
const source = await import("node:fs").then((fs) =>
  fs.readFileSync("src/a.ts", "utf8"),
);
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
const source = await import("node:fs").then(({ readFileSync }) =>
  readFileSync("src/a.ts", "utf8"),
);
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
const source = await loadFake().then((fs) =>
  fs.readFileSync("src/a.ts", "utf8"),
);
`),
    [],
  );
});

test("does not flag a read on a local mock that is only named fs", () => {
  assert.deepEqual(
    flagged(`
const fs = { readFileSync: vi.fn(() => "x") };
fs.readFileSync("./Editor.tsx", "utf8");
`),
    [],
  );
  assert.deepEqual(
    flagged(`
function run(fs: FakeFs) {
  return fs.readFileSync("./Editor.tsx", "utf8");
}
`),
    [],
  );
  assert.deepEqual(
    flagged(`
const run = ({ fs }: { fs: FakeFs }) => fs.readFileSync("./Editor.tsx", "utf8");
`),
    [],
  );
  assert.deepEqual(
    flagged(`
function fsp() {}
fsp.readFile("./Editor.tsx", "utf8");
`),
    [],
  );
  assert.deepEqual(
    flagged(`
class FS {}
const fakeFs = new FS();
for (const fs of [fakeFs]) fs.readFileSync("./Editor.tsx", "utf8");
`),
    [],
  );
  assert.deepEqual(
    flagged(`
import { fs } from "memfs";
fs.readFileSync("./Editor.tsx", "utf8");
`),
    [],
  );
  assert.deepEqual(
    flagged(`
import fs from "./fake-fs";
fs.readFileSync("./Editor.tsx", "utf8");
`),
    [],
  );
  assert.deepEqual(
    flagged(`
const { fs } = makeSandbox();
await fs.promises.readFile("./Editor.tsx", "utf8");
`),
    [],
  );
});

test("does not flag a bare readFileSync the file defines itself", () => {
  assert.deepEqual(
    flagged(`
function readFileSync(file: string) { return fixtures[file]; }
readFileSync("./Editor.tsx", "utf8");
`),
    [],
  );
  assert.deepEqual(
    flagged(`
function check(readFileSync: (file: string, enc: string) => string) {
  return readFileSync("./Editor.tsx", "utf8");
}
`),
    [],
  );
  assert.deepEqual(
    flagged(`
const readFileSync = vi.fn(() => "x");
readFileSync("./Editor.tsx", "utf8");
`),
    [],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "./helpers";
readFileSync("./Editor.tsx", "utf8");
`),
    [],
  );
});

test("flags a bare readFileSync that is imported from fs or not declared", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
readFileSync("./Editor.tsx", "utf8");
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
const { readFileSync } = require("node:fs");
readFileSync("./Editor.tsx", "utf8");
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
readFileSync("./Editor.tsx", "utf8");
`),
    [2],
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

test("a pragma anywhere in the comment block directly above allows the read", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
// The barrel is generated, so its text is the contract.
// source-read-ok: generated barrel must list every module
// (regenerate with pnpm gen:barrel)
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

test("pragma text inside a string, template or regex is not a pragma", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const a = readFileSync("src/a.ts", "utf8"); const note = "// source-read-ok: nope";
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const note = "/* source-read-ok: nope */"; readFileSync("src/a.ts", "utf8");
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const doc = \`intro
// source-read-ok: nope\`;
const a = readFileSync("src/a.ts", "utf8");
`),
    [5],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const a = readFileSync(
  "src/a.ts", // not a pragma, and the call spans lines
  "// source-read-ok: nope",
);
`),
    [3],
  );
  assert.deepEqual(
    flagged(
      `
import { readFileSync } from "node:fs";
const el = <p>// source-read-ok: nope</p>; readFileSync("src/a.ts", "utf8");
`,
      "app/Editor.test.tsx",
    ),
    [3],
  );
});

test("a real pragma comment still counts after a string that looks like one", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const note = "// source-read-ok: nope"; readFileSync("src/a.ts", "utf8"); // source-read-ok: real reason
const re = /\\/\\//; readFileSync("src/b.ts", "utf8"); // source-read-ok: after a regex with slashes
const t = \`\${1}\`; readFileSync("src/c.ts", "utf8"); /* source-read-ok: block comment after a template */
`),
    [],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
/* source-read-ok: block comment above */
const a = readFileSync("src/a.ts", "utf8");
`),
    [],
  );
});

test("an empty block-comment pragma followed by code does not allow the read", () => {
  const source = `
import { readFileSync } from "node:fs";
/* source-read-ok: */ const a = readFileSync("src/a.ts", "utf8");
`;
  assert.deepEqual(flagged(source), [3]);
  assert.match(reasons(source)[0]!, /pragma needs a reason/u);
});

test("a pragma inside a multi-line read does not allow it", () => {
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const a = readFileSync(
  "src/a.ts", // source-read-ok: not the read line
  "utf8",
);
`),
    [3],
  );
  assert.deepEqual(
    flagged(`
import { readFileSync } from "node:fs";
const a = readFileSync( // source-read-ok: on the read line
  "src/a.ts",
  "utf8",
);
`),
    [],
  );
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

function flaggedWhenAdded(source: string, added: number[]): number[] {
  return findSourceReadViolations(TEST_PATH, source, new Set(added)).map(
    (found) => found.line,
  );
}

test("a read is reported when the line naming its source file was added", () => {
  const source = `
import { readFileSync } from "node:fs";
import path from "node:path";
const EDITOR = "src/Editor.tsx";
const rows = [["editor", "src/Editor.tsx"], ["data", "data.json"]];
const a = readFileSync(path.join(__dirname, EDITOR), "utf8");
for (const [, file] of rows) readFileSync(path.join(__dirname, file), "utf8");
const read = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");
const PANEL = "src/Panel.tsx";
read(PANEL);
`;
  assert.deepEqual(flaggedWhenAdded(source, [4]), [6]);
  assert.deepEqual(flaggedWhenAdded(source, [5]), [7]);
  assert.deepEqual(flaggedWhenAdded(source, [9]), [10]);
});

test("an added line the read depends on that names no source file is not enough", () => {
  const source = `
import { readFileSync } from "node:fs";
import path from "node:path";
const ROOT = path.resolve(__dirname, "..");
const a = readFileSync(path.join(ROOT, "src/a.ts"), "utf8");
`;
  assert.deepEqual(flaggedWhenAdded(source, [4]), []);
  assert.deepEqual(flaggedWhenAdded(source, [5]), [5]);
});

test("a read is reported when the line turning it into text was added", () => {
  const source = `
import { readFileSync } from "node:fs";
const a = readFileSync("src/a.ts")
  .toString();
`;
  assert.deepEqual(flaggedWhenAdded(source, [4]), [3]);
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
