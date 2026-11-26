import assert from "node:assert/strict";
import { test } from "node:test";

import { findNewProseComments } from "./guard-new-prose-comments.ts";

const allLines = (text: string) =>
  new Set(text.split("\n").map((_, index) => index + 1));
const lines = (
  text: string,
  publicApi = false,
  file = "scripts/example.ts",
  added = allLines(text),
) =>
  findNewProseComments(file, text, added, publicApi).map(
    (finding) => finding.line,
  );

test("rejects added leading, trailing, block, JSX, and EOF prose comments", () => {
  assert.deepEqual(
    lines(
      [
        "// Narrates the next line.",
        "const value = 1; // Stores a value.",
        "/* Explains this change. */",
        "const view = <div>{/* Narration inside JSX. */}</div>;",
        "// Final explanation.",
      ].join("\n"),
      false,
      "templates/chat/app/example.tsx",
    ),
    [1, 2, 3, 4, 5],
  );
});

test("reads syntax rather than comment markers in strings, regexes, templates, or JSX text", () => {
  assert.deepEqual(
    lines(
      [
        "const url = 'https://example.test/*path*/';",
        "const pattern = /https?:\\/\\/[^/]+/;",
        "const template = `// text ${value /* actual comment */} /* text */`;",
        "const view = <div>// text /* text */</div>;",
      ].join("\n"),
      false,
      "example.tsx",
    ),
    [3],
  );
});

test("checks only touched comment ranges, including edits inside an existing block", () => {
  const text =
    "// Old debt\n/*\n * changed explanation\n */\nconst x = 1; // Existing prose\n";
  assert.deepEqual(lines(text, false, "x.ts", new Set([3])), [2]);
  assert.deepEqual(lines(text, false, "x.ts", new Set([6])), []);
});

test("permits functional directives and legal notices", () => {
  const text = [
    "#!/usr/bin/env node",
    "// SPDX-License-Identifier: MIT",
    "/*! Copyright 2026 Example contributors.\n * Licensed under the MIT license. */",
    "// oxlint-disable-next-line typescript/no-floating-promises -- owned background operation",
    "// @ts-expect-error -- checks an invalid input",
    "// oxfmt-ignore",
    "/* @__PURE__ */ factory();",
    '/// <reference types="node" />',
    "// source-read-ok: this fixture is the parser input contract",
    "// fixed-sleep-ok: this test measures the timer being exercised",
    "// oracle-change(packages/example/old.spec.ts): the spec was deleted with its feature",
    "// guard:allow-unbounded-read — frozen catalog read once at boot",
    "//# sourceMappingURL=example.js.map",
  ].join("\n");
  assert.deepEqual(lines(text), []);
});

test("does not turn a vague marker or a directive plus a prose paragraph into an exception", () => {
  assert.deepEqual(
    lines(
      [
        "// WARNING: The caller owns the lock until the write settles.",
        "/* WARNING: This is a multiline prose workaround. */",
        "// arbitrary-ok: this is an invented prose bypass",
        "// guard:allow-extra-narration — this is an invented guard bypass",
        "/* @__PURE__\n * Explains the implementation. */",
        "// This mentions SPDX-License-Identifier: MIT but is prose.",
        "/* oxlint-disable\n * Explains the implementation. */",
      ].join("\n"),
    ),
    [1, 2, 3, 4, 5, 7, 8],
  );
});

test("allows public API TSDoc on exports and public members but rejects implementation and private docs", () => {
  const text = [
    "/** Public operation. */",
    "export function run() {",
    "  /** Local helper. */",
    "  function helper() {}",
    "}",
    "/** Public options. */",
    "export interface Options {",
    "  /** The request id. */",
    "  id: string;",
    "}",
    "/** Public client. */",
    "export class Client {",
    "  /** Send a request. */",
    "  send() {}",
    "  /** Private helper. */",
    "  private helper() {}",
    "  /** @internal Internal operation. */",
    "  internal() {}",
    "}",
    "/** Exported later. */",
    "function later() {}",
    "export { later };",
  ].join("\n");
  assert.deepEqual(lines(text, true), [3, 15, 17]);
  assert.deepEqual(
    lines("/** Internal app export. */\nexport const value = 1;"),
    [1],
  );
});

test("permits ambient declaration API docs and excludes generated/vendor rather than all templates or tests", () => {
  assert.deepEqual(
    lines(
      "/** Public ambient API. */\ndeclare function api(): void;",
      true,
      "packages/sdk/src/api.d.ts",
    ),
    [],
  );
  for (const file of [
    "vendor/tool.ts",
    "packages/sdk/dist/api.js",
    "x.generated.ts",
    "src/.generated/api.ts",
    "node_modules/pkg/api.ts",
  ]) {
    assert.deepEqual(lines("// Generated description", false, file), []);
  }
  assert.deepEqual(
    lines(
      "// Generated from the upstream schema.\n// Generator output",
      false,
      "src/schema.ts",
    ),
    [],
  );
  assert.deepEqual(
    lines(
      "// Handwritten test prose",
      false,
      "templates/chat/e2e/example.spec.ts",
    ),
    [1],
  );
  assert.deepEqual(
    lines(
      "// Handwritten route prose",
      false,
      "templates/slides/server/routes/api/generated/[...].get.ts",
    ),
    [1],
  );
});

test("keeps reporting prose when generated markers appear outside the file header", () => {
  assert.deepEqual(
    lines(
      [
        "// Handwritten header.",
        "// @generated in a secondary comment.",
        'export const marker = "@generated";',
        "// @generated after a statement.",
      ].join("\n"),
    ),
    [1, 2, 4],
  );
});

test("keeps referenced signature types public while internal container docs stay private", () => {
  assert.deepEqual(
    lines(
      [
        "/** Request contract. */",
        "interface Request {",
        "  /** Nested options. */",
        "  options: {",
        "    /** Unique id. */",
        "    id: string;",
        "  };",
        "}",
        "export function run(request: Request) {}",
        "/** @internal Internal class. */",
        "export class Internal {",
        "  /** Internal member. */",
        "  run() {}",
        "}",
      ].join("\n"),
      true,
    ),
    [10, 12],
  );
});

test("unreadable syntax is a failure instead of a clean comment inventory", () => {
  assert.throws(
    () => lines("const = ; // prose"),
    /Variable declaration expected/,
  );
});

await test("permits Vitest environment selectors without admitting attached prose", () => {
  for (const text of [
    "// @vitest-environment happy-dom",
    "/** @vitest-environment jsdom */",
  ])
    assert.deepEqual(lines(text, false, "example.spec.tsx"), []);
  assert.deepEqual(
    lines("// @vitest-environment happy-dom with an explanation"),
    [1],
  );
  assert.deepEqual(lines("// @vitest-environment"), [1]);
});
