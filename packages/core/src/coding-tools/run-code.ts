/**
 * Sandboxed JavaScript execution tool for the agent.
 *
 * Executes user-supplied JavaScript in an isolated child process with:
 *  - A scrubbed environment (no app secrets or env vars; only PATH/HOME/TMPDIR).
 *  - A fresh temporary working directory.
 *  - An ephemeral bridge HTTP server on 127.0.0.1 so the child can call
 *    allowlisted registered tools (provider-api-request, web-request, etc.)
 *    with the same request context as the parent — without leaking secrets.
 *
 * Security notes:
 *  - The bridge token is a 32-byte random hex string generated per invocation.
 *  - The bridge binds to 127.0.0.1 only; no external exposure.
 *  - The allowlist of callable bridge tools is enforced server-side.
 *  - Secret values are NEVER included in the env passed to the child.
 *  - When the Node permission model is available (`--permission`, or
 *    `--experimental-permission` on Node 20), the child is denied filesystem
 *    access outside its own temp dir, child processes, workers, and native
 *    addons. Outbound network from the child is NOT blocked by the permission
 *    model; the env scrub means such requests carry no credentials, and all
 *    authenticated calls must go through the bridge (which applies the
 *    registered tools' host allowlists and SSRF guards).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import type { ActionEntry } from "../agent/production-agent.js";
import type { ActionRunContext } from "../action.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
const MAX_OUTPUT_CHARS = 200_000;
/** Hard cap on bridge request bodies so sandboxed code can't exhaust parent memory. */
const BRIDGE_MAX_BODY_BYTES = 10 * 1024 * 1024;

function sandboxReadAllowPaths(tmpDir: string): string[] {
  const paths = new Set<string>([tmpDir]);
  try {
    paths.add(fs.realpathSync(tmpDir));
  } catch {}
  return [...paths];
}

function sandboxWriteAllowPaths(tmpDir: string): string[] {
  const paths = new Set<string>([tmpDir]);
  try {
    paths.add(fs.realpathSync(tmpDir));
  } catch {}
  return [...paths];
}

/**
 * Resolve the Node permission-model flag supported by the current runtime,
 * probing once and caching. Returns null when the permission model is
 * unavailable (the sandbox then falls back to env-scrub isolation only).
 */
let cachedPermissionFlag: string | null | undefined;
function resolvePermissionFlag(): string | null {
  if (cachedPermissionFlag !== undefined) return cachedPermissionFlag;
  for (const flag of ["--permission", "--experimental-permission"]) {
    try {
      const probe = spawnSync(
        process.execPath,
        [flag, "-e", "process.exit(0)"],
        { timeout: 10_000, stdio: "ignore" },
      );
      if (probe.status === 0) {
        cachedPermissionFlag = flag;
        return flag;
      }
    } catch {
      // Probe failure means the flag is unsupported; try the next one.
    }
  }
  cachedPermissionFlag = null;
  return null;
}

/** Tools callable via the sandbox bridge by default. */
const DEFAULT_BRIDGE_TOOLS = new Set([
  "provider-api-request",
  "provider-api-docs",
  "provider-api-catalog",
  "web-request",
  "workspace-files",
]);

export interface RunCodeOptions {
  /**
   * Extra tool names (beyond the default set) that the sandbox bridge will
   * forward to the registered action registry.
   */
  bridgeTools?: string[];
}

/**
 * Create a `run-code` ActionEntry.
 *
 * @param getActions  Supplier that returns the current action registry (called
 *                    at invocation time so updates are reflected).
 * @param opts        Optional configuration.
 */
