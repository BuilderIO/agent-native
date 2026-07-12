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
 *
 * The actual execution is delegated to a pluggable `SandboxAdapter` (see
 * `./sandbox`). The default `LocalChildProcessAdapter` preserves the spawned
 * child-process behavior described above; a remote/durable adapter can be
 * plugged in via `registerSandboxAdapter()` / `AGENT_NATIVE_SANDBOX` without
 * changing this file. The bridge, env scrub, module building, and output
 * formatting stay here in the parent regardless of adapter.
 */

import crypto from "node:crypto";
import http from "node:http";

import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { getRequestUserEmail } from "../server/request-context.js";
import {
  failExpiredSandboxExecution,
  getSandboxExecutionForOwner,
  type SandboxExecutionRow,
} from "./sandbox/executions-store.js";
import {
  BACKGROUND_DEFAULT_TIMEOUT_MS,
  BACKGROUND_MAX_TIMEOUT_MS,
  SANDBOX_EXECUTION_REDRIVE_AFTER_MS,
  driveSandboxExecution,
  enqueueSandboxExecution,
  getSandboxAdapter,
  isQueuedSandboxAdapter,
  registerSandboxExecutionRunner,
  resolveExecutionSandboxAdapter,
} from "./sandbox/index.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
const MAX_OUTPUT_CHARS = 200_000;
/** Hard cap on bridge request bodies so sandboxed code can't exhaust parent memory. */
const BRIDGE_MAX_BODY_BYTES = 10 * 1024 * 1024;

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

  // Make this entry's action surface available to the durable background
  // executor (first registration wins — the host builds the full-surface
  // production entry first). The executor re-runs `executeSandboxCode` with
  // the same bridge allowlist under the enqueueing owner's request context,
  // so background executions see the same tools as foreground ones.
  registerSandboxExecutionRunner({
    execute: ({ code, timeoutMs, context }) =>
      executeSandboxCode({
        code,
        timeoutMs,
        getActions,
        extraBridgeTools,
        context,
      }),
  });

  return {
    readOnly: true,
    allowInPlanMode: false,
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
        "  - `providerSearchAll(provider, path, init?, options?)` — streaming search helper for broad provider corpora such as transcripts, messages, tickets, issues, notes, events, or documents. Use this before hand-written loops when searching many provider records for terms/phrases/regexes or proving absence. Pass the same `pagination` config as `providerFetchAll`, plus options like `{ query, queries, terms, regex, textPaths, idPaths, metadataPaths, maxHits }`. Returns structured hits with item ids, paths, snippets, page/item indexes, and coverage fields (`pageCount`, `itemCount`, `hasMore`, `stoppedReason`).",
        "  - `webFetch(url, init?)` — outbound HTTP request via the web-request action.",
        "    Returns `{ status, body }` where body is the response text. Supports responseMode, extract, includeLinks, search, maxChars, and saveToFile.",
        "    Example: `const { body } = await webFetch('https://api.example.com/data', { responseMode: 'raw' });`",
        "  - `webRead(url, init?)` — convenience wrapper for webFetch with `responseMode: 'auto'` and extracted HTML/markdown or bounded matches.",
        "    Example: `const docs = await webRead('https://docs.example.com/api', { search: { query: 'pagination' } });`",
        "  - `workspaceRead(path, opts?)` — read a Resources-backed workspace file by path. Returns content string or null. opts: { offset?, maxChars? }.",
        "  - `workspaceReadMeta(path, opts?)` — read a workspace file with metadata such as sizeBytes, truncated, and nextOffset.",
        "  - `workspaceWrite(path, content, contentType?)` — create or overwrite a workspace file. Use `scratch/...` for temporary staging; use durable folders only for files the user should keep.",
        "  - `workspaceAppend(path, content)` — append text to a workspace file.",
        "  - `workspaceList(prefix?)` — list workspace files, returns [{ path, sizeBytes, contentType, updatedAt }].",
        "Print results with `console.log()`; only stdout+stderr are returned.",
        "Timeout defaults to 120 s (max 600 s). Output is truncated to 50 000 chars by default (max 200 000).",
        'For LONG compute — big cross-source joins, corpus-wide sweeps, scripts that could exceed ~30 s, or anything at risk of dying with the current chat run — pass `background: true`. That enqueues a durable execution and returns `{ executionId, status: "queued" }` immediately; the code runs out-of-band with a generous budget (default 10 min) and its result survives run timeouts. Continue other work, then poll by calling run-code again with just `{ executionId }` to get status and, once finished, the output. Keep quick scripts in the default foreground mode.',
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "JavaScript source to execute. ESM syntax, top-level await allowed. Required unless polling with executionId.",
          },
          timeoutMs: {
            type: "number",
            description: `Execution timeout in milliseconds. Foreground default: ${DEFAULT_TIMEOUT_MS} (max ${MAX_TIMEOUT_MS}). With background: true the default is ${BACKGROUND_DEFAULT_TIMEOUT_MS} (max ${BACKGROUND_MAX_TIMEOUT_MS}).`,
          },
          maxOutputChars: {
            type: "number",
            description: `Maximum combined stdout+stderr characters to return. Default: ${DEFAULT_MAX_OUTPUT_CHARS}. Max: ${MAX_OUTPUT_CHARS}.`,
          },
          background: {
            type: "boolean",
            description:
              'Run as a durable background execution: returns { executionId, status: "queued" } immediately and the code executes out-of-band, surviving chat-run timeouts. Use for long compute (large joins, multi-page provider sweeps, heavy analysis). Poll with executionId for the result.',
          },
          executionId: {
            type: "string",
            description:
              "Poll a background execution started earlier: pass the executionId alone (no code) to get its status and, once finished, its output.",
          },
        },
        required: [],
      },
    },
    run: async (args: Record<string, string>, context?: ActionRunContext) => {
      // Poll path: status/result lookup for a previously queued background
      // execution. Takes precedence so a poll call never needs `code`.
      const requestedExecutionId =
        typeof args.executionId === "string" ? args.executionId.trim() : "";
      if (requestedExecutionId) {
        return describeSandboxExecutionForOwner(requestedExecutionId, context);
      }

      const code = typeof args.code === "string" ? args.code : "";
      if (!code.trim()) return "Error: code is required.";

      const requestedMaxOutput = Number(args.maxOutputChars);
      const maxOutputChars =
        Number.isFinite(requestedMaxOutput) && requestedMaxOutput > 0
          ? Math.min(requestedMaxOutput, MAX_OUTPUT_CHARS)
          : DEFAULT_MAX_OUTPUT_CHARS;

      // Background path: opt-in per call, or forced when the active sandbox
      // adapter is the queued backend (AGENT_NATIVE_SANDBOX=background).
      const backgroundRequested =
        (args.background as unknown) === true ||
        (typeof args.background === "string" &&
          args.background.trim().toLowerCase() === "true");
      if (backgroundRequested || isQueuedSandboxAdapter(getSandboxAdapter())) {
        return enqueueBackgroundRunCode({
          code,
          requestedTimeoutMs: Number(args.timeoutMs),
          maxOutputChars,
          context,
          getActions,
        });
      }

      const requestedTimeout = Number(args.timeoutMs);
      const timeoutMs =
        Number.isFinite(requestedTimeout) && requestedTimeout > 0
          ? Math.min(requestedTimeout, MAX_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS;

      const { stdout, stderr, exitCode, timedOut, bridgeToolsUsed } =
        await executeSandboxCode({
          code,
          timeoutMs,
          getActions,
          extraBridgeTools,
          context,
        });

      const combined =
        [stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""]
          .filter(Boolean)
          .join("\n\n") || "(no output)";

      const lines: string[] = [];
      if (timedOut) lines.push(`timedOut: true (${timeoutMs}ms)`);
      if (exitCode !== 0 && exitCode !== null)
        lines.push(`exitCode: ${exitCode}`);
      if (bridgeToolsUsed.length)
        lines.push(`bridgeToolsUsed: ${bridgeToolsUsed.join(", ")}`);
      lines.push(combined);

      const full = lines.join("\n\n");
      if (full.length > maxOutputChars) {
        const truncated = full.slice(0, maxOutputChars);
        return `${truncated}\n\n...[truncated ${(full.length - maxOutputChars).toLocaleString()} chars]`;
      }
      return full;
    },
  };
}

