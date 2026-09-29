#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createDatabaseRequestTelemetry,
  runWithDatabaseRequestTelemetry,
} from "../packages/core/src/db/request-telemetry.ts";

const BUDGET_PATH = "scripts/neon-query-budgets.json";
const GENERATED_HANDLER = ".netlify/functions-internal/server/main.mjs";
const METRIC_NAMES = [
  "db-queries",
  "db-connects",
  "db-rows",
  "db-catalog",
  "db-migrations",
] as const;
const BUDGETED_METRICS = [
  "queries",
  "rowsReturned",
  "poolAcquisitions",
] as const;
const PGLITE_DATABASE_URL = "pglite:memory";
const SERVERLESS_ENV_KEYS = [
  "NETLIFY",
  "NETLIFY_FUNCTION_NAME",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_LAMBDA_FUNCTION_VERSION",
  "AWS_EXECUTION_ENV",
  "LAMBDA_TASK_ROOT",
  "VERCEL",
  "VERCEL_FUNCTION_ID",
  "VERCEL_REGION",
  "CF_PAGES",
] as const;

const TEMPLATE_MIGRATION_EXPORTS: Record<string, string[]> = {
  analytics: ["runAnalyticsMigrations"],
  assets: ["runAssetsMigrations"],
  brain: ["runBrainMigrations"],
  calendar: ["runCalendarMigrations"],
  clips: ["migrations"],
  content: ["runContentMigrations", "runContentSourceMigrations"],
  crm: ["runCrmMigrations"],
  design: ["runDesignMigrations"],
  factory: ["runFactoryMigrations"],
  forms: ["runFormsMigrations"],
  mail: ["runMailMigrations"],
  plan: ["runPlanMigrations"],
  slides: ["runSlidesMigrations"],
  tasks: ["runTasksMigrations"],
};

type MigrationRuntimeGlobal = typeof globalThis & {
  __AGENT_NATIVE_MIGRATION_RUNTIME__?: boolean;
};

export interface QueryBudgetMetrics {
  queries: number;
  rowsReturned: number;
  catalogQueries: number;
  migrationTableQueries: number;
  poolAcquisitions: number;
}

export interface TemplateQueryBudget {
  action: string | null;
  budget?: {
    page: Partial<QueryBudgetMetrics>;
    listAction: Partial<QueryBudgetMetrics> | null;
    idlePoll: Partial<QueryBudgetMetrics>;
    pollRequests: number;
  };
  observed?: {
    page: QueryBudgetMetrics;
    listAction: QueryBudgetMetrics | null;
    idlePoll: QueryBudgetMetrics;
    pollRequests: number;
  };
  status?: "retired";
  reason?: string;
}

export interface QueryBudgetReport {
  template: string;
  action: string | null;
  page: QueryBudgetMetrics;
  listAction: QueryBudgetMetrics | null;
  idlePoll: QueryBudgetMetrics;
  pollRequests: number;
  statuses: { page: number; listAction: number | null; idlePoll: number };
}

export interface QueryBudgetFile {
  tolerance: { absolute: number; percent: number };
  templates: Record<string, TemplateQueryBudget>;
}

export async function withSchemaProvisioningRuntime<T>(
  run: () => Promise<T>,
): Promise<T> {
  const previousEnvironment = new Map(
    SERVERLESS_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const migrationRuntime = globalThis as MigrationRuntimeGlobal;
  const previousMigrationRuntime =
    migrationRuntime.__AGENT_NATIVE_MIGRATION_RUNTIME__;

  for (const key of SERVERLESS_ENV_KEYS) delete process.env[key];
  migrationRuntime.__AGENT_NATIVE_MIGRATION_RUNTIME__ = true;
  try {
    return await runWithDatabaseRequestTelemetry(
      createDatabaseRequestTelemetry(),
      run,
    );
  } finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousMigrationRuntime === undefined) {
      delete migrationRuntime.__AGENT_NATIVE_MIGRATION_RUNTIME__;
    } else {
      migrationRuntime.__AGENT_NATIVE_MIGRATION_RUNTIME__ =
        previousMigrationRuntime;
    }
  }
}

const TEMPLATE_ACTIONS: Record<string, string | null> = {
  analytics: "list-analyses",
  assets: "list-assets",
  brain: "list-captures",
  calendar: "list-booking-links",
  chat: null,
  clips: "list-recordings",
  content: "list-documents",
  crm: "list-crm-lists",
  design: "list-designs",
  dispatch: "list-workspace-connections",
  factory: "list-factories",
  forms: "list-forms",
  mail: "list-inbox-threads",
  plan: "list-visual-plans",
  slides: "list-decks",
  tasks: "list-tasks",
};

function fail(message: string): never {
  throw new Error(message);
}

