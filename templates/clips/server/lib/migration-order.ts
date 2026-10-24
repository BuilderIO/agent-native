export function orderMigrationsByVersion<T extends { version: number }>(
  migrations: readonly T[],
): T[] {
  return [...migrations].sort((left, right) => left.version - right.version);
}
