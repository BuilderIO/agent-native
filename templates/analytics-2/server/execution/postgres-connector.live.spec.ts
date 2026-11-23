import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";

import postgres from "postgres";
import { expect, it, vi } from "vitest";

import { notebookArrowRows } from "./notebook-arrow.js";
import { postgresWarehouseFixtureSql } from "./postgres-connector-test-fixture.js";
import {
  acceptPostgresFixtureTls,
  createPostgresFixtureTls,
  fixtureTlsHost,
} from "./postgres-connector-test-tls.js";
import {
  createPostgresConnector,
  isPostgresProviderEnabled,
  postgresTableQuery,
} from "./postgres-connector.js";
import { WarehouseExecutionError } from "./sql-adapter.js";

const fixtureConfigPath = new URL(
  "../../../../.tmp/postgres-fixture.json",
  import.meta.url,
);
const fixtureConfig: { url?: string; caPath?: string } = existsSync(
  fixtureConfigPath,
)
  ? JSON.parse(readFileSync(fixtureConfigPath, "utf8"))
  : {};
const fixtureUrl = fixtureConfig.url;
const fixtureAuthorityPath = fixtureConfig.caPath;

async function localReadEndpoint(fixtureHost: string, fixturePort: number) {
  const { context, certificate } = await createPostgresFixtureTls();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    acceptPostgresFixtureTls(socket, context, (tls) => {
      const provider = connect(fixturePort, fixtureHost);
      provider.on("error", () => tls.destroy());
      provider.on("close", () => tls.destroy());
      tls.on("close", () => provider.destroy());
      tls.pipe(provider).pipe(tls);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, fixtureTlsHost, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not open test-only PostgreSQL read endpoint");
  return {
    host: fixtureTlsHost,
    port: address.port,
    certificate,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

it("verifies PostgreSQL credentials and TLS, reads scoped tables, cancels a live cursor and denies a revoked grant", async ({
  skip,
}) => {
  if (!fixtureUrl) {
    skip(
      "Not run: write { url, caPath } for a PostgreSQL fixture to .tmp/postgres-fixture.json at the repository root",
    );
    return;
  }
  const url = new URL(fixtureUrl);
  const host = url.hostname;
  const port = Number(url.port || 5432);
  const loopback = host === "127.0.0.1" || host === "localhost";
  const ca = fixtureAuthorityPath
    ? await readFile(fixtureAuthorityPath, "utf8")
    : undefined;
  const endpoint =
    loopback && !ca ? await localReadEndpoint(host, port) : undefined;
  const managed = {
    host: endpoint?.host ?? host,
    port: endpoint?.port ?? port,
  };
  const caCertificate = endpoint?.certificate ?? ca;
  const adminOptions = endpoint
    ? { ssl: false }
    : { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
  const { ssl } = adminOptions;
  const admin = postgres(fixtureUrl, { ssl, max: 1, onnotice: () => {} });
  const id = randomBytes(8).toString("hex");
  const database = `analytics_pg_${id}`;
  const username = `analytics_reader_${id}`;
  const password = randomBytes(24).toString("hex");
  const seedUrl = new URL(fixtureUrl);
  seedUrl.pathname = `/${database}`;
  const seed = postgres(seedUrl.href, { ssl, max: 1, onnotice: () => {} });
  vi.stubEnv("ANALYTICS2_POSTGRES_READ_ENDPOINTS", JSON.stringify([managed]));
  vi.stubEnv("ANALYTICS2_POSTGRES_READBACK_VERIFIED", "false");
  let authorized = true;
  const requireGrant = () => {
    if (!authorized) throw new WarehouseExecutionError("source_access_denied");
  };
  const config = {
    ...managed,
    database,
    username,
    password,
  };
  const trustedConfig = { ...config, caCertificate };
  const connection = createPostgresConnector(trustedConfig, requireGrant);
  try {
    await admin`create database ${admin(database)}`;
    // raw-sql-ok: CREATE ROLE cannot bind a password; the fixture password is generated hex.
    await admin`create role ${admin(username)} login password ${admin.unsafe(`'${password}'`)}`;
    await seed.unsafe(postgresWarehouseFixtureSql);
    await seed`grant usage on schema phase_east, phase_west to ${seed(username)}`;
    await seed`grant select on all tables in schema phase_east, phase_west to ${seed(username)}`;
    expect(isPostgresProviderEnabled()).toBe(false);
    const badCredentials = createPostgresConnector(
      { ...trustedConfig, username: `${username}_missing` },
      requireGrant,
    );
    await expect(badCredentials.validate()).rejects.toThrow(
      "warehouse_query_denied",
    );
    if (caCertificate) {
      const untrusted = createPostgresConnector(config, requireGrant);
      await expect(untrusted.validate()).rejects.toThrow(
        "warehouse_tls_unverified",
      );
    }
    await expect(connection.validate()).resolves.toEqual({ checkedSchemas: 3 });
    vi.stubEnv("ANALYTICS2_POSTGRES_READBACK_VERIFIED", "true");
    expect(isPostgresProviderEnabled()).toBe(true);
    const east = await connection.catalog({
      schema: "phase_east",
      table: "same.name",
    });
    const west = await connection.catalog({
      schema: "phase_west",
      table: "same.name",
    });
    expect(east.tables[0]?.oid).toMatch(/^\d+$/);
    expect(west.tables[0]?.oid).toMatch(/^\d+$/);
    expect(east.tables[0]?.oid).not.toBe(west.tables[0]?.oid);
    const catalogCursor = await connection.submit({
      sql: postgresTableQuery("phase_west", "same.name"),
      parameters: [],
    });
    const page = await catalogCursor.page(50);
    expect(notebookArrowRows(page.table, page.fields).rows).toEqual([[84n]]);
    const typed = await connection.submit({
      sql: `select sentinel, $1::numeric, $2::timestamptz, $3::text from phase_east."same.name"`,
      parameters: [
        {
          name: "decimal",
          parameterType: { type: "NUMERIC" },
          parameterValue: { value: "42.00000000000000000001" },
        },
        {
          name: "time",
          parameterType: { type: "TIMESTAMP" },
          parameterValue: { value: "2026-04-03T02:01:00.123456+02:00" },
        },
        {
          name: "missing",
          parameterType: { type: "STRING" },
          parameterValue: { value: null },
        },
      ],
    });
    const exact = await typed.page(50);
    expect(notebookArrowRows(exact.table, exact.fields).rows).toEqual([
      [42n, "42.00000000000000000001", "2026-04-03T00:01:00.123456Z", null],
    ]);
    const control = new AbortController();
    const slow = await connection.submit(
      {
        sql: `select sentinel from phase_east."same.name" where pg_sleep(12) is null`,
        parameters: [],
      },
      control.signal,
    );
    const pending = expect(slow.page(50)).rejects.toThrow(
      "warehouse_query_cancelled",
    );
    await vi.waitFor(
      async () => {
        const state =
          await seed`select state, wait_event from pg_catalog.pg_stat_activity where usename = ${username}`;
        expect([...state]).toEqual([
          { state: "active", wait_event: "PgSleep" },
        ]);
      },
      { timeout: 5000 },
    );
    control.abort();
    await pending;
    await vi.waitFor(
      async () => {
        const state =
          await seed`select pid from pg_catalog.pg_stat_activity where usename = ${username}`;
        expect([...state]).toEqual([]);
      },
      { timeout: 5000 },
    );
    const revoked = await connection.submit({
      sql: postgresTableQuery("phase_east", "same.name"),
      parameters: [],
    });
    authorized = false;
    await expect(revoked.page(50)).rejects.toThrow("source_access_denied");
    await expect(connection.validate()).rejects.toThrow("source_access_denied");
  } finally {
    vi.unstubAllEnvs();
    await seed.end({ timeout: 0 });
    try {
      await admin`drop database if exists ${admin(database)} with (force)`;
      await admin`drop role if exists ${admin(username)}`;
    } finally {
      await admin.end({ timeout: 0 });
      await endpoint?.close();
    }
  }
});
