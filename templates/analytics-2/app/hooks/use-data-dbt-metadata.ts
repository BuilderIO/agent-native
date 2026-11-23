import { useActionQuery } from "@agent-native/core/client/hooks";

interface TableDbtMetadata {
  description?: string | null;
  docsUrl?: string | null;
  columns: readonly { name: string; description: string | null }[];
  tests: readonly {
    name: string;
    status: string | null;
    columnName: string | null;
  }[];
}

export function useDataDbtMetadata(
  connectionId: string,
  tableId: string,
  enabled: boolean,
) {
  const query = useActionQuery(
    "get-data-dbt-metadata",
    { connectionId, tableId },
    { enabled, retry: false },
  );
  const response = query.data as
    | {
        connectionId: string;
        tableId: string;
        metadata: TableDbtMetadata | null;
      }
    | undefined;
  return enabled &&
    !query.isError &&
    response?.connectionId === connectionId &&
    response.tableId === tableId
    ? response.metadata
    : null;
}
