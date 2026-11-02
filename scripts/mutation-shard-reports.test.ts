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

const expected: ExpectedShardSet = {
  head: "a".repeat(40),
  base: "b".repeat(40),
  configHash: "c".repeat(64),
  scopeHash: "d".repeat(64),
  testScopeHash: "e".repeat(64),
  shardCount: 4,
};

const statuses: Record<string, TerminalMutantStatus> = {
  "0": "Killed",
  "1": "Survived",
  "2": "NoCoverage",
  "3": "Ignored",
  "4": "Timeout",
  "5": "CompileError",
  "6": "RuntimeError",
};

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
  return { ...expected, shardIndex };
}

function reportFor(shardIndex: number): FixtureReport {
  const makeMutant = (
    id: string,
    replacement = "changed",
  ): Record<string, unknown> => ({
    id,
    mutatorName: "StringLiteral",
    replacement,
    location: {
      start: { line: Number(id) + 1, column: 1 },
      end: { line: Number(id) + 1, column: 6 },
    },
    status:
      Number(id) % expected.shardCount === shardIndex
        ? statuses[id]
        : "Survived",
    ...(Number(id) % expected.shardCount === shardIndex
      ? {
          testsCompleted: Number(id) + 1,
          coveredBy: ["test-0"],
          ...(id === "0" ? { killedBy: ["test-1"] } : {}),
        }
      : { testsCompleted: 0 }),
  });
  return {
    files: {
      "src/a.ts": {
        language: "typescript",
        source: "export const a = 'a';\n",
        mutants: [makeMutant("0"), makeMutant("1")],
      },
      "src/b.ts": {
        language: "typescript",
        source: "export const b = 'b';\n",
        mutants: [
          makeMutant("2"),
          makeMutant("3"),
          makeMutant("4"),
          makeMutant("5"),
          makeMutant("6"),
        ],
      },
    },
    testFiles: {
      "src/a.test.ts": {
        source: "test('a', () => expect(a).toBe('a'));\n",
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
  return Array.from({ length: expected.shardCount }, (_, shardIndex) =>
    createShardReceipt(reportFor(shardIndex), metadata(shardIndex)),
  );
}

test("reconstructs the complete weighted union and preserves every owner status", () => {
  const input = receipts();
  assert.deepEqual(
    input.map(({ ownedMutants }) => ownedMutants.length),
    [2, 2, 2, 1],
  );

  const report = aggregateShardReceipts(input, expected);
  const merged = [
    ...report.files["src/a.ts"]!.mutants,
    ...report.files["src/b.ts"]!.mutants,
  ];
  assert.equal(merged.length, 7);
  assert.deepEqual(
    Object.fromEntries(merged.map((mutant) => [mutant.id, mutant.status])),
    statuses,
  );
  assert.equal(report.files["src/a.ts"]!.source, "export const a = 'a';\n");
  assert.deepEqual(
    report.files["src/b.ts"]!.mutants.map((mutant) => mutant.id),
    ["2", "3", "4", "5", "6"],
  );
});

test("hashes stable identities and test inventory, not runtime mutant metadata", () => {
  const firstReport = reportFor(0);
  const secondReport = structuredClone(firstReport);
  secondReport.files["src/a.ts"]!.mutants.reverse();
  const tests = secondReport.testFiles!["src/a.test.ts"]!.tests;
  tests.reverse();
  tests.forEach((entry, index) => {
    entry.id = `renumbered-${index}`;
  });
  secondReport.files["src/a.ts"]!.mutants[1]!.status = "Survived";
  secondReport.files["src/a.ts"]!.mutants[1]!.coveredBy = ["renumbered-0"];
  secondReport.files["src/a.ts"]!.mutants[0]!.coveredBy = ["renumbered-0"];
  secondReport.files["src/a.ts"]!.mutants[1]!.killedBy = ["renumbered-1"];
  secondReport.files["src/a.ts"]!.mutants[1]!.testsCompleted = 999;
  for (const file of Object.values(secondReport.files)) {
    for (const mutant of file.mutants) {
      if (Array.isArray(mutant.coveredBy)) mutant.coveredBy = ["renumbered-0"];
      if (Array.isArray(mutant.killedBy)) mutant.killedBy = ["renumbered-1"];
    }
  }

  const first = createShardReceipt(firstReport, metadata(0));
  const second = createShardReceipt(secondReport, metadata(0));
  assert.equal(first.inventoryHash, second.inventoryHash);
  assert.equal(first.testInventoryHash, second.testInventoryHash);
  assert.equal("coveredBy" in second.ownedMutants[0]!, false);
  assert.equal("killedBy" in second.ownedMutants[0]!, false);

  secondReport.testFiles!["src/a.test.ts"]!.source = "different test source";
  assert.notEqual(
    createShardReceipt(secondReport, metadata(0)).testInventoryHash,
    first.testInventoryHash,
  );
  secondReport.testFiles!["src/a.test.ts"]!.tests[0]!.name = "renamed test";
  assert.notEqual(
    createShardReceipt(secondReport, metadata(0)).testInventoryHash,
    first.testInventoryHash,
  );

  const duplicateIdentity = reportFor(0);
  const duplicateTest =
    duplicateIdentity.testFiles!["src/a.test.ts"]!.tests[0]!;
  duplicateIdentity.testFiles!["src/a.test.ts"]!.tests.push({
    ...duplicateTest,
    id: "duplicate-semantic-test",
  });
  assert.notEqual(
    createShardReceipt(duplicateIdentity, metadata(0)).testInventoryHash,
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
  unknownReference.files["src/a.ts"]!.mutants[0]!.coveredBy = ["missing"];
  assert.throws(
    () => createShardReceipt(unknownReference, metadata(0)),
    /unknown test id/,
  );

  const duplicateTestId = reportFor(0);
  duplicateTestId.testFiles!["src/a.test.ts"]!.tests[1]!.id = "test-1";
  assert.throws(
    () => createShardReceipt(duplicateTestId, metadata(0)),
    /duplicate test id/,
  );
});

test("rejects missing and duplicate shard indices", () => {
  const input = receipts();
  assert.throws(
    () => aggregateShardReceipts(input.slice(0, 3), expected),
    /expected 4 receipts/,
  );
  assert.throws(
    () =>
      aggregateShardReceipts(
        [input[0]!, input[0]!, input[2]!, input[3]!],
        expected,
      ),
    /duplicate shard index 0/,
  );
});

test("rejects stale heads, bases, hashes, and shard counts", () => {
  const input = receipts();
  const staleFields = [
    "head",
    "base",
    "configHash",
    "scopeHash",
    "testScopeHash",
  ] as const;
  for (const field of staleFields) {
    const stale = input.map((receipt, index) =>
      index === 0 ? { ...receipt, [field]: "stale" } : receipt,
    );
    assert.throws(
      () => aggregateShardReceipts(stale, expected),
      /does not match/,
    );
  }
  const wrongCount = input.map((receipt, index) =>
    index === 0 ? { ...receipt, shardCount: 3 } : receipt,
  );
  assert.throws(
    () => aggregateShardReceipts(wrongCount, expected),
    /shardCount does not match/,
  );
});

test("rejects inconsistent mutant identity and source across shards", () => {
  const input = receipts();
  const changedIdentity = createShardReceipt(
    (() => {
      const report = reportFor(1);
      report.files["src/a.ts"]!.mutants[0]!.replacement = "different";
      return report;
    })(),
    metadata(1),
  );
  assert.throws(
    () =>
      aggregateShardReceipts(
        [input[0]!, changedIdentity, input[2]!, input[3]!],
        expected,
      ),
    /inventory or source hash/,
  );

  const changedSource = createShardReceipt(
    (() => {
      const report = reportFor(1);
      report.files["src/b.ts"]!.source = "changed source";
      return report;
    })(),
    metadata(1),
  );
  assert.throws(
    () =>
      aggregateShardReceipts(
        [input[0]!, changedSource, input[2]!, input[3]!],
        expected,
      ),
    /inventory or source hash/,
  );

  const changedTests = createShardReceipt(
    (() => {
      const report = reportFor(1);
      report.testFiles!["src/a.test.ts"]!.source = "changed test source";
      return report;
    })(),
    metadata(1),
  );
  assert.throws(
    () =>
      aggregateShardReceipts(
        [input[0]!, changedTests, input[2]!, input[3]!],
        expected,
      ),
    /test inventory/,
  );
});

test("rejects missing or extra owned results", () => {
  const input = receipts();
  const missing = input.map((receipt, index) =>
    index === 0
      ? { ...receipt, ownedMutants: receipt.ownedMutants.slice(1) }
      : receipt,
  );
  assert.throws(
    () => aggregateShardReceipts(missing, expected),
    /missing or has extra owned results/,
  );

  const extra = input.map((receipt, index) => {
    if (index !== 0) return receipt;
    const nonOwner = receipt.inventory.find(
      (mutant) => Number(mutant.id) % expected.shardCount !== 0,
    );
    assert.ok(nonOwner);
    return {
      ...receipt,
      ownedMutants: [
        ...receipt.ownedMutants,
        { ...nonOwner, status: "Survived" as const },
      ],
    };
  });
  assert.throws(
    () => aggregateShardReceipts(extra, expected),
    /missing or has extra owned results/,
  );
});

test("rejects nonnumeric or duplicate mutant ids and nonterminal statuses", () => {
  const nonnumeric = reportFor(0);
  nonnumeric.files["src/a.ts"]!.mutants[0]!.id = "not-a-number";
  assert.throws(
    () => createShardReceipt(nonnumeric, metadata(0)),
    /canonical numeric id/,
  );

  const duplicate = reportFor(0);
  duplicate.files["src/b.ts"]!.mutants[0]!.id = "0";
  assert.throws(
    () => createShardReceipt(duplicate, metadata(0)),
    /duplicate mutant id/,
  );

  const pending = reportFor(0);
  pending.files["src/a.ts"]!.mutants[0]!.status = "Pending";
  assert.throws(
    () => createShardReceipt(pending, metadata(0)),
    /nonterminal or unknown status/,
  );

  const unknownStatus = reportFor(0);
  unknownStatus.files["src/a.ts"]!.mutants[0]!.status = "Complete";
  assert.throws(
    () => createShardReceipt(unknownStatus, metadata(0)),
    /nonterminal or unknown status/,
  );
});

test("ignores fake nonowner survivor outcomes and accepts owned NoCoverage", () => {
  const report = createShardReceipt(reportFor(2), metadata(2));
  assert.deepEqual(
    report.ownedMutants.map(({ id, status }) => ({ id, status })),
    [
      { id: "2", status: "NoCoverage" },
      { id: "6", status: "RuntimeError" },
    ],
  );
});
