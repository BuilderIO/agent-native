import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  generateSearchBenchmarkRows,
  SEARCH_BENCHMARK_QUERIES,
  SEARCH_BENCHMARK_SEED,
  type SearchBenchmarkProfile,
} from "./benchmark-search-fixture.js";

interface BenchmarkManifest {
  projectId: string;
  branchId: string;
  branchName: string;
  endpointHost: string;
  database: string;
  expiresAt: string;
  ownerEmail: string;
  outsiderEmail: string;
  spaceId: string;
  outsiderSpaceId: string;
  fixturePrefix: string;
}

type Command =
  | "inspect"
  | "migrate"
  | "seed"
  | "measure"
  | "diagnose"
  | "cleanup";

const args = process.argv.slice(2);
const command = args.shift() as Command | undefined;
const options = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    throw new Error(`Expected --flag value, received ${key ?? "end of input"}`);
  }
  options.set(key.slice(2), value);
}

function requiredOption(key: string): string {
  const value = options.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function assertManifest(value: unknown): asserts value is BenchmarkManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid manifest");
  const manifest = value as Record<string, unknown>;
  for (const key of [
    "projectId",
    "branchId",
    "branchName",
    "endpointHost",
    "database",
    "expiresAt",
    "ownerEmail",
    "outsiderEmail",
    "spaceId",
    "outsiderSpaceId",
    "fixturePrefix",
  ]) {
    if (typeof manifest[key] !== "string" || !manifest[key]) {
      throw new Error(`Invalid manifest field ${key}`);
    }
  }
  if (!String(manifest.branchName).startsWith("dev/content-search-latency-")) {
    throw new Error("Benchmark manifest must name an isolated search branch");
  }
  if (/production|default|main/i.test(String(manifest.branchName))) {
    throw new Error("Benchmark refuses a production or default branch");
  }
  if (!String(manifest.branchId).startsWith("br-")) {
    throw new Error("Benchmark manifest needs a Neon branch ID");
  }
  if (Date.parse(String(manifest.expiresAt)) <= Date.now()) {
    throw new Error("Benchmark branch has expired");
  }
  if (!String(manifest.endpointHost).endsWith(".neon.tech")) {
    throw new Error("Benchmark requires a Neon branch endpoint");
  }
  if (
    manifest.ownerEmail === manifest.outsiderEmail ||
    manifest.spaceId === manifest.outsiderSpaceId
  ) {
    throw new Error("Fixture identities and spaces must differ");
  }
}

function connectionHost(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Benchmark database URL must use PostgreSQL");
  }
  return url.hostname;
}

function directHost(host: string): string {
  return host.replace("-pooler.", ".");
}

function configureDatabase(url: string, manifest: BenchmarkManifest): void {
  const pooledHost = manifest.endpointHost;
  const acceptedHosts = new Set([pooledHost, directHost(pooledHost)]);
  if (!acceptedHosts.has(connectionHost(url))) {
    throw new Error("Connection endpoint differs from the pinned task branch");
  }
  const parsed = new URL(url);
  if (parsed.pathname !== `/${manifest.database}`) {
    throw new Error("Connection database differs from the manifest");
  }
  for (const key of [
    "CONTENT_DATABASE_URL_UNPOOLED",
    "CONTENT_DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "DATABASE_URL",
    "NETLIFY_DATABASE_URL_UNPOOLED",
    "NETLIFY_DATABASE_URL",
  ]) {
    const existing = process.env[key];
    if (existing && !acceptedHosts.has(connectionHost(existing))) {
      throw new Error(`${key} points outside the pinned task branch`);
    }
  }
  const direct = new URL(url);
  direct.hostname = directHost(direct.hostname);
  process.env.APP_NAME = "content";
  process.env.CONTENT_DATABASE_URL = url;
  process.env.CONTENT_DATABASE_URL_UNPOOLED = direct.toString();
  process.env.DATABASE_URL = url;
  process.env.DATABASE_URL_UNPOOLED = direct.toString();
}

function fixtureOptions(manifest: BenchmarkManifest) {
  return {
    fixturePrefix: manifest.fixturePrefix,
    ownerEmail: manifest.ownerEmail,
    outsiderEmail: manifest.outsiderEmail,
    spaceId: manifest.spaceId,
    outsiderSpaceId: manifest.outsiderSpaceId,
  };
}

function p(samples: number[], percentile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentile) - 1]!;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function gitOutput(...args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd: resolve(import.meta.dirname, "../../.."),
  });
}