// ---------------------------------------------------------------------------
// Core execution (shared by the foreground path and the background executor)
// ---------------------------------------------------------------------------

export interface ExecuteSandboxCodeOptions {
  /** Raw user JavaScript (ESM, top-level await allowed). */
  code: string;
  /** Hard wall-clock timeout enforced by the adapter. */
  timeoutMs: number;
  /** Supplier for the action registry the loopback bridge exposes. */
  getActions: () => Record<string, ActionEntry>;
  /** Extra bridge tool names beyond the defaults. */
  extraBridgeTools?: Set<string>;
  /** Request context (owner/org) applied to bridged tool calls. */
  context?: ActionRunContext;
}

export interface ExecuteSandboxCodeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  bridgeToolsUsed: string[];
}

/**
 * Run one piece of sandbox code end-to-end: start the loopback bridge, build
 * the scrubbed env and wrapped module, execute through the active NON-QUEUED
 * sandbox adapter, and return the raw outputs. This is the exact machinery the
 * foreground `run-code` path always used, factored out so the durable
 * background executor reuses it verbatim (with the enqueueing owner's context)
 * instead of forking it.
 */
export async function executeSandboxCode(
  options: ExecuteSandboxCodeOptions,
): Promise<ExecuteSandboxCodeResult> {
  const actions = options.getActions();
  const bridgeToken = crypto.randomBytes(32).toString("hex");

  // Start bridge server — resolves once the server is listening.
  const {
    bridgePort,
    getUsedTools,
    cleanup: cleanupBridge,
  } = await startBridgeServer(
    bridgeToken,
    actions,
    options.context,
    DEFAULT_BRIDGE_TOOLS,
    options.extraBridgeTools ?? new Set(),
  );

  try {
    // Build scrubbed env — only safe POSIX vars, no secrets. The adapter
    // points TMPDIR/TEMP/TMP at the sandbox's own temp dir.
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

    // Delegate execution to the active sandbox adapter (local child process
    // by default; remote adapters can be registered via ./sandbox). A queued
    // (background) adapter is never used here — `resolveExecutionSandboxAdapter`
    // falls back to local so execution can't recurse into the queue. The
    // bridge, env scrub, module, and output formatting stay in the parent
    // regardless of adapter.
    const { stdout, stderr, exitCode, timedOut } =
      await resolveExecutionSandboxAdapter().run({
        moduleSource: buildSandboxModule(options.code, bridgePort, bridgeToken),
        env: safeEnv,
        timeoutMs: options.timeoutMs,
        bridgePort,
      });

    return {
      stdout,
      stderr,
      exitCode,
      timedOut,
      bridgeToolsUsed: getUsedTools(),
    };
  } finally {
    // The active sandbox adapter owns its own temp-file cleanup; the parent
    // only tears down the bridge server here.
    cleanupBridge();
  }
}

