import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  checkBoundary,
  CORE_SPEC as SPEC,
  DIRECT_ADAPTER,
  findBoundaryBypasses,
  PROTECTED_MODULE,
  specifiedModule,
} from "./guard-mcp-unredacted-call-boundary.js";

const OUTSIDER = "packages/core/src/mcp/some-adapter.ts";
const BUILD_SERVER = "packages/core/src/mcp/build-server.ts";
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
      'import { runMcpActionCallUnredacted as raw } from "./execute-action-call.ts#review";',
      'import * as core from "./execute%2daction-call.ts";',
    ]) {
      assert.deepEqual(
        kinds(source),
        ["import of execute-action-call"],
        source,
      );
    }
    for (const specifier of [
      "./execute-action-call.ts#review",
      "./execute%2daction-call.ts",
    ]) {
      assert.deepEqual(
        kinds(`const core = await import("${specifier}");`),
        ["dynamic import() of execute-action-call"],
        specifier,
      );
    }
  });

  it("reads a specifier the way a loader reads it", () => {
    const cases: Array<[string, string]> = [
      ["./execute-action-call.ts?raw#top", "execute-action-call"],
      ["./execute%2Daction%2dcall.js", "execute-action-call"],
      ["./other/../execute-action-call.mts", "execute-action-call"],
      [".\\mcp\\execute-action-call.cjs", "execute-action-call"],
      ["./execute-action-call.ts/..", "."],
      ["#internal/execute-action-call", "execute-action-call"],
      ["./execute%252daction-call.ts", "execute%2daction-call"],
      ["./Execute-Action-Call.TS", "execute-action-call"],
      ["./%45xecute-action-call.ts", "execute-action-call"],
    ];
    for (const [specifier, module] of cases) {
      assert.equal(specifiedModule(specifier), module, specifier);
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

  it("holds the direct adapter's top level to imports, types and its factory", () => {
    const factory =
      "export function createDirectActionCall() {\n  return 1;\n}";
    const topLevel =
      "direct adapter top level holds more than imports, types and createDirectActionCall";
    // Each case lists the statements that should be reported.
    const cases: Array<[string, number]> = [
      ["const x = raw;", 1],
      [`${factory}\ncreateDirectActionCall.raw = raw;`, 1],
      [`${factory}\nObject.assign(createDirectActionCall, { raw });`, 1],
      ["globalThis.reviewRaw = raw;", 1],
      ['Object.defineProperty(globalThis, "reviewRaw", { value: raw });', 1],
      ['module["exports"] = { run: raw };', 1],
      ["Object.assign(exports, { run: raw });", 1],
      ["const runners = { run: raw };\nexport const run = runners.run;", 2],
      ["const { run } = { run: raw };\nexport { run };", 2],
      ["export const run = useDirect ? raw : sanitized;", 1],
      ["export function describeCall() {\n  return 'call';\n}", 1],
      ["export default raw;", 1],
      ["export class Runner {}", 1],
      ['export * from "./other.js";', 1],
      ["export const createDirectActionCall = () => raw;", 1],
      [
        "function createDirectActionCall() {}\nexport { createDirectActionCall };",
        2,
      ],
    ];
    for (const [statements, reported] of cases) {
      assert.deepEqual(
        kinds(`${RAW_IMPORT}\n${statements}`, DIRECT_ADAPTER),
        Array.from({ length: reported }, () => topLevel),
        statements,
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
      "export from the spec: leak",
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
    assert.deepEqual(
      kinds(
        [
          RAW_IMPORT,
          'const core = await import("./execute-action-call.js");',
          "describe('core', () => {});",
        ].join("\n"),
        SPEC,
      ),
      [],
    );
    assert.deepEqual(
      kinds(
        [
          RAW_IMPORT,
          "export function createDirectActionCall() {",
          '  return () => import("./execute-action-call.js");',
          "}",
        ].join("\n"),
        DIRECT_ADAPTER,
      ),
      [],
    );
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

  it("inspects a committed file under a directory the ignore rules skip", () => {
    const root = repo("nested-build", {
      [PROTECTED_MODULE]: protectedSource,
      ".gitignore": "build/\n",
      "packages/core/src/build/leak.ts":
        'export const core = () => import("../mcp/execute-action-call.js");\n',
    });
    const add = spawnSync(
      "git",
      ["add", "-f", "packages/core/src/build/leak.ts"],
      { cwd: root },
    );
    assert.equal(add.status, 0, String(add.stderr));
    assert.deepEqual(findingsOf(root), [
      "packages/core/src/build/leak.ts dynamic import() of execute-action-call",
    ]);
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

  it("parses a file that names the module with a percent escape, a fragment or capitals", () => {
    const loaders: Record<string, string> = {
      "packages/core/src/mcp/percent.ts": "./execute%2daction-call.ts",
      "packages/core/src/mcp/percent-upper.ts": "./execute%2Daction-call.ts",
      "packages/core/src/mcp/escaped-percent.ts": String.raw`./execute\x252daction-call.ts`,
      "packages/core/src/mcp/fragment.ts": "./execute-action-call.ts#review",
      "packages/core/src/mcp/mixed-case.ts": "./Execute-Action-Call.ts",
      "packages/core/src/mcp/percent-capital.ts": "./%45xecute-action-call.ts",
      "packages/core/src/mcp/escaped-capital.ts": String.raw`./\u0045xecute-action-call.ts`,
    };
    const root = repo("url-specifiers", {
      [PROTECTED_MODULE]: protectedSource,
      ...Object.fromEntries(
        Object.entries(loaders).map(([file, specifier]) => [
          file,
          `export const load = () => import("${specifier}");\n`,
        ]),
      ),
    });
    assert.deepEqual(
      findingsOf(root).sort(),
      Object.keys(loaders)
        .map((file) => `${file} dynamic import() of execute-action-call`)
        .sort(),
    );
  });

  it("holds the direct adapter's top level to its rule even when it names no module", () => {
    const root = repo("adapter-top-level", {
      [PROTECTED_MODULE]: protectedSource,
      [DIRECT_ADAPTER]: "globalThis.extra = 1;\n",
    });
    assert.deepEqual(findingsOf(root), [
      `${DIRECT_ADAPTER} direct adapter top level holds more than imports, types and createDirectActionCall`,
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
