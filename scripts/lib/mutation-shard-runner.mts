export interface MutationShard {
  index: number;
  count: number;
}

export interface ShardMutantOptions {
  activeMutant: { id: string };
}

export interface MutationTestRunner {
  capabilities(): unknown;
  init?(): unknown;
  dryRun(options: unknown): unknown;
  mutantRun(options: ShardMutantOptions): unknown;
  dispose?(): unknown;
}

function parseNatural(value: string | undefined, label: string): number {
  if (value === undefined || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer`);
  }
  return parsed;
}

export function parseMutationShard(
  index: string | undefined,
  count: string | undefined,
): MutationShard {
  const parsedIndex = parseNatural(index, "MUTATION_SHARD_INDEX");
  const parsedCount = parseNatural(count, "MUTATION_SHARD_COUNT");
  if (parsedCount === 0 || parsedIndex >= parsedCount) {
    throw new Error(
      "Mutation shard index must be less than a positive shard count",
    );
  }
  return { index: parsedIndex, count: parsedCount };
}

export function createMutationShardRunner(
  runner: MutationTestRunner,
  shard: MutationShard,
): MutationTestRunner {
  const validated = parseMutationShard(
    String(shard.index),
    String(shard.count),
  );
  return {
    capabilities: () => runner.capabilities(),
    ...(runner.init ? { init: () => runner.init?.() } : {}),
    dryRun: (options) => runner.dryRun(options),
    mutantRun: (options) => {
      const mutantId = parseNatural(options.activeMutant?.id, "mutant.id");
      if (mutantId % validated.count !== validated.index) {
        return { status: "survived", nrOfTests: 0 };
      }
      return runner.mutantRun(options);
    },
    ...(runner.dispose ? { dispose: () => runner.dispose?.() } : {}),
  };
}

export function createMutationShardPlugin(
  module: unknown,
  shard: MutationShard,
) {
  if (
    !module ||
    typeof module !== "object" ||
    !("strykerPlugins" in module) ||
    !Array.isArray(module.strykerPlugins)
  ) {
    throw new Error("Vitest runner plugin is unavailable");
  }
  const matches = module.strykerPlugins.filter(
    (plugin: unknown) =>
      !!plugin &&
      typeof plugin === "object" &&
      "kind" in plugin &&
      plugin.kind === "TestRunner" &&
      "name" in plugin &&
      plugin.name === "vitest" &&
      "factory" in plugin &&
      typeof plugin.factory === "function",
  );
  if (matches.length !== 1)
    throw new Error("Expected one Vitest runner factory");
  const original = matches[0] as {
    kind: "TestRunner";
    factory: ((...args: unknown[]) => MutationTestRunner) & {
      inject?: unknown;
    };
  };
  if (!Array.isArray(original.factory.inject)) {
    throw new Error("Vitest runner factory injection metadata is unavailable");
  }
  const factory = Object.assign(
    (...args: unknown[]) =>
      createMutationShardRunner(original.factory(...args), shard),
    { inject: original.factory.inject },
  );
  return { kind: original.kind, name: "sharded-vitest", factory };
}
