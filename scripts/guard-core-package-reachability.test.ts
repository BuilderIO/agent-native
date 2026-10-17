import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  auditCorePackage,
  scanStaticImports,
} from "./guard-core-package-reachability";

function createFixture(
  t: { after(callback: () => void): void },
  options: {
    exports?: Record<string, unknown>;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    sources?: Record<string, string>;
  } = {},
): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "core-reachability-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const coreRoot = path.join(root, "packages/core");
  mkdirSync(path.join(coreRoot, "src"), { recursive: true });
  mkdirSync(path.join(coreRoot, "dist"), { recursive: true });
  writeFileSync(
    path.join(coreRoot, "package.json"),
    JSON.stringify({
      name: "@agent-native/core",
      exports: options.exports ?? { ".": "./dist/index.js" },
      dependencies: options.dependencies ?? {},
      optionalDependencies: options.optionalDependencies ?? {},
      peerDependencies: options.peerDependencies ?? {},
      devDependencies: options.devDependencies ?? {},
    }),
  );
  for (const [file, source] of Object.entries(
    options.sources ?? { "index.ts": "export {};" },
  )) {
    const target = path.join(coreRoot, "src", file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

describe("Core package reachability guard", () => {
  it("scans static runtime imports and ignores type-only and dynamic imports", () => {
    const imports = scanStaticImports(
      "entry.ts",
      `
        import type { Shape } from "type-only";
        import { type Shape as OtherShape } from "also-type-only";
        import { value, type Shape } from "runtime";
        export type { Shape } from "export-type-only";
        export { value } from "export-runtime";
        void import("dynamic");
      `,
    );

    assert.deepEqual(
      imports.map((item) => item.specifier),
      ["runtime", "export-runtime"],
    );
  });

  it("follows relative imports, reports the full chain, and skips client exports", (t) => {
    const root = createFixture(t, {
      exports: {
        ".": "./dist/index.js",
        "./client/card": "./dist/client/card.js",
      },
      dependencies: { "@agent-native/toolkit": "*" },
      sources: {
        "index.ts": `export { value } from "./nested.js";`,
        "nested.ts": `import "@agent-native/toolkit/ui/button"; export const value = 1;`,
        "client/card.ts": `import "@agent-native/toolkit/ui/button"; export const Card = 1;`,
      },
    });

    const result = auditCorePackage(root, 0);
    assert.deepEqual(
      result.issues
        .filter((issue) => issue.kind === "forbidden")
        .map((issue) => issue.chain),
      [
        [
          'export ".": packages/core/src/index.ts',
          "packages/core/src/index.ts:1 --./nested.js-->",
          "packages/core/src/nested.ts:1 --@agent-native/toolkit/ui/button-->",
        ],
      ],
    );
    assert.equal(
      result.issues.some((issue) => issue.exportKey === "./client/card"),
      false,
    );
  });

  it("fails on undeclared package imports and counts deps plus optional deps, not peers", (t) => {
    const root = createFixture(t, {
      dependencies: { react: "*" },
      optionalDependencies: { sharp: "*" },
      peerDependencies: { "@agent-native/toolkit": "*" },
      devDependencies: { "not-declared": "*" },
      sources: { "index.ts": `import "not-declared";` },
    });

    const result = auditCorePackage(root, 2);
    assert.equal(result.runtimeDependencyCount, 2);
    assert.equal(result.issues[0]?.kind, "undeclared");
    assert.equal(
      auditCorePackage(root, 1).issues.some((issue) => issue.kind === "budget"),
      true,
    );
    assert.deepEqual(
      auditCorePackage(root, 2, false).issues,
      [],
      "budget-only mode does not inspect import reachability",
    );
  });

  it("returns unresolved status for an entry or source import that cannot be mapped", (t) => {
    const missingEntry = createFixture(t, {
      exports: { ".": "./dist/missing.js" },
      sources: {},
    });
    const missingImport = createFixture(t, {
      sources: { "index.ts": `export * from "./missing.js";` },
    });

    assert.equal(auditCorePackage(missingEntry).issues[0]?.kind, "unresolved");
    assert.equal(auditCorePackage(missingImport).issues[0]?.kind, "unresolved");
  });

  it("ignores public asset exports that have no TypeScript or JavaScript closure", (t) => {
    const root = createFixture(t, {
      exports: {
        "./styles.css": "./dist/styles.css",
        "./manifest.json": "./manifest.json",
      },
      sources: {},
    });

    assert.deepEqual(auditCorePackage(root).issues, []);
  });
});
