export function readValueOption(args: readonly string[], flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (args.indexOf(flag, index + 1) >= 0) {
    throw new Error(`${flag} may be provided only once`);
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function authoringFilterError(
  sourceFilter?: string,
  flowFilter?: string,
) {
  if (sourceFilter === "largest" && flowFilter) {
    return "--authoring-flow cannot be combined with --authoring-source largest";
  }
}

export type ShardSelection = { index: number; total: number };

// `--authoring-shard 2/3` is the second of three slices; the CLI counts from 1.
export function parseShard(value: string | undefined) {
  if (value === undefined) return undefined;
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  const position = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || position < 1 || total < 1 || position > total) {
    throw new Error(
      `--authoring-shard expects <position>/<total> with 1 <= position <= total, got ${value}`,
    );
  }
  return { index: position - 1, total } satisfies ShardSelection;
}

// Striping, not contiguous slices: the cases are grouped by kind, so a block
// would hand one shard every slow shortcut case.
export function selectShard<T>(
  items: readonly T[],
  shard: ShardSelection | undefined,
) {
  if (!shard) return [...items];
  return items.filter((_, position) => position % shard.total === shard.index);
}
