import { randomUUID } from "node:crypto";
import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import { readBody } from "../server/h3-helpers.js";
import { getSession } from "../server/auth.js";
import { recordChange } from "../server/poll.js";
import {
  runWithRequestContext,
  getRequestOrgId,
} from "../server/request-context.js";
import { getOrgContext } from "../org/context.js";
import { getDbExec, isPostgres } from "../db/client.js";
import {
  listTools,
  getTool,
  createTool,
  updateTool,
  updateToolContent,
  deleteTool,
  ensureToolsTables,
} from "./store.js";
import { buildToolHtml, TOOL_IFRAME_CSP } from "./html-shell.js";
import { getThemeVars } from "./theme.js";
import {
  resolveKeyReferences,
  validateUrlAllowlist,
  getKeyAllowlist,
} from "../secrets/substitution.js";
import {
  collectSecretValues,
  normalizeToolProxyMethod,
  readResponseTextWithLimit,
  redactSecrets,
  redactString,
  sanitizeOutboundHeaders,
} from "./proxy-security.js";
import {
  createSsrfSafeDispatcher,
  isBlockedToolUrlWithDns,
} from "./url-safety.js";
import { ForbiddenError, resolveAccess } from "../sharing/access.js";

export function createToolsHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    const pathname = (event.url?.pathname || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const parts = pathname ? pathname.split("/") : [];

    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }

    const orgCtx = await getOrgContext(event).catch(() => null);
    const userEmail = session.email;
    const orgId = orgCtx?.orgId ?? undefined;

    try {
      return await runWithRequestContext({ userEmail, orgId }, () =>
        dispatch(event, method, parts, userEmail),
      );
    } catch (err) {
      if (err instanceof ForbiddenError) {
        setResponseStatus(event, 403);
        return { error: err.message };
      }
      throw err;
    }
  });
}

