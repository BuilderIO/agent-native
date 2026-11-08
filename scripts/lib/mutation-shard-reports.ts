import { createHash } from "node:crypto";

export type TerminalMutantStatus =
  | "Killed"
  | "Survived"
  | "NoCoverage"
  | "CompileError"
  | "RuntimeError"
  | "Timeout"
  | "Ignored";

export interface MutationPosition {
  line: number;
  column: number;
}

export interface MutationLocation {
  start: MutationPosition;
  end: MutationPosition;
}

export interface MutantIdentity {
  file: string;
  id: string;
  mutatorName: string;
  replacement: string;
  location: MutationLocation;
}

export interface OwnedMutantResult extends MutantIdentity {
  status: TerminalMutantStatus;
  description?: string;
  duration?: number;
  static?: boolean;
  statusReason?: string;
  testsCompleted?: number;
}

export interface ShardMetadata {
  head: string;
  base: string;
  configHash: string;
  scopeHash: string;
  testScopeHash: string;
  shardIndex: number;
  shardCount: number;
}

export interface ShardReceipt extends ShardMetadata {
  inventoryHash: string;
  testInventoryHash: string;
  inventory: MutantIdentity[];
  files: Record<string, { source: string; language: string }>;
  ownedMutants: OwnedMutantResult[];
}

export interface ExpectedShardSet {
  head: string;
  base: string;
  configHash: string;
  scopeHash: string;
  testScopeHash: string;
  shardCount: number;
}

export interface AggregatedMutationFiles {
  files: Record<
    string,
    {
      source: string;
      language: string;
      mutants: Array<Omit<OwnedMutantResult, "file">>;
    }
  >;
  inventoryHash: string;
  testInventoryHash: string;
}

const TERMINAL_STATUSES = new Set<TerminalMutantStatus>([
  "Killed",
  "Survived",
  "NoCoverage",
  "CompileError",
  "RuntimeError",
  "Timeout",
  "Ignored",
]);

type UnknownRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new Error(`Invalid mutation shard report: ${message}`);
}

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function nonEmptyString(value: unknown, label: string): string {
  const text = stringValue(value, label);
  if (text.length === 0) {
    return invalid(`${label} must be a non-empty string`);
  }
  return text;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") return invalid(`${label} must be a string`);
  return value;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    return invalid(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return invalid(`${label} must be an array`);
  return value;
}

function relativeFilePath(value: unknown, label: string): string {
  const file = nonEmptyString(value, label);
  if (
    file.startsWith("/") ||
    file.includes("\\") ||
    file.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    return invalid(`${label} must be a normalized relative path`);
  }
  return file;
}

function position(value: unknown, label: string): MutationPosition {
  const input = record(value, label);
  return {
    line: safeInteger(input.line, `${label}.line`, 1),
    column: safeInteger(input.column, `${label}.column`, 1),
  };
}

function comparePosition(a: MutationPosition, b: MutationPosition): number {
  return a.line === b.line ? a.column - b.column : a.line - b.line;
}

function location(value: unknown, label: string): MutationLocation {
  const input = record(value, label);
  const start = position(input.start, `${label}.start`);
  const end = position(input.end, `${label}.end`);
  if (comparePosition(start, end) > 0) {
    return invalid(`${label}.end must not precede start`);
  }
  return { start, end };
}

function mutantIdentity(
  fileValue: unknown,
  value: unknown,
  label: string,
): MutantIdentity {
  const input = record(value, label);
  const id = nonEmptyString(input.id, `${label}.id`);
  if (!/^(0|[1-9]\d*)$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return invalid(`${label}.id must be a canonical numeric id`);
  }
  return {
    file: relativeFilePath(fileValue, `${label}.file`),
    id,
    mutatorName: nonEmptyString(input.mutatorName, `${label}.mutatorName`),
    replacement: stringValue(input.replacement, `${label}.replacement`),
    location: location(input.location, `${label}.location`),
  };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareIdentities(a: MutantIdentity, b: MutantIdentity): number {
  return (
    compareStrings(a.file, b.file) ||
    Number(a.id) - Number(b.id) ||
    compareStrings(a.mutatorName, b.mutatorName) ||
    compareStrings(a.replacement, b.replacement) ||
    comparePosition(a.location.start, b.location.start) ||
    comparePosition(a.location.end, b.location.end)
  );
}

function assertUniqueMutantIds(mutants: readonly MutantIdentity[]): void {
  const ids = new Set<string>();
  for (const mutant of mutants) {
    if (ids.has(mutant.id)) invalid(`duplicate mutant id ${mutant.id}`);
    ids.add(mutant.id);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortedSourceEntries(
  files: Record<string, { source: string; language: string }>,
) {
  return Object.entries(files)
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([file, value]) => ({
      file,
      language: value.language,
      sourceHash: sha256(value.source),
    }));
}

function hashMutantInventory(
  inventory: readonly MutantIdentity[],
  files: Record<string, { source: string; language: string }>,
): string {
  return sha256(
    JSON.stringify({
      mutants: [...inventory].sort(compareIdentities),
      files: sortedSourceEntries(files),
    }),
  );
}

interface TestIdentity {
  file: string;
  name: string;
  location: { start: MutationPosition; end?: MutationPosition } | null;
}

interface ParsedTestInventory {
  hash: string;
  ids: ReadonlySet<string>;
  count: number;
}

function parseTestInventory(value: unknown): ParsedTestInventory {
  if (value === undefined) {
    return { hash: sha256("[]"), ids: new Set(), count: 0 };
  }
  const testFiles = record(value, "report.testFiles");
  const seenIds = new Set<string>();
  let count = 0;
  const normalized = Object.entries(testFiles)
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([file, testFileValue]) => {
      nonEmptyString(file, "report.testFiles path");
      const testFile = record(testFileValue, `report.testFiles.${file}`);
      const source =
        testFile.source === undefined
          ? null
          : stringValue(testFile.source, `report.testFiles.${file}.source`);
      const tests = array(testFile.tests, `report.testFiles.${file}.tests`)
        .map((testValue, index): TestIdentity => {
          const test = record(
            testValue,
            `report.testFiles.${file}.tests[${index}]`,
          );
          const id = nonEmptyString(
            test.id,
            `report.testFiles.${file}.tests[${index}].id`,
          );
          if (seenIds.has(id)) invalid(`duplicate test id ${id}`);
          seenIds.add(id);
          count += 1;
          let testLocation: TestIdentity["location"] = null;
          if (test.location !== undefined) {
            const input = record(
              test.location,
              `report.testFiles.${file}.tests[${index}].location`,
            );
            const start = position(
              input.start,
              `report.testFiles.${file}.tests[${index}].location.start`,
            );
            const end =
              input.end === undefined
                ? undefined
                : position(
                    input.end,
                    `report.testFiles.${file}.tests[${index}].location.end`,
                  );
            if (end && comparePosition(start, end) > 0) {
              invalid(`test location end must not precede start`);
            }
            testLocation = end ? { start, end } : { start };
          }
          return {
            file,
            name: nonEmptyString(
              test.name,
              `report.testFiles.${file}.tests[${index}].name`,
            ),
            location: testLocation,
          };
        })
        .sort(
          (a, b) =>
            compareStrings(a.name, b.name) ||
            compareStrings(
              JSON.stringify(a.location),
              JSON.stringify(b.location),
            ),
        );
      return { file, source, tests };
    });
  return { hash: sha256(JSON.stringify(normalized)), ids: seenIds, count };
}

function parseStatus(value: unknown, label: string): TerminalMutantStatus {
  if (
    typeof value !== "string" ||
    !TERMINAL_STATUSES.has(value as TerminalMutantStatus)
  ) {
    return invalid(`${label} has a nonterminal or unknown status`);
  }
  return value as TerminalMutantStatus;
}

function validateTestIdReferences(
  input: UnknownRecord,
  key: "coveredBy" | "killedBy",
  label: string,
  testIds: ReadonlySet<string> | undefined,
): void {
  if (input[key] === undefined) return;
  if (!testIds) {
    invalid(`${label}.${key} cannot be retained without its test inventory`);
  }
  if (testIds.size === 0) {
    invalid(`${label}.${key} requires report.testFiles`);
  }
  for (const [index, value] of array(input[key], `${label}.${key}`).entries()) {
    const id = nonEmptyString(value, `${label}.${key}[${index}]`);
    if (!testIds.has(id))
      invalid(`${label}.${key} references an unknown test id`);
  }
}

function optionalString(
  input: UnknownRecord,
  key: "description" | "statusReason",
  label: string,
): string | undefined {
  if (input[key] === undefined) return undefined;
  if (typeof input[key] !== "string") {
    return invalid(`${label}.${key} must be a string`);
  }
  return input[key];
}

function optionalNonnegativeNumber(
  input: UnknownRecord,
  key: "duration" | "testsCompleted",
  label: string,
  integer: boolean,
): number | undefined {
  if (input[key] === undefined) return undefined;
  const value = input[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  ) {
    return invalid(`${label}.${key} must be a nonnegative number`);
  }
  return value;
}

function ownedMutantResult(
  fileValue: unknown,
  value: unknown,
  label: string,
  testIds?: ReadonlySet<string>,
): OwnedMutantResult {
  const input = record(value, label);
  const identity = mutantIdentity(fileValue, input, label);
  const status = parseStatus(input.status, `${label}.status`);
  validateTestIdReferences(input, "coveredBy", label, testIds);
  validateTestIdReferences(input, "killedBy", label, testIds);
  const description = optionalString(input, "description", label);
  const statusReason = optionalString(input, "statusReason", label);
  const duration = optionalNonnegativeNumber(input, "duration", label, false);
  const testsCompleted = optionalNonnegativeNumber(
    input,
    "testsCompleted",
    label,
    true,
  );
  if (input.static !== undefined && typeof input.static !== "boolean") {
    return invalid(`${label}.static must be a boolean`);
  }
  return {
    ...identity,
    status,
    ...(description === undefined ? {} : { description }),
    ...(duration === undefined ? {} : { duration }),
    ...(input.static === undefined ? {} : { static: input.static }),
    ...(statusReason === undefined ? {} : { statusReason }),
    ...(testsCompleted === undefined ? {} : { testsCompleted }),
  };
}

function shardMetadata(value: unknown, label: string): ShardMetadata {
  const input = record(value, label);
  const metadata: ShardMetadata = {
    head: nonEmptyString(input.head, `${label}.head`),
    base: nonEmptyString(input.base, `${label}.base`),
    configHash: nonEmptyString(input.configHash, `${label}.configHash`),
    scopeHash: nonEmptyString(input.scopeHash, `${label}.scopeHash`),
    testScopeHash: nonEmptyString(
      input.testScopeHash,
      `${label}.testScopeHash`,
    ),
    shardIndex: safeInteger(input.shardIndex, `${label}.shardIndex`),
    shardCount: safeInteger(input.shardCount, `${label}.shardCount`, 1),
  };
  if (metadata.shardIndex >= metadata.shardCount) {
    return invalid(`${label}.shardIndex must be less than shardCount`);
  }
  return metadata;
}

function filesAndInventory(reportValue: unknown, testIds: ReadonlySet<string>) {
  const report = record(reportValue, "report");
  const reportFiles = record(report.files, "report.files");
  const files = Object.create(null) as Record<
    string,
    { source: string; language: string }
  >;
  const inventory: MutantIdentity[] = [];
  const statuses = new Map<string, OwnedMutantResult>();

  for (const [fileKey, fileValue] of Object.entries(reportFiles)) {
    const file = relativeFilePath(fileKey, "report.files path");
    const fileRecord = record(fileValue, `report.files.${file}`);
    files[file] = {
      source: stringValue(fileRecord.source, `report.files.${file}.source`),
      language: nonEmptyString(
        fileRecord.language,
        `report.files.${file}.language`,
      ),
    };
    const mutants = array(fileRecord.mutants, `report.files.${file}.mutants`);
    for (const [index, mutantValue] of mutants.entries()) {
      const label = `report.files.${file}.mutants[${index}]`;
      const mutant = ownedMutantResult(file, mutantValue, label, testIds);
      inventory.push({
        file: mutant.file,
        id: mutant.id,
        mutatorName: mutant.mutatorName,
        replacement: mutant.replacement,
        location: mutant.location,
      });
      statuses.set(`${file}\0${mutant.id}`, mutant);
    }
  }

  inventory.sort(compareIdentities);
  assertUniqueMutantIds(inventory);
  if (inventory.some(({ file }) => files[file] === undefined)) {
    return invalid("mutant refers to a file without source");
  }
  return { files, inventory, statuses };
}

function sameIdentities(
  a: readonly MutantIdentity[],
  b: readonly MutantIdentity[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameIdentity(a: MutantIdentity, b: MutantIdentity): boolean {
  return (
    JSON.stringify(a) ===
    JSON.stringify({
      file: b.file,
      id: b.id,
      mutatorName: b.mutatorName,
      replacement: b.replacement,
      location: b.location,
    })
  );
}

function sameSources(
  a: Record<string, { source: string; language: string }>,
  b: Record<string, { source: string; language: string }>,
): boolean {
  return (
    JSON.stringify(sortedSourceEntries(a)) ===
      JSON.stringify(sortedSourceEntries(b)) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(
      ([file, source]) =>
        b[file]?.source === source.source &&
        b[file]?.language === source.language,
    )
  );
}

function parseReceipt(value: unknown, index: number): ShardReceipt {
  const input = record(value, `receipts[${index}]`);
  const metadata = shardMetadata(input, `receipts[${index}]`);
  const inventory = array(input.inventory, `receipts[${index}].inventory`)
    .map((entry, entryIndex) =>
      mutantIdentity(
        record(entry, `receipts[${index}].inventory[${entryIndex}]`).file,
        entry,
        `receipts[${index}].inventory[${entryIndex}]`,
      ),
    )
    .sort(compareIdentities);
  assertUniqueMutantIds(inventory);

  const fileInputs = record(input.files, `receipts[${index}].files`);
  const files = Object.create(null) as Record<
    string,
    { source: string; language: string }
  >;
  for (const [fileKey, fileValue] of Object.entries(fileInputs)) {
    const file = relativeFilePath(fileKey, `receipts[${index}].files path`);
    const fileRecord = record(fileValue, `receipts[${index}].files.${file}`);
    files[file] = {
      source: stringValue(
        fileRecord.source,
        `receipts[${index}].files.${file}.source`,
      ),
      language: nonEmptyString(
        fileRecord.language,
        `receipts[${index}].files.${file}.language`,
      ),
    };
  }
  if (inventory.some(({ file }) => files[file] === undefined)) {
    return invalid(`receipts[${index}] inventory refers to a missing source`);
  }
  const inventoryHash = nonEmptyString(
    input.inventoryHash,
    `receipts[${index}].inventoryHash`,
  );
  if (inventoryHash !== hashMutantInventory(inventory, files)) {
    return invalid(`receipts[${index}] inventory hash does not match its data`);
  }
  const testInventoryHash = nonEmptyString(
    input.testInventoryHash,
    `receipts[${index}].testInventoryHash`,
  );
  const ownedMutants = array(
    input.ownedMutants,
    `receipts[${index}].ownedMutants`,
  ).map((entry, entryIndex) =>
    ownedMutantResult(
      record(entry, `receipts[${index}].ownedMutants[${entryIndex}]`).file,
      entry,
      `receipts[${index}].ownedMutants[${entryIndex}]`,
    ),
  );

  const expectedOwned = inventory.filter(
    ({ id }) => Number(id) % metadata.shardCount === metadata.shardIndex,
  );
  if (ownedMutants.length !== expectedOwned.length) {
    return invalid(`receipts[${index}] is missing or has extra owned results`);
  }
  const ownedById = new Map<string, OwnedMutantResult>();
  for (const mutant of ownedMutants) {
    if (ownedById.has(mutant.id)) {
      invalid(`receipts[${index}] has duplicate owned mutant id ${mutant.id}`);
    }
    ownedById.set(mutant.id, mutant);
  }
  for (const identity of expectedOwned) {
    const result = ownedById.get(identity.id);
    if (!result || !sameIdentity(identity, result)) {
      invalid(
        `receipts[${index}] lacks the owned result for mutant ${identity.id}`,
      );
    }
  }
  return {
    ...metadata,
    inventoryHash,
    testInventoryHash,
    inventory,
    files,
    ownedMutants,
  };
}

function compareMetadata(
  actual: ShardMetadata,
  expected: ExpectedShardSet,
  index: number,
): void {
  for (const key of [
    "head",
    "base",
    "configHash",
    "scopeHash",
    "testScopeHash",
    "shardCount",
  ] as const) {
    if (actual[key] !== expected[key]) {
      invalid(`receipts[${index}].${key} does not match the expected run`);
    }
  }
}

/** Validates a complete Stryker report and retains only this shard's real results. */
export function createShardReceipt(
  report: unknown,
  metadata: ShardMetadata,
): ShardReceipt {
  const validatedMetadata = shardMetadata(metadata, "metadata");
  const parsedReport = record(report, "report");
  const tests = parseTestInventory(parsedReport.testFiles);
  const { files, inventory, statuses } = filesAndInventory(
    parsedReport,
    tests.ids,
  );
  if (inventory.length > 0 && tests.count === 0) {
    return invalid(
      "report.testFiles must contain tests when mutants are instrumented",
    );
  }
  const ownedMutants = inventory
    .filter(
      ({ id }) =>
        Number(id) % validatedMetadata.shardCount ===
        validatedMetadata.shardIndex,
    )
    .map((identity) => {
      const result = statuses.get(`${identity.file}\0${identity.id}`);
      if (!result)
        invalid(`owned mutant ${identity.id} has no terminal result`);
      return result;
    });
  return {
    ...validatedMetadata,
    inventoryHash: hashMutantInventory(inventory, files),
    testInventoryHash: tests.hash,
    inventory,
    files,
    ownedMutants,
  };
}

/** Reconstructs the full terminal Stryker file report from a complete shard set. */
export function aggregateShardReceipts(
  receipts: readonly unknown[],
  expected: ExpectedShardSet,
): AggregatedMutationFiles {
  const count = safeInteger(expected.shardCount, "expected.shardCount", 1);
  if (receipts.length !== count) {
    return invalid(`expected ${count} receipts, received ${receipts.length}`);
  }
  const rawMetadata = receipts.map((receipt, index) =>
    shardMetadata(receipt, `receipts[${index}]`),
  );
  const rawIndices = new Set<number>();
  rawMetadata.forEach((metadata, index) => {
    compareMetadata(metadata, expected, index);
    if (rawIndices.has(metadata.shardIndex)) {
      invalid(`duplicate shard index ${metadata.shardIndex}`);
    }
    rawIndices.add(metadata.shardIndex);
  });
  for (let index = 0; index < count; index += 1) {
    if (!rawIndices.has(index)) invalid(`missing shard index ${index}`);
  }
  const parsed = receipts.map(parseReceipt);
  const byIndex = new Map<number, ShardReceipt>();
  parsed.forEach((receipt) => {
    byIndex.set(receipt.shardIndex, receipt);
  });
  const ordered = [...byIndex.values()].sort(
    (a, b) => a.shardIndex - b.shardIndex,
  );
  const first = ordered[0];
  if (!first) return invalid("no shard receipts were provided");
  for (const receipt of ordered.slice(1)) {
    if (receipt.inventoryHash !== first.inventoryHash) {
      invalid("shards disagree on mutant inventory or source hash");
    }
    if (!sameIdentities(receipt.inventory, first.inventory)) {
      invalid("shards disagree on mutant identities");
    }
    if (!sameSources(receipt.files, first.files)) {
      invalid("shards disagree on file source");
    }
    if (receipt.testInventoryHash !== first.testInventoryHash) {
      invalid("shards disagree on test inventory");
    }
  }

  const terminalById = new Map<string, OwnedMutantResult>();
  for (const receipt of ordered) {
    for (const mutant of receipt.ownedMutants) {
      if (terminalById.has(mutant.id)) {
        invalid(`multiple shards report mutant ${mutant.id}`);
      }
      terminalById.set(mutant.id, mutant);
    }
  }
  const fileMutants = new Map<string, Array<Omit<OwnedMutantResult, "file">>>();
  for (const identity of first.inventory) {
    const result = terminalById.get(identity.id);
    if (!result || !sameIdentity(identity, result)) {
      invalid(`missing terminal owner result for mutant ${identity.id}`);
    }
    const { file: _file, ...reportMutant } = result;
    const current = fileMutants.get(identity.file) ?? [];
    current.push(reportMutant);
    fileMutants.set(identity.file, current);
  }

  const files = Object.fromEntries(
    Object.entries(first.files)
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([file, source]) => [
        file,
        {
          ...source,
          mutants: (fileMutants.get(file) ?? []).sort((a, b) =>
            compareIdentities({ file, ...a }, { file, ...b }),
          ),
        },
      ]),
  );
  return {
    files,
    inventoryHash: first.inventoryHash,
    testInventoryHash: first.testInventoryHash,
  };
}
