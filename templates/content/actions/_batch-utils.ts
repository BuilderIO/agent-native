import { getDialect, type Dialect } from "@agent-native/core/db";

export function chunks<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export function bulkChunkSizeForColumnCount(
  columnCount: number,
  dialect: Dialect = getDialect(),
) {
  // D1 rejects statements with more than 100 bound params, so derive every
  // bulk chunk from the statement's column count instead of a fixed row count.
  const budget = dialect === "d1" ? 90 : 900;
  return Math.max(1, Math.floor(budget / Math.max(1, columnCount)));
}

export async function processWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(concurrency)),
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        if (item !== undefined) await worker(item);
      }
    }),
  );
}
