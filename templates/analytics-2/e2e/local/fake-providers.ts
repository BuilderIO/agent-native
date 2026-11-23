import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect, type AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { z } from "zod";

import { safeErrorDiagnostic } from "../failure-diagnostic.js";
import { answerModelRequest, createModelState } from "./fake-model";
import { required } from "./required";

/**
 * Test-only fake of every external provider the analytics app talks to during everyday use:
 * Google OAuth token exchange, the BigQuery REST API (datasets, tables, query jobs), HubSpot's
 * private-app token check, the Builder.io connect handshake and an Anthropic-compatible model
 * endpoint with scripted answers. Deterministic: no clock, no randomness in responses except job
 * ids. The app reaches it through `preload.ts`, which rewrites those hosts to this loopback server.
 */

export type BigQueryMode = "ok" | "empty" | "error" | "denied" | "slow";
export type HubSpotMode = "ok" | "unauthorized" | "error" | "slow";

export type FakeTable = {
  dataset: string;
  name: string;
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, string | number | null>>;
};

export type Scenario = {
  projectId: string;
  /** "ok": normal; "empty": no datasets; "error": 500s; "denied": 403 on every call; "slow": 1.5 s per call. */
  bigquery: BigQueryMode;
  bigqueryStorageFailure?: boolean;
  /** Project-wide INFORMATION_SCHEMA is denied, as for a dataset-scoped service account. */
  denyProjectInformationSchema: boolean;
  hubspot: HubSpotMode;
  tables: FakeTable[];
  /** Datasets the key can read that hold no tables (for the empty tables list). */
  emptyDatasets: string[];
};

const ORDER_ROWS = Array.from({ length: 24 }, (_, i) => ({
  order_id: 1001 + i,
  region: required(["North", "South", "East", "West"][i % 4]),
  amount: 100 + ((i * 37) % 400),
  status: required(["paid", "refunded", "pending"][i % 3]),
  ordered_at: `2026-0${1 + (i % 9)}-1${i % 10}`,
}));

function manyTables(): FakeTable[] {
  // Enough tables to need two pages at the default BigQuery page size of 50.
  return Array.from({ length: 62 }, (_, i) => ({
    dataset: "warehouse_many",
    name: `events_${String(i + 1).padStart(2, "0")}`,
    columns: [
      { name: "event_id", type: "INT64" },
      { name: "kind", type: "STRING" },
    ],
    rows: [{ event_id: i + 1, kind: "view" }],
  }));
}

export function defaultScenario(): Scenario {
  return {
    projectId: "local-fake-project",
    bigquery: "ok",
    denyProjectInformationSchema: true,
    hubspot: "ok",
    emptyDatasets: [],
    tables: [
      {
        dataset: "daily_sales",
        name: "orders",
        columns: [
          { name: "order_id", type: "INT64" },
          { name: "region", type: "STRING" },
          { name: "amount", type: "FLOAT64" },
          { name: "status", type: "STRING" },
          { name: "ordered_at", type: "DATE" },
        ],
        rows: ORDER_ROWS,
      },
      {
        dataset: "daily_sales",
        name: "customers",
        columns: [
          { name: "customer_id", type: "INT64" },
          { name: "name", type: "STRING" },
        ],
        rows: [
          { customer_id: 1, name: "Ada" },
          { customer_id: 2, name: "Grace" },
        ],
      },
      {
        dataset: "single_table",
        name: "only_table",
        columns: [{ name: "id", type: "INT64" }],
        rows: [{ id: 1 }],
      },
      ...manyTables(),
    ],
  };
}