export function createRunCodeEntry(
  getActions: () => Record<string, ActionEntry>,
  opts: RunCodeOptions = {},
): ActionEntry {
  const extraBridgeTools = new Set(opts.bridgeTools ?? []);

  return {
    readOnly: true,
    // Allow a generous per-call timeout so large data-processing jobs don't hit
    // the agent-loop's default 60 s cap.
    timeoutMs: MAX_TIMEOUT_MS,
    maxResultChars: MAX_OUTPUT_CHARS,
    tool: {
      description: [
        "Execute JavaScript (Node.js, ESM, top-level await supported) in an isolated sandbox.",
        "Use this to fetch, join, aggregate, and reduce large datasets, returning only printed output to the conversation.",
        "The sandbox runs with a scrubbed environment (no secrets) and, where the Node permission model is available, no filesystem access outside its own temp dir, no child processes, and no workers. Authenticated calls must go through the provided globals; direct network requests carry no credentials. Note: isolation is process-level (env scrub + Node permission model), not an OS-level container — outbound network from sandbox code is not blocked.",
        "Available globals:",
        "  - `appAction(name, args?)` — call any registered agent-exposed read-only app action/tool and get its parsed result.",
        "    Use this to loop over app data readers and compose multi-source analyses without forcing every intermediate result into chat.",
        "  - `providerFetch(provider, path, init?)` — authenticated call to a registered provider via the provider-api-request action.",
        "    Returns the parsed JSON result (or throws on error).",
        "    Supports stageAs/saveToFile/fetchAllPages; use cursorBodyPath for POST-body pagination.",
        "    Example: `const data = await providerFetch('<provider-id>', '/records', { query: { limit: 100 } });`",
        "  - `providerRequest(provider, path, init?)` — same authenticated call, but returns the full provider-api envelope with request, response status/headers, truncation, and body metadata.",
        "  - `providerFetchAll(provider, path, init?)` — generic pagination helper for cursor, page, and offset APIs. Pass `pagination: { itemsPath, cursorPath or nextCursorPath, cursorParam or cursorBodyPath, pageParam, offsetParam, pageSize, maxPages }`. Returns `{ items, pages, pageCount, itemCount, hasMore, lastCursor, stoppedReason }`.",
        "  - `webFetch(url, init?)` — outbound HTTP request via the web-request action.",
        "    Returns `{ status, body }` where body is the response text.",
        "    Example: `const { body } = await webFetch('https://api.example.com/data');`",
        "  - `workspaceRead(path, opts?)` — read a workspace file by path. Returns content string or null. opts: { offset?, maxChars? }.",
        "  - `workspaceReadMeta(path, opts?)` — read a workspace file with metadata such as sizeBytes, truncated, and nextOffset.",
        "  - `workspaceWrite(path, content, contentType?)` — create or overwrite a workspace file.",
        "  - `workspaceAppend(path, content)` — append text to a workspace file.",
        "  - `workspaceList(prefix?)` — list workspace files, returns [{ path, sizeBytes, contentType, updatedAt }].",
        "Print results with `console.log()`; only stdout+stderr are returned.",
        "Timeout defaults to 120 s (max 600 s). Output is truncated to 50 000 chars by default (max 200 000).",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "JavaScript source to execute. ESM syntax, top-level await allowed.",
          },
          timeoutMs: {
            type: "number",
            description: `Execution timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}. Max: ${MAX_TIMEOUT_MS}.`,
          },
          maxOutputChars: {
            type: "number",
            description: `Maximum combined stdout+stderr characters to return. Default: ${DEFAULT_MAX_OUTPUT_CHARS}. Max: ${MAX_OUTPUT_CHARS}.`,
          },
        },
        required: ["code"],
      },
    },
    run: async (args: Record<string, string>, context?: ActionRunContext) => {
      const code = typeof args.code === "string" ? args.code : "";
      if (!code.trim()) return "Error: code is required.";

      const requestedTimeout = Number(args.timeoutMs);
      const timeoutMs =
        Number.isFinite(requestedTimeout) && requestedTimeout > 0
          ? Math.min(requestedTimeout, MAX_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS;

      const requestedMaxOutput = Number(args.maxOutputChars);
      const maxOutputChars =
        Number.isFinite(requestedMaxOutput) && requestedMaxOutput > 0
          ? Math.min(requestedMaxOutput, MAX_OUTPUT_CHARS)
          : DEFAULT_MAX_OUTPUT_CHARS;

      const actions = getActions();
      const bridgeToken = crypto.randomBytes(32).toString("hex");

      // Start bridge server — resolves once the server is listening.
      const {
        server,
        bridgePort,
        getUsedTools,
        cleanup: cleanupBridge,
      } = await startBridgeServer(
        bridgeToken,
        actions,
        context,
        DEFAULT_BRIDGE_TOOLS,
        extraBridgeTools,
      );

      let tmpDir: string | undefined;
      let tmpFile: string | undefined;
      try {
        // Write code to a temp ESM file (top-level await needs a module).
        const tmpBaseDir = fs.realpathSync(os.tmpdir());
        tmpDir = fs.mkdtempSync(path.join(tmpBaseDir, "agent-run-code-"));
        tmpFile = path.join(tmpDir, "sandbox.mjs");
        fs.writeFileSync(
          tmpFile,
          buildSandboxModule(code, bridgePort, bridgeToken),
          "utf8",
        );

        // Build scrubbed env — only safe POSIX vars, no secrets.
        const safeEnv: Record<string, string> = {};
        for (const key of [
          "PATH",
          "HOME",
          "TMPDIR",
          "TEMP",
          "TMP",
          "LANG",
          "LC_ALL",
        ]) {
          if (process.env[key]) safeEnv[key] = process.env[key]!;
        }
        // Point TMPDIR inside the sandbox dir so in-sandbox temp writes stay
        // within the permission-model allow list.
        safeEnv.TMPDIR = tmpDir;
        safeEnv.TEMP = tmpDir;
        safeEnv.TMP = tmpDir;

        // Lock the child down with the Node permission model when available:
        // filesystem restricted to the sandbox temp dir, and child processes,
        // workers, and native addons denied entirely.
        const permissionFlag = resolvePermissionFlag();
        const nodeArgs = permissionFlag
          ? [
              permissionFlag,
              ...sandboxReadAllowPaths(tmpDir).map(
                (allowedPath) => `--allow-fs-read=${allowedPath}`,
              ),
              ...sandboxWriteAllowPaths(tmpDir).map(
                (allowedPath) => `--allow-fs-write=${allowedPath}`,
              ),
              tmpFile,
            ]
          : [tmpFile];

        const child = spawn(process.execPath, nodeArgs, {
          cwd: tmpDir,
          env: safeEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, 2_000);
        }, timeoutMs);

        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        const exitCode = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", resolve);
        });
        clearTimeout(timer);

        const combined =
          [
            stdout ? `stdout:\n${stdout}` : "",
            stderr ? `stderr:\n${stderr}` : "",
          ]
            .filter(Boolean)
            .join("\n\n") || "(no output)";

        const lines: string[] = [];
        if (timedOut) lines.push(`timedOut: true (${timeoutMs}ms)`);
        if (exitCode !== 0 && exitCode !== null)
          lines.push(`exitCode: ${exitCode}`);
        const usedTools = getUsedTools();
        if (usedTools.length)
          lines.push(`bridgeToolsUsed: ${usedTools.join(", ")}`);
        lines.push(combined);

        const full = lines.join("\n\n");
        if (full.length > maxOutputChars) {
          const truncated = full.slice(0, maxOutputChars);
          return `${truncated}\n\n...[truncated ${(full.length - maxOutputChars).toLocaleString()} chars]`;
        }
        return full;
      } finally {
        cleanupBridge();
        server.close();
        // Clean up temp files (best-effort).
        try {
          if (tmpFile) fs.rmSync(tmpFile, { force: true });
          if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Bridge server
// ---------------------------------------------------------------------------

interface BridgeResult {
  server: http.Server;
  bridgePort: number;
  getUsedTools: () => string[];
  cleanup: () => void;
}

async function startBridgeServer(
  token: string,
  actions: Record<string, ActionEntry>,
  context: ActionRunContext | undefined,
  defaultTools: Set<string>,
  extraTools: Set<string>,
): Promise<BridgeResult> {
  const usedTools = new Set<string>();
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/tool") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Validate bearer token — must match exactly.
    const authHeader = req.headers.authorization ?? "";
    if (authHeader !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body = "";
    let receivedBytes = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > BRIDGE_MAX_BODY_BYTES) {
        rejected = true;
        res.writeHead(413);
        res.end("Payload too large");
        req.destroy();
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      if (rejected) return;
      handleBridgeRequest(
        body,
        actions,
        context,
        defaultTools,
        extraTools,
        usedTools,
        res,
      );
    });
    req.on("error", () => {
      res.writeHead(500);
      res.end("Request error");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address() as { port: number };
  const bridgePort = addr.port;

  const cleanup = () => {
    try {
      server.close();
    } catch {}
  };

  return {
    server,
    bridgePort,
    getUsedTools: () => Array.from(usedTools).sort(),
    cleanup,
  };
}

function handleBridgeRequest(
  rawBody: string,
  actions: Record<string, ActionEntry>,
  context: ActionRunContext | undefined,
  defaultTools: Set<string>,
  extraTools: Set<string>,
  usedTools: Set<string>,
  res: http.ServerResponse,
): void {
  let parsed: { tool?: string; args?: Record<string, string> };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const toolName = typeof parsed.tool === "string" ? parsed.tool.trim() : "";
  if (!toolName) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing tool name" }));
    return;
  }

  // Enforce allowlist.
  const entry = actions[toolName];
  const isReadOnlyAction =
    entry?.readOnly === true &&
    entry.agentTool !== false &&
    entry.toolCallable !== false;
  if (
    !defaultTools.has(toolName) &&
    !extraTools.has(toolName) &&
    !isReadOnlyAction
  ) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Tool "${toolName}" is not an agent-exposed read-only action or sandbox bridge allowlisted tool.`,
      }),
    );
    return;
  }

  if (!entry) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Tool "${toolName}" is not registered.` }));
    return;
  }

  const toolArgs = parsed.args ?? {};
  usedTools.add(toolName);
  // Run the tool with the parent request context so auth/org/owner resolution
  // works exactly as it does in the normal agent loop.
  entry
    .run(toolArgs, context)
    .then((result: unknown) => {
      const body =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: body }));
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    });
}

