declare module "@electric-sql/pglite" {
  export type Row = Record<string, unknown>;

  export interface Results<T extends Row = Row> {
    rows: T[];
    affectedRows?: number;
    rowCount?: number;
  }

  export interface PGliteOptions {
    dataDir?: string;
    [key: string]: unknown;
  }

  export class PGlite {
    static create(options?: string | PGliteOptions): Promise<PGlite>;
    query<T extends Row = Row>(
      sql: string,
      params?: unknown[],
    ): Promise<Results<T>>;
    transaction<T>(callback: (tx: Transaction) => Promise<T> | T): Promise<T>;
    close(): Promise<void>;
  }

  export type Transaction = PGlite;
}