async function dispatch(
  event: H3Event,
  method: string,
  parts: string[],
  userEmail: string,
): Promise<unknown> {
  // POST /sql/query — read-only SQL for tool iframes
  if (
    method === "POST" &&
    parts.length === 2 &&
    parts[0] === "sql" &&
    parts[1] === "query"
  ) {
    return handleSqlQuery(event);
  }

  // POST /sql/exec — write SQL for tool iframes
  if (
    method === "POST" &&
    parts.length === 2 &&
    parts[0] === "sql" &&
    parts[1] === "exec"
  ) {
    return handleSqlExec(event);
  }

  // GET /data/:toolId/:collection — list items in a collection
  if (method === "GET" && parts.length === 3 && parts[0] === "data") {
    return handleToolDataList(event, parts[1], parts[2], userEmail);
  }

  // POST /data/:toolId/:collection — create/upsert an item
  if (method === "POST" && parts.length === 3 && parts[0] === "data") {
    return handleToolDataUpsert(event, parts[1], parts[2], userEmail);
  }

  // DELETE /data/:toolId/:collection/:itemId — delete an item
  if (method === "DELETE" && parts.length === 4 && parts[0] === "data") {
    return handleToolDataDelete(event, parts[1], parts[2], parts[3], userEmail);
  }

  // POST /proxy
  if (method === "POST" && parts.length === 1 && parts[0] === "proxy") {
    return handleProxy(event, userEmail);
  }

  // GET / — list
  if (method === "GET" && parts.length === 0) {
    return listTools();
  }

  // POST / — create
  if (method === "POST" && parts.length === 0) {
    const body = await readBody(event);
    if (!body.name) {
      setResponseStatus(event, 400);
      return { error: "name is required" };
    }
    const tool = await createTool(body);
    recordChange({ source: "action", type: "change" });
    setResponseStatus(event, 201);
    return tool;
  }

  // GET /:id/render
  if (method === "GET" && parts.length === 2 && parts[1] === "render") {
    const access = await resolveAccess("tool", parts[0]);
    const tool = access?.resource;
    if (!tool) {
      setResponseStatus(event, 404);
      return { error: "Tool not found" };
    }
    const search = event.url?.search || "";
    const isDark = search.includes("dark=1") || search.includes("dark=true");
    const themeVars = getThemeVars(isDark);
    // Compute viewer-vs-author binding so the iframe can warn when the
    // viewer is NOT the author. This is the minimum-viable trust signal —
    // a full consent flow is tracked as TODO C1 in audit 05-tools-sandbox.md.
    // Resolved access role is plumbed through so future bridge gating can
    // be conditional on owner/editor/viewer (audit H4 — scaffold only).
    const isAuthor = tool.ownerEmail === userEmail;
    const html = buildToolHtml(tool.content, themeVars, isDark, parts[0], {
      authorEmail: tool.ownerEmail,
      viewerEmail: userEmail,
      isAuthor,
      role: access.role,
    });
    // Security headers per render. We set these explicitly here (rather than
    // rely on the global security-headers middleware) because:
    //   - The global middleware sets X-Frame-Options: DENY which would break
    //     the legitimate iframe usage of this route inside the app.
    //   - frame-ancestors in the CSP must be set as an HTTP header to be
    //     enforced; meta-CSP can't set it per spec.
    setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
    setResponseHeader(event, "Content-Security-Policy", TOOL_IFRAME_CSP);
    setResponseHeader(event, "X-Frame-Options", "SAMEORIGIN");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");
    return html;
  }

  // GET /:id
  if (method === "GET" && parts.length === 1) {
    const tool = await getTool(parts[0]);
    if (!tool) {
      setResponseStatus(event, 404);
      return { error: "Tool not found" };
    }
    return tool;
  }

  // PUT /:id
  if (method === "PUT" && parts.length === 1) {
    const body = await readBody(event);
    const hasContentUpdate =
      body.content !== undefined || body.patches !== undefined;
    const hasMetaUpdate =
      body.name !== undefined ||
      body.description !== undefined ||
      body.icon !== undefined ||
      body.visibility !== undefined;

    let result = null;
    if (hasContentUpdate) {
      result = await updateToolContent(parts[0], {
        content: body.content,
        patches: body.patches,
      });
    }
    if (hasMetaUpdate) {
      result = await updateTool(parts[0], body);
    }
    if (!hasContentUpdate && !hasMetaUpdate) {
      result = await getTool(parts[0]);
    }
    if (!result) {
      setResponseStatus(event, 404);
      return { error: "Tool not found" };
    }
    recordChange({ source: "action", type: "change" });
    return result;
  }

  // DELETE /:id
  if (method === "DELETE" && parts.length === 1) {
    const ok = await deleteTool(parts[0]);
    if (!ok) {
      setResponseStatus(event, 404);
      return { error: "Tool not found" };
    }
    recordChange({ source: "action", type: "change" });
    return { ok: true };
  }

  setResponseStatus(event, 404);
  return { error: "Not found" };
}