// ---------------------------------------------------------------------------
// Sandbox module template
// ---------------------------------------------------------------------------

/**
 * Wrap the user's code in an ESM module that:
 *  1. Defines `providerFetch`, `providerRequest`, `providerFetchAll`, and
 *     `webFetch` helpers via the bridge.
 *  2. Runs the user's code as top-level await in an async IIFE.
 */
function buildSandboxModule(
  userCode: string,
  bridgePort: number,
  bridgeToken: string,
): string {
  return `
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const _bridgeBase = "http://127.0.0.1:${bridgePort}/tool";
const _bridgeToken = "${bridgeToken}";

async function _bridgeCall(tool, args) {
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ tool, args });
    const options = {
      hostname: "127.0.0.1",
      port: ${bridgePort},
      path: "/tool",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": "Bearer " + _bridgeToken,
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error));
          } else {
            resolve(parsed.result);
          }
        } catch (e) {
          reject(new Error("Bridge response parse error: " + e.message));
        }
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function _parseBridgeResult(rawResult) {
  if (typeof rawResult !== "string") return rawResult;
  try { return JSON.parse(rawResult); } catch { return rawResult; }
}

/**
 * Call any registered agent-exposed read-only app action/tool via the sandbox bridge.
 * Mutating and explicitly hidden actions are blocked by the parent bridge.
 */
async function appAction(name, args = {}) {
  return _parseBridgeResult(await _bridgeCall(name, args));
}

async function providerRequest(provider, apiPath, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const rawResult = await _bridgeCall("provider-api-request", {
    provider,
    path: apiPath,
    method,
    ...(init.query ? { query: init.query } : {}),
    ...(init.body ? { body: init.body } : {}),
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.auth ? { auth: init.auth } : {}),
    ...(init.connectionId ? { connectionId: init.connectionId } : {}),
    ...(init.accountId ? { accountId: init.accountId } : {}),
    ...(init.timeoutMs ? { timeoutMs: init.timeoutMs } : {}),
    ...(init.maxBytes ? { maxBytes: init.maxBytes } : {}),
    ...(init.stageAs ? { stageAs: init.stageAs } : {}),
    ...(init.itemsPath ? { itemsPath: init.itemsPath } : {}),
    ...(init.pagination ? { pagination: init.pagination } : {}),
    ...(init.saveToFile ? { saveToFile: init.saveToFile } : {}),
    ...(init.fetchAllPages ? { fetchAllPages: init.fetchAllPages } : {}),
  });
  return _parseBridgeResult(rawResult);
}

/**
 * Call a provider API via the authenticated provider-api-request action.
 * Returns the parsed JSON response body (or throws on error).
 */
async function providerFetch(provider, apiPath, init = {}) {
  const parsed = await providerRequest(provider, apiPath, init);
  // Unwrap the provider-api-request envelope ({ provider, request, response, guidance })
  // so callers get the actual response body. fetchAllPages / saveToFile results
  // (which have no \`response\` field) are returned as-is.
  if (parsed && typeof parsed === "object" && parsed.response && typeof parsed.response === "object") {
    const r = parsed.response;
    if (typeof r.status === "number" && r.status >= 400) {
      const detail = typeof r.text === "string" ? r.text : JSON.stringify(r.json ?? "");
      throw new Error(\`Provider request failed (\${r.status}): \${String(detail).slice(0, 500)}\`);
    }
    return r.json !== undefined ? r.json : r.text;
  }
  return parsed;
}

function _cloneJson(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function _pathParts(path) {
  if (!path || typeof path !== "string") return [];
  return path
    .replace(/\\[(\\d+)\\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function _getByPath(value, path) {
  let current = value;
  for (const part of _pathParts(path)) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function _setByPath(value, path, nextValue) {
  const parts = _pathParts(path);
  if (!parts.length) return value;
  const root = value && typeof value === "object" ? _cloneJson(value) : {};
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = nextValue;
  return root;
}

function _extractItems(page, itemsPath) {
  if (itemsPath) {
    const value = _getByPath(page, itemsPath);
    return Array.isArray(value) ? value : [];
  }
  if (Array.isArray(page)) return page;
  if (!page || typeof page !== "object") return [];
  for (const key of ["data", "results", "items", "records", "rows", "calls", "messages", "tickets", "issues", "deals"]) {
    if (Array.isArray(page[key])) return page[key];
  }
  return [];
}

function _withoutProviderFetchAllOptions(init) {
  const {
    pagination: _pagination,
    fetchAllPages: _fetchAllPages,
    stageAs: _stageAs,
    itemsPath: _itemsPath,
    saveToFile: _saveToFile,
    ...rest
  } = init || {};
  return rest;
}

/**
 * Fetch every page from a provider API using generic cursor, page-number, or
 * offset pagination. Prefer this inside run-code when the answer depends on a
 * broad provider corpus rather than a single bounded request.
 */
async function providerFetchAll(provider, apiPath, init = {}) {
  const pagination = init.pagination || init.fetchAllPages || {};
  const itemsPath = pagination.itemsPath || init.itemsPath;
  const cursorPath = pagination.nextCursorPath || pagination.cursorPath;
  const maxPagesRaw = Number(pagination.maxPages || init.maxPages || 50);
  const maxPages = Math.max(1, Math.min(Number.isFinite(maxPagesRaw) ? maxPagesRaw : 50, 200));
  const baseInit = _withoutProviderFetchAllOptions(init);
  let query = _cloneJson(init.query || {});
  let body = _cloneJson(init.body);
  let pageNumber = Number(pagination.startPage || 1);
  let offset = Number(pagination.startOffset || 0);
  const pages = [];
  const items = [];
  let lastCursor = null;
  let stoppedReason = "completed";

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    if (pagination.pageParam) {
      query = { ...(query || {}), [pagination.pageParam]: pageNumber };
    }
    if (pagination.offsetParam) {
      query = { ...(query || {}), [pagination.offsetParam]: offset };
    }

    const page = await providerFetch(provider, apiPath, {
      ...baseInit,
      query,
      ...(body !== undefined ? { body } : {}),
    });
    pages.push(page);
    const pageItems = _extractItems(page, itemsPath);
    items.push(...pageItems);

    const nextCursor = cursorPath ? _getByPath(page, cursorPath) : undefined;
    if (nextCursor !== undefined && nextCursor !== null && String(nextCursor) !== "") {
      if (lastCursor !== null && String(nextCursor) === String(lastCursor)) {
        stoppedReason = "repeated-cursor";
        break;
      }
      lastCursor = nextCursor;
      if (pagination.cursorBodyPath) {
        body = _setByPath(body || {}, pagination.cursorBodyPath, nextCursor);
      } else if (pagination.cursorParam) {
        query = { ...(query || {}), [pagination.cursorParam]: nextCursor };
      } else {
        stoppedReason = "cursor-found-without-destination";
        break;
      }
      continue;
    }

    lastCursor = null;
    if (pagination.pageParam) {
      if (pageItems.length === 0) {
        stoppedReason = "empty-page";
        break;
      }
      pageNumber += 1;
      continue;
    }
    if (pagination.offsetParam) {
      if (pageItems.length === 0) {
        stoppedReason = "empty-page";
        break;
      }
      const step = Number(pagination.pageSize || pageItems.length);
      if (!Number.isFinite(step) || step <= 0) {
        stoppedReason = "invalid-page-size";
        break;
      }
      offset += step;
      if (pagination.pageSize && pageItems.length < Number(pagination.pageSize)) {
        stoppedReason = "short-page";
        break;
      }
      continue;
    }

    break;
  }

  const hitPageOrOffsetLimit =
    Boolean(pagination.pageParam || pagination.offsetParam) &&
    stoppedReason === "completed" &&
    pages.length >= maxPages;
  const hasMore =
    (lastCursor !== null && pages.length >= maxPages) || hitPageOrOffsetLimit;
  if (hasMore) stoppedReason = "max-pages";
  return {
    items,
    pages,
    pageCount: pages.length,
    itemCount: items.length,
    hasMore,
    lastCursor,
    stoppedReason,
  };
}

/**
 * Make an outbound HTTP request via the web-request action.
 * Returns an object \`{ status, body }\` where \`body\` is the response text.
 */
async function webFetch(url, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const rawResult = await _bridgeCall("web-request", {
    url,
    method,
    ...(init.headers ? { headers: typeof init.headers === "string" ? init.headers : JSON.stringify(init.headers) } : {}),
    ...(init.body ? { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) } : {}),
  });
  // rawResult is "HTTP <status> <statusText>\\n\\n<body>"
  const statusMatch = typeof rawResult === "string" ? rawResult.match(/^HTTP (\\d+) [^\\n]*\\n\\n/) : null;
  if (statusMatch) {
    return {
      status: Number(statusMatch[1]),
      body: rawResult.slice(statusMatch[0].length),
    };
  }
  return { status: 0, body: rawResult };
}

/**
 * Read a workspace file by path. Returns the file content as a string, or null if not found.
 * Supports optional offset and maxChars for paging large files.
 */
async function workspaceRead(path, opts = {}) {
  const parsed = await workspaceReadMeta(path, opts);
  if (parsed && parsed.ok === false) return null;
  return parsed && typeof parsed.content === "string" ? parsed.content : null;
}

/**
 * Read a workspace file by path and return the full metadata envelope.
 * Use this when offset/maxChars paging or truncation status matters.
 */
async function workspaceReadMeta(path, opts = {}) {
  const rawResult = await _bridgeCall("workspace-files", {
    action: "read",
    path,
    ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
    ...(opts.maxChars !== undefined ? { maxChars: opts.maxChars } : {}),
  });
  return _parseBridgeResult(rawResult);
}

/**
 * Write (create or overwrite) a workspace file.
 * \`content\` must be a string. Returns metadata { path, sizeBytes, updatedAt }.
 */
async function workspaceWrite(path, content, contentType = "text/plain") {
  const rawResult = await _bridgeCall("workspace-files", {
    action: "write",
    path,
    content: typeof content === "string" ? content : JSON.stringify(content),
    contentType,
  });
  try { return typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult; } catch { return rawResult; }
}

/**
 * Append text to a workspace file (creates if absent).
 */
async function workspaceAppend(path, content) {
  const rawResult = await _bridgeCall("workspace-files", {
    action: "append",
    path,
    content: typeof content === "string" ? content : JSON.stringify(content),
  });
  try { return typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult; } catch { return rawResult; }
}

/**
 * List workspace files, optionally filtered by path prefix.
 * Returns an array of { path, sizeBytes, contentType, updatedAt }.
 */
async function workspaceList(prefix) {
  const rawResult = await _bridgeCall("workspace-files", {
    action: "list",
    ...(prefix ? { path: prefix } : {}),
  });
  const parsed = typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;
  if (parsed && Array.isArray(parsed.files)) return parsed.files;
  if (Array.isArray(parsed)) return parsed;
  throw new Error("workspaceList: unexpected result shape: " + JSON.stringify(parsed).slice(0, 200));
}

// Run user code
(async () => {
${userCode}
})().catch((err) => {
  console.error("Unhandled error:", err?.message ?? String(err));
  process.exit(1);
});
`;
}
