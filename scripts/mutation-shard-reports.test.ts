import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateShardReceipts,
  createShardReceipt,
  type ExpectedShardSet,
  type ShardMetadata,
  type ShardReceipt,
  type TerminalMutantStatus,
} from "./lib/mutation-shard-reports.ts";

// Worker 0 is group 0 alone; workers 1 and 2 split group 1's mutants by id.
const expected: ExpectedShardSet = {
  head: "a".repeat(40),
  base: "b".repeat(40),
  configHash: "c".repeat(64),
  shards: [
    {
      group: 0,
      part: 0,
      parts: 1,
      scopeHash: "d0",
      testScopeHash: "e0",
      files: ["src/a.ts"],
    },
    {
      group: 1,
      part: 0,
      parts: 2,
      scopeHash: "d1",
      testScopeHash: "e1",
      files: ["src/c.ts", "src/b.ts"],
    },
    {
      group: 1,
      part: 1,
      parts: 2,
      scopeHash: "d1",
      testScopeHash: "e1",
      files: ["src/c.ts", "src/b.ts"],
    },
  ],
};

const groupStatuses: Record<string, TerminalMutantStatus>[] = [
  { "0": "Killed", "1": "Survived" },
  {
    "0": "NoCoverage",
    "1": "Ignored",
    "2": "Timeout",
    "3": "CompileError",
    "4": "RuntimeError",
  },
];

interface FixtureReport {
  files: Record<
    string,
    { language: string; source: string; mutants: Record<string, unknown>[] }
  >;
  testFiles?: Record<
    string,
    { source: string; tests: Record<string, unknown>[] }
  >;
}

function metadata(shardIndex: number): ShardMetadata {
  const shard = expected.shards[shardIndex];
  assert.ok(shard);
  return {
    head: expected.head,
    base: expected.base,
    configHash: expected.configHash,
    scopeHash: shard.scopeHash,
    testScopeHash: shard.testScopeHash,
    shardIndex,
    shardCount: expected.shards.length,
    part: shard.part,
    parts: shard.parts,
  };
}

// Stryker numbers mutants from 0 in each run, so both groups reuse ids. A
// worker reports the mutants it does not own as fake survivors.
function reportFor(shardIndex: number): FixtureReport {
  const shard = expected.shards[shardIndex];
  assert.ok(shard);
  const statuses = groupStatuses[shard.group];
  assert.ok(statuses);
  const mutant = (id: string): Record<string, unknown> => {
    const owned = Number(id) % shard.parts === shard.part;
    return {
      id,
      mutatorName: "StringLiteral",
      replacement: "changed",
      location: {
        start: { line: Number(id) + 1, column: 1 },
        end: { line: Number(id) + 1, column: 6 },
      },
      status: owned ? statuses[id] : "Survived",
      ...(owned
        ? {
            testsCompleted: Number(id) + 1,
            coveredBy: ["test-0"],
            ...(statuses[id] === "Killed" ? { killedBy: ["test-1"] } : {}),
          }
        : { testsCompleted: 0 }),
    };
  };
  const file = (name: string, ids: string[]) => ({
    language: "typescript",
    source: `export const ${name} = '${name}';\n`,
    mutants: ids.map(mutant),
  });
  const testFile = shard.group === 0 ? "src/a.test.ts" : "src/b.test.ts";
  return {
    files:
      shard.group === 0
        ? { "src/a.ts": file("a", ["0", "1"]) }
        : {
            "src/b.ts": file("b", ["0", "1", "2"]),
            "src/c.ts": file("c", ["3", "4"]),
          },
    testFiles: {
      [testFile]: {
        source: "test('x', () => expect(x).toBe('x'));\n",
        tests: [
          {
            id: "test-1",
            name: "a second test",
            location: { start: { line: 2, column: 1 } },
          },
          {
            id: "test-0",
            name: "the first test",
            location: { start: { line: 1, column: 1 } },
          },
        ],
      },
    },
  };
}

function receipts(): ShardReceipt[] {
  return expected.shards.map((_, shardIndex) =>
    createShardReceipt(reportFor(shardIndex), metadata(shardIndex)),
  );
}

function replace(
  input: readonly ShardReceipt[],
  index: number,
  receipt: unknown,
): unknown[] {
  return input.map((original, position) =>
    position === index ? receipt : original,
  );
}

