import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  checkBoundary,
  DIRECT_ADAPTER,
  findBoundaryBypasses,
  PROTECTED_MODULE,
} from "./guard-mcp-unredacted-call-boundary.js";

const OUTSIDER = "packages/core/src/mcp/some-adapter.ts";
const BUILD_SERVER = "packages/core/src/mcp/build-server.ts";
const SPEC = "packages/core/src/mcp/execute-action-call.spec.ts";
const RAW_IMPORT =
  'import { runMcpActionCallUnredacted as raw } from "./execute-action-call.js";';

function kinds(source: string, file = OUTSIDER) {
  return findBoundaryBypasses(file, source).map((finding) => finding.kind);
}

describe("unredacted MCP call boundary", () => {
  it("rejects a dynamic import of the module", () => {
    assert.deepEqual(
      kinds('const core = await import("./execute-action-call.js");'),
      ["dynamic import() of execute-action-call"],
    );
    assert.deepEqual(kinds("await import(`./execute-action-call.ts`);"), [
      "dynamic import() of execute-action-call",
    ]);
  });

  it("rejects require, import-equals and curried requires", () => {
    assert.deepEqual(
      kinds('const core = require("../mcp/execute-action-call");'),
      ["require() of execute-action-call"],
    );
    assert.deepEqual(kinds('import core = require("./execute-action-call");'), [
      "import-equals require of execute-action-call",
    ]);
    assert.deepEqual(
      kinds(
        'const core = createRequire(import.meta.url)("./execute-action-call.cjs");',
      ),
      ["call that loads execute-action-call by name"],
    );
    assert.deepEqual(
      kinds('const core = await vi.importActual("./execute-action-call.js");'),
      ["call that loads execute-action-call by name"],
    );
  });

  it("rejects a named, default or namespace import, however the path is written", () => {
    for (const source of [
      'import { runMcpActionCallUnredacted } from "./execute-action-call.ts";',
      'import { runMcpActionCallUnredacted as run } from "@agent-native/core/mcp/execute-action-call";',
      'import * as core from "./execute-action-call.mts";',
      'import core from "./execute-action-call.js";',
      'import { runMcpActionCallUnredacted } from "./execute-action-call.ts?raw";',
    ]) {
      assert.deepEqual(
        kinds(source),
        ["import of execute-action-call"],
        source,
      );
    }
  });

  it("keeps build-server.ts away from the unredacted call", () => {
    assert.deepEqual(kinds(RAW_IMPORT, BUILD_SERVER), [
      "import of execute-action-call",
    ]);
  });

  it("lets only build-server.ts load the direct adapter", () => {
    const loads: Array<[string, string]> = [
      [
        'import { createDirectActionCall } from "./direct-action-call.js";',
        "import of direct-action-call",
      ],
      [
        'import * as direct from "./direct-action-call.js";',
        "import of direct-action-call",
      ],
      [
        'const direct = await import("./direct-action-call.js");',
        "dynamic import() of direct-action-call",
      ],
    ];
    for (const [source, kind] of loads) {
      assert.deepEqual(kinds(source), [kind], source);
      assert.deepEqual(kinds(source, BUILD_SERVER), [], source);
    }
    assert.deepEqual(
      kinds(
        'import type { DirectActionCallScope } from "./direct-action-call.js";',
      ),
      [],
    );
  });

  it("rejects re-exports, even from allowed importers", () => {
    assert.deepEqual(kinds('export * from "./execute-action-call.js";'), [
      "re-export of execute-action-call",
    ]);
    assert.deepEqual(
      kinds('export * as core from "./execute-action-call.js";'),
      ["re-export of execute-action-call"],
    );
    assert.deepEqual(
      kinds(
        'export { runMcpActionCallUnredacted } from "./execute-action-call.js";',
        BUILD_SERVER,
      ),
      ["re-export of execute-action-call"],
    );
    assert.deepEqual(
      kinds(
        'export { createDirectActionCall } from "./direct-action-call.js";',
        BUILD_SERVER,
      ),
      ["re-export of direct-action-call"],
    );
  });

  it("rejects any direct adapter export the allowlist does not name", () => {
    const cases: Array<[string, string]> = [
      ["const runners = { run: raw };\nexport const run = runners.run;", "run"],
      [
        "const runners = { run: raw };\nconst { run } = runners;\nexport { run };",
        "run",
      ],
      ["export const run = useDirect ? raw : sanitized;", "run"],
      ["export function describeCall() {\n  return 'call';\n}", "describeCall"],
      ["export { raw as handler };", "handler"],
      ["export default raw;", "default"],
      ["export class Runner {}", "Runner"],
      ['export * from "./other.js";', "*"],
      ["module.exports = { run: raw };", "module.exports"],
    ];
    for (const [exported, name] of cases) {
      assert.deepEqual(
        kinds(`${RAW_IMPORT}\n${exported}`, DIRECT_ADAPTER),
        [`export not on the allowlist: ${name}`],
        exported,
      );
    }
  });

  it("holds the allowed export to its function declaration", () => {
    for (const exported of [
      "export const createDirectActionCall = () => raw;",
      "function createDirectActionCall() {}\nexport { createDirectActionCall };",
    ]) {
      assert.deepEqual(
        kinds(`${RAW_IMPORT}\n${exported}`, DIRECT_ADAPTER),
        [
          "createDirectActionCall exported other than as a function declaration",
        ],
        exported,
      );
    }
  });

  it("lets the direct adapter call it from its allowed export and export types", () => {
    assert.deepEqual(
      kinds(
        [
          RAW_IMPORT,
          'import type { McpActionCallContext } from "./execute-action-call.js";',
          "export interface DirectActionCallScope { context: McpActionCallContext }",
          "export type DirectActionCallFailure = { errorType: string };",
          "export function createDirectActionCall() {",
          "  return async () => toWire(await raw());",
          "}",
        ].join("\n"),
        DIRECT_ADAPTER,
      ),
      [],
    );
  });

  it("holds the spec to exporting nothing", () => {
    assert.deepEqual(kinds(`${RAW_IMPORT}\nexport const leak = raw;`, SPEC), [
      "export not on the allowlist: leak",
    ]);
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
        ["dynamic import() of execute-action-call"],
        specifier,
      );
    }
  });

  it("allows the redacted entry point, types, and the allowed importers", () => {
    assert.deepEqual(
      kinds(
        [
          'import { executeMcpActionCall, type McpActionCallOutcome } from "./execute-action-call.js";',
          'import type { runMcpActionCallUnredacted } from "./execute-action-call.js";',
          'import { type runMcpActionCallUnredacted as T } from "./execute-action-call.js";',
          'export { executeMcpActionCall } from "./execute-action-call.js";',
          'export type * from "./execute-action-call.js";',
          'export type * from "./direct-action-call.js";',
          'const other = await import("./execute-action-call-helpers.js");',
          'const loaded = require("./not-the-module");',
        ].join("\n"),
      ),
      [],
    );
    for (const file of [DIRECT_ADAPTER, SPEC]) {
      assert.deepEqual(
        kinds(
          [
            RAW_IMPORT,
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

  function findingsOf(root: string) {
    const result = checkBoundary(root);
    assert.equal(result.status, "failed");
    return result.status === "failed"
      ? result.findings.map(({ file, kind }) => `${file} ${kind}`)
      : [];
  }

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
    assert.deepEqual(findingsOf(root), [
      "packages/core/src/mcp/leak.ts dynamic import() of execute-action-call",
    ]);
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

  it("checks the direct adapter's exports even when it names no module", () => {
    const root = repo("adapter-export", {
      [PROTECTED_MODULE]: protectedSource,
      [DIRECT_ADAPTER]: "export const extra = 1;\n",
    });
    assert.deepEqual(findingsOf(root), [
      `${DIRECT_ADAPTER} export not on the allowlist: extra`,
    ]);
  });

  it("passes and counts what it inspected", () => {
    const root = repo("clean", {
      [PROTECTED_MODULE]: protectedSource,
      [DIRECT_ADAPTER]: `${RAW_IMPORT}\nexport function createDirectActionCall() {\n  return raw;\n}\n`,
      [BUILD_SERVER]:
        'import { createDirectActionCall } from "./direct-action-call.js";\n',
    });
    assert.deepEqual(checkBoundary(root), { status: "passed", inspected: 3 });
  });

  it("passes on this repository", () => {
    const result = checkBoundary(path.resolve(import.meta.dirname, ".."));
    assert.equal(
      result.status,
      "passed",
      result.status === "failed"
        ? result.findings
            .map(({ file, line, kind }) => `${file}:${line} ${kind}`)
            .join("\n")
        : undefined,
    );
  });
});
