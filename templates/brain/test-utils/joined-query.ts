export interface FixtureColumn {
  table: string;
  name: string;
}

export type FixtureRow = Record<string, unknown>;

export function fixtureColumnValue(row: FixtureRow, column: FixtureColumn) {
  const key = `${column.table}.${column.name}`;
  return key in row ? row[key] : row[column.name];
}

interface JoinedQuery<Condition> {
  innerJoin(table: FixtureRow, condition: Condition): JoinedQuery<Condition>;
  where(condition: Condition): { limit(limit: number): Promise<FixtureRow[]> };
}

export function createJoinedQuery<Condition>(
  selection: Record<string, FixtureColumn>,
  table: FixtureRow,
  tableRows: (table: FixtureRow) => FixtureRow[],
  matches: (row: FixtureRow, condition: Condition) => boolean,
): JoinedQuery<Condition> {
  function qualifiedRows(tableRef: FixtureRow) {
    return tableRows(tableRef).map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          `${String(tableRef.__tableName)}.${key}`,
          value,
        ]),
      ),
    );
  }
  function query(items: FixtureRow[]): JoinedQuery<Condition> {
    return {
      innerJoin: (tableRef, condition) =>
        query(
          items.flatMap((row) =>
            qualifiedRows(tableRef)
              .map((joined) => ({ ...row, ...joined }))
              .filter((joined) => matches(joined, condition)),
          ),
        ),
      where: (condition) => ({
        limit: async (limit) =>
          items
            .filter((row) => matches(row, condition))
            .map((row) =>
              Object.fromEntries(
                Object.entries(selection).map(([key, column]) => [
                  key,
                  fixtureColumnValue(row, column),
                ]),
              ),
            )
            .slice(0, limit),
      }),
    };
  }
  return query(qualifiedRows(table));
}
