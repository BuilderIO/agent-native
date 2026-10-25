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

test("names only dot-form specs after a mutated file", () => {
  const listing = [
    "session.spec.ts",
    "session.store.test.ts",
    "session-store.spec.ts",
    "session.ts",
  ];
  assert.deepEqual(
    namedSpecs(["src/session.ts:1-2"], () => listing),
    {
      include: ["src/session.spec.ts", "src/session.store.test.ts"],
      missing: [],
    },
  );
});

test("reports a mutated file as missing when only a dash-named spec exists", () => {
  assert.deepEqual(
    namedSpecs(["src/session.ts:1-2"], () => [
      "session-store.spec.ts",
      "session.ts",
    ]),
    { include: [], missing: ["src/session.ts"] },
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