async function main(): Promise<void> {
  if (
    !command ||
    !["inspect", "migrate", "seed", "measure", "diagnose", "cleanup"].includes(
      command,
    )
  ) {
    throw new Error(
      "Usage: benchmark-search <inspect|migrate|seed|measure|diagnose|cleanup> --manifest <path> --url-file <path> [--profile A|B] [--report <path>]",
    );
  }
  const manifestPath = resolve(requiredOption("manifest"));
  const urlPath = resolve(requiredOption("url-file"));
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest: unknown = JSON.parse(manifestText);
  assertManifest(manifest);
  const url = (await readFile(urlPath, "utf8")).trim();
  configureDatabase(url, manifest);
  const profile = options.get("profile") as SearchBenchmarkProfile | undefined;
  if (
    (command === "seed" || command === "measure" || command === "diagnose") &&
    profile !== "A" &&
    profile !== "B"
  ) {
    throw new Error("Seed, measure, and diagnose require --profile A or B");
  }

  const core = await import("@agent-native/core/db");
  if (
    connectionHost(core.getRuntimeDatabaseUrl()) !==
    directHost(manifest.endpointHost)
  ) {
    throw new Error(
      "Runtime database resolution differs from the pinned task endpoint",
    );
  }
  const exec = core.getDbExec();
  try {
    const identity = await exec.execute(
      "select current_database() as database, current_setting('server_version') as version",
    );
    if (identity.rows[0]?.database !== manifest.database)
      throw new Error("Database identity changed");
    const marker = await exec.execute(
      "select to_regclass('public.content_search_benchmark_identity') as identity_table",
    );
    if (!marker.rows[0]?.identity_table) {
      throw new Error("Target lacks the provisioned branch identity sentinel");
    }
    const branchIdentity = await exec.execute(
      "select project_id, branch_id, endpoint_host from public.content_search_benchmark_identity",
    );
    if (
      branchIdentity.rows.length !== 1 ||
      branchIdentity.rows[0]?.project_id !== manifest.projectId ||
      branchIdentity.rows[0]?.branch_id !== manifest.branchId ||
      branchIdentity.rows[0]?.endpoint_host !== manifest.endpointHost
    ) {
      throw new Error("Target branch identity differs from the manifest");
    }
    console.info(
      `Content search benchmark: ${manifest.branchName} (${manifest.branchId}), PostgreSQL ${identity.rows[0]?.version}`,
    );

    if (command === "migrate") {
      const { runFrameworkReleaseMigrations } =
        await import("@agent-native/core/server");
      const { runContentMigrations, runContentSourceMigrations } =
        await import("../server/plugins/db.js");
      await core.withMigrationRuntime(async () => {
        await runFrameworkReleaseMigrations(null);
        await runContentMigrations(null);
        await runContentSourceMigrations(null);
      });
      console.info("Task branch migrations complete");
      return;
    }

    const dbModule = await import("../server/db/index.js");
    const db = dbModule.getDb();
    const { schema } = dbModule;
    const { eq, and, like, sql } = await import("drizzle-orm");
    const ownedPattern = `${manifest.fixturePrefix}%`;
    const rowsFor = async (ownerEmail: string, spaceId: string) => {
      const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.ownerEmail, ownerEmail),
            eq(schema.documents.spaceId, spaceId),
            like(schema.documents.id, ownedPattern),
          ),
        );
      return Number(rows[0]?.count ?? 0);
    };
    const currentCounts = async () => ({
      authorized: await rowsFor(manifest.ownerEmail, manifest.spaceId),
      outsider: await rowsFor(manifest.outsiderEmail, manifest.outsiderSpaceId),
    });

    if (command === "inspect") {
      console.info(JSON.stringify(await currentCounts()));
      return;
    }
    if (command === "cleanup") {
      const { or } = await import("drizzle-orm");
      const deleted = await db
        .delete(schema.documents)
        .where(
          and(
            like(schema.documents.id, ownedPattern),
            or(
              and(
                eq(schema.documents.ownerEmail, manifest.ownerEmail),
                eq(schema.documents.spaceId, manifest.spaceId),
              ),
              and(
                eq(schema.documents.ownerEmail, manifest.outsiderEmail),
                eq(schema.documents.spaceId, manifest.outsiderSpaceId),
              ),
            ),
          ),
        )
        .returning({ id: schema.documents.id });
      await db
        .delete(schema.contentSpaces)
        .where(
          and(
            eq(schema.contentSpaces.id, manifest.spaceId),
            eq(schema.contentSpaces.ownerEmail, manifest.ownerEmail),
          ),
        );
      await db
        .delete(schema.contentSpaces)
        .where(
          and(
            eq(schema.contentSpaces.id, manifest.outsiderSpaceId),
            eq(schema.contentSpaces.ownerEmail, manifest.outsiderEmail),
          ),
        );
      const remaining = await currentCounts();
      if (remaining.authorized || remaining.outsider)
        throw new Error("Fixture cleanup was incomplete");
      console.info(
        `Deleted ${deleted.length} task-owned documents; verified zero remain`,
      );
      return;
    }
    if (command === "seed") {
      const before = await currentCounts();
      if (before.authorized || before.outsider)
        throw new Error("Fixture already exists; clean it before reseeding");
      await db
        .insert(schema.contentSpaces)
        .values([
          {
            id: manifest.spaceId,
            name: "Search benchmark Personal",
            kind: "personal",
            ownerEmail: manifest.ownerEmail,
            filesDatabaseId: `${manifest.fixturePrefix}owner-files`,
            createdBy: manifest.ownerEmail,
          },
          {
            id: manifest.outsiderSpaceId,
            name: "Search benchmark outsider",
            kind: "personal",
            ownerEmail: manifest.outsiderEmail,
            filesDatabaseId: `${manifest.fixturePrefix}outsider-files`,
            createdBy: manifest.outsiderEmail,
          },
        ])
        .onConflictDoNothing();
      let batch: Array<typeof schema.documents.$inferInsert> = [];
      let inserted = 0;
      for (const row of generateSearchBenchmarkRows(
        profile!,
        fixtureOptions(manifest),
      )) {
        batch.push(row);
        if (batch.length === 100) {
          await db.insert(schema.documents).values(batch);
          inserted += batch.length;
          batch = [];
          if (inserted % 2000 === 0)
            console.info(`Seeded ${inserted}/12000 documents`);
        }
      }
      if (batch.length) {
        await db.insert(schema.documents).values(batch);
        inserted += batch.length;
      }
      const after = await currentCounts();
      if (
        inserted !== 12_000 ||
        after.authorized !== 10_000 ||
        after.outsider !== 2_000
      ) {
        throw new Error(
          `Seed count mismatch: inserted ${inserted}, counted ${JSON.stringify(after)}`,
        );
      }
      await exec.execute("ANALYZE documents");
      console.info(
        `Seeded profile ${profile}; authorized 10000, outsider 2000; analyzed documents`,
      );
      return;
    }

    const before = await currentCounts();
    if (before.authorized !== 10_000 || before.outsider !== 2_000) {
      throw new Error(
        `Measure requires one complete 10k profile, found ${JSON.stringify(before)}`,
      );
    }
    const { runWithRequestContext } = await import("@agent-native/core/server");
    const searchDocuments = (await import("../actions/search-documents.js"))
      .default;
    const { createDatabaseRequestTelemetry, runWithDatabaseRequestTelemetry } =
      await import("../../../packages/core/src/db/request-telemetry.js");
    const run = async (
      searchCase: (typeof SEARCH_BENCHMARK_QUERIES)[number],
    ) => {
      const telemetry = createDatabaseRequestTelemetry();
      const start = performance.now();
      const result = await runWithDatabaseRequestTelemetry(telemetry, () =>
        runWithRequestContext({ userEmail: manifest.ownerEmail }, () =>
          searchDocuments.run({
            query: searchCase.query,
            spaceId: manifest.spaceId,
            searchFields: searchCase.searchFields,
            limit: searchCase.limit,
            offset: searchCase.offset,
          }),
        ),
      );
      const elapsedMs = performance.now() - start;
      if (
        result.pagination.totalItems !== searchCase.expectedTotalItems ||
        result.documents[0]?.title !==
          (searchCase.expectedFirstTitle ?? undefined)
      ) {
        throw new Error(
          `Incorrect search result for ${searchCase.query}: count ${result.pagination.totalItems}, first ${result.documents[0]?.id ?? "none"}`,
        );
      }
      return {
        elapsedMs,
        totalItems: result.pagination.totalItems,
        firstId: result.documents[0]?.id ?? null,
        payloadBytes: Buffer.byteLength(JSON.stringify(result)),
        telemetry,
      };
    };
    if (command === "diagnose") {
      const { Client } =
        await import("../../../packages/core/node_modules/@neondatabase/serverless/index.mjs");
      const originalQuery = Client.prototype.query;
      const statements: Array<{
        query: string;
        sql: string;
        args: unknown[];
        wallMs: number;
      }> = [];
      let activeQuery = "";
      Client.prototype.query = function (
        this: InstanceType<typeof Client>,
        statement: unknown,
        values?: unknown,
      ) {
        const sqlText =
          typeof statement === "string"
            ? statement
            : ((statement as { text?: string })?.text ?? "");
        const args = Array.isArray(values)
          ? values
          : ((statement as { values?: unknown[] })?.values ?? []);
        const start = performance.now();
        const result = Reflect.apply(originalQuery, this, [
          statement,
          values,
        ]) as unknown;
        if (
          !activeQuery ||
          !/^\s*(select|with)\b/i.test(sqlText) ||
          !result ||
          typeof (result as { then?: unknown }).then !== "function"
        )
          return result;
        return (result as Promise<unknown>).then((value: unknown) => {
          statements.push({
            query: activeQuery,
            sql: sqlText,
            args,
            wallMs: performance.now() - start,
          });
          return value;
        });
      } as typeof Client.prototype.query;
      const diagnostics = [];
      try {
        for (const searchCase of SEARCH_BENCHMARK_QUERIES) {
          activeQuery = searchCase.query;
          diagnostics.push({
            query: searchCase.query,
            ...(await run(searchCase)),
          });
        }
      } finally {
        activeQuery = "";
        Client.prototype.query = originalQuery;
      }
      const plans = [];
      for (const statement of statements) {
        const explained = await exec.execute({
          sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`,
          args: statement.args,
        });
        plans.push({
          ...statement,
          plan: explained.rows[0]?.["QUERY PLAN"] ?? null,
        });
      }
      const reportPath = resolve(requiredOption("report"));
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(
        reportPath,
        JSON.stringify({ profile, diagnostics, plans }, null, 2),
      );
      console.info(`Wrote ${reportPath}`);
      return;
    }
    for (const searchCase of SEARCH_BENCHMARK_QUERIES) {
      for (let index = 0; index < 5; index++) await run(searchCase);
    }
    const batches = [];
    for (let batchIndex = 0; batchIndex < 3; batchIndex++) {
      const samples: Record<string, Awaited<ReturnType<typeof run>>[]> =
        Object.fromEntries(
          SEARCH_BENCHMARK_QUERIES.map((searchCase) => [searchCase.query, []]),
        );
      for (let iteration = 0; iteration < 30; iteration++) {
        for (let shift = 0; shift < SEARCH_BENCHMARK_QUERIES.length; shift++) {
          const searchCase =
            SEARCH_BENCHMARK_QUERIES[
              (batchIndex + iteration + shift) % SEARCH_BENCHMARK_QUERIES.length
            ]!;
          samples[searchCase.query]!.push(await run(searchCase));
        }
      }
      const summary = Object.fromEntries(
        SEARCH_BENCHMARK_QUERIES.map((searchCase) => {
          const times = samples[searchCase.query]!.map(
            (sample) => sample.elapsedMs,
          );
          return [
            searchCase.query,
            { p50: p(times, 0.5), p95: p(times, 0.95), count: times.length },
          ];
        }),
      );
      batches.push({ samples, summary });
      console.info(
        `Profile ${profile} batch ${batchIndex + 1}: ${JSON.stringify(summary)}`,
      );
    }
    const reportPath = resolve(requiredOption("report"));
    const source = await readFile(
      new URL("../actions/search-documents.ts", import.meta.url),
    );
    const fixtureSource = await readFile(
      new URL("./benchmark-search-fixture.ts", import.meta.url),
    );
    const runnerSource = await readFile(
      new URL("./benchmark-search.ts", import.meta.url),
    );
    const settings = await exec.execute(
      "select current_setting('work_mem') as work_mem, current_setting('shared_buffers') as shared_buffers, current_setting('max_parallel_workers_per_gather') as max_parallel_workers_per_gather, current_setting('server_version') as server_version",
    );
    const databaseSettings = settings.rows[0];
    const report = {
      date: new Date().toISOString(),
      projectId: manifest.projectId,
      branchId: manifest.branchId,
      branchName: manifest.branchName,
      endpointHost: manifest.endpointHost,
      database: manifest.database,
      profile,
      fixtureSeed: SEARCH_BENCHMARK_SEED,
      counts: before,
      queryManifest: SEARCH_BENCHMARK_QUERIES,
      actionSourceSha256: sha256(source),
      fixtureSourceSha256: sha256(fixtureSource),
      runnerSourceSha256: sha256(runnerSource),
      queryManifestSha256: sha256(JSON.stringify(SEARCH_BENCHMARK_QUERIES)),
      codeRevision: gitOutput("rev-parse", "HEAD").toString().trim(),
      dirtyDiffSha256: sha256(gitOutput("diff", "--binary")),
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      databaseSettings,
      configurationFingerprint: sha256(
        JSON.stringify({
          branchId: manifest.branchId,
          endpointHost: manifest.endpointHost,
          database: manifest.database,
          databaseSettings,
        }),
      ),
      batches,
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.info(`Wrote ${reportPath}`);
    if (
      batches.some((batch) =>
        Object.values(batch.summary).some((entry) => entry.p95 > 400),
      )
    ) {
      throw new Error("One or more frozen p95 gates failed");
    }
  } finally {
    await core.closeDbExec();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