// The handler is measured with release-owned migrations, so every schema the
// template's release script migrates has to exist before it loads; otherwise
// plugin queries fail against missing tables and drop out of the count.
async function loadCreativeContextMigrations(
  template: string,
): Promise<((nitroApp: null) => Promise<void> | void) | null> {
  const releaseScript = path.resolve(
    "templates",
    template,
    "scripts/migrate-production.ts",
  );
  let source: string;
  try {
    source = await readFile(releaseScript, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!source.includes("creativeContextDbPlugin")) return null;
  const templateRequire = createRequire(
    path.resolve("templates", template, "package.json"),
  );
  const { creativeContextDbPlugin } = (await import(
    pathToFileURL(
      templateRequire.resolve("@agent-native/creative-context/server"),
    ).href
  )) as { creativeContextDbPlugin?: unknown };
  if (typeof creativeContextDbPlugin !== "function") {
    fail(
      `${template}: @agent-native/creative-context/server did not export creativeContextDbPlugin`,
    );
  }
  return creativeContextDbPlugin as (nitroApp: null) => Promise<void> | void;
}

async function provisionTemplateSchema(template: string): Promise<void> {
  // Provision disposable PGlite before the production-marked handler loads.
  await withSchemaProvisioningRuntime(async () => {
    const coreRequire = createRequire(
      path.resolve("packages/core/package.json"),
    );
    const [
      { runFrameworkReleaseMigrations },
      { runMigrations, withMigrationRuntime },
    ] = await Promise.all([
      import(
        pathToFileURL(coreRequire.resolve("@agent-native/core/server")).href
      ),
      import(pathToFileURL(coreRequire.resolve("@agent-native/core/db")).href),
    ]);
    const migrationModulePath =
      template === "dispatch"
        ? path.resolve("packages/dispatch/src/db/migrations.ts")
        : template === "factory"
          ? path.resolve(
              "templates/factory/server/plugins/factory-migrations.ts",
            )
          : template === "tasks"
            ? path.resolve("templates/tasks/server/db/migrations.ts")
            : path.resolve("templates", template, "server/plugins/db.ts");
    let migrationModule: Record<string, unknown> = {};
    try {
      await access(migrationModulePath);
      migrationModule = (await import(
        pathToFileURL(migrationModulePath).href
      )) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const migrationExports = TEMPLATE_MIGRATION_EXPORTS[template] ?? [];
    const creativeContextMigrations =
      await loadCreativeContextMigrations(template);
    await withMigrationRuntime(async () => {
      await runFrameworkReleaseMigrations(null);
      await creativeContextMigrations?.(null);
      if (template === "dispatch") {
        const dispatchMigrations = migrationModule.dispatchMigrations;
        if (!Array.isArray(dispatchMigrations)) {
          fail("Dispatch migration module did not export dispatchMigrations");
        }
        await runMigrations(dispatchMigrations, {
          table: "dispatch_migrations",
        })(null);
      }
      for (const exportName of migrationExports) {
        const runMigration = migrationModule[exportName];
        if (typeof runMigration !== "function") {
          fail(`${template} migration module did not export ${exportName}`);
        }
        await runMigration(null);
      }
    });
  });
}

function metricValue(source: string, key: string): number | undefined {
  const match = source.match(
    new RegExp(`(?:^|\\s)${key}=([0-9]+)(?:\\s|$)`, "i"),
  );
  return match ? Number(match[1]) : undefined;
}

function timingValue(header: string, name: string): number | undefined {
  const match = header.match(
    new RegExp(`(?:^|,)\\s*${name};dur=([0-9]+)(?:;|,|$)`, "i"),
  );
  return match ? Number(match[1]) : undefined;
}

export function parsePrivateRequestMetrics(
  serverTiming: string | null,
): QueryBudgetMetrics {
  if (!serverTiming) fail("response did not include Server-Timing metrics");
  const values = METRIC_NAMES.map((name) => timingValue(serverTiming, name));
  if (values.some((value) => value === undefined)) {
    fail(`response omitted required database counters: ${serverTiming}`);
  }
  return {
    queries: values[0]!,
    poolAcquisitions: values[1]!,
    rowsReturned: values[2]!,
    catalogQueries: values[3]!,
    migrationTableQueries: values[4]!,
  };
}

export function parseCacheablePageMetrics(
  serverTiming: string | null,
): QueryBudgetMetrics {
  if (!serverTiming) fail("cacheable page did not include Server-Timing");
  const originMetric = serverTiming.match(
    /(?:^|,)\s*origin;dur=[0-9]+;desc=("(?:[^"\\]|\\.)*")/i,
  )?.[1];
  if (!originMetric)
    fail(`cacheable page omitted its origin metric: ${serverTiming}`);
  const description = JSON.parse(originMetric) as string;
  const requestQueries = metricValue(description, "dbq");
  const requestRows = metricValue(description, "dbrows");
  const requestCatalog = metricValue(description, "dbcatalog");
  const requestMigrations = metricValue(description, "dbmigrations");
  const requestConnections = metricValue(description, "dbconnects");
  const startupQueries = metricValue(description, "startupdbq");
  const startupRows = metricValue(description, "startupdbrows");
  const startupCatalog = metricValue(description, "startupdbcatalog");
  const startupMigrations = metricValue(description, "startupdbmigrations");
  const startupConnections = metricValue(description, "startupdbconnects");
  if (
    [
      requestQueries,
      requestRows,
      requestCatalog,
      requestMigrations,
      requestConnections,
      startupQueries,
      startupRows,
      startupCatalog,
      startupMigrations,
      startupConnections,
    ].some((value) => value === undefined)
  ) {
    fail(`cold page database counters were incomplete: ${description}`);
  }
  return {
    queries: requestQueries! + startupQueries!,
    rowsReturned: requestRows! + startupRows!,
    catalogQueries: requestCatalog! + startupCatalog!,
    migrationTableQueries: requestMigrations! + startupMigrations!,
    poolAcquisitions: requestConnections! + startupConnections!,
  };
}

function responseFromNetlifyResult(value: unknown, label: string): Response {
  if (value instanceof Response) return value;
  if (!value || typeof value !== "object") {
    fail(`${label} handler returned no HTTP response`);
  }
  const result = value as {
    statusCode?: unknown;
    headers?: Record<string, string | string[] | undefined>;
    body?: unknown;
  };
  const headers = new Headers();
  for (const [key, headerValue] of Object.entries(result.headers ?? {})) {
    if (headerValue === undefined) continue;
    headers.set(
      key,
      Array.isArray(headerValue) ? headerValue.join(", ") : headerValue,
    );
  }
  const body =
    typeof result.body === "string"
      ? result.body
      : result.body == null
        ? null
        : JSON.stringify(result.body);
  return new Response(body, {
    status: typeof result.statusCode === "number" ? result.statusCode : 200,
    headers,
  });
}

async function send(
  handler: (request: Request, context?: unknown) => Promise<unknown>,
  template: string,
  pathname: string,
  label: string,
  headers?: HeadersInit,
): Promise<Response> {
  const request = new Request(
    `https://${template}.agent-native.com${pathname}`,
    {
      method: "GET",
      headers,
    },
  );
  const response = responseFromNetlifyResult(await handler(request, {}), label);
  if (!response.ok) fail(`${label} returned HTTP ${response.status}`);
  return response;
}

export async function measureTemplate(
  template: string,
): Promise<QueryBudgetReport> {
  const action = TEMPLATE_ACTIONS[template];
  if (action === undefined) fail(`unknown first-party template: ${template}`);
  if (!process.env.NETLIFY || process.env.NODE_ENV !== "production") {
    fail("run with NETLIFY=true and NODE_ENV=production");
  }
  if (process.env.DATABASE_URL !== PGLITE_DATABASE_URL) {
    fail(`run with DATABASE_URL=${PGLITE_DATABASE_URL}`);
  }

  Object.assign(globalThis, {
    __AGENT_NATIVE_EMBEDDED_RUNTIME__: true,
  });

  await provisionTemplateSchema(template);

  const handlerPath = path.resolve("templates", template, GENERATED_HANDLER);
  const imported = (await import(pathToFileURL(handlerPath).href)) as Record<
    string,
    unknown
  >;
  const handler =
    imported.handler ??
    (imported.default as { handler?: unknown } | undefined)?.handler ??
    imported.default;
  if (typeof handler !== "function") {
    fail(
      `built Netlify handler did not export a callable handler: ${handlerPath}`,
    );
  }

  const pageResponse = await send(
    handler as (request: Request) => Promise<unknown>,
    template,
    "/",
    `${template} main page`,
  );
  const page = parseCacheablePageMetrics(
    pageResponse.headers.get("server-timing"),
  );
  await pageResponse.body?.cancel();

  let listAction: QueryBudgetMetrics | null = null;
  let listActionStatus: number | null = null;
  if (action) {
    const response = await send(
      handler as (request: Request) => Promise<unknown>,
      template,
      `/_agent-native/actions/${action}`,
      `${template} main list action`,
    );
    listActionStatus = response.status;
    listAction = parsePrivateRequestMetrics(
      response.headers.get("server-timing"),
    );
    await response.body?.cancel();
  }

  const pollResponse = await send(
    handler as (request: Request) => Promise<unknown>,
    template,
    "/_agent-native/poll?since=9007199254740991",
    `${template} idle poll`,
  );
  const idlePoll = parsePrivateRequestMetrics(
    pollResponse.headers.get("server-timing"),
  );
  await pollResponse.body?.cancel();

  return {
    template,
    action,
    page,
    listAction,
    idlePoll,
    pollRequests: 1,
    statuses: {
      page: pageResponse.status,
      listAction: listActionStatus,
      idlePoll: pollResponse.status,
    },
  };
}

export function compareQueryBudget(
  report: QueryBudgetReport,
  budget: TemplateQueryBudget,
  tolerance: QueryBudgetFile["tolerance"],
): string[] {
  if (budget.status === "retired") return [];
  if (!budget.budget)
    return [`${report.template}: no measured baseline exists`];
  const errors: string[] = [];
  const compare = (
    pathName: string,
    measured: QueryBudgetMetrics | null,
    expected: QueryBudgetMetrics | null,
  ) => {
    if (measured === null || expected === null) {
      if (measured !== expected) {
        errors.push(
          `${report.template} ${pathName}: N/A did not match baseline`,
        );
      }
      return;
    }
    for (const key of BUDGETED_METRICS) {
      const expectedValue = expected[key];
      if (expectedValue === undefined) continue;
      const allowed =
        expectedValue +
        Math.max(
          tolerance.absolute,
          Math.ceil(expectedValue * tolerance.percent),
        );
      if (measured[key] > allowed) {
        errors.push(
          `${report.template} ${pathName}.${key}: measured ${measured[key]}, budget ${allowed} (baseline ${expectedValue})`,
        );
      }
    }
  };

  compare("page", report.page, budget.budget.page);
  compare("listAction", report.listAction, budget.budget.listAction);
  compare("idlePoll", report.idlePoll, budget.budget.idlePoll);
  if (report.pollRequests !== budget.budget.pollRequests) {
    errors.push(
      `${report.template} pollRequests: measured ${report.pollRequests}, expected ${budget.budget.pollRequests}`,
    );
  }
  return errors;
}

async function readBudgetFile(): Promise<QueryBudgetFile> {
  const content = await readFile(path.resolve(BUDGET_PATH), "utf8");
  return JSON.parse(content) as QueryBudgetFile;
}

function printMarkdown(report: QueryBudgetReport): string {
  const format = (metric: QueryBudgetMetrics | null) =>
    metric
      ? `${metric.queries} / ${metric.rowsReturned} / ${metric.catalogQueries} / ${metric.migrationTableQueries} / ${metric.poolAcquisitions}`
      : "N/A";
  return [
    `### ${report.template}`,
    "",
    "| Request | Queries / rows / catalog / migration / pool acquisitions | HTTP |",
    "| --- | ---: | ---: |",
    `| Main page, including startup | ${format(report.page)} | ${report.statuses.page} |`,
    `| Main list action (${report.action ?? "not applicable"}) | ${format(report.listAction)} | ${report.statuses.listAction ?? "N/A"} |`,
    `| One idle visible-tab poll | ${format(report.idlePoll)} | ${report.statuses.idlePoll} |`,
    `| Poll requests per simulated minute | ${report.pollRequests} | |`,
    "",
    "",
  ].join("\n");
}

interface CliOptions {
  app?: string;
  mode: "measure" | "check";
  output?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mode: "check" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--app") options.app = argv[++index];
    else if (value === "--mode") {
      const mode = argv[++index];
      if (mode !== "measure" && mode !== "check") {
        fail("--mode must be measure or check");
      }
      options.mode = mode;
    } else if (value === "--output") options.output = argv[++index];
    else fail(`unknown option: ${value}`);
  }
  if (
    !options.app ||
    !Object.prototype.hasOwnProperty.call(TEMPLATE_ACTIONS, options.app)
  ) {
    fail(
      "usage: neon-query-budget.ts --app <template> [--mode measure|check] [--output <file>]",
    );
  }
  return options;
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await measureTemplate(options.app!);
    if (options.output) {
      await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
    }
    if (options.mode === "check") {
      const budgetFile = await readBudgetFile();
      const budget = budgetFile.templates[report.template];
      if (!budget) fail(`${report.template} has no entry in ${BUDGET_PATH}`);
      const errors = compareQueryBudget(report, budget, budgetFile.tolerance);
      if (errors.length) {
        console.error(errors.join("\n"));
        process.exitCode = 1;
      }
    }
    console.log(JSON.stringify(report));
    const markdown = printMarkdown(report);
    console.log(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    }
  } catch (error) {
    console.error(
      `[neon-query-budget] could not run: ${String((error as Error)?.stack ?? error)}`,
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.write("", resolve);
        }),
    ),
  );
  process.exit(process.exitCode ?? 0);
}
