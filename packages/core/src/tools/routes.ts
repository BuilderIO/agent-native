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
import {
  listTools,
  getTool,
  createTool,
  updateTool,
  updateToolContent,
  deleteTool,
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
    const html = buildToolHtml(tool.content, themeVars, isDark);
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

const PRIVATE_IP_RE =
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[::1?\])/i;
const METADATA_HOSTS = [
  "metadata.google.internal",
  "metadata.google.internal.",
];

function isBlockedUrl(url: string): boolean {
  if (PRIVATE_IP_RE.test(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (METADATA_HOSTS.includes(host)) return true;
    if (host === "169.254.169.254") return true;
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

async function handleSqlExec(event: H3Event): Promise<unknown> {
  const body = await readBody(event);
  const sql = body.sql;
  if (!sql || typeof sql !== "string") {
    setResponseStatus(event, 400);
    return { error: "sql is required" };
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
