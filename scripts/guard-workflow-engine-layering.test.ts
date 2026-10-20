import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findLayeringViolations,
  shouldScanEngineFile,
} from "./guard-workflow-engine-layering";

const FILE = "templates/factory/server/workflow/graph-validation.ts";

function flagged(source: string, file = FILE) {
  return findLayeringViolations(file, source).map(
    (violation) => `${violation.line}: ${violation.specifier}`,
  );
}

describe("workflow engine layering guard", () => {
  it("rejects relative imports that leave the folder", () => {
    const source = [
      'import { getDb } from "../db/index.js";',
      'import { resolve } from "../../lib/factory-scope";',
      'export { x } from "../../../actions/list-factories";',
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "1: ../db/index.js",
      "2: ../../lib/factory-scope",
      "3: ../../../actions/list-factories",
    ]);
  });

  it("rejects the template's aliases and bare root directories", () => {
    const source = [
      'import { Button } from "@/components/ui/button";',
      'import { z } from "@shared/schemas";',
      'import { requireWorkspaceMember } from "server/lib/require-workspace-member";',
      'import { x } from "app/lib/x";',
      'import "actions/list-factories";',
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "1: @/components/ui/button",
      "2: @shared/schemas",
      "3: server/lib/require-workspace-member",
      "4: app/lib/x",
      "5: actions/list-factories",
    ]);
  });

  it("rejects dynamic imports, require, absolute paths and file URLs", () => {
    const source = [
      'const a = await import("../lib/a");',
      'const b = require("../lib/b");',
      'import c from "/abs/path/c";',
      'import d from "file:///abs/path/d";',
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "1: ../lib/a",
      "2: ../lib/b",
      "3: /abs/path/c",
      "4: file:///abs/path/d",
    ]);
  });

  it("allows imports within the folder, packages, and node builtins", () => {
    const source = [
      'import { z } from "zod";',
      'import { defineAction } from "@agent-native/core/action";',
      'import path from "node:path";',
      'import { x } from "./contract.js";',
      'import { y } from "./nested/y.js";',
      'import { vi } from "vitest";',
      'import type { ServerThing } from "serverless-thing";',
      'import { appShell } from "app-shell";',
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("resolves a relative import from the importing file's own folder", () => {
    const nested = "templates/factory/server/workflow/nested/deep.ts";
    assert.deepEqual(
      flagged('import { a } from "../contract.js";', nested),
      [],
    );
    assert.deepEqual(flagged('import { a } from "../../lib/helper";', nested), [
      "1: ../../lib/helper",
    ]);
    assert.deepEqual(
      flagged(
        'import { a } from "../../../../../packages/core/src/x";',
        nested,
      ),
      ["1: ../../../../../packages/core/src/x"],
    );
  });

  it("ignores import-shaped text in comments and strings", () => {
    const source = [
      '// import { x } from "../lib/x";',
      '/* import("../lib/y") */',
      'const doc = "import { z } from \\"../lib/z\\"";',
      "const tpl = `require('../lib/w')`;",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("reports the line of each import", () => {
    const source = ["", "", 'import { x } from "../lib/x";'].join("\n");
    assert.deepEqual(flagged(source), ["3: ../lib/x"]);
  });

  it("scans every source file in the folder except the adapter", () => {
    for (const file of [
      "templates/factory/server/workflow/contract.ts",
      "templates/factory/server/workflow/contract.spec.ts",
      "templates/factory/server/workflow/story-graphs.fixture.ts",
      "templates/factory/server/workflow/nested/deep.tsx",
    ]) {
      assert.equal(shouldScanEngineFile(file), true, file);
    }
    for (const file of [
      "templates/factory/server/workflow/adapter.ts",
      "templates/factory/server/workflow/notes.md",
      "templates/factory/server/workflow/node_modules/x/index.ts",
      "templates/factory/server/lib/factory-scope.ts",
      "templates/factory/server/workflow-other/x.ts",
      "templates/chat/server/workflow/x.ts",
    ]) {
      assert.equal(shouldScanEngineFile(file), false, file);
    }
  });
});

describe("guard command", () => {
  const scriptsDir = import.meta.dirname;

  function runGuard(root: string) {
    return spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        path.join(root, "scripts", "guard-workflow-engine-layering.ts"),
      ],
      { cwd: root, encoding: "utf8" },
    );
  }

  // The guard finds the repo from its own path, so each case copies it beside
  // a throwaway template tree instead of touching the real one.
  function scaffold(engineFiles: Record<string, string>): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "layering-guard-"));
    mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), '{ "type": "module" }\n');
    for (const name of [
      "guard-workflow-engine-layering.ts",
      "guard-toolkit-must-not-import-core.ts",
      "lib/changed-lines.mjs",
    ]) {
      copyFileSync(
        path.join(scriptsDir, name),
        path.join(root, "scripts", name),
      );
    }
    const engine = path.join(root, "templates/factory/server/workflow");
    mkdirSync(engine, { recursive: true });
    for (const [name, source] of Object.entries(engineFiles)) {
      writeFileSync(path.join(engine, name), source);
    }
    return root;
  }

  it("passes on the real repository", () => {
    const result = runGuard(path.resolve(scriptsDir, ".."));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OK \(\d+ file\(s\) inspected\)/);
  });

  it("exits 2, not 0, when the folder has nothing to inspect", () => {
    const result = runGuard(scaffold({ "adapter.ts": "export {};\n" }));
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /found no source files to inspect/);
  });

  it("exits 2, not 0, when the folder is missing", () => {
    const root = scaffold({});
    rmSync(path.join(root, "templates"), { recursive: true });
    const result = runGuard(root);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /could not read templates\/factory/);
  });

  it("exits 1 and names the file and line for a stray import", () => {
    const result = runGuard(
      scaffold({
        "adapter.ts": 'import { x } from "../lib/x";\n',
        "engine.ts":
          'import { ok } from "./adapter.js";\nimport { bad } from "../lib/bad";\n',
      }),
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /templates\/factory\/server\/workflow\/engine\.ts:2 imports "\.\.\/lib\/bad"/,
    );
    assert.doesNotMatch(result.stderr, /adapter\.ts:/);
  });

  it("exits 0 when the engine imports only from itself and packages", () => {
    const result = runGuard(
      scaffold({
        "adapter.ts": 'import { x } from "../lib/x";\n',
        "engine.ts":
          'import { z } from "zod";\nimport { a } from "./adapter.js";\n',
      }),
    );
    assert.equal(result.status, 0, result.stderr);
  });
});
