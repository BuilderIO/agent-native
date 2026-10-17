import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  checkBoundary,
  findBoundaryBypasses,
  PROTECTED_MODULE,
} from "./guard-mcp-unredacted-call-boundary.js";

const OUTSIDER = "packages/core/src/mcp/some-adapter.ts";

function kinds(source: string, file = OUTSIDER) {
  return findBoundaryBypasses(file, source).map((finding) => finding.kind);
}

describe("unredacted MCP call boundary", () => {
  it("rejects a dynamic import of the module", () => {
    assert.deepEqual(
      kinds('const core = await import("./execute-action-call.js");'),
      ["dynamic import()"],
    );
    assert.deepEqual(kinds("await import(`./execute-action-call.ts`);"), [
      "dynamic import()",
    ]);
  });

  it("rejects require, import-equals and curried requires", () => {
    assert.deepEqual(
      kinds('const core = require("../mcp/execute-action-call");'),
      ["require()"],
    );
    assert.deepEqual(kinds('import core = require("./execute-action-call");'), [
      "import-equals require",
    ]);
    assert.deepEqual(
      kinds(
        'const core = createRequire(import.meta.url)("./execute-action-call.cjs");',
      ),
      ["call that loads the module by name"],
    );
    assert.deepEqual(
      kinds('const core = await vi.importActual("./execute-action-call.js");'),
      ["call that loads the module by name"],
    );
  });

  it("rejects a static import with a .ts specifier, an alias or a namespace", () => {
    assert.deepEqual(
      kinds(
        'import { runMcpActionCallUnredacted } from "./execute-action-call.ts";',
      ),
      ["named import of runMcpActionCallUnredacted"],
    );
    assert.deepEqual(
      kinds(
        'import { runMcpActionCallUnredacted as run } from "@agent-native/core/mcp/execute-action-call";',
      ),
      ["named import of runMcpActionCallUnredacted"],
    );
    assert.deepEqual(
      kinds('import * as core from "./execute-action-call.mts";'),
      ["namespace import"],
    );
  });

  it("rejects re-exports, even from build-server.ts", () => {
    assert.deepEqual(kinds('export * from "./execute-action-call.js";'), [
      "re-export of the whole module",
    ]);
    assert.deepEqual(
      kinds('export * as core from "./execute-action-call.js";'),
      ["re-export of the whole module"],
    );
    assert.deepEqual(
      kinds(
        'export { runMcpActionCallUnredacted } from "./execute-action-call.js";',
        "packages/core/src/mcp/build-server.ts",
      ),
      ["re-export of runMcpActionCallUnredacted"],
    );
  });

  it("rejects an allowed importer exporting what it imported", () => {
    const adapter = "packages/core/src/mcp/build-server.ts";
    const named =
      'import { runMcpActionCallUnredacted as raw } from "./execute-action-call.js";';
    const namespace = 'import * as core from "./execute-action-call.js";';
    const local = "local export of runMcpActionCallUnredacted";
    const holding = "exported value holding runMcpActionCallUnredacted";
    const cases: Array<[string, string, string]> = [
      [named, "export { raw };", local],
      [named, "export { raw as handler };", local],
      [named, "const again = raw;\nexport { again };", local],
      [
        named,
        "export default raw;",
        "default export of runMcpActionCallUnredacted",
      ],
      [named, "export const api = { raw };", holding],
      [named, "export const bound = raw.bind(null);", holding],
      [
        named,
        "module.exports = { run: raw };",
        "CommonJS export of runMcpActionCallUnredacted",
      ],
      [namespace, "export { core };", local],
      [
        namespace,
        "export const { runMcpActionCallUnredacted: run } = core;",
        holding,
      ],
      [
        namespace,
        "export const run = core.runMcpActionCallUnredacted;",
        holding,
      ],
    ];
    for (const [imported, exported, kind] of cases) {
      assert.deepEqual(
        kinds(`${imported}\n${exported}`, adapter),
        [kind],
        exported,
      );
    }
  });

  it("lets an allowed importer call it from exported code", () => {
    assert.deepEqual(
      kinds(
        [
          'import * as core from "./execute-action-call.js";',
          'import { runMcpActionCallUnredacted as raw, executeMcpActionCall } from "./execute-action-call.js";',
          "const local = raw;",
          "export async function handle() { return local(); }",
          "export const execute = core.executeMcpActionCall;",
          "export { executeMcpActionCall };",
        ].join("\n"),
        "packages/core/src/mcp/build-server.ts",
      ),
      [],
    );
  });

  it("reads the module name through string escapes", () => {
    for (const specifier of [
      String.raw`./execute\u002daction-call.js`,
      String.raw`./execute\x2daction-call.js`,
      String.raw`./execute\u{00002d}action-call.js`,
      String.raw`./execute\-action-call.js`,
      "./execute-\\\naction-call.js",
    ]) {
      assert.deepEqual(
        kinds(`await import("${specifier}");`),
        ["dynamic import()"],
        specifier,
      );
    }
  });

  it("allows the redacted entry point, types, and the direct adapter", () => {
    assert.deepEqual(
      kinds(
        [
          'import { executeMcpActionCall, type McpActionCallOutcome } from "./execute-action-call.js";',
          'import type { runMcpActionCallUnredacted } from "./execute-action-call.js";',
          'import { type runMcpActionCallUnredacted as T } from "./execute-action-call.js";',
          'export { executeMcpActionCall } from "./execute-action-call.js";',
          'export type * from "./execute-action-call.js";',
          'const other = await import("./execute-action-call-helpers.js");',
          'const loaded = require("./not-the-module");',
        ].join("\n"),
      ),
      [],
    );
    for (const file of [
      "packages/core/src/mcp/build-server.ts",
      "packages/core/src/mcp/execute-action-call.spec.ts",
    ]) {
      assert.deepEqual(
        kinds(
          [
            'import { runMcpActionCallUnredacted } from "./execute-action-call.js";',
            'const core = await import("./execute-action-call.js");',
          ].join("\n"),
          file,
        ),
        [],
        file,
      );
    }
  });

  it("reports the line of each bypass", () => {
    const findings = findBoundaryBypasses(
      OUTSIDER,
      ["// first", "", '  await import("./execute-action-call.js");'].join(
        "\n",
      ),
    );
    assert.equal(findings[0]?.line, 3);
  });
});

