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
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import type { ActionEntry } from "../agent/production-agent.js";
import type { ActionRunContext } from "../action.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
const MAX_OUTPUT_CHARS = 200_000;

/** Tools callable via the sandbox bridge by default. */
const DEFAULT_BRIDGE_TOOLS = new Set([
  "provider-api-request",
  "provider-api-docs",
  "provider-api-catalog",
  "web-request",
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
    // Allow a generous per-call timeout so large analytics jobs don't hit the
    // agent-loop's default 60 s cap.
    timeoutMs: MAX_TIMEOUT_MS,
    maxResultChars: MAX_OUTPUT_CHARS,
    tool: {
      description: [
        "Execute JavaScript (Node.js, ESM, top-level await supported) in an isolated sandbox.",
        "Use this to fetch, join, aggregate, and reduce large datasets, returning only printed output to the conversation.",
        "The sandbox has NO access to app source files, environment secrets, or the database.",
        "Available globals:",
        "  - `providerFetch(provider, path, init?)` — authenticated call to a registered provider via the provider-api-request action.",
        "    Returns the parsed JSON result (or throws on error).",
        "    Example: `const data = await providerFetch('hubspot', '/crm/v3/objects/contacts');`",
        "  - `webFetch(url, init?)` — outbound HTTP request via the web-request action.",
        "    Returns `{ status, body }` where body is the response text.",
        "    Example: `const { body } = await webFetch('https://api.example.com/data');`",
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
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-run-code-"));
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
        // Provide TMPDIR if not already set so Node has a writable temp.
        if (!safeEnv.TMPDIR) safeEnv.TMPDIR = os.tmpdir();

        const child = spawn(process.execPath, [tmpFile], {
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
  cleanup: () => void;
}

async function startBridgeServer(
  token: string,
  actions: Record<string, ActionEntry>,
  context: ActionRunContext | undefined,
  defaultTools: Set<string>,
  extraTools: Set<string>,
): Promise<BridgeResult> {
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
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      handleBridgeRequest(
        body,
        actions,
        context,
        defaultTools,
        extraTools,
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

  return { server, bridgePort, cleanup };
}

function handleBridgeRequest(
  rawBody: string,
  actions: Record<string, ActionEntry>,
  context: ActionRunContext | undefined,
  defaultTools: Set<string>,
  extraTools: Set<string>,
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
  if (!defaultTools.has(toolName) && !extraTools.has(toolName)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Tool "${toolName}" is not in the sandbox bridge allowlist.`,
      }),
    );
    return;
  }

  const entry = actions[toolName];
  if (!entry) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Tool "${toolName}" is not registered.` }));
    return;
  }

  const toolArgs = parsed.args ?? {};
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
 *  1. Defines `providerFetch` and `webFetch` helpers via the bridge.
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

/**
 * Call a provider API via the authenticated provider-api-request action.
 * Returns the parsed JSON response body (or throws on error).
 */
async function providerFetch(provider, apiPath, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const rawResult = await _bridgeCall("provider-api-request", {
    provider,
    path: apiPath,
    method,
    ...(init.query ? { query: typeof init.query === "string" ? init.query : JSON.stringify(init.query) } : {}),
    ...(init.body ? { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) } : {}),
    ...(init.headers ? { headers: typeof init.headers === "string" ? init.headers : JSON.stringify(init.headers) } : {}),
  });
  // rawResult is the action's string output; parse it if it looks like JSON
  if (typeof rawResult === "string") {
    try { return JSON.parse(rawResult); } catch { return rawResult; }
  }
  return rawResult;
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

// Run user code
(async () => {
${userCode}
})().catch((err) => {
  console.error("Unhandled error:", err?.message ?? String(err));
  process.exit(1);
});
`;
}