async function handleToolDataList(
  event: H3Event,
  toolId: string,
  collection: string,
  userEmail: string,
): Promise<unknown> {
  await ensureToolsTables();
  const tool = await getTool(toolId);
  if (!tool) {
    setResponseStatus(event, 404);
    return { error: "Tool not found" };
  }
  const client = getDbExec();
  const url = event.url;
  const limitParam = url?.searchParams?.get("limit");
  const limit = limitParam
    ? Math.min(Math.max(1, Number(limitParam)), 1000)
    : 100;
  const scope = url?.searchParams?.get("scope") || "user";
  const orgId = getRequestOrgId();

  if (scope === "org") {
    if (!orgId) {
      setResponseStatus(event, 400);
      return { error: "Org context required for scope=org" };
    }
    const result = await client.execute({
      sql: `SELECT COALESCE(item_id, id) AS id, tool_id, collection, data, owner_email, scope, org_id, created_at, updated_at
        FROM tool_data
        WHERE tool_id = ? AND collection = ? AND scope = 'org' AND org_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      args: [toolId, collection, orgId, limit],
    });
    return result.rows ?? [];
  }

  if (scope === "all") {
    const result = await client.execute({
      sql: `SELECT COALESCE(item_id, id) AS id, tool_id, collection, data, owner_email, scope, org_id, created_at, updated_at
        FROM tool_data
        WHERE tool_id = ? AND collection = ?
          AND ((scope = 'user' AND owner_email = ?) OR (scope = 'org' AND org_id = ?))
        ORDER BY created_at DESC
        LIMIT ?`,
      args: [toolId, collection, userEmail, orgId ?? "", limit],
    });
    return result.rows ?? [];
  }

  const result = await client.execute({
    sql: `SELECT COALESCE(item_id, id) AS id, tool_id, collection, data, owner_email, scope, org_id, created_at, updated_at
      FROM tool_data
      WHERE tool_id = ? AND collection = ? AND scope = 'user' AND owner_email = ?
      ORDER BY updated_at DESC
      LIMIT ?`,
    args: [toolId, collection, userEmail, limit],
  });
  return result.rows ?? [];
}

async function handleToolDataUpsert(
  event: H3Event,
  toolId: string,
  collection: string,
  userEmail: string,
): Promise<unknown> {
  await ensureToolsTables();
  const tool = await getTool(toolId);
  if (!tool) {
    setResponseStatus(event, 404);
    return { error: "Tool not found" };
  }
  const body = await readBody(event);
  if (body.data === undefined) {
    setResponseStatus(event, 400);
    return { error: "data is required" };
  }
  const itemId = String(body.id || randomUUID());
  const data =
    typeof body.data === "string" ? body.data : JSON.stringify(body.data);
  const now = new Date().toISOString();
  const scope = body.scope === "org" ? "org" : "user";
  const orgId = getRequestOrgId();

  if (scope === "org" && !orgId) {
    setResponseStatus(event, 400);
    return { error: "Org context required for scope=org" };
  }

  const scopeKey = scope === "org" ? `org:${orgId}` : userEmail;
  const client = getDbExec();
  const pg = isPostgres();
  const conflictClause = pg
    ? `ON CONFLICT (tool_id, collection, scope_key, item_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`
    : `ON CONFLICT (tool_id, collection, scope_key, item_id)
       DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`;

  await client.execute({
    sql: `INSERT INTO tool_data (id, tool_id, collection, item_id, data, owner_email, scope, org_id, scope_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ${conflictClause}`,
    args: [
      randomUUID(),
      toolId,
      collection,
      itemId,
      data,
      userEmail,
      scope,
      scope === "org" ? orgId! : null,
      scopeKey,
      now,
      now,
    ],
  });
  return {
    id: itemId,
    toolId,
    collection,
    data,
    ownerEmail: userEmail,
    scope,
    orgId: scope === "org" ? orgId : null,
    createdAt: now,
    updatedAt: now,
  };
}

async function handleToolDataDelete(
  event: H3Event,
  toolId: string,
  collection: string,
  itemId: string,
  userEmail: string,
): Promise<unknown> {
  await ensureToolsTables();
  const tool = await getTool(toolId);
  if (!tool) {
    setResponseStatus(event, 404);
    return { error: "Tool not found" };
  }
  const url = event.url;
  const scope = url?.searchParams?.get("scope") || "user";
  const orgId = getRequestOrgId();
  const client = getDbExec();

  if (scope === "org") {
    if (!orgId) {
      setResponseStatus(event, 400);
      return { error: "Org context required for scope=org" };
    }
    await client.execute({
      sql: `DELETE FROM tool_data WHERE COALESCE(item_id, id) = ? AND tool_id = ? AND collection = ? AND scope = 'org' AND org_id = ?`,
      args: [itemId, toolId, collection, orgId],
    });
    return { ok: true };
  }

  await client.execute({
    sql: `DELETE FROM tool_data WHERE COALESCE(item_id, id) = ? AND tool_id = ? AND collection = ? AND scope = 'user' AND owner_email = ?`,
    args: [itemId, toolId, collection, userEmail],
  });
  return { ok: true };
}

async function handleProxy(
  event: H3Event,
  userEmail: string,
): Promise<unknown> {
  const body = await readBody(event);
  const rawUrl = body.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    setResponseStatus(event, 400);
    return { error: "url is required" };
  }

  const method = normalizeToolProxyMethod(body.method || "GET");
  if (!method) {
    setResponseStatus(event, 405);
    return {
      error:
        "Unsupported HTTP method. Allowed methods: GET, POST, PUT, PATCH, DELETE, HEAD.",
    };
  }
  const rawHeaders: Record<string, string> = body.headers || {};
  const rawBody = body.body;

  let resolvedUrl = rawUrl;
  let resolvedHeaders = JSON.stringify(rawHeaders);
  let resolvedBody = rawBody;
  const allUsedKeys: string[] = [];
  const allSecretValues: string[] = [];

  try {
    const urlResult = await resolveKeyReferences(rawUrl, "user", userEmail);
    resolvedUrl = urlResult.resolved;
    allUsedKeys.push(...urlResult.usedKeys);
    allSecretValues.push(...urlResult.secretValues);

    const headerResult = await resolveKeyReferences(
      resolvedHeaders,
      "user",
      userEmail,
    );
    resolvedHeaders = headerResult.resolved;
    allUsedKeys.push(...headerResult.usedKeys);
    allSecretValues.push(...headerResult.secretValues);

    if (rawBody) {
      const bodyResult = await resolveKeyReferences(
        typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
        "user",
        userEmail,
      );
      resolvedBody = bodyResult.resolved;
      allUsedKeys.push(...bodyResult.usedKeys);
      allSecretValues.push(...bodyResult.secretValues);
    }
  } catch (err: any) {
    setResponseStatus(event, 400);
    return { error: `Key resolution failed: ${err?.message ?? err}` };
  }
  const secretValues = collectSecretValues(allSecretValues);

  if (await isBlockedToolUrlWithDns(resolvedUrl)) {
    setResponseStatus(event, 403);
    return { error: "Requests to private/internal addresses are not allowed" };
  }

  for (const keyName of new Set(allUsedKeys)) {
    const allowlist = await getKeyAllowlist(keyName, "user", userEmail);
    if (!validateUrlAllowlist(resolvedUrl, allowlist)) {
      setResponseStatus(event, 403);
      return {
        error: `Key "${keyName}" is not allowed for this URL origin`,
      };
    }
  }

  let headers: Record<string, string>;
  try {
    headers = sanitizeOutboundHeaders(JSON.parse(resolvedHeaders));
  } catch {
    headers = sanitizeOutboundHeaders(rawHeaders);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  // Best-effort connect-time SSRF guard. When undici is available (it ships
  // with Node 18+ but is not always exposed as an importable module), the
  // dispatcher re-checks the resolved IP at TCP-connect time, closing the
  // TOCTOU between the pre-flight `isBlockedToolUrlWithDns` lookup and the
  // actual fetch lookup. If undici is not importable, fall through to plain
  // fetch — the pre-flight remains the primary protection.
  const dispatcher = (await createSsrfSafeDispatcher()) ?? undefined;

  try {
    const fetchOpts: RequestInit & { dispatcher?: unknown } = {
      method,
      headers,
      signal: controller.signal,
      redirect: "manual",
    };
    if (dispatcher) fetchOpts.dispatcher = dispatcher;
    if (resolvedBody && ["POST", "PUT", "PATCH"].includes(method)) {
      const isStringBody = typeof resolvedBody === "string";
      fetchOpts.body = isStringBody
        ? resolvedBody
        : JSON.stringify(resolvedBody);
      // Only inject Content-Type when (a) the caller didn't set one and
      // (b) the body is actually JSON-shaped (object or stringified JSON).
      // Otherwise leave it unset so the runtime fetch picks an appropriate
      // default and we don't misrepresent text/plain bodies as JSON.
      const hasContentType = Object.keys(headers).some(
        (k) => k.toLowerCase() === "content-type",
      );
      if (!hasContentType) {
        const isJsonShaped =
          !isStringBody ||
          (typeof resolvedBody === "string" &&
            /^\s*[{[]/.test(resolvedBody) &&
            isLikelyJson(resolvedBody));
        if (isJsonShaped) headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(resolvedUrl, fetchOpts);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const redirectUrl = location ? new URL(location, resolvedUrl).href : null;
      if (redirectUrl && (await isBlockedToolUrlWithDns(redirectUrl))) {
        setResponseStatus(event, 403);
        return { error: "Redirect to private/internal address blocked" };
      }
      if (redirectUrl) {
        for (const keyName of new Set(allUsedKeys)) {
          const allowlist = await getKeyAllowlist(keyName, "user", userEmail);
          if (!validateUrlAllowlist(redirectUrl, allowlist)) {
            setResponseStatus(event, 403);
            return {
              error: `Redirect URL is not allowed for key "${keyName}"`,
            };
          }
        }
      }
      return {
        status: response.status,
        body: {
          redirect: redirectUrl
            ? redactString(redirectUrl, secretValues)
            : location,
        },
      };
    }

    const { text } = await readResponseTextWithLimit(response);
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }

    return {
      status: response.status,
      body: redactSecrets(responseBody, secretValues),
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      setResponseStatus(event, 504);
      return { error: "Upstream request timed out" };
    }
    setResponseStatus(event, 502);
    return {
      error: `Proxy request failed: ${redactSecrets(
        err?.message ?? String(err),
        secretValues,
      )}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Capture console output from a CLI script that uses console.log for results.
 * Same technique as wrapCliScript in agent-chat-plugin.ts.
 */
let captureCliOutputQueue: Promise<void> = Promise.resolve();

async function captureCliOutput(
  fn: (args: string[]) => Promise<void>,
  args: string[],
): Promise<string> {
  const previousCapture = captureCliOutputQueue;
  let releaseCapture!: () => void;
  captureCliOutputQueue = new Promise<void>((resolve) => {
    releaseCapture = resolve;
  });
  await previousCapture;

  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origStdoutWrite = process.stdout.write;
  console.log = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  console.error = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  process.stdout.write = ((chunk: any) => {
    if (typeof chunk === "string") logs.push(chunk);
    else if (Buffer.isBuffer(chunk)) logs.push(chunk.toString());
    return true;
  }) as any;
  try {
    await fn(args);
  } catch (err: any) {
    logs.push(`Error: ${err?.message ?? String(err)}`);
  } finally {
    console.log = origLog;
    console.error = origError;
    process.stdout.write = origStdoutWrite;
    releaseCapture();
  }
  return logs.join("\n") || "(no output)";
}

async function handleSqlQuery(event: H3Event): Promise<unknown> {
  const body = await readBody(event);
  const sql = body.sql;
  if (!sql || typeof sql !== "string") {
    setResponseStatus(event, 400);
    return { error: "sql is required" };
  }

  const cleanSql = stripSqlComments(sql);
  if (!/^\s*(SELECT|WITH)\b/i.test(cleanSql)) {
    setResponseStatus(event, 403);
    return { error: "Only SELECT queries are allowed from tools" };
  }
  if (SENSITIVE_SQL_RE.test(cleanSql)) {
    setResponseStatus(event, 403);
    return { error: "Sensitive framework tables are not readable from tools" };
  }

  try {
    const mod = await import("../scripts/db/query.js");
    const args = ["--sql", sql, "--format", "json"];
    if (body.limit) args.push("--limit", String(body.limit));
    if (body.args !== undefined) {
      if (!Array.isArray(body.args)) {
        setResponseStatus(event, 400);
        return { error: "args must be an array" };
      }
      args.push("--args", JSON.stringify(body.args));
    }
    const output = await captureCliOutput(mod.default, args);
    try {
      return JSON.parse(output);
    } catch {
      return { output };
    }
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err?.message ?? "Query failed" };
  }
}

// TODO(security): replace this regex blocklist with a SQL parser + an explicit
// allowlist of tables a tool may read/write (e.g. only `tool_data`, plus a
// per-template list). The current blocklist is best-effort defense in depth
// and is by design bypassable via SQL constructions that don't include the
// blocklisted token literally (string concat, dynamic SQL, etc). The temp-
// view scoping in scripts/db/scoping.ts is the actual ownership boundary.
const DESTRUCTIVE_SQL_RE =
  /\b(CREATE\s+(?:(?:LOCAL|GLOBAL)\s+)?(?:TEMPORARY|TEMP)?\s*(TABLE|INDEX|VIEW|SCHEMA|DATABASE|TRIGGER|FUNCTION|EXTENSION|ROLE|TABLESPACE|PUBLICATION|SUBSCRIPTION)|DROP\s+(TABLE|INDEX|VIEW|SCHEMA|DATABASE|TRIGGER|FUNCTION|EXTENSION|ROLE)|TRUNCATE|DELETE\s+FROM\s+(?!tool_data\b)|ALTER\s+(TABLE|VIEW|SCHEMA|DATABASE|FUNCTION|ROLE|EXTENSION|PUBLICATION)\s+(?!tool_data\b)|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA|GRANT|REVOKE|SET\s+ROLE|RESET\s+ROLE|COPY)\b/i;

// Sensitive tables that tools must not touch directly. Includes Better Auth
// identity tables, framework infrastructure (tracing, evals, automations,
// integrations, notifications, scheduling, sharing/orgs), and Postgres
// catalogs that would let a tool enumerate or read internals.
const SENSITIVE_SQL_RE =
  /\b(app_secrets|user|users|session|sessions|account|accounts|verification|oauth_tokens|tools|tool_shares|tool_slots|tool_slot_installs|member|organization|invitation|jwks|agent_trace_spans|agent_trace_summaries|agent_feedback|agent_satisfaction_scores|agent_evals|agent_runs|agent_run_events|notifications|progress_runs|integration_configs|integration_pending_tasks|integration_thread_mappings|resources|org_members|org_invitations|bigquery_cache|dashboard_views|pg_catalog|information_schema|pg_class|pg_proc|pg_namespace|pg_user|pg_roles|pg_authid|pg_shadow)\b/i;

// Refuses positional INSERTs (no column list). `INSERT INTO recordings VALUES
// (...)` would let a tool stuff arbitrary owner_email values into a row.
// `INSERT INTO recordings (col1, col2) VALUES (...)` is required so the
// downstream injectOwnership helper can append owner_email.
const POSITIONAL_INSERT_RE = /\bINSERT\s+INTO\s+["'`]?\w+["'`]?\s+VALUES\b/i;

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function isLikelyJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

async function handleSqlExec(event: H3Event): Promise<unknown> {
  const body = await readBody(event);
  const sql = body.sql;
  if (!sql || typeof sql !== "string") {
    setResponseStatus(event, 400);
    return { error: "sql is required" };
  }

  const cleanSql = stripSqlComments(sql);
  if (DESTRUCTIVE_SQL_RE.test(cleanSql)) {
    setResponseStatus(event, 403);
    return {
      error: "Schema changes and destructive SQL are not allowed from tools",
    };
  }
  if (SENSITIVE_SQL_RE.test(cleanSql)) {
    setResponseStatus(event, 403);
    return { error: "Sensitive framework tables are not writable from tools" };
  }
  if (POSITIONAL_INSERT_RE.test(cleanSql)) {
    setResponseStatus(event, 400);
    return {
      error:
        "INSERT must specify an explicit column list (e.g. INSERT INTO t (col1, col2) VALUES (?, ?)) so ownership can be injected.",
    };
  }

  try {
    const mod = await import("../scripts/db/exec.js");
    const args = ["--sql", sql, "--format", "json"];
    if (body.args !== undefined) {
      if (!Array.isArray(body.args)) {
        setResponseStatus(event, 400);
        return { error: "args must be an array" };
      }
      args.push("--args", JSON.stringify(body.args));
    }
    const output = await captureCliOutput(mod.default, args);
    try {
      return JSON.parse(output);
    } catch {
      return { output };
    }
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err?.message ?? "Exec failed" };
  }
}