// ---------------------------------------------------------------------------
// Durable background executions
// ---------------------------------------------------------------------------

function structuredRunCodeError(payload: {
  code: string;
  message: string;
  guidance: string;
  executionId?: string;
}): string {
  return JSON.stringify(
    {
      ...(payload.executionId ? { executionId: payload.executionId } : {}),
      status: "error",
      error: { code: payload.code, message: payload.message },
      guidance: payload.guidance,
    },
    null,
    2,
  );
}

function resolveExecutionOwner(context?: ActionRunContext): string | undefined {
  return context?.userEmail ?? getRequestUserEmail();
}

function pollHintFor(executionId: string, hasGetTool: boolean): string {
  return hasGetTool
    ? `\`get-code-execution\` with {"executionId": "${executionId}"}`
    : `\`run-code\` with {"executionId": "${executionId}"} and no code`;
}

async function enqueueBackgroundRunCode(input: {
  code: string;
  requestedTimeoutMs: number;
  maxOutputChars: number;
  context?: ActionRunContext;
  getActions: () => Record<string, ActionEntry>;
}): Promise<string> {
  const owner = resolveExecutionOwner(input.context);
  if (!owner) {
    return structuredRunCodeError({
      code: "identity_required",
      message:
        "Background execution requires an authenticated owner identity; none was resolved for this call.",
      guidance:
        "Run the code in the foreground instead (omit background), or retry from an authenticated agent run.",
    });
  }

  const timeoutMs =
    Number.isFinite(input.requestedTimeoutMs) && input.requestedTimeoutMs > 0
      ? Math.min(input.requestedTimeoutMs, BACKGROUND_MAX_TIMEOUT_MS)
      : BACKGROUND_DEFAULT_TIMEOUT_MS;

  const { execution, driveNote } = await enqueueSandboxExecution({
    code: input.code,
    timeoutMs,
    maxOutputChars: input.maxOutputChars,
    owner,
    orgId: input.context?.orgId ?? null,
    threadId: input.context?.threadId ?? null,
  });

  const hasGetTool = Boolean(input.getActions()["get-code-execution"]);
  return JSON.stringify(
    {
      executionId: execution.id,
      status: "queued",
      timeoutMs,
      guidance:
        `Queued for durable background execution — it keeps running even if this chat run is cut off, and the result stays available afterwards. ` +
        `Do NOT wait idle: continue other useful work now, then check progress by calling ${pollHintFor(execution.id, hasGetTool)}. ` +
        `Poll after finishing your other steps, then every ~15-30 seconds — not in a tight loop. ` +
        `If the result reports failed or timed_out, split the computation into smaller chunks or persist intermediate progress with workspaceWrite and re-run.`,
      ...(driveNote ? { note: driveNote } : {}),
    },
    null,
    2,
  );
}

