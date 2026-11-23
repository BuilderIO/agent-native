import { createHash, randomUUID } from "node:crypto";
import { checkServerIdentity } from "node:tls";

import { readAgentSqlQuery } from "@agent-native/core/agent-sql";
import { defineAppConfigSection } from "@agent-native/core/app-config";
import { getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { Decimal } from "apache-arrow";
import postgres from "postgres";
import { z } from "zod";

import { postgresEndpointSchema } from "../../shared/postgres-connection-form.js";
import {
  RESULT_SEGMENT_ROWS,
  notebookResultFields,
  notebookTable,
  type NotebookRows,
} from "./notebook-arrow.js";
import {
  ProviderOutcomeUnknown,
  WarehouseExecutionError,
} from "./sql-adapter.js";
import type { CompiledSql } from "./sql-compiler.js";

export { postgresEndpointSchema };

export type PostgresConnectionConfig = z.output<
  typeof postgresEndpointSchema
> & {
  password: string;
  caCertificate?: string | undefined;
};

const managedEndpointSchema = z.strictObject({
  host: z
    .string()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9.-]{0,199}$/),
  port: z.int().min(1).max(65_535),
  certificate: z.string().min(1).max(65_536).optional(),
});
const managedEndpoints = z.array(managedEndpointSchema).max(100);
export const analyticsPostgresConfig = defineAppConfigSection(
  "analyticsPostgres",
  z.object({
    readEndpoints: z.string().optional().meta({
      env: "ANALYTICS2_POSTGRES_READ_ENDPOINTS",
      doc: "JSON allowlist of PostgreSQL read endpoints, each with host, port and optional PEM authority certificate.",
    }),
    providerReadbackVerified: z.boolean().default(false).meta({
      env: "ANALYTICS2_POSTGRES_READBACK_VERIFIED",
      doc: "Enable the PostgreSQL connection picker after signed-in provider readback.",
    }),
  }),
);

declare module "@agent-native/core/app-config" {
  interface AppConfigSections {
    analyticsPostgres: typeof analyticsPostgresConfig.schema;
  }
}

function readEndpoints() {
  const serialized = analyticsPostgresConfig.read().readEndpoints;
  if (!serialized) return [];
  try {
    return managedEndpoints.parse(JSON.parse(serialized));
  } catch {
    throw new WarehouseExecutionError("warehouse_endpoint_config_invalid");
  }
}

export function isPostgresProviderEnabled() {
  return (
    analyticsPostgresConfig.read().providerReadbackVerified &&
    readEndpoints().length > 0
  );
}

function readEndpoint(connection: z.output<typeof postgresEndpointSchema>) {
  if (
    [connection.database, connection.username].some(
      (value) => !value || value.includes("\0"),
    )
  )
    throw new WarehouseExecutionError("warehouse_credentials_invalid");
  const host = connection.host.toLowerCase();
  const port = connection.port;
  const endpoint = readEndpoints().find(
    (item) => item.host === host && item.port === port,
  );
  const appUrl = getRuntimeDatabaseUrl();
  const app = URL.canParse(appUrl) ? new URL(appUrl) : null;
  if (
    !endpoint ||
    (app &&
      app.hostname.replace(/^\[|\]$/g, "") === host &&
      Number(app.port || 5432) === port &&
      (decodeURIComponent(app.pathname.slice(1)) === connection.database ||
        decodeURIComponent(app.username) === connection.username))
  )
    throw new WarehouseExecutionError("warehouse_endpoint_not_allowed");
  return endpoint;
}

export function postgresEndpointAuthority(
  connection: z.output<typeof postgresEndpointSchema>,
) {
  return createHash("sha256")
    .update(JSON.stringify(readEndpoint(connection)))
    .digest("hex");
}

export function quotePostgresIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function postgresTableQuery(schema: string, table: string) {
  return `select * from ${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(table)} limit 100`;
}

type PgField = { name: string; oid: number };
type PgPage = { fields: PgField[]; rows: unknown[][] };
export type PostgresReadSession = {
  read: (sql: string, parameters?: (string | null)[]) => Promise<PgPage>;
  close: () => Promise<void>;
};
type OpenSession = (signal: AbortSignal) => Promise<PostgresReadSession>;
type Authorize = () => void | Promise<void>;

