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
import { runWithRequestContext } from "../server/request-context.js";
import { getOrgContext } from "../org/context.js";
import { getDbExec } from "../db/client.js";
import {
  listTools,
  getTool,
  createTool,
  updateTool,
  updateToolContent,
  deleteTool,
  ensureToolsTables,
} from "./store.js";
import { buildToolHtml } from "./html-shell.js";
import { getThemeVars } from "./theme.js";
import {
  resolveKeyReferences,
  validateUrlAllowlist,
  getKeyAllowlist,
} from "../secrets/substitution.js";

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

    return runWithRequestContext({ userEmail, orgId }, () =>
      dispatch(event, method, parts, userEmail),
    );
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
    const tool = await getTool(parts[0]);
    if (!tool) {
      setResponseStatus(event, 404);
      return { error: "Tool not found" };
    }
    const search = event.url?.search || "";
    const isDark = search.includes("dark=1") || search.includes("dark=true");
    const themeVars = getThemeVars(isDark);
    const html = buildToolHtml(tool.content, themeVars, isDark, parts[0]);
    setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
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
  const result = await client.execute({
    sql: `SELECT COALESCE(item_id, id) AS id, tool_id, collection, data, owner_email, created_at, updated_at
      FROM tool_data
      WHERE tool_id = ? AND collection = ? AND owner_email = ?
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
  const client = getDbExec();
  const existing = await client.execute({
    sql: `SELECT id
      FROM tool_data
      WHERE tool_id = ?
        AND collection = ?
        AND owner_email = ?
        AND (item_id = ? OR (item_id IS NULL AND id = ?))
      ORDER BY CASE WHEN item_id = ? THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    args: [toolId, collection, userEmail, itemId, itemId, itemId],
  });
  const storageId = existing.rows?.[0]?.id;

  if (storageId) {
    await client.execute({
      sql: `UPDATE tool_data
        SET data = ?, updated_at = ?
        WHERE id = ? AND tool_id = ? AND collection = ? AND owner_email = ?`,
      args: [data, now, storageId, toolId, collection, userEmail],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO tool_data (id, tool_id, collection, item_id, data, owner_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tool_id, collection, owner_email, item_id)
       DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      args: [
        randomUUID(),
        toolId,
        collection,
        itemId,
        data,
        userEmail,
        now,
        now,
      ],
    });
  }

  const saved = await client.execute({
    sql: `SELECT COALESCE(item_id, id) AS id, tool_id, collection, data, owner_email, created_at, updated_at
      FROM tool_data
      WHERE tool_id = ?
        AND collection = ?
        AND owner_email = ?
        AND (item_id = ? OR (item_id IS NULL AND id = ?))
      ORDER BY CASE WHEN item_id = ? THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    args: [toolId, collection, userEmail, itemId, itemId, itemId],
  });
  const row = saved.rows?.[0];
  return {
    id: row?.id ?? itemId,
    toolId: row?.tool_id ?? toolId,
    collection: row?.collection ?? collection,
    data: row?.data ?? data,
    ownerEmail: row?.owner_email ?? userEmail,
    createdAt: row?.created_at ?? now,
    updatedAt: row?.updated_at ?? now,
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
  const client = getDbExec();
  const existing = await client.execute({
    sql: `SELECT id
      FROM tool_data
      WHERE tool_id = ?
        AND collection = ?
        AND owner_email = ?
        AND (item_id = ? OR (item_id IS NULL AND id = ?))
      ORDER BY CASE WHEN item_id = ? THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    args: [toolId, collection, userEmail, itemId, itemId, itemId],
  });
  const storageId = existing.rows?.[0]?.id;
  if (storageId) {
    await client.execute({
      sql: `DELETE FROM tool_data WHERE id = ? AND tool_id = ? AND collection = ? AND owner_email = ?`,
      args: [storageId, toolId, collection, userEmail],
    });
  }
  return { ok: true };
}