test("reconstructs every group's union under unique ids and keeps each owner status", () => {
  const input = receipts();
  assert.deepEqual(
    input.map(({ ownedMutants }) => ownedMutants.map(({ id }) => id)),
    [
      ["0", "1"],
      ["0", "2", "4"],
      ["1", "3"],
    ],
  );

  const report = aggregateShardReceipts(input, expected);
  assert.deepEqual(Object.keys(report.files), [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
  ]);
  const merged = Object.values(report.files).flatMap(({ mutants }) => mutants);
  assert.deepEqual(
    merged.map(({ id, status }) => [id, status]),
    [
      ["0", "Killed"],
      ["1", "Survived"],
      ["2", "NoCoverage"],
      ["3", "Ignored"],
      ["4", "Timeout"],
      ["5", "CompileError"],
      ["6", "RuntimeError"],
    ],
  );
  assert.equal(report.files["src/c.ts"]?.source, "export const c = 'c';\n");
  assert.equal(report.files["src/c.ts"]?.mutants[0]?.location.start.line, 4);
});

test("ignores fake nonowner survivor outcomes and accepts owned NoCoverage", () => {
  const receipt = createShardReceipt(reportFor(1), metadata(1));
  assert.deepEqual(
    receipt.ownedMutants.map(({ id, status }) => ({ id, status })),
    [
      { id: "0", status: "NoCoverage" },
      { id: "2", status: "Timeout" },
      { id: "4", status: "RuntimeError" },
    ],
  );
});

test("hashes stable identities and test inventory, not runtime mutant metadata", () => {
  const firstReport = reportFor(0);
  const secondReport = structuredClone(firstReport);
  secondReport.files["src/a.ts"]?.mutants.reverse();
  const tests = secondReport.testFiles?.["src/a.test.ts"]?.tests ?? [];
  assert.equal(tests.length, 2);
  tests.reverse();
  tests.forEach((entry, index) => {
    entry.id = `renumbered-${index}`;
  });
  for (const file of Object.values(secondReport.files)) {
    for (const entry of file.mutants) {
      entry.status = "Survived";
      entry.testsCompleted = 999;
      entry.coveredBy = ["renumbered-0"];
      delete entry.killedBy;
    }
  }

  const first = createShardReceipt(firstReport, metadata(0));
  const second = createShardReceipt(secondReport, metadata(0));
  assert.equal(first.inventoryHash, second.inventoryHash);
  assert.equal(first.testInventoryHash, second.testInventoryHash);
  assert.equal("coveredBy" in (second.ownedMutants[0] ?? {}), false);
  assert.equal("killedBy" in (first.ownedMutants[0] ?? {}), false);

  const testFile = secondReport.testFiles?.["src/a.test.ts"];
  assert.ok(testFile);
  testFile.source = "different test source";
  assert.notEqual(
    createShardReceipt(secondReport, metadata(0)).testInventoryHash,
    first.testInventoryHash,
  );
});

test("rejects absent test inventory when mutants were instrumented", () => {
  const report = reportFor(0);
  delete report.testFiles;
  assert.throws(
    () => createShardReceipt(report, metadata(0)),
    /requires report.testFiles/,
  );
});

test("validates unique local test ids and coverage references", () => {
  const unknownReference = reportFor(0);
  const owned = unknownReference.files["src/a.ts"]?.mutants[0];
  assert.ok(owned);
  owned.coveredBy = ["missing"];
  assert.throws(
    () => createShardReceipt(unknownReference, metadata(0)),
    /unknown test id/,
  );

  const duplicateTestId = reportFor(0);
  const second = duplicateTestId.testFiles?.["src/a.test.ts"]?.tests[1];
  assert.ok(second);
  second.id = "test-1";
  assert.throws(
    () => createShardReceipt(duplicateTestId, metadata(0)),
    /duplicate test id/,
  );
});

test("rejects missing and duplicate shard indices", () => {
  const input = receipts();
  assert.throws(
    () => aggregateShardReceipts(input.slice(0, 2), expected),
    /expected 3 receipts/,
  );
  assert.throws(
    () => aggregateShardReceipts(replace(input, 2, input[1]), expected),
    /duplicate shard index 1/,
  );
  assert.throws(
    () => aggregateShardReceipts([], { ...expected, shards: [] }),
    /no shards/,
  );
});

test("rejects stale heads, bases, hashes, parts, and shard counts", () => {
  const input = receipts();
  for (const [field, value] of [
    ["head", "stale"],
    ["base", "stale"],
    ["configHash", "stale"],
    ["scopeHash", "d1"],
    ["testScopeHash", "stale"],
    ["shardCount", 4],
    ["parts", 2],
  ] as const) {
    assert.throws(
      () =>
        aggregateShardReceipts(
          replace(input, 0, { ...input[0], [field]: value }),
          expected,
        ),
      new RegExp(`\\.${field} does not match`),
    );
  }
  assert.throws(
    () =>
      aggregateShardReceipts(
        replace(input, 1, { ...input[1], part: 1 }),
        expected,
      ),
    /\.part does not match/,
  );
});

