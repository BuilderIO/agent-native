export const SAMPLE_DATA_SOURCE_ID = "builtin-sample-data";
export const SAMPLE_DATA_SOURCE_NAME = "[Demo] Public Data";
export const SAMPLE_QUERY_MAX_WORKERS = 2;

export interface SampleDataBrowseResult {
  source: { id: string; name: string };
  schemas: string[];
  tables: { name: string; schema: string; rowCount: number }[];
  preview: {
    table: string;
    columns: {
      name: string;
      dataType: string;
      nullable: boolean;
      ordinalPosition: number;
    }[];
    rows: Record<string, string | number | boolean | null>[];
    complete: boolean;
  } | null;
}

export const SAMPLE_TABLE_NAMES = [
  "orders",
  "customers",
  "products",
  "sessions",
  "support_tickets",
] as const;
