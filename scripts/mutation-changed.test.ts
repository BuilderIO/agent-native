import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  contiguousRanges,
  mutateSpecs,
  namedSpecs,
  survivingMutants,
} from "./mutation-changed.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const absolute = (repoPath: string) => path.join(repoRoot, repoPath);

test("merges added lines into inclusive contiguous ranges", () => {
  assert.deepEqual(contiguousRanges([5, 1, 2, 3, 9, 10, 3]), [
    [1, 3],
    [5, 5],
    [9, 10],
  ]);
  assert.deepEqual(contiguousRanges([]), []);
});

test("mutates only added Core source lines, as packages/core-relative ranges", () => {
  const added = new Map([
    [absolute("packages/core/src/shared/merge-by-id.ts"), new Set([3, 4, 9])],
    [absolute("packages/core/src/shared/merge-by-id.spec.ts"), new Set([1])],
    [absolute("packages/core/src/templates/x.ts"), new Set([1])],
    [absolute("packages/core/src/cli/create.ts"), new Set([1])],
    [absolute("templates/chat/actions/x.ts"), new Set([1])],
  ]);
  assert.deepEqual(mutateSpecs(added), [
    "src/shared/merge-by-id.ts:3-4",
    "src/shared/merge-by-id.ts:9-9",
  ]);
});

test("leaves type-level proofs (.test-d.ts) out of mutation scope", () => {
  const added = new Map([
    [absolute("packages/core/src/state-machine/index.ts"), new Set([1])],
    [absolute("packages/core/src/state-machine/index.test-d.ts"), new Set([1])],
  ]);
  assert.deepEqual(mutateSpecs(added), ["src/state-machine/index.ts:1-1"]);
});

/** Serves only the listed files; any other read fails the test. */
const readFrom =
  (files: Record<string, string>) =>
  (file: string): string => {
    const text: string | undefined = files[file];
    if (text === undefined) throw new Error(`unexpected read of ${file}`);
    return text;
  };

test("names dot-form specs after a mutated file", () => {
  const listing = [
    "session.spec.ts",
    "session.store.test.ts",
    "session-store.spec.ts",
    "session.ts",
  ];
  assert.deepEqual(
    namedSpecs(["src/session.ts:1-2"], () => listing, readFrom({})),
    {
      include: ["src/session.spec.ts", "src/session.store.test.ts"],
      missing: [],
    },
  );
});

test("a dot-named spec wins over a same-directory spec that imports the module", () => {
  const listing = ["session.spec.ts", "routes.spec.ts"];
  assert.deepEqual(
    namedSpecs(["src/session.ts:1-2"], () => listing, readFrom({})),
    { include: ["src/session.spec.ts"], missing: [] },
  );
});

test("selects a same-directory spec that imports the module when no dot-named spec exists", () => {
  const listing = [
    "action.execution-outcome.spec.ts",
    "unrelated.spec.ts",
    "action-invocation.ts",
  ];
  const files = {
    "src/action.execution-outcome.spec.ts": `import { invokeAction } from "./action-invocation";`,
    "src/unrelated.spec.ts": `import { other } from "./other";`,
  };
  assert.deepEqual(
    namedSpecs(
      ["src/action-invocation.ts:1-2"],
      () => listing,
      readFrom(files),
    ),
    { include: ["src/action.execution-outcome.spec.ts"], missing: [] },
  );
});

test("matches static imports, re-exports, and dynamic imports with either quote and an optional extension", () => {
  const listing = [
    "a.spec.ts",
    "b.spec.ts",
    "c.spec.ts",
    "d.spec.ts",
    "e.spec.ts",
    "f.spec.ts",
  ];
  const files = {
    "src/a.spec.ts": `import { x } from './session';`,
    "src/b.spec.ts": `import { x } from "./session.js";`,
    "src/c.spec.ts": `export * from "./session.ts";`,
    "src/d.spec.ts": `const m = await import("./session");`,
    "src/e.spec.ts": `const m = await import('./session.js');`,
    "src/f.spec.ts": `import "./session";`,
  };
  assert.deepEqual(
    namedSpecs(["src/session.ts:1-2"], () => listing, readFrom(files)),
    {
      include: [
        "src/a.spec.ts",
        "src/b.spec.ts",
        "src/c.spec.ts",
        "src/d.spec.ts",
        "src/e.spec.ts",
        "src/f.spec.ts",
      ],
      missing: [],
    },
  );
});

test("matches dynamic imports with comment trivia before the module specifier", () => {
  const listing = ["imports.spec.ts"];
  const files = {
    "src/imports.spec.ts": `const feature = await import(/* test note */ "./feature");`,
  };
  assert.deepEqual(
    namedSpecs(["src/feature.ts:1-2"], () => listing, readFrom(files)),
    { include: ["src/imports.spec.ts"], missing: [] },
  );
});

test("does not select a same-directory spec that does not import the module", () => {
  const listing = ["unrelated.spec.ts", "session.ts"];
  const files = {
    "src/unrelated.spec.ts": `import { x } from "./other";\nimport { y } from "../session";`,
  };
  assert.deepEqual(
    namedSpecs(["src/session.ts:1-2"], () => listing, readFrom(files)),
    { include: [], missing: ["src/session.ts"] },
  );
});

test("does not count session-store.spec.ts, which imports only ./session-store, for session.ts", () => {
  const listing = ["session-store.spec.ts", "session.ts"];
  const files = {
    "src/session-store.spec.ts": `import { createSessionStore } from "./session-store";`,
  };
  assert.deepEqual(
    namedSpecs(["src/session.ts:1-2"], () => listing, readFrom(files)),
    { include: [], missing: ["src/session.ts"] },
  );
});

test("does not take a sibling module's dot spec, and falls back to importers instead", () => {
  const listing = [
    "index.ts",
    "index.browser.ts",
    "index.browser.spec.ts",
    "exports.spec.ts",
  ];
  const files = {
    "src/index.browser.spec.ts": `import { x } from "./index.browser";`,
    "src/exports.spec.ts": `import * as core from "./index";`,
  };
  assert.deepEqual(
    namedSpecs(["src/index.ts:1-2"], () => listing, readFrom(files)),
    { include: ["src/exports.spec.ts"], missing: [] },
  );
});

test("matches explicit .tsx and .jsx import suffixes", () => {
  const listing = ["a.spec.tsx", "b.spec.ts"];
  const files = {
    "src/a.spec.tsx": `import { Widget } from "./widget.tsx";`,
    "src/b.spec.ts": `import { Widget } from "./widget.jsx";`,
  };
  assert.deepEqual(
    namedSpecs(["src/widget.tsx:1-2"], () => listing, readFrom(files)),
    { include: ["src/a.spec.tsx", "src/b.spec.ts"], missing: [] },
  );
});

test("reports surviving and uncovered mutants with their location", () => {
  const report = {
    files: {
      "src/a.ts": {
        mutants: [
          {
            status: "Killed",
            mutatorName: "Arithmetic",
            replacement: "-",
            location: { start: { line: 1, column: 2 } },
          },
          {
            status: "Survived",
            mutatorName: "Equality",
            replacement: "!==",
            location: { start: { line: 7, column: 4 } },
          },
          {
            status: "NoCoverage",
            mutatorName: "Block",
            replacement: "{}",
            location: { start: { line: 9, column: 1 } },
          },
        ],
      },
    },
  };
  assert.deepEqual(survivingMutants(report), [
    "packages/core/src/a.ts:7:4  Survived  Equality: !==",
    "packages/core/src/a.ts:9:1  NoCoverage  Block: {}",
  ]);
});
