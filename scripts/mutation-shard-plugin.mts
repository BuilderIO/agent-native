import {
  createMutationShardPlugin,
  parseMutationShard,
} from "./lib/mutation-shard-runner.mts";

const shard = parseMutationShard(
  process.env.MUTATION_SHARD_INDEX,
  process.env.MUTATION_SHARD_COUNT,
);
const packageName = "@stryker-mutator/vitest-runner";
const vitestPlugin: unknown = await import(packageName);
export const strykerPlugins = [createMutationShardPlugin(vitestPlugin, shard)];