const METADATA_HOSTS = [
  "metadata.google.internal",
  "metadata.google.internal.",
];

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost") return true;
  if (METADATA_HOSTS.includes(h)) return true;

  // IPv6 forms
  if (h === "::1" || h === "::0" || h === "::") return true;
  // IPv4-mapped IPv6: ::ffff:127.0.0.1
  const v4mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) {
    const [a, b] = v4mapped[1].split(".").map(Number);
    if (isPrivateIpv4(a, b)) return true;
  }
  // ULA (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd]/.test(h)) return true;
  if (/^fe[89ab]/.test(h)) return true;

  // Dotted IPv4
  const raw = hostname.toLowerCase();
  const parts = raw.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (isPrivateIpv4(a, b)) return true;
  }
  // Decimal integer IPv4
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    if (num >= 0 && num <= 0xffffffff) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      if (isPrivateIpv4(a, b)) return true;
    }
  }
  return false;
}

const DNS_REBIND_SUFFIXES = [
  ".nip.io",
  ".sslip.io",
  ".xip.io",
  ".localtest.me",
  ".lvh.me",
];

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true;
    }
    const host = parsed.hostname.toLowerCase();
    if (isPrivateHost(host)) return true;
    if (DNS_REBIND_SUFFIXES.some((s) => host.endsWith(s))) return true;
  } catch {
    return true;
  }
  return false;
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

  const method = (body.method || "GET").toUpperCase();
  const rawHeaders: Record<string, string> = body.headers || {};
  const rawBody = body.body;

  let resolvedUrl = rawUrl;
  let resolvedHeaders = JSON.stringify(rawHeaders);
  let resolvedBody = rawBody;
  const allUsedKeys: string[] = [];

  try {
    const urlResult = await resolveKeyReferences(rawUrl, "user", userEmail);
    resolvedUrl = urlResult.resolved;
    allUsedKeys.push(...urlResult.usedKeys);

    const headerResult = await resolveKeyReferences(
      resolvedHeaders,
      "user",
      userEmail,
    );
    resolvedHeaders = headerResult.resolved;
    allUsedKeys.push(...headerResult.usedKeys);

    if (rawBody) {
      const bodyResult = await resolveKeyReferences(
        typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
        "user",
        userEmail,
      );
      resolvedBody = bodyResult.resolved;
      allUsedKeys.push(...bodyResult.usedKeys);
    }
  } catch (err: any) {
    setResponseStatus(event, 400);
    return { error: `Key resolution failed: ${err?.message ?? err}` };
  }

  if (isBlockedUrl(resolvedUrl)) {
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
    headers = JSON.parse(resolvedHeaders);
  } catch {
    headers = rawHeaders;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const fetchOpts: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      redirect: "manual",
    };
    if (resolvedBody && ["POST", "PUT", "PATCH"].includes(method)) {
      fetchOpts.body =
        typeof resolvedBody === "string"
          ? resolvedBody
          : JSON.stringify(resolvedBody);
      if (!headers["content-type"] && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(resolvedUrl, fetchOpts);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location && isBlockedUrl(new URL(location, resolvedUrl).href)) {
        setResponseStatus(event, 403);
        return { error: "Redirect to private/internal address blocked" };
      }
      return {
        status: response.status,
        body: { redirect: location },
      };
    }

    const text = await response.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }

    return { status: response.status, body: responseBody };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      setResponseStatus(event, 504);
      return { error: "Upstream request timed out" };
    }
    setResponseStatus(event, 502);
    return { error: `Proxy request failed: ${err?.message ?? err}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Capture console output from a CLI script that uses console.log for results.
 * Same technique as wrapCliScript in agent-chat-plugin.ts.
 */
async function captureCliOutput(
  fn: (args: string[]) => Promise<void>,
  args: string[],
): Promise<string> {
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

const DESTRUCTIVE_SQL_RE =
  /\b(CREATE\s+(?:(?:LOCAL|GLOBAL)\s+)?(?:TEMPORARY|TEMP)?\s*(TABLE|INDEX|VIEW|SCHEMA|DATABASE|TRIGGER)|DROP\s+(TABLE|INDEX|VIEW|SCHEMA|DATABASE|TRIGGER)|TRUNCATE|DELETE\s+FROM\s+(?!tool_data\b)|ALTER\s+TABLE\s+(?!tool_data\b)|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b/i;

const SENSITIVE_SQL_RE =
  /\b(app_secrets|user|users|session|sessions|account|accounts|verification|oauth_tokens|tool_shares)\b/i;

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
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

  try {
    const mod = await import("../scripts/db/exec.js");
    const args = ["--sql", sql, "--format", "json"];
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