describe("guard over a repository", () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "mcp-boundary-guard-"));
  after(() => rmSync(scratch, { recursive: true, force: true }));

  function repo(name: string, files: Record<string, string>) {
    const root = path.join(scratch, name);
    mkdirSync(root, { recursive: true });
    const init = spawnSync("git", ["init", "-q"], { cwd: root });
    assert.equal(init.status, 0, String(init.stderr));
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), source);
    }
    return root;
  }

  const protectedSource =
    "export async function runMcpActionCallUnredacted() {}\n";

  function couldNotRunReason(root: string) {
    const result = checkBoundary(root);
    assert.equal(result.status, "could-not-run");
    return result.status === "could-not-run" ? result.reason : "";
  }

  it("could not run when git cannot list files", () => {
    assert.match(
      couldNotRunReason(path.join(scratch, "missing-checkout")),
      /could not list source files/,
    );
  });

  it("could not run when git lists no source files", () => {
    const root = repo("empty", { "README.md": "nothing to parse\n" });
    assert.match(couldNotRunReason(root), /listed no source files/);
  });

  it("could not run when the protected module is gone", () => {
    const root = repo("moved", { "src/index.ts": "export {};\n" });
    assert.match(couldNotRunReason(root), /no longer exports/);
  });

  it("fails on an untracked file that loads the module", () => {
    const root = repo("bypass", {
      [PROTECTED_MODULE]: protectedSource,
      "packages/core/src/mcp/leak.ts":
        'export const core = () => import("./execute-action-call.js");\n',
    });
    const result = checkBoundary(root);
    assert.equal(result.status, "failed");
    assert.deepEqual(
      result.status === "failed"
        ? result.findings.map(({ file, kind }) => `${file} ${kind}`)
        : [],
      ["packages/core/src/mcp/leak.ts dynamic import()"],
    );
  });

  it("parses a file that spells the module name with escapes", () => {
    const loaders: Record<string, string> = {
      "packages/core/src/mcp/unicode.ts": String.raw`./execute\u002daction-call.js`,
      "packages/core/src/mcp/hex.ts": String.raw`./execute\x2Daction-call.js`,
      "packages/core/src/mcp/code-point.ts": String.raw`./execute\u{2d}action-call.js`,
      "packages/core/src/mcp/identity.ts": String.raw`./\execute\-action-call.js`,
      "packages/core/src/mcp/octal.cjs": String.raw`./execute\55action-call`,
      "packages/core/src/mcp/continued.ts": "./execute-\\\naction-call.js",
      "packages/core/src/mcp/continued-crlf.ts":
        "./execute-\\\r\naction-call.js",
    };
    const root = repo("escaped", {
      [PROTECTED_MODULE]: protectedSource,
      ...Object.fromEntries(
        Object.entries(loaders).map(([file, specifier]) => [
          file,
          `module.exports = () => require("${specifier}");\n`,
        ]),
      ),
    });
    const result = checkBoundary(root);
    assert.equal(result.status, "failed");
    assert.deepEqual(
      result.status === "failed"
        ? result.findings.map(({ file }) => file).sort()
        : [],
      Object.keys(loaders).sort(),
    );
  });

  it("passes and counts what it inspected", () => {
    const root = repo("clean", {
      [PROTECTED_MODULE]: protectedSource,
      "packages/core/src/mcp/build-server.ts":
        'import { runMcpActionCallUnredacted } from "./execute-action-call.js";\n',
    });
    assert.deepEqual(checkBoundary(root), { status: "passed", inspected: 2 });
  });
});