const catalogLimit = 1000;
const maxSessions = 8;
const sessionTtlMs = 120_000;
const extendedProtocol = { simple: false, prepare: false };
let activeSessions = 0;

function providerError(
  error: unknown,
  signal: AbortSignal,
  dispatched: boolean,
) {
  if (signal.aborted) {
    if (
      signal.reason instanceof DOMException &&
      signal.reason.name === "TimeoutError"
    )
      return new ProviderOutcomeUnknown(
        dispatched ? "postgres_cursor_lost" : "postgres_connection_unreadable",
      );
    return new WarehouseExecutionError("warehouse_query_cancelled");
  }
  if (
    error instanceof WarehouseExecutionError ||
    error instanceof ProviderOutcomeUnknown
  )
    return error;
  const code = z.object({ code: z.string() }).safeParse(error).data?.code;
  if (
    code?.startsWith("ERR_TLS_") ||
    code?.startsWith("ERR_SSL_") ||
    code?.startsWith("ERR_OSSL_") ||
    code?.includes("CERT") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  )
    return new WarehouseExecutionError("warehouse_tls_unverified");
  if (
    code === "34000" ||
    code === "25P03" ||
    code?.startsWith("08") ||
    code?.startsWith("57P0") ||
    !code ||
    !/^[0-9A-Z]{5}$/.test(code)
  )
    return new ProviderOutcomeUnknown(
      dispatched ? "postgres_cursor_lost" : "postgres_connection_unreadable",
    );
  return new WarehouseExecutionError(
    code.startsWith("28") || code === "42501"
      ? "warehouse_query_denied"
      : code === "57014"
        ? "warehouse_statement_timeout"
        : "warehouse_query_failed",
    { reason: code },
  );
}

async function openPostgres(
  connection: PostgresConnectionConfig,
  signal: AbortSignal,
) {
  const endpoint = readEndpoint(connection);
  if (!connection.password)
    throw new WarehouseExecutionError("warehouse_credentials_invalid");
  if (activeSessions >= maxSessions)
    throw new WarehouseExecutionError("warehouse_connection_capacity");
  const client = postgres({
    host: endpoint.host,
    port: endpoint.port,
    database: connection.database,
    username: connection.username,
    password: connection.password,
    ssl: {
      rejectUnauthorized: true,
      checkServerIdentity: (
        _hostname: string,
        certificate: Parameters<typeof checkServerIdentity>[1],
      ) => checkServerIdentity(endpoint.host, certificate),
      ca: endpoint.certificate ?? connection.caCertificate,
    },
    max: 1,
    connect_timeout: 5,
    idle_timeout: 15,
    max_lifetime: null,
    prepare: false,
    onnotice: () => {},
    connection: {
      application_name: "analytics-warehouse-read",
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 30_000,
      client_connection_check_interval: 1000,
      TimeZone: "UTC",
      DateStyle: "ISO, YMD",
      standard_conforming_strings: "on",
    },
    types: {
      textPrecision: {
        to: 0,
        from: [1082, 1083, 1114, 1184, 1700],
        serialize: (value: string) => value,
        parse: (value: string) => value,
      },
    },
  });
  activeSessions++;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= client.end({ timeout: 0 }).finally(() => {
      activeSessions--;
    });
    return closing;
  };
  const read: PostgresReadSession["read"] = async (query, values = []) => {
    signal.throwIfAborted();
    const result = await client
      .unsafe(query, values, extendedProtocol)
      .values();
    return {
      fields: result.columns.map(({ name, type }) => ({ name, oid: type })),
      rows: result,
    };
  };
  return { read, close };
}

