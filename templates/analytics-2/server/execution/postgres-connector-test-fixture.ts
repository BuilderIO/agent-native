import { PGlite } from "@electric-sql/pglite";

import type { PostgresReadSession } from "./postgres-connector.js";

export const postgresWarehouseFixtureSql = `
  create schema phase_east;
  create schema phase_west;
  create table phase_east."same.name" (sentinel bigint not null);
  create table phase_west."same.name" (sentinel bigint not null);
  insert into phase_east."same.name" values (42);
  insert into phase_west."same.name" values (84);
  comment on column phase_west."same.name".sentinel is 'West sentinel';
`;

export async function openPglitePostgresFixture() {
  const db = await PGlite.create();
  await db.exec(postgresWarehouseFixtureSql);
  await db.exec(`create role analytics_warehouse_reader;
    grant usage on schema phase_east, phase_west to analytics_warehouse_reader;
    grant select on all tables in schema phase_east, phase_west to analytics_warehouse_reader;
    set time zone 'UTC'`);
  return {
    db,
    async open(signal: AbortSignal): Promise<PostgresReadSession> {
      signal.throwIfAborted();
      await db.exec("set role analytics_warehouse_reader");
      return {
        async read(sql, parameters = []) {
          signal.throwIfAborted();
          const result = await db.query<unknown[]>(sql, parameters, {
            rowMode: "array",
            parsers: {
              1082: (value) => value,
              1083: (value) => value,
              1114: (value) => value,
              1184: (value) => value,
              1700: (value) => value,
            },
          });
          return {
            fields: result.fields.map(({ name, dataTypeID }) => ({
              name,
              oid: dataTypeID,
            })),
            rows: result.rows,
          };
        },
        async close() {
          await db.exec("rollback; reset role");
        },
      };
    },
  };
}