/** A real RSA key so the app's service-account JWT signing works; never used outside loopback. */
export function fakeServiceAccountKey(projectId = "local-fake-project") {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    type: "service_account",
    project_id: projectId,
    private_key_id: "local-fake-key",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: `daily-e2e@${projectId}.iam.gserviceaccount.com`,
    client_id: "100000000000000000001",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

export const HUBSPOT_GOOD_TOKEN = "pat-na1-daily-good-0000";
export const HUBSPOT_BAD_TOKEN = "pat-na1-daily-bad-0000";

type CallLog = {
  host: string;
  method: string;
  path: string;
  at: number;
  jobId?: string;
};

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function bqError(
  res: ServerResponse,
  status: number,
  reason: string,
  message: string,
) {
  json(res, status, {
    error: {
      code: status,
      message,
      errors: [{ reason, message }],
      status: reason,
    },
  });
}

function bqType(type: string) {
  return type === "INT64" ? "INTEGER" : type === "FLOAT64" ? "FLOAT" : type;
}

function queryResult(
  projectId: string,
  fields: Array<{ name: string; type: string }>,
  rows: Array<Record<string, unknown>>,
) {
  return {
    kind: "bigquery#queryResponse",
    jobReference: {
      projectId,
      jobId: `job_${randomUUID().replaceAll("-", "")}`,
      location: "US",
    },
    jobComplete: true,
    totalRows: String(rows.length),
    schema: {
      fields: fields.map((f) => ({
        name: f.name,
        type: bqType(f.type),
        mode: "NULLABLE",
      })),
    },
    rows: rows.map((row) => ({
      f: fields.map((f) => ({
        v:
          row[f.name] === null || row[f.name] === undefined
            ? null
            : String(row[f.name]),
      })),
    })),
  };
}

function queryPage(
  result: ReturnType<typeof queryResult>,
  pageToken: string | null,
  maxResults: unknown,
) {
  const start = pageToken === null ? 0 : Number(pageToken);
  const max = maxResults == null ? result.rows.length || 1 : Number(maxResults);
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(max) ||
    max < 1
  )
    return null;
  const end = start + max;
  return {
    ...result,
    rows: result.rows.slice(start, end),
    pageToken: end < result.rows.length ? String(end) : undefined,
  };
}