/**
 * Owner-scoped status/result lookup for a background execution, with
 * opportunistic recovery: a stale queued row (lost dispatch) or a running row
 * whose lease expired (dead executor) is re-driven; an expired row that
 * exhausted its attempts is reaped to `failed` so it never hangs forever.
 */
async function describeSandboxExecutionForOwner(
  executionId: string,
  context?: ActionRunContext,
): Promise<string> {
  const owner = resolveExecutionOwner(context);
  if (!owner) {
    return structuredRunCodeError({
      executionId,
      code: "identity_required",
      message:
        "Cannot look up a background execution without an authenticated owner identity.",
      guidance:
        "Background executions are scoped to the user who started them. Retry from an authenticated agent run.",
    });
  }

  let row = await getSandboxExecutionForOwner(executionId, owner);
  if (!row) {
    return structuredRunCodeError({
      executionId,
      code: "execution_not_found",
      message: `No background execution "${executionId}" exists for this user.`,
      guidance:
        "Check the executionId — it must come from a prior run-code call with background: true made by this same user.",
    });
  }

  const now = Date.now();
  const pollGuidance =
    `Still in progress. Do not wait idle — continue other useful work, then poll again in ~15-30 seconds by calling ` +
    `${pollHintFor(executionId, false)}.`;

  if (row.status === "queued") {
    // Lost-dispatch recovery: re-drive a row that has sat unclaimed.
    if (now - row.updatedAt >= SANDBOX_EXECUTION_REDRIVE_AFTER_MS) {
      try {
        await driveSandboxExecution(row.id);
      } catch {
        // Best-effort; the sweep retries.
      }
    }
    return JSON.stringify(
      {
        executionId,
        status: "queued",
        attemptCount: row.attemptCount,
        queuedForMs: now - row.createdAt,
        guidance: pollGuidance,
      },
      null,
      2,
    );
  }

  if (row.status === "running") {
    const leaseExpired =
      row.leaseExpiresAt !== null && row.leaseExpiresAt < now;
    if (!leaseExpired) {
      return JSON.stringify(
        {
          executionId,
          status: "running",
          attemptCount: row.attemptCount,
          runningForMs: now - (row.startedAt ?? row.createdAt),
          guidance: pollGuidance,
        },
        null,
        2,
      );
    }
    if (row.attemptCount < row.maxAttempts) {
      try {
        await driveSandboxExecution(row.id);
      } catch {
        // Best-effort; the sweep retries.
      }
      return JSON.stringify(
        {
          executionId,
          status: "running",
          attemptCount: row.attemptCount,
          note: `The previous executor stopped heartbeating (its environment was likely terminated); a retry has been dispatched (attempt ${row.attemptCount + 1} of ${row.maxAttempts}).`,
          guidance: pollGuidance,
        },
        null,
        2,
      );
    }
    // Attempts exhausted — reap to a terminal failure and report that below.
    await failExpiredSandboxExecution(
      row.id,
      `Executor lease expired after ${row.attemptCount} attempt(s); the execution environment was likely terminated before the code finished. Split the computation into smaller chunks or persist intermediate results (e.g. workspaceWrite) and run again.`,
      now,
    );
    row = (await getSandboxExecutionForOwner(executionId, owner)) ?? row;
  }

  return formatTerminalSandboxExecution(row);
}