const roleCheck = `select not (
  exists (select 1 from pg_catalog.pg_roles where
    pg_has_role(current_user, oid, 'MEMBER') and
    (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls
      or rolname in ('pg_write_all_data', 'pg_read_server_files', 'pg_write_server_files',
        'pg_execute_server_program', 'pg_signal_backend', 'pg_create_subscription')))
  or has_database_privilege(current_database(), 'CREATE')
  or exists (select 1 from pg_catalog.pg_namespace where nspname !~ '^pg_'
    and has_schema_privilege(oid, 'CREATE'))
  or exists (select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname !~ '^pg_'
    and (has_table_privilege(c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
      or has_any_column_privilege(c.oid, 'INSERT,UPDATE,REFERENCES')))
) as read_only`;
const schemaQuery = `select nspname from pg_catalog.pg_namespace
  where nspname !~ '^pg_' and nspname <> 'information_schema'
    and has_schema_privilege(oid, 'USAGE')
  order by nspname limit 1001`;
const tableQuery = `select n.nspname, c.relname, c.oid::text, obj_description(c.oid, 'pg_class')
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1 and ($2::text is null or c.relname = $2)
    and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
    and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_schema_privilege(n.oid, 'USAGE')
    and has_table_privilege(c.oid, 'SELECT')
  order by c.relname limit 1001`;
const columnQuery = `select attname, format_type(atttypid, atttypmod), not attnotnull,
    col_description(attrelid, attnum)
  from pg_catalog.pg_attribute where attrelid = $1::oid
    and attnum > 0 and not attisdropped order by attnum limit 1001`;

const tableRow = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string().nullable(),
]);
const columnRow = z.tuple([
  z.string(),
  z.string(),
  z.boolean(),
  z.string().nullable(),
]);

function boundedCatalog<T>(rows: unknown[][], schema: z.ZodType<T>) {
  if (rows.length > catalogLimit)
    throw new WarehouseExecutionError("warehouse_catalog_truncated");
  return z.array(schema).parse(rows);
}

function postgresColumnType(oid: number) {
  switch (oid) {
    case 16:
      return "BOOL";
    case 17:
      return "BYTES";
    case 20:
    case 21:
    case 23:
    case 26:
      return "INT64";
    case 700:
    case 701:
      return "FLOAT64";
    case 1082:
      return "DATE";
    case 1083:
      return "TIME";
    case 1114:
      return "DATETIME";
    case 1184:
      return "TIMESTAMP";
    case 1700:
      return "NUMERIC";
    case 114:
    case 3802:
      return "JSON";
    case 18:
    case 19:
    case 25:
    case 1042:
    case 1043:
    case 2950:
      return "STRING";
    default:
      throw new WarehouseExecutionError("postgres_result_type_unsupported", {
        reason: String(oid),
      });
  }
}

function postgresArrow(page: PgPage) {
  if (page.rows.some((row) => row.length !== page.fields.length))
    throw new WarehouseExecutionError("warehouse_result_coverage_unverified");
  const columns = page.fields.map(({ name, oid }) => ({
    name,
    type: postgresColumnType(oid),
    ...(oid === 1700 ? { decimal: new Decimal(38, 76, 256) } : {}),
  }));
  const rows = page.rows.map((row) =>
    row.map((value, index) =>
      page.fields[index]?.oid === 1184 && typeof value === "string"
        ? value.replace(/([+-]\d{2})$/, "$1:00")
        : value,
    ),
  );
  const notebookRows: NotebookRows = { columns, rows };
  const fields = notebookResultFields(columns);
  return { table: notebookTable(notebookRows, fields), fields };
}