test("rejects inconsistent identity, source, and tests inside a group", () => {
  const input = receipts();
  const changedIdentity = reportFor(2);
  const target = changedIdentity.files["src/b.ts"]?.mutants[0];
  assert.ok(target);
  target.replacement = "different";
  assert.throws(
    () =>
      aggregateShardReceipts(
        replace(input, 2, createShardReceipt(changedIdentity, metadata(2))),
        expected,
      ),
    /inventory or source hash/,
  );

  const changedTests = reportFor(2);
  const testFile = changedTests.testFiles?.["src/b.test.ts"];
  assert.ok(testFile);
  testFile.source = "changed test source";
  assert.throws(
    () =>
      aggregateShardReceipts(
        replace(input, 2, createShardReceipt(changedTests, metadata(2))),
        expected,
      ),
    /test inventory/,
  );
});

test("accepts a planned file without mutants, rejects unplanned or shared files", () => {
  // Stryker omits a file whose ranges produced no mutants from its report.
  const withoutMutants = (index: number) => {
    const report = reportFor(index);
    delete report.files["src/c.ts"];
    return createShardReceipt(report, metadata(index));
  };
  assert.deepEqual(
    Object.keys(
      aggregateShardReceipts(
        [receipts()[0], withoutMutants(1), withoutMutants(2)],
        expected,
      ).files,
    ),
    ["src/a.ts", "src/b.ts"],
  );

  const added = reportFor(0);
  added.files["src/d.ts"] = {
    language: "typescript",
    source: "export const d = 'd';\n",
    mutants: [],
  };
  assert.throws(
    () =>
      aggregateShardReceipts(
        replace(receipts(), 0, createShardReceipt(added, metadata(0))),
        expected,
      ),
    /reports unplanned files src\/d.ts/,
  );

  const [alone, member] = expected.shards;
  assert.ok(alone && member);
  const overlapping: ExpectedShardSet = {
    ...expected,
    shards: [alone, { ...member, parts: 1, files: ["src/a.ts"] }],
  };
  const second = createShardReceipt(reportFor(0), {
    ...metadata(1),
    shardCount: 2,
    part: 0,
    parts: 1,
  });
  assert.throws(
    () =>
      aggregateShardReceipts(
        [
          createShardReceipt(reportFor(0), { ...metadata(0), shardCount: 2 }),
          second,
        ],
        overlapping,
      ),
    /groups 0 and 1 both report src\/a.ts/,
  );
});

test("rejects missing or extra owned results", () => {
  const input = receipts();
  const first = input[1];
  assert.ok(first);
  assert.throws(
    () =>
      aggregateShardReceipts(
        replace(input, 1, {
          ...first,
          ownedMutants: first.ownedMutants.slice(1),
        }),
        expected,
      ),
    /missing or has extra owned results/,
  );

  const nonOwner = first.inventory.find(
    (mutant) => Number(mutant.id) % 2 !== 0,
  );
  assert.ok(nonOwner);
  assert.throws(
    () =>
      aggregateShardReceipts(
        replace(input, 1, {
          ...first,
          ownedMutants: [
            ...first.ownedMutants,
            { ...nonOwner, status: "Survived" as const },
          ],
        }),
        expected,
      ),
    /missing or has extra owned results/,
  );
});

test("rejects nonnumeric or duplicate mutant ids and nonterminal statuses", () => {
  const nonnumeric = reportFor(0);
  const firstMutant = nonnumeric.files["src/a.ts"]?.mutants[0];
  assert.ok(firstMutant);
  firstMutant.id = "not-a-number";
  assert.throws(
    () => createShardReceipt(nonnumeric, metadata(0)),
    /canonical numeric id/,
  );

  const duplicate = reportFor(1);
  const cMutant = duplicate.files["src/c.ts"]?.mutants[0];
  assert.ok(cMutant);
  cMutant.id = "0";
  assert.throws(
    () => createShardReceipt(duplicate, metadata(1)),
    /duplicate mutant id/,
  );

  for (const status of ["Pending", "Complete"]) {
    const report = reportFor(0);
    const owned = report.files["src/a.ts"]?.mutants[0];
    assert.ok(owned);
    owned.status = status;
    assert.throws(
      () => createShardReceipt(report, metadata(0)),
      /nonterminal or unknown status/,
    );
  }
});