/** Answers the handful of SQL shapes the app sends: catalog reads and simple selects. */
function runSql(scenario: Scenario, sql: string) {
  const text = sql.replace(/\s+/g, " ").trim();
  const tables = scenario.tables;
  const datasetQualified =
    /`?(?:[\w-]+\.)?([A-Za-z_]\w*)`?\.INFORMATION_SCHEMA\.(TABLES|COLUMNS|COLUMN_FIELD_PATHS|TABLE_OPTIONS)/i.exec(
      text,
    );
  const projectWide =
    /(?:region-[\w-]+|`[\w-]+`)\.INFORMATION_SCHEMA|INFORMATION_SCHEMA\.SCHEMATA/i.test(
      text,
    );
  if (!datasetQualified && projectWide) {
    if (scenario.denyProjectInformationSchema) return { denied: true as const };
    const datasets = [
      ...new Set([...tables.map((t) => t.dataset), ...scenario.emptyDatasets]),
    ];
    return {
      fields: [{ name: "schema_name", type: "STRING" }],
      rows: datasets.map((d) => ({ schema_name: d })),
    };
  }
  if (datasetQualified) {
    const dataset = required(datasetQualified[1]);
    const view = required(datasetQualified[2]).toUpperCase();
    const inDataset = tables.filter((t) => t.dataset === dataset);
    if (view === "COLUMNS" || view === "COLUMN_FIELD_PATHS") {
      const rows = inDataset.flatMap((t) =>
        t.columns.map((c, i) => ({
          table_catalog: scenario.projectId,
          table_schema: dataset,
          table_name: t.name,
          column_name: c.name,
          field_path: c.name,
          data_type: c.type,
          ordinal_position: i + 1,
          is_nullable: "YES",
        })),
      );
      return {
        fields: [
          "table_catalog",
          "table_schema",
          "table_name",
          "column_name",
          "field_path",
          "data_type",
          "ordinal_position",
          "is_nullable",
        ].map((name) => ({
          name,
          type: name === "ordinal_position" ? "INT64" : "STRING",
        })),
        rows,
      };
    }
    return {
      fields: ["table_catalog", "table_schema", "table_name", "table_type"].map(
        (name) => ({ name, type: "STRING" }),
      ),
      rows: inDataset.map((t) => ({
        table_catalog: scenario.projectId,
        table_schema: dataset,
        table_name: t.name,
        table_type: "BASE TABLE",
      })),
    };
  }
  const from = /\bfrom\s+`?(?:[\w-]+\.)?(?:(\w+)\.)?(\w+)`?/i.exec(text);
  const table = from
    ? tables.find(
        (t) => t.name === from[2] && (!from[1] || t.dataset === from[1]),
      )
    : undefined;
  if (from && !table && !/^select\s+[^]*\bfrom\s*\(/i.test(text))
    return {
      error: `Not found: Table ${scenario.projectId}:${from[1] || "dataset"}.${from[2]} was not found in location US`,
    };
  if (table) {
    const limit = /\blimit\s+(\d+)/i.exec(text);
    return {
      fields: table.columns,
      rows: table.rows.slice(0, limit ? Number(limit[1]) : undefined),
    };
  }
  // SELECT without FROM: SELECT 1 AS a, 'x' AS b
  const literals = /^select\s+(.+?)(?:;)?$/i.exec(text)?.[1]?.split(",") ?? [];
  const fields: Array<{ name: string; type: string }> = [];
  const row: Record<string, unknown> = {};
  literals.forEach((part, i) => {
    const m = /^\s*(.+?)(?:\s+as\s+(\w+))?\s*$/i.exec(part);
    const value = (m?.[1] ?? "").replace(/^'(.*)'$/, "$1");
    const name = m?.[2] ?? `f${i}_`;
    fields.push({ name, type: /^-?\d+$/.test(value) ? "INT64" : "STRING" });
    row[name] = value;
  });
  return { fields, rows: [row] };
}

function paged<T>(items: T[], url: URL, size = 50) {
  const start = Number(url.searchParams.get("pageToken") ?? 0);
  const max = Number(url.searchParams.get("maxResults") ?? size);
  const page = items.slice(start, start + max);
  return {
    page,
    nextPageToken: start + max < items.length ? String(start + max) : undefined,
  };
}

export async function startFakeProviders(
  options: {
    port?: number;
    appPort?: number;
    scenario?: Scenario;
    serveAnthropicDirectly?: boolean;
  } = {},
) {
  let scenario: Scenario = options.scenario ?? defaultScenario();
  const calls: CallLog[] = [];
  const jobs = new Map<
    string,
    {
      projectId: string;
      fields: Array<{ name: string; type: string }>;
      rows: Array<Record<string, unknown>>;
      result: ReturnType<typeof queryResult>;
      pending?: boolean;
      cancelled?: boolean;
    }
  >();
  const modelState = createModelState();
  const assets = new Map<
    string,
    Promise<{ status: number; headers: Record<string, string>; body: Buffer }>
  >();
  async function proxyApp(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      Number(url.port) !== options.appPort
    )
      return json(res, 403, {
        error: "Daily browser proxy refuses non-app traffic",
      });
    const staticAsset =
      req.method === "GET" &&
      /\.(?:tsx?|jsx?|mjs|css|woff2?)(?:$|\?)/.test(url.pathname + url.search);
    const forward = async () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (
          value &&
          ![
            "host",
            "connection",
            "accept-encoding",
            "if-none-match",
            "if-modified-since",
          ].includes(name)
        )
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const response = await fetch(url, {
        method: req.method ?? "GET",
        headers,
        redirect: "manual",
        ...(req.method === "GET" || req.method === "HEAD"
          ? {}
          : { body: await body(req) }),
      });
      const responseHeaders = Object.fromEntries(response.headers);
      for (const name of [
        "content-encoding",
        "content-length",
        "transfer-encoding",
        "connection",
      ])
        delete responseHeaders[name];
      return { response, headers: responseHeaders };
    };
    if (staticAsset) {
      let asset = assets.get(url.href);
      if (!asset) {
        asset = forward().then(async ({ response, headers }) => ({
          status: response.status,
          headers,
          body: Buffer.from(await response.arrayBuffer()),
        }));
        assets.set(url.href, asset);
      }
      let result;
      try {
        result = await asset;
      } catch (error) {
        if (assets.get(url.href) === asset) assets.delete(url.href);
        throw error;
      }
      const cacheControl = result.headers["cache-control"] ?? "";
      if (
        result.status !== 200 ||
        !/(?:^|,)\s*immutable\s*(?:,|$)/i.test(cacheControl) ||
        /(?:^|,)\s*(?:no-cache|no-store|private)(?:\s|=|,|$)/i.test(
          cacheControl,
        )
      ) {
        if (assets.get(url.href) === asset) assets.delete(url.href);
      }
      res.writeHead(result.status, result.headers);
      res.end(result.body);
      return;
    }
    const { response, headers } = await forward();
    res.writeHead(response.status, headers);
    if (!response.body) return res.end();
    const stream = Readable.from(response.body as AsyncIterable<Uint8Array>);
    stream.on("error", (error) => res.destroy(error));
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  }
  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });
  async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) {
    try {
      const url = new URL(req.url ?? "/", "http://fake.local");
      if (/^http:\/\//.test(req.url ?? ""))
        return await proxyApp(req, res, url);
      const host = String(req.headers["x-fake-host"] ?? "control");
      if (url.pathname.startsWith("/__control"))
        return await control(req, res, url);
      calls.push({
        host,
        method: req.method ?? "GET",
        path: url.pathname + url.search,
        at: Date.now(),
      });
      if (
        host === "oauth2.googleapis.com" ||
        (host === "www.googleapis.com" && url.pathname.startsWith("/oauth2"))
      ) {
        await body(req);
        return json(res, 200, {
          access_token: "ya29.local-fake",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (host.endsWith("googleapis.com")) return await bigquery(req, res, url);
      if (host === "api.hubapi.com") return await hubspot(req, res, url);
      if (
        host === "api.anthropic.com" ||
        (options.serveAnthropicDirectly &&
          (url.pathname === "/v1/messages" || url.pathname === "/v1/models"))
      )
        return await anthropic(req, res, url);
      if (host.endsWith("builder.io")) return await builder(req, res, url);
      return json(res, 404, {
        error: `fake has no route for ${host}${url.pathname}`,
      });
    } catch (error) {
      const diagnostic = safeErrorDiagnostic(error);
      console.error(`Local fake request failed: ${diagnostic}`);
      json(res, 500, { error: diagnostic });
    }
  }

  server.on("connect", (req, socket, head) => {
    const target = new URL(`http://${req.url}`);
    if (
      target.hostname !== "127.0.0.1" ||
      Number(target.port) !== options.appPort
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = connect(Number(target.port), "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
  });

  async function control(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname === "/__control/calls") return json(res, 200, calls);
    if (url.pathname === "/__control/storage") {
      const jobId = url.searchParams.get("jobId") ?? "";
      calls.push({
        host: "storage",
        method: req.method ?? "GET",
        path: url.pathname,
        at: Date.now(),
        ...(jobId && { jobId }),
      });
      const job = jobs.get(jobId);
      if (!job || job.projectId !== url.searchParams.get("projectId"))
        return json(res, 404, { error: "Unknown Storage query job" });
      if (scenario.bigqueryStorageFailure)
        return json(res, 503, { error: "Injected Storage read failure" });
      const offset = Number(url.searchParams.get("offset"));
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > job.rows.length
      )
        return json(res, 400, { error: "Invalid Storage offset" });
      return json(res, 200, {
        fields: job.fields,
        rows: job.rows.slice(offset),
      });
    }
    if (url.pathname === "/__control/assets/reset") {
      assets.clear();
      return json(res, 200, { ok: true });
    }
    const input =
      req.method === "POST" ? JSON.parse((await body(req)) || "{}") : {};
    if (url.pathname === "/__control/reset") {
      scenario = options.scenario ?? defaultScenario();
      calls.length = 0;
      jobs.clear();
      modelState.reset();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/__control/scenario") {
      scenario = { ...scenario, ...input };
      return json(res, 200, scenario);
    }
    if (url.pathname === "/__control/key")
      return json(res, 200, fakeServiceAccountKey(scenario.projectId));
    return json(res, 404, { error: "unknown control" });
  }

  // MCP OAuth 2 client discovery and DCR, matching RFC 9728 / RFC 8414.
  async function builder(req: IncomingMessage, res: ServerResponse, url: URL) {
    const issuer = "https://mcp.builder.io";
    const scopes = [
      "builder:ai:invoke",
      "builder:agents:run",
      "builder:browser:connect",
      "builder:assets:write",
      "builder:content:read",
      "builder:content:write",
      "builder:projects:read",
      "builder:projects:write",
      "builder:designsystem:read",
      "builder:designsystem:write",
    ];
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
      return json(res, 200, {
        resource: "https://api.builder.io",
        authorization_servers: [issuer],
        scopes_supported: scopes,
        bearer_methods_supported: ["header"],
      });
    if (
      [
        "/.well-known/oauth-authorization-server",
        "/.well-known/openid-configuration",
      ].includes(url.pathname)
    )
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: scopes,
      });
    if (url.pathname === "/register" && req.method === "POST") {
      const input = JSON.parse(await body(req));
      return json(res, 201, {
        ...input,
        client_id: "local-fake-builder-client",
        client_id_issued_at: 1700000000,
        token_endpoint_auth_method: "none",
      });
    }
    if (url.pathname === "/token" && req.method === "POST") {
      await body(req);
      return json(res, 200, {
        access_token: "local-fake-builder-access",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "local-fake-builder-refresh",
        scope: scopes.join(" "),
      });
    }
    if (url.pathname === "/authorize") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(
        "<!doctype html><title>Local Builder authorization</title><h1>Authorize</h1>",
      );
    }
    return json(res, 404, {
      error: `Unknown fake Builder route: ${url.pathname}`,
    });
  }

  async function bigquery(req: IncomingMessage, res: ServerResponse, url: URL) {
    const raw = await body(req);
    if (scenario.bigquery === "slow") await delay(1500);
    if (scenario.bigquery === "error")
      return bqError(
        res,
        500,
        "backendError",
        "Backend error. Please try again.",
      );
    if (scenario.bigquery === "denied")
      return bqError(
        res,
        403,
        "accessDenied",
        `Access Denied: Project ${scenario.projectId}: User does not have bigquery.jobs.create permission in project ${scenario.projectId}.`,
      );
    const path = url.pathname.replace(/^\/bigquery\/v2/, "");
    const tables = scenario.bigquery === "empty" ? [] : scenario.tables;
    const emptyDatasets =
      scenario.bigquery === "empty" ? [] : scenario.emptyDatasets;
    let m: RegExpExecArray | null;
    if ((m = /^\/projects\/([^/]+)\/datasets\/?$/.exec(path))) {
      const datasets = [
        ...new Set([...tables.map((t) => t.dataset), ...emptyDatasets]),
      ];
      const { page, nextPageToken } = paged(datasets, url);
      return json(res, 200, {
        kind: "bigquery#datasetList",
        datasets: page.map((d) => ({
          id: `${required(m)[1]}:${d}`,
          datasetReference: { projectId: required(m)[1], datasetId: d },
          location: "US",
        })),
        ...(nextPageToken ? { nextPageToken } : {}),
      });
    }
    if (
      (m = /^\/projects\/([^/]+)\/datasets\/([^/]+)\/tables\/?$/.exec(path))
    ) {
      const inDataset = tables.filter(
        (t) => t.dataset === decodeURIComponent(required(required(m)[2])),
      );
      const { page, nextPageToken } = paged(inDataset, url);
      return json(res, 200, {
        kind: "bigquery#tableList",
        totalItems: inDataset.length,
        tables: page.map((t) => ({
          id: `${required(m)[1]}:${t.dataset}.${t.name}`,
          tableReference: {
            projectId: required(m)[1],
            datasetId: t.dataset,
            tableId: t.name,
          },
          type: "TABLE",
        })),
        ...(nextPageToken ? { nextPageToken } : {}),
      });
    }
    if (
      (m =
        /^\/projects\/([^/]+)\/datasets\/([^/]+)\/tables\/([^/]+)\/data$/.exec(
          path,
        ))
    ) {
      const t = tables.find(
        (x) =>
          x.dataset === decodeURIComponent(required(required(m)[2])) &&
          x.name === decodeURIComponent(required(required(m)[3])),
      );
      if (!t) return bqError(res, 404, "notFound", "Not found: Table");
      return json(res, 200, {
        totalRows: String(t.rows.length),
        rows: queryResult(required(m[1]), t.columns, t.rows).rows,
      });
    }
    if (
      (m = /^\/projects\/([^/]+)\/datasets\/([^/]+)\/tables\/([^/]+)$/.exec(
        path,
      ))
    ) {
      const t = tables.find(
        (x) =>
          x.dataset === decodeURIComponent(required(required(m)[2])) &&
          x.name === decodeURIComponent(required(required(m)[3])),
      );
      if (!t)
        return bqError(
          res,
          404,
          "notFound",
          `Not found: Table ${m[1]}:${m[2]}.${m[3]}`,
        );
      return json(res, 200, {
        kind: "bigquery#table",
        tableReference: {
          projectId: m[1],
          datasetId: t.dataset,
          tableId: t.name,
        },
        type: "TABLE",
        numRows: String(t.rows.length),
        schema: {
          fields: t.columns.map((c) => ({
            name: c.name,
            type: bqType(c.type),
            mode: "NULLABLE",
          })),
        },
      });
    }
    if ((m = /^\/projects\/([^/]+)\/datasets\/([^/]+)$/.exec(path))) {
      const d = decodeURIComponent(required(m[2]));
      if (!tables.some((t) => t.dataset === d) && !emptyDatasets.includes(d))
        return bqError(res, 404, "notFound", `Not found: Dataset ${m[1]}:${d}`);
      return json(res, 200, {
        kind: "bigquery#dataset",
        datasetReference: { projectId: m[1], datasetId: d },
        location: "US",
      });
    }
    if (
      (m = /^\/projects\/([^/]+)\/queries\/?$/.exec(path)) ||
      (m = /^\/projects\/([^/]+)\/jobs\/?$/.exec(path))
    ) {
      const input = JSON.parse(raw || "{}");
      const sql = String(
        input.query ?? input.configuration?.query?.query ?? "",
      );
      const out = runSql({ ...scenario, tables }, sql);
      if ("denied" in out)
        return bqError(
          res,
          403,
          "accessDenied",
          `Access Denied: Table ${scenario.projectId}:INFORMATION_SCHEMA: User does not have permission to query table.`,
        );
      if ("error" in out)
        return bqError(res, 404, "notFound", required(out.error));
      const jobRequest = path.endsWith("/jobs");
      const reference =
        input.jobReference === undefined
          ? undefined
          : z
              .object({
                projectId: z.string(),
                jobId: z.string(),
                location: z.string(),
              })
              .safeParse(input.jobReference);
      if (
        reference &&
        (!reference.success || reference.data.projectId !== required(m[1]))
      )
        return bqError(res, 400, "invalid", "Invalid job reference");
      if (jobRequest && input.configuration?.dryRun === true)
        return json(res, 200, {
          kind: "bigquery#job",
          jobReference: {
            projectId: required(m[1]),
            location: reference?.success ? reference.data.location : "US",
          },
          statistics: {
            query: { statementType: "SELECT", totalBytesProcessed: "0" },
          },
        });
      if (input.dryRun)
        return json(res, 200, {
          kind: "bigquery#queryResponse",
          jobComplete: true,
          totalBytesProcessed: "0",
          schema: {
            fields: out.fields.map((f) => ({
              name: f.name,
              type: bqType(f.type),
            })),
          },
        });
      const result = queryResult(required(m[1]), out.fields, out.rows);
      if (jobRequest && reference?.success) {
        if (jobs.has(reference.data.jobId))
          return bqError(res, 409, "duplicate", "Job already exists");
        result.jobReference = reference.data;
      }
      const page = queryPage(result, null, input.maxResults);
      if (!page) return bqError(res, 400, "invalid", "Invalid maxResults");
      const pending = sql.includes("/* QA_PENDING_JOB */");
      jobs.set(result.jobReference.jobId, {
        projectId: required(m[1]),
        fields: out.fields,
        rows: out.rows,
        result,
        pending,
      });
      return json(
        res,
        200,
        jobRequest
          ? {
              kind: "bigquery#job",
              jobReference: result.jobReference,
              status: { state: pending ? "RUNNING" : "DONE" },
            }
          : pending
            ? { jobComplete: false, jobReference: result.jobReference }
            : page,
      );
    }
    if (
      req.method === "POST" &&
      (m = /^\/projects\/([^/]+)\/jobs\/([^/]+)\/cancel$/.exec(path))
    ) {
      const job = jobs.get(decodeURIComponent(required(m[2])));
      if (
        !job ||
        job.projectId !== decodeURIComponent(required(m[1])) ||
        !job.pending
      )
        return bqError(res, 404, "notFound", "Unknown pending query job");
      job.cancelled = true;
      return json(res, 200, {
        job: {
          jobReference: job.result.jobReference,
          status: { state: "RUNNING" },
        },
      });
    }
    if (
      (m = /^\/projects\/([^/]+)\/queries\/([^/]+)$/.exec(path)) ||
      (m = /^\/projects\/([^/]+)\/jobs\/([^/]+)$/.exec(path))
    ) {
      const job = jobs.get(decodeURIComponent(required(m[2])));
      if (!job || job.projectId !== decodeURIComponent(required(m[1])))
        return bqError(res, 404, "notFound", "Unknown query job");
      if (path.includes("/jobs/"))
        return json(res, 200, {
          kind: "bigquery#job",
          jobReference: job.result.jobReference,
          status: job.cancelled
            ? { state: "DONE", errorResult: { reason: "stopped" } }
            : { state: job.pending ? "RUNNING" : "DONE" },
        });
      if (job.pending)
        return json(
          res,
          200,
          job.cancelled
            ? {
                jobComplete: true,
                jobReference: job.result.jobReference,
                errors: [{ reason: "stopped", message: "Job was cancelled" }],
              }
            : { jobComplete: false, jobReference: job.result.jobReference },
        );
      const page = queryPage(
        job.result,
        url.searchParams.get("pageToken"),
        url.searchParams.get("maxResults"),
      );
      if (!page)
        return bqError(res, 400, "invalid", "Invalid pagination parameters");
      return json(res, 200, page);
    }
    if ((m = /^\/projects\/?$/.exec(path)))
      return json(res, 200, {
        projects: [
          {
            id: scenario.projectId,
            projectReference: { projectId: scenario.projectId },
            friendlyName: scenario.projectId,
          },
        ],
      });
    return bqError(
      res,
      404,
      "notFound",
      `fake BigQuery has no route for ${url.pathname}`,
    );
  }

  async function hubspot(req: IncomingMessage, res: ServerResponse, url: URL) {
    await body(req);
    if (scenario.hubspot === "slow") await delay(1500);
    if (scenario.hubspot === "error")
      return json(res, 500, {
        status: "error",
        message: "internal error",
        category: "INTERNAL_ERROR",
      });
    const auth = String(req.headers.authorization ?? "");
    if (
      scenario.hubspot === "unauthorized" ||
      !auth.includes(HUBSPOT_GOOD_TOKEN)
    )
      return json(res, 401, {
        status: "error",
        message: "Authentication credentials not found.",
        category: "INVALID_AUTHENTICATION",
      });
    if (url.pathname.startsWith("/account-info"))
      return json(res, 200, {
        portalId: 4242,
        accountType: "STANDARD",
        timeZone: "US/Pacific",
        companyCurrency: "USD",
        uiDomain: "app.hubspot.com",
      });
    if (url.pathname.startsWith("/crm/v3/objects/"))
      return json(res, 200, {
        results: [{ id: "1", properties: { name: "Fake Co" } }],
        paging: undefined,
      });
    return json(res, 200, { ok: true });
  }

  async function anthropic(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ) {
    if (req.method === "GET" && url.pathname.startsWith("/v1/models"))
      return json(res, 200, {
        data: [
          {
            type: "model",
            id: "claude-sonnet-5-5",
            display_name: "Sonnet 5.5",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        has_more: false,
        first_id: "claude-sonnet-5-5",
        last_id: "claude-sonnet-5-5",
      });
    const input = JSON.parse((await body(req)) || "{}");
    return answerModelRequest(input, res, modelState);
  }

  await new Promise<void>((done) =>
    server.listen(options.port ?? 0, "127.0.0.1", done),
  );
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    calls,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
