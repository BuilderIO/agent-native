import assert from "node:assert/strict";
import test from "node:test";

import {
  createMutationShardRunner,
  createMutationShardPlugin,
  parseMutationShard,
} from "./lib/mutation-shard-runner.mjs";
import type {
  MutationTestRunner,
  ShardMutantOptions,
} from "./lib/mutation-shard-runner.mjs";

test("delegates owned mutants with the identical options and keeps others partial", async () => {
  const options: ShardMutantOptions & {
    mutantActivation: string;
    testFilter: string[];
    timeout: number;
    hitLimit: number;
  } = {
    activeMutant: { id: "7" },
    mutantActivation: "static",
    testFilter: ["one"],
    timeout: 123,
    hitLimit: 456,
  };
  const expected = {
    status: "killed",
    killedBy: ["one"],
    failureMessage: "failure",
    nrOfTests: 1,
  };
  const calls: ShardMutantOptions[] = [];
  const runner: MutationTestRunner = {
    capabilities: () => ({}),
    dryRun: () => ({}),
    mutantRun: (value) => {
      calls.push(value);
      return expected;
    },
  };
  const shard = createMutationShardRunner(runner, { index: 1, count: 3 });
  assert.equal(await shard.mutantRun(options), expected);
  assert.equal(calls[0], options);
  assert.deepEqual(
    await shard.mutantRun({ ...options, activeMutant: { id: "8" } }),
    { status: "survived", nrOfTests: 0 },
  );
  assert.equal(calls.length, 1);
});

test("passes complete dry run and lifecycle calls with original receiver", async () => {
  const dryOptions = { coverageAnalysis: "perTest" };
  const dryResult = {
    status: "complete",
    tests: [{ id: "one" }],
    mutantCoverage: { static: { "0": 1 } },
  };
  const capabilities = { reloadEnvironment: true };
  const seen: unknown[] = [];
  const runner: MutationTestRunner = {
    capabilities() {
      assert.equal(this, runner);
      return capabilities;
    },
    init() {
      assert.equal(this, runner);
      seen.push("init");
    },
    dryRun(options) {
      assert.equal(this, runner);
      assert.equal(options, dryOptions);
      return dryResult;
    },
    mutantRun() {
      throw new Error("unexpected");
    },
    dispose() {
      assert.equal(this, runner);
      seen.push("dispose");
    },
  };
  const shard = createMutationShardRunner(runner, { index: 0, count: 1 });
  assert.equal(await shard.capabilities(), capabilities);
  await shard.init?.();
  assert.equal(await shard.dryRun(dryOptions), dryResult);
  await shard.dispose?.();
  assert.deepEqual(seen, ["init", "dispose"]);
});

test("propagates runner failures instead of coercing them", async () => {
  const error = new Error("runner failed");
  const runner: MutationTestRunner = {
    capabilities: () => {
      throw error;
    },
    dryRun: async () => {
      throw error;
    },
    mutantRun: async () => {
      throw error;
    },
  };
  const shard = createMutationShardRunner(runner, { index: 0, count: 1 });
  assert.throws(
    () => shard.capabilities(),
    (received) => received === error,
  );
  await assert.rejects(
    Promise.resolve(shard.dryRun({})),
    (received) => received === error,
  );
  await assert.rejects(
    Promise.resolve(shard.mutantRun({ activeMutant: { id: "0" } })),
    (received) => received === error,
  );
});

test("rejects invalid or missing shard metadata and mutant IDs", () => {
  for (const [index, count] of [
    [undefined, undefined],
    ["0", undefined],
    ["-1", "2"],
    ["0", "0"],
    ["2", "2"],
    ["1.0", "2"],
    ["01", "2"],
    ["0", "9007199254740992"],
  ] as const) {
    assert.throws(() => parseMutationShard(index, count));
  }
  const runner: MutationTestRunner = {
    capabilities: () => ({}),
    dryRun: () => ({}),
    mutantRun: () => ({}),
  };
  const shard = createMutationShardRunner(runner, { index: 0, count: 2 });
  for (const id of ["-1", "01", "1.5", "9007199254740992", ""]) {
    assert.throws(() => shard.mutantRun({ activeMutant: { id } }));
  }
});

test("composes the public Vitest factory with its injection metadata", () => {
  const runner: MutationTestRunner = {
    capabilities: () => ({}),
    dryRun: () => ({}),
    mutantRun: () => ({}),
  };
  const injector = {};
  const original = Object.assign(
    (value: unknown) => {
      assert.equal(value, injector);
      return runner;
    },
    { inject: ["$injector"] },
  );
  const plugin = createMutationShardPlugin(
    {
      strykerPlugins: [
        { kind: "TestRunner", name: "vitest", factory: original },
      ],
    },
    { index: 0, count: 1 },
  );
  assert.equal(plugin.name, "sharded-vitest");
  assert.equal(plugin.kind, "TestRunner");
  assert.equal(plugin.factory.inject, original.inject);
  assert.deepEqual(plugin.factory(injector).capabilities(), {});
  assert.throws(() => createMutationShardPlugin({}, { index: 0, count: 1 }));
  assert.throws(() =>
    createMutationShardPlugin(
      {
        strykerPlugins: [
          { kind: "TestRunner", name: "vitest", factory: () => runner },
        ],
      },
      { index: 0, count: 1 },
    ),
  );
});
