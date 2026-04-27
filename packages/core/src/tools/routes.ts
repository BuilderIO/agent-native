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
  listTools,
  getTool,
  createTool,
  updateTool,
  updateToolContent,
  deleteTool,
} from "./store.js";
import { buildToolHtml } from "./html-shell.js";
import { getThemeVars } from "./theme.js";
import { resolveKeyReferences } from "../secrets/substitution.js";
import { getRequestUserEmail } from "../server/request-context.js";

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

    // POST /proxy
    if (method === "POST" && parts.length === 1 && parts[0] === "proxy") {
      return handleProxy(event);
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
      const themeVars = getThemeVars();
      const isDark = (event.url?.search || "").includes("dark=1");
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
  });
}

async function handleProxy(event: H3Event): Promise<unknown> {
  const body = await readBody(event);
  const rawUrl = body.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    setResponseStatus(event, 400);
    return { error: "url is required" };
  }

  const method = (body.method || "GET").toUpperCase();
  const rawHeaders: Record<string, string> = body.headers || {};
  const rawBody = body.body;

  const userEmail = getRequestUserEmail() || "local@localhost";

  let resolvedUrl = rawUrl;
  let resolvedHeaders = JSON.stringify(rawHeaders);
  let resolvedBody = rawBody;

  try {
    const urlResult = await resolveKeyReferences(rawUrl, "user", userEmail);
    resolvedUrl = urlResult.resolved;

    const headerResult = await resolveKeyReferences(
      resolvedHeaders,
      "user",
      userEmail,
    );
    resolvedHeaders = headerResult.resolved;

    if (rawBody) {
      const bodyResult = await resolveKeyReferences(
        typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
        "user",
        userEmail,
      );
      resolvedBody = bodyResult.resolved;
    }
  } catch (err: any) {
    setResponseStatus(event, 400);
    return { error: `Key resolution failed: ${err?.message ?? err}` };
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