export function createPostgresSessionConnector(
  open: OpenSession,
  authorize: Authorize,
) {
  async function session(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(sessionTtlMs);
    const lifetime = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const requireLive = (dispatched: boolean) => {
      if (lifetime.aborted)
        throw providerError(lifetime.reason, lifetime, dispatched);
    };
    await authorize();
    requireLive(false);
    const connection = await open(lifetime);
    let closing: Promise<void> | undefined;
    const onAbort = () => {
      void close().catch((error: unknown) => {
        console.error(
          "PostgreSQL read session close failed",
          providerError(error, lifetime, true).message,
        );
      });
    };
    const close = () => {
      lifetime.removeEventListener("abort", onAbort);
      closing ??= connection.close();
      return closing;
    };
    const read = async (
      query: string,
      params?: (string | null)[],
      dispatched = false,
    ) => {
      try {
        return await connection.read(query, params);
      } catch (error) {
        throw providerError(error, lifetime, dispatched);
      }
    };
    lifetime.addEventListener("abort", onAbort, { once: true });
    try {
      requireLive(false);
      await read("begin isolation level repeatable read read only");
      const result = await read(roleCheck);
      if (result.rows[0]?.[0] !== true)
        throw new WarehouseExecutionError("warehouse_read_only_role_required");
      const verify = async () => {
        await authorize();
        requireLive(true);
      };
      return { read, close, verify };
    } catch (error) {
      await close();
      throw error;
    }
  }

  async function catalog(
    input: { schema?: string; table?: string } = {},
    signal?: AbortSignal,
  ) {
    const connection = await session(signal);
    try {
      const schemas =
        input.schema === undefined
          ? boundedCatalog(
              (await connection.read(schemaQuery)).rows,
              z.tuple([z.string()]),
            ).map(([name]) => name)
          : [];
      const tables =
        input.schema !== undefined
          ? boundedCatalog(
              (
                await connection.read(tableQuery, [
                  input.schema,
                  input.table ?? null,
                ])
              ).rows,
              tableRow,
            ).map(([schema, name, oid, description]) => ({
              schema,
              name,
              oid,
              description,
            }))
          : [];
      const oid = input.table === undefined ? undefined : tables[0]?.oid;
      const columns = oid
        ? boundedCatalog(
            (await connection.read(columnQuery, [oid])).rows,
            columnRow,
          ).map(([name, type, nullable, description]) => ({
            name,
            type,
            nullable,
            description,
          }))
        : [];
      await connection.verify();
      return { schemas, tables, columns };
    } finally {
      await connection.close();
    }
  }

  return {
    dialect: "postgres" as const,
    async validate(signal?: AbortSignal) {
      const { schemas } = await catalog({}, signal);
      return { checkedSchemas: schemas.length };
    },
    catalog,
    async submit(compiled: CompiledSql, signal?: AbortSignal) {
      try {
        readAgentSqlQuery(compiled.sql, { dialect: "postgres" });
      } catch {
        throw new WarehouseExecutionError("warehouse_query_invalid");
      }
      const connection = await session(signal);
      const id = randomUUID();
      let closing: Promise<void> | undefined;
      let reading = false;
      let offset = 0;
      const closeCursor = () => {
        closing ??= connection.close();
        return closing;
      };
      try {
        await connection.verify();
        const parameters = compiled.parameters.map(
          ({ parameterValue }) => parameterValue.value,
        );
        // raw-sql-ok: The read-only cursor wraps one parsed provider query and binds values separately.
        await connection.read(
          `declare analytics_result no scroll cursor for ${compiled.sql}`,
          parameters,
          true,
        );
      } catch (error) {
        await closeCursor();
        throw error;
      }
      return {
        async page(size: number) {
          if (closing) throw new ProviderOutcomeUnknown("postgres_cursor_lost");
          if (reading)
            throw new WarehouseExecutionError("warehouse_cursor_busy");
          if (!Number.isInteger(size) || size < 1 || size > RESULT_SEGMENT_ROWS)
            throw new WarehouseExecutionError("warehouse_page_size_invalid");
          reading = true;
          try {
            await connection.verify();
            // raw-sql-ok: FETCH requires a literal count, bounded to a validated integer above.
            const page = await connection.read(
              `fetch forward ${size} from analytics_result`,
              [],
              true,
            );
            await connection.verify();
            const result = postgresArrow(page);
            offset += page.rows.length;
            const complete = page.rows.length < size;
            if (complete) await closeCursor();
            return {
              ...result,
              cursor: complete ? null : `${id}:${offset}`,
              complete,
            };
          } catch (error) {
            await closeCursor();
            throw error;
          } finally {
            reading = false;
          }
        },
        async cancel() {
          try {
            await authorize();
          } finally {
            await closeCursor();
          }
        },
      };
    },
    async recover(): Promise<never> {
      await authorize();
      throw new ProviderOutcomeUnknown("postgres_cursor_lost");
    },
  };
}

export function createPostgresConnector(
  connection: PostgresConnectionConfig,
  authorize: Authorize,
) {
  return createPostgresSessionConnector(
    (signal) => openPostgres(connection, signal),
    authorize,
  );
}