function formatTerminalSandboxExecution(row: SandboxExecutionRow): string {
  const durationMs =
    row.startedAt !== null && row.finishedAt !== null
      ? Math.max(0, row.finishedAt - row.startedAt)
      : undefined;
  const guidance =
    row.status === "timed_out"
      ? `The execution exceeded its ${row.timeoutMs}ms background budget and was terminated. Reduce the work per run, or persist intermediate results with workspaceWrite and continue in a follow-up background execution.`
      : row.status === "failed"
        ? "The execution failed. Inspect error/stderr, fix the code, and re-run (use background: true again for long compute). If the executor was lost repeatedly, split the computation into smaller chunks or persist intermediate results with workspaceWrite."
        : undefined;

  const header = JSON.stringify(
    {
      executionId: row.id,
      status: row.status,
      exitCode: row.exitCode,
      ...(row.timedOut ? { timedOut: true } : {}),
      attemptCount: row.attemptCount,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(row.error ? { error: row.error } : {}),
      ...(row.bridgeToolsUsed.length
        ? { bridgeToolsUsed: row.bridgeToolsUsed }
        : {}),
      ...(guidance ? { guidance } : {}),
    },
    null,
    2,
  );

  const combined =
    [
      row.stdout
        ? `stdout:\n${row.stdout}${row.stdoutTruncated ? "\n...[stored stdout truncated]" : ""}`
        : "",
      row.stderr
        ? `stderr:\n${row.stderr}${row.stderrTruncated ? "\n...[stored stderr truncated]" : ""}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n") || "(no output)";

  const full = `${header}\n\n${combined}`;
  const maxChars =
    row.maxOutputChars > 0 ? row.maxOutputChars : MAX_OUTPUT_CHARS;
  if (full.length > maxChars) {
    const truncated = full.slice(0, maxChars);
    return `${truncated}\n\n...[truncated ${(full.length - maxChars).toLocaleString()} chars]`;
  }
  return full;
}

/**
 * Standalone, access-scoped poll tool for background executions. Behaviorally
 * identical to calling `run-code` with only `executionId`; hosts that register
 * it as `get-code-execution` give the model a dedicated read tool (and the
 * enqueue guidance automatically points at it when present in the registry).
 */
export function createGetCodeExecutionEntry(): ActionEntry {
  return {
    readOnly: true,
    tool: {
      description:
        "Check a background run-code execution: returns its status (queued | running | succeeded | failed | timed_out) and, once finished, its stdout/stderr output. Executions are scoped to the user who started them. While one is queued or running, continue other useful work and poll every ~15-30 seconds instead of busy-waiting.",
      parameters: {
        type: "object",
        properties: {
          executionId: {
            type: "string",
            description:
              "The executionId returned by run-code with background: true.",
          },
        },
        required: ["executionId"],
      },
    },
    run: async (args: Record<string, string>, context?: ActionRunContext) => {
      const executionId =
        typeof args.executionId === "string" ? args.executionId.trim() : "";
      if (!executionId) {
        return structuredRunCodeError({
          code: "execution_id_required",
          message: "executionId is required.",
          guidance:
            "Pass the executionId returned by a prior run-code call with background: true.",
        });
      }
      return describeSandboxExecutionForOwner(executionId, context);
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
 *  1. Defines `providerFetch`, `providerRequest`, `providerFetchAll`,
 *     `providerSearchAll`, and `webFetch` helpers via the bridge.
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
  for (const key of ["data", "results", "items", "records", "rows", "calls", "callTranscripts", "transcripts", "messages", "tickets", "issues", "deals", "events", "notes", "documents", "entries", "objects"]) {
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

function _asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function _stringifySearchValue(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function _collectStrings(value, basePath = "", out = [], limit = 5000) {
  if (out.length >= limit || value === undefined || value === null) return out;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    out.push({ path: basePath || "$", text: String(value) });
    return out;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && out.length < limit; i++) {
      _collectStrings(value[i], basePath ? basePath + "[" + i + "]" : "[" + i + "]", out, limit);
    }
    return out;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (out.length >= limit) break;
      _collectStrings(value[key], basePath ? basePath + "." + key : key, out, limit);
    }
  }
  return out;
}

function _collectSearchStrings(item, textPaths, maxFieldsPerItem) {
  const paths = _asArray(textPaths).filter((path) => typeof path === "string" && path.trim());
  if (!paths.length) return _collectStrings(item, "", [], maxFieldsPerItem);
  const out = [];
  for (const path of paths) {
    const value = _getByPath(item, path);
    if (value !== undefined) _collectStrings(value, path, out, maxFieldsPerItem);
    if (out.length >= maxFieldsPerItem) break;
  }
  return out;
}

function _firstValueByPath(value, paths) {
  for (const path of paths) {
    const found = _getByPath(value, path);
    if (found !== undefined && found !== null && String(found) !== "") {
      return { path, value: found };
    }
  }
  return null;
}

const _DEFAULT_ID_PATHS = [
  "id",
  "callId",
  "callID",
  "call_id",
  "call.id",
  "call.metaData.id",
  "metaData.id",
  "metadata.id",
  "recordId",
  "record_id",
  "objectId",
  "object_id",
  "ticketId",
  "ticket_id",
  "issueId",
  "issue_id",
  "messageId",
  "message_id",
  "conversationId",
  "conversation_id",
  "eventId",
  "event_id",
  "documentId",
  "document_id",
  "url",
  "webUrl",
  "permalink",
];

function _extractItemIdentity(item, idPaths) {
  const paths = [
    ..._asArray(idPaths).filter((path) => typeof path === "string" && path.trim()),
    ..._DEFAULT_ID_PATHS,
  ];
  const found = _firstValueByPath(item, paths);
  if (!found) return { id: null, idPath: null };
  return { id: _stringifySearchValue(found.value), idPath: found.path };
}

function _extractMetadata(item, metadataPaths) {
  const metadata = {};
  for (const path of _asArray(metadataPaths)) {
    if (typeof path !== "string" || !path.trim()) continue;
    const value = _getByPath(item, path);
    if (value !== undefined) metadata[path] = value;
  }
  return metadata;
}

function _makeSnippet(text, index, contextChars) {
  const source = String(text);
  const context = Math.max(20, Math.min(Number(contextChars) || 180, 1000));
  const start = Math.max(0, index - context);
  const end = Math.min(source.length, Math.max(index, 0) + context);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return (prefix + source.slice(start, end) + suffix).replace(/\\s+/g, " ").trim();
}

function _normalizeFlags(flags, caseSensitive) {
  const raw = typeof flags === "string" ? flags : "";
  const allowed = raw.replace(/[^dgimsuvy]/g, "");
  const withoutGlobalOrSticky = allowed.replace(/[gy]/g, "");
  const withCase =
    caseSensitive || /i/.test(withoutGlobalOrSticky)
      ? withoutGlobalOrSticky
      : withoutGlobalOrSticky + "i";
  return withCase + "g";
}

function _normalizedSearchTerms(options) {
  const explicitTerms = _asArray(options.terms)
    .map((term) => String(term).trim())
    .filter(Boolean);
  if (explicitTerms.length) return explicitTerms;
  if (options.matchMode === "allTerms" && typeof options.query === "string") {
    return options.query
      .split(/\\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
  }
  return [];
}

function _findItemWideTermMatch(fields, options) {
  const terms = _normalizedSearchTerms(options);
  if (!terms.length || options.matchMode === "anyTerm") return null;
  const caseSensitive = Boolean(options.caseSensitive);
  const normalizedFields = fields.map((field) => ({
    field,
    haystack: caseSensitive ? String(field.text) : String(field.text).toLowerCase(),
  }));
  const termHits = terms.map((term) => {
    const searchTerm = caseSensitive ? term : term.toLowerCase();
    for (const entry of normalizedFields) {
      const index = entry.haystack.indexOf(searchTerm);
      if (index >= 0) return { term, field: entry.field, index };
    }
    return { term, field: null, index: -1 };
  });
  if (termHits.some((hit) => hit.index < 0 || !hit.field)) return null;
  const first = termHits
    .filter((hit) => hit.field)
    .sort((a, b) => {
      const fieldOrder = fields.indexOf(a.field) - fields.indexOf(b.field);
      return fieldOrder || a.index - b.index;
    })[0];
  return {
    field: first.field,
    match: {
      kind: "allTerms",
      query: terms.join(" "),
      index: first.index,
      match: first.term,
    },
  };
}

function _findSearchMatches(text, options, includeTerms = true) {
  const source = String(text);
  const caseSensitive = Boolean(options.caseSensitive);
  const haystack = caseSensitive ? source : source.toLowerCase();
  const maxMatchesPerField = _boundedNumber(options.maxMatchesPerField, 1000, 1, 100000);
  const matches = [];

  const addSubstring = (needle, label, kind) => {
    if (needle === undefined || needle === null) return;
    const rawNeedle = String(needle);
    if (!rawNeedle) return;
    const searchNeedle = caseSensitive ? rawNeedle : rawNeedle.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const index = haystack.indexOf(searchNeedle, from);
      if (index < 0) break;
      matches.push({ kind, query: label ?? rawNeedle, index, match: source.slice(index, index + rawNeedle.length) });
      from = index + Math.max(1, searchNeedle.length);
      if (matches.length >= maxMatchesPerField) break;
    }
  };

  if (options.regex) {
    try {
      const regex = new RegExp(String(options.regex), _normalizeFlags(options.regexFlags, caseSensitive));
      let match;
      while ((match = regex.exec(source)) && typeof match.index === "number") {
        matches.push({ kind: "regex", query: String(options.regex), index: match.index, match: match[0] });
        if (matches.length >= maxMatchesPerField) break;
        if (match[0] === "") regex.lastIndex += 1;
      }
    } catch (err) {
      throw new Error("providerSearchAll invalid regex: " + (err?.message || err));
    }
  }

  for (const query of _asArray(options.query).concat(_asArray(options.queries))) {
    addSubstring(query, String(query), "query");
  }

  const terms = includeTerms ? _normalizedSearchTerms(options) : [];
  if (terms.length) {
    const termHits = terms
      .map((term) => {
        const searchTerm = caseSensitive ? term : term.toLowerCase();
        const index = haystack.indexOf(searchTerm);
        return { term, index };
      })
      .filter((hit) => hit.index >= 0);
    const mode = options.matchMode === "anyTerm" ? "anyTerm" : "allTerms";
    if ((mode === "allTerms" && termHits.length === terms.length) || (mode === "anyTerm" && termHits.length > 0)) {
      const first = termHits.sort((a, b) => a.index - b.index)[0];
      matches.push({ kind: mode, query: terms.join(" "), index: first.index, match: first.term });
    }
  }

  return matches.sort((a, b) => a.index - b.index);
}

function _boundedNumber(value, defaultValue, min, max) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : defaultValue;
  return Math.max(min, Math.min(finite, max));
}

function _hitKey(identity, path, query, index, pageIndex, pageItemIndex) {
  const itemKey =
    identity.id !== null && identity.id !== undefined
      ? "id:" + identity.id
      : "page:" + String(pageIndex) + ":" + String(pageItemIndex);
  return [itemKey, path ?? "", query ?? "", String(index ?? "")].join("\\n");
}

/**
 * Stream pages from a provider API and search item text structurally. This is
 * for broad mention searches and absence checks where keeping every raw page
 * in memory or hand-parsing JSON strings is brittle.
 */
async function providerSearchAll(provider, apiPath, init = {}, options = {}) {
  const pagination = init.pagination || init.fetchAllPages || {};
  const itemsPath = pagination.itemsPath || init.itemsPath || options.itemsPath;
  const cursorPath = pagination.nextCursorPath || pagination.cursorPath;
  const maxPagesRaw = Number(pagination.maxPages || init.maxPages || options.maxPages || 100);
  const maxPages = Math.max(1, Math.min(Number.isFinite(maxPagesRaw) ? maxPagesRaw : 100, 500));
  const maxHits = _boundedNumber(options.maxHits, 100, 1, 5000);
  const maxHitsPerItem = _boundedNumber(options.maxHitsPerItem, 3, 1, 100);
  const maxFieldsPerItem = _boundedNumber(options.maxFieldsPerItem, 5000, 1, 50000);
  const contextChars = options.contextChars ?? options.snippetChars ?? 180;
  const baseInit = _withoutProviderFetchAllOptions(init);
  let query = _cloneJson(init.query || {});
  let body = _cloneJson(init.body);
  let pageNumber = Number(pagination.startPage || 1);
  let offset = Number(pagination.startOffset || 0);
  let lastCursor = null;
  let stoppedReason = "completed";
  let itemCount = 0;
  let matchedItemCount = 0;
  let totalHitCount = 0;
  const hits = [];
  const seenHitKeys = new Set();
  let pageIndex = 0;

  for (; pageIndex < maxPages; pageIndex++) {
    if (pagination.pageParam) query = { ...(query || {}), [pagination.pageParam]: pageNumber };
    if (pagination.offsetParam) query = { ...(query || {}), [pagination.offsetParam]: offset };

    const page = await providerFetch(provider, apiPath, {
      ...baseInit,
      query,
      ...(body !== undefined ? { body } : {}),
    });
    const nextCursor = cursorPath ? _getByPath(page, cursorPath) : undefined;
    const hasNextCursor =
      nextCursor !== undefined && nextCursor !== null && String(nextCursor) !== "";
    if (hasNextCursor && lastCursor !== null && String(nextCursor) === String(lastCursor)) {
      stoppedReason = "repeated-cursor";
      break;
    }

    const pageItems = _extractItems(page, itemsPath);
    itemCount += pageItems.length;

    for (let pageItemIndex = 0; pageItemIndex < pageItems.length; pageItemIndex++) {
      const item = pageItems[pageItemIndex];
      const identity = _extractItemIdentity(item, options.idPaths);
      const metadata = _extractMetadata(item, options.metadataPaths);
      const fields = _collectSearchStrings(item, options.textPaths, maxFieldsPerItem);
      let storedItemHitCount = 0;
      let itemMatched = false;

      const addHit = (field, match) => {
        const key = _hitKey(identity, field.path, match.query, match.index, pageIndex, pageItemIndex);
        if (seenHitKeys.has(key)) return false;
        seenHitKeys.add(key);
        totalHitCount += 1;
        if (!itemMatched) {
          matchedItemCount += 1;
          itemMatched = true;
        }
        if (hits.length < maxHits && storedItemHitCount < maxHitsPerItem) {
          storedItemHitCount += 1;
          hits.push({
            id: identity.id,
            idPath: identity.idPath,
            pageIndex,
            pageItemIndex,
            itemIndex: itemCount - pageItems.length + pageItemIndex,
            path: field.path,
            kind: match.kind,
            query: match.query,
            match: match.match,
            snippet: _makeSnippet(field.text, match.index, contextChars),
            ...(Object.keys(metadata).length ? { metadata } : {}),
          });
        }
        return true;
      };

      const itemWideTermMatch = _findItemWideTermMatch(fields, options);
      if (itemWideTermMatch) {
        addHit(itemWideTermMatch.field, itemWideTermMatch.match);
      }

      for (const field of fields) {
        const fieldMatches = _findSearchMatches(field.text, options, !itemWideTermMatch);
        for (const match of fieldMatches) {
          addHit(field, match);
        }
      }
    }

    if (hasNextCursor) {
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

  const pageCount = pageIndex + (pageIndex < maxPages ? 1 : 0);
  const hitPageOrOffsetLimit =
    Boolean(pagination.pageParam || pagination.offsetParam) &&
    stoppedReason === "completed" &&
    pageCount >= maxPages;
  const hasMore =
    stoppedReason === "cursor-found-without-destination" ||
    (lastCursor !== null && pageCount >= maxPages) || hitPageOrOffsetLimit;
  if (hasMore && stoppedReason === "completed") stoppedReason = "max-pages";

  return {
    hits,
    hitCount: hits.length,
    totalHitCount,
    truncatedHits: totalHitCount > hits.length,
    matchedItemCount,
    itemCount,
    pageCount,
    hasMore,
    lastCursor,
    stoppedReason,
    searched: {
      provider,
      path: apiPath,
      itemsPath: itemsPath || null,
      textPaths: _asArray(options.textPaths),
      idPaths: _asArray(options.idPaths),
      query: options.query ?? null,
      queries: _asArray(options.queries),
      terms: _asArray(options.terms),
      regex: options.regex ?? null,
      matchMode: options.matchMode || (options.terms ? "allTerms" : "query"),
      caseSensitive: Boolean(options.caseSensitive),
    },
  };
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
    ...(init.responseMode ? { responseMode: init.responseMode } : {}),
    ...(init.extract ? { extract: init.extract } : {}),
    ...(init.includeLinks !== undefined ? { includeLinks: init.includeLinks } : {}),
    ...(init.search ? { search: init.search } : {}),
    ...(init.maxChars ? { maxChars: init.maxChars } : {}),
    ...(init.saveToFile ? { saveToFile: init.saveToFile } : {}),
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

async function webRead(url, init = {}) {
  return webFetch(url, {
    responseMode: "auto",
    includeLinks: true,
    ...init,
  });
}

/**
 * Read a Resources-backed workspace file by path. Returns the file content as
 * a string, or null if not found.
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
 * Write (create or overwrite) a workspace file. Use \`scratch/...\` for
 * temporary staging files.
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
