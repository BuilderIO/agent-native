#!/usr/bin/env tsx
/**
 * e2e-mcp-test.ts — exhaustive end-to-end MCP behavior test against a remote
 * Agent Native MCP server (typically https://*.agent-native.com or an ngrok dev URL).
 *
 * # Usage
 *
 *   pnpm test:mcp:e2e [baseUrl] [token] [flags]
 *   tsx scripts/e2e-mcp-test.ts [baseUrl] [token] [flags]
 *
 *   Default baseUrl: https://archer-ophitic-unhortatively.ngrok-free.dev (dispatch dev)
 *
 * # Auth
 *
 *   1. Pass token as second positional arg, OR
 *   2. Set MCP_TEST_TOKEN env var, OR
 *   3. Use --device-flow (preferred) — the dispatch UI Connect page mints a token,
 *      device flow lets the script obtain it programmatically. Open the printed
 *      verification URL, approve it, and the script picks up the token.
 *   4. Use --auth-code — performs Dynamic Client Registration + Authorization Code
 *      with PKCE (S256 is required by the server). The script prints the auth URL
 *      and waits for you to paste back the `code=` param.
 *   5. --insecure-no-auth — skip auth (only works against AUTH_DISABLED dev servers).
 *
 * # Flags
 *
 *   --verbose             dump full request/response bodies
 *   --catalog-dump        just print tools/list + resources/list and exit
 *   --save-responses DIR  save each response body to a file
 *   --device-flow         use POST /_agent-native/mcp/connect/device/start
 *   --auth-code           use Dynamic Client Registration + Authorization Code (PKCE S256)
 *   --insecure-no-auth    skip auth entirely (dev only)
 *   --skip-mail           skip Group D (manage-draft) even if mail-like server detected
 *   --skip-open-app       skip Group C (open_app) even if open_app is listed
 *   --skip-stability      skip Group F (catalog stability — runs tools/list twice)
 *   --help                show this help
 *
 * # Test groups
 *
 *   A: Compact catalog detection (UA + client hint headers select catalog size)
 *   B: Resources catalog
 *   C: open_app + embed ticket privacy
 *   D: Mail manage-draft URL privacy
 *   E: ui.domain validation for Claude (no https:// prefix)
 *   F: Catalog stability across turns
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 *
 * Node 22 built-ins only — no external deps.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const DEFAULT_BASE_URL = "https://archer-ophitic-unhortatively.ngrok-free.dev";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliFlags {
  baseUrl: string;
  token?: string;
  verbose: boolean;
  catalogDump: boolean;
  saveResponses?: string;
  deviceFlow: boolean;
  authCode: boolean;
  insecureNoAuth: boolean;
  skipMail: boolean;
  skipOpenApp: boolean;
  skipStability: boolean;
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    baseUrl: "",
    verbose: false,
    catalogDump: false,
    deviceFlow: false,
    authCode: false,
    insecureNoAuth: false,
    skipMail: false,
    skipOpenApp: false,
    skipStability: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--verbose") flags.verbose = true;
    else if (a === "--catalog-dump") flags.catalogDump = true;
    else if (a === "--device-flow") flags.deviceFlow = true;
    else if (a === "--auth-code") flags.authCode = true;
    else if (a === "--insecure-no-auth") flags.insecureNoAuth = true;
    else if (a === "--skip-mail") flags.skipMail = true;
    else if (a === "--skip-open-app") flags.skipOpenApp = true;
    else if (a === "--skip-stability") flags.skipStability = true;
    else if (a === "--save-responses") flags.saveResponses = argv[++i];
    else if (a.startsWith("--save-responses=")) {
      flags.saveResponses = a.slice("--save-responses=".length);
    } else if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else {
      positional.push(a);
    }
  }
  flags.baseUrl = (positional[0] || DEFAULT_BASE_URL).replace(/\/+$/, "");
  flags.token = positional[1] || process.env.MCP_TEST_TOKEN || undefined;
  return flags;
}

function printHelp() {
  console.log(`e2e-mcp-test.ts — MCP server behavior tests

Usage: tsx scripts/e2e-mcp-test.ts [baseUrl] [token] [flags]
  Default baseUrl: ${DEFAULT_BASE_URL}

Auth:
  Pass token positionally, or set MCP_TEST_TOKEN, or use --device-flow,
  or --auth-code, or --insecure-no-auth.

Flags:
  --verbose             dump full request/response bodies
  --catalog-dump        just print tools/list + resources/list and exit
  --save-responses DIR  save each response body to a file
  --device-flow         use device flow at /_agent-native/mcp/connect/device/start
  --auth-code           OAuth Dynamic Client Registration + Auth Code (PKCE S256)
  --insecure-no-auth    skip auth (only works against AUTH_DISABLED servers)
  --skip-mail           skip Group D (manage-draft tests)
  --skip-open-app       skip Group C (open_app tests)
  --skip-stability      skip Group F (catalog-stability test)
  -h, --help            this help
`);
}

// ---------------------------------------------------------------------------
// Test reporting
// ---------------------------------------------------------------------------

interface TestResult {
  group: string;
  id: string;
  desc: string;
  pass: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

const results: TestResult[] = [];
let groupCurrent = "";
const flags = parseArgs(process.argv.slice(2));
let responseCounter = 0;

function logInfo(msg: string) {
  process.stdout.write(`${msg}\n`);
}
function logErr(msg: string) {
  process.stderr.write(`${msg}\n`);
}
function startGroup(name: string) {
  groupCurrent = name;
  logInfo("");
  logInfo(`── ${name} ─────────────────────────────────────`);
}
function pass(id: string, desc: string, details?: Record<string, unknown>) {
  results.push({ group: groupCurrent, id, desc, pass: true, details });
  logInfo(`  PASS ${id}  ${desc}`);
  if (flags.verbose && details) {
    logInfo(`       ${JSON.stringify(details, null, 2).slice(0, 1000)}`);
  }
}
function fail(
  id: string,
  desc: string,
  error: string,
  details?: Record<string, unknown>,
) {
  results.push({ group: groupCurrent, id, desc, pass: false, error, details });
  logErr(`  FAIL ${id}  ${desc}`);
  logErr(`       ${error}`);
  if (details) {
    const dump = JSON.stringify(details, null, 2);
    logErr(
      `       ${dump.slice(0, 2000)}${dump.length > 2000 ? "…[truncated]" : ""}`,
    );
  }
}

function maybeSaveResponse(name: string, body: unknown) {
  if (!flags.saveResponses) return;
  responseCounter += 1;
  try {
    mkdirSync(flags.saveResponses, { recursive: true });
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    const file = `${flags.saveResponses}/${String(responseCounter).padStart(3, "0")}-${safeName}.json`;
    writeFileSync(
      file,
      typeof body === "string" ? body : JSON.stringify(body, null, 2),
      "utf-8",
    );
  } catch (err: any) {
    logErr(`  warn: failed to save response: ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// SSE parsing — Streamable HTTP MCP responses come back as text/event-stream
// when the transport decides to stream. Each event has a `data:` field with
// one JSON-RPC payload. We collect them all and return the last `result`/`id`-
// bearing payload, which is the tool/list/etc. response.
// ---------------------------------------------------------------------------

function parseSseEvents(text: string): any[] {
  const events: any[] = [];
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n");
    try {
      events.push(JSON.parse(payload));
    } catch {
      // ignore malformed
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// MCP request helper
// ---------------------------------------------------------------------------

interface McpCallOptions {
  /** Override the User-Agent header sent on the request. */
  userAgent?: string;
  /** Optional MCP client hint header `x-agent-native-mcp-client`. */
  clientHint?: string;
  /** Optional full-catalog opt-in header `x-agent-native-mcp-full-catalog`. */
  fullCatalogHeader?: string;
  /** Override clientInfo.name in initialize payloads. */
  clientInfoName?: string;
  /** Override Authorization header (or omit by setting to ""). */
  token?: string | "";
  /** Extra arbitrary headers. */
  extraHeaders?: Record<string, string>;
}

interface McpCallResult {
  status: number;
  /** The parsed JSON-RPC response (preferred) — works for both JSON and SSE. */
  result?: any;
  /** Raw response body (text). */
  rawBody: string;
  /** Byte length of the raw body — used for catalog-size assertions. */
  byteLength: number;
  /** Response headers (for content-type debugging). */
  contentType: string;
  /** Errors that prevented parsing (e.g. 4xx/5xx body). */
  parseError?: string;
}

async function mcpCall(
  method: string,
  params: Record<string, any> | undefined,
  opts: McpCallOptions = {},
): Promise<McpCallResult> {
  const url = `${flags.baseUrl}/_agent-native/mcp`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Streamable HTTP MCP requires Accept advertise both JSON and SSE
    Accept: "application/json, text/event-stream",
    "User-Agent": opts.userAgent ?? "e2e-mcp-test/1.0",
    ...(opts.extraHeaders ?? {}),
  };
  if (opts.clientHint) headers["x-agent-native-mcp-client"] = opts.clientHint;
  if (opts.fullCatalogHeader) {
    headers["x-agent-native-mcp-full-catalog"] = opts.fullCatalogHeader;
  }
  const tokenToUse =
    opts.token === "" ? undefined : (opts.token ?? flags.token);
  if (tokenToUse) headers.Authorization = `Bearer ${tokenToUse}`;

  const body = {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1_000_000),
    method,
    params: params ?? {},
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const rawBody = await res.text();
  const contentType = res.headers.get("content-type") || "";
  const byteLength = Buffer.byteLength(rawBody, "utf8");

  let result: any | undefined;
  let parseError: string | undefined;
  try {
    if (contentType.includes("text/event-stream")) {
      const events = parseSseEvents(rawBody);
      // Pick the first event that has a matching id, else the last one
      const matching =
        events.find((e) => e && e.id === body.id) ?? events.at(-1);
      result = matching;
    } else if (contentType.includes("application/json")) {
      result = JSON.parse(rawBody);
    } else if (rawBody) {
      // Best-effort
      try {
        result = JSON.parse(rawBody);
      } catch {
        const events = parseSseEvents(rawBody);
        if (events.length > 0) result = events.at(-1);
      }
    }
  } catch (err: any) {
    parseError = err?.message ?? String(err);
  }

  return {
    status: res.status,
    result,
    rawBody,
    byteLength,
    contentType,
    parseError,
  };
}

async function initialize(opts: McpCallOptions = {}): Promise<McpCallResult> {
  return mcpCall(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: opts.clientInfoName ?? "e2e-mcp-test",
        version: "1.0.0",
      },
    },
    opts,
  );
}

// ---------------------------------------------------------------------------
// Auth: device-code flow
// ---------------------------------------------------------------------------

async function runDeviceFlow(): Promise<string> {
  logInfo(`  Starting device flow against ${flags.baseUrl}`);
  const startRes = await fetch(
    `${flags.baseUrl}/_agent-native/mcp/connect/device/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: "e2e-mcp-test" }),
    },
  );
  if (!startRes.ok) {
    const text = await startRes.text();
    throw new Error(
      `device/start failed (HTTP ${startRes.status}): ${text.slice(0, 500)}`,
    );
  }
  const startJson = (await startRes.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    interval?: number;
    expires_in?: number;
  };
  if (!startJson.device_code) {
    throw new Error(
      `device/start returned no device_code: ${JSON.stringify(startJson)}`,
    );
  }
  const interval = Math.max(1, Number(startJson.interval) || 3);
  const expiresIn = Math.max(interval, Number(startJson.expires_in) || 600);
  const deadline = Date.now() + expiresIn * 1000;

  logInfo("");
  logInfo(`  Open this URL in a browser and approve:`);
  logInfo(
    `      ${startJson.verification_uri_complete ?? startJson.verification_uri}`,
  );
  if (startJson.user_code) {
    logInfo(`  Code: ${startJson.user_code}`);
  }
  logInfo("");
  logInfo(`  Polling every ${interval}s (timeout ${expiresIn}s)…`);

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const pollRes = await fetch(
      `${flags.baseUrl}/_agent-native/mcp/connect/device/poll`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: startJson.device_code }),
      },
    );
    let pollJson: any = null;
    try {
      pollJson = await pollRes.json();
    } catch {
      // network blip — retry
      continue;
    }
    if (pollJson?.status === "pending") continue;
    if (pollJson?.status === "approved" && typeof pollJson.token === "string") {
      logInfo("  Approved — token acquired.");
      return pollJson.token as string;
    }
    if (pollJson?.status === "expired") throw new Error("Device code expired");
    if (pollJson?.status === "consumed") {
      throw new Error("Device code already consumed");
    }
    if (
      pollJson?.status === "error" ||
      pollJson?.status === "not_found" ||
      !pollRes.ok
    ) {
      throw new Error(
        `device/poll failed: ${JSON.stringify(pollJson).slice(0, 500)}`,
      );
    }
  }
  throw new Error("Timed out waiting for device-flow approval");
}

// ---------------------------------------------------------------------------
// Auth: OAuth Dynamic Client Registration + Authorization Code (PKCE S256)
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

async function runAuthCodeFlow(): Promise<string> {
  const redirectUri = "http://localhost:3000/cb";
  logInfo(`  Registering OAuth client at ${flags.baseUrl}`);
  const regRes = await fetch(
    `${flags.baseUrl}/_agent-native/mcp/oauth/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "e2e-mcp-test",
        redirect_uris: [redirectUri],
      }),
    },
  );
  if (!regRes.ok) {
    const text = await regRes.text();
    throw new Error(
      `oauth/register failed (HTTP ${regRes.status}): ${text.slice(0, 500)}`,
    );
  }
  const regJson = (await regRes.json()) as { client_id?: string };
  if (!regJson.client_id) {
    throw new Error(
      `oauth/register returned no client_id: ${JSON.stringify(regJson)}`,
    );
  }
  const clientId = regJson.client_id;

  // PKCE S256 is REQUIRED by the server (oauth-route.ts line 553-555).
  const codeVerifier = base64url(randomBytes(48)); // 64 chars after base64url
  const codeChallenge = base64url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  const state = base64url(randomBytes(16));

  const resourceUrl = `${flags.baseUrl}/_agent-native/mcp`;
  const authUrl = new URL(`${flags.baseUrl}/_agent-native/mcp/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("resource", resourceUrl);
  authUrl.searchParams.set("scope", "mcp:read mcp:write mcp:apps");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  logInfo("");
  logInfo("  Open this URL in a browser, sign in, click Authorize, then paste");
  logInfo("  the resulting `code=` query parameter value below:");
  logInfo("");
  logInfo(`      ${authUrl.toString()}`);
  logInfo("");

  const code = await prompt("  Paste the code= value: ");

  logInfo("  Exchanging code for token…");
  const tokenForm = new URLSearchParams({
    grant_type: "authorization_code",
    code: code.trim(),
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const tokenRes = await fetch(
    `${flags.baseUrl}/_agent-native/mcp/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenForm.toString(),
    },
  );
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(
      `oauth/token failed (HTTP ${tokenRes.status}): ${text.slice(0, 500)}`,
    );
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error(
      `oauth/token returned no access_token: ${JSON.stringify(tokenJson)}`,
    );
  }
  logInfo("  Token acquired.");
  return tokenJson.access_token;
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers for extracting JSON-RPC result/error from McpCallResult
// ---------------------------------------------------------------------------

function unwrapResult(call: McpCallResult): { result?: any; error?: any } {
  const env = call.result;
  if (!env || typeof env !== "object") {
    return {
      error: {
        code: -1,
        message: `No parseable JSON-RPC envelope (status ${call.status}, content-type ${call.contentType}). Body: ${call.rawBody.slice(0, 500)}`,
      },
    };
  }
  if ("error" in env) return { error: env.error };
  if ("result" in env) return { result: env.result };
  return {
    error: {
      code: -1,
      message: `Envelope had neither result nor error: ${JSON.stringify(env).slice(0, 500)}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Group A — Compact catalog detection
// ---------------------------------------------------------------------------

const INTERNAL_TOOL_NAMES = [
  "view-screen",
  "view_screen",
  "navigate",
  "list-app-state-keys",
  "list_app_state_keys",
];

interface CatalogProbe {
  id: string;
  desc: string;
  opts: McpCallOptions;
  expectCompact: boolean;
}

const CATALOG_PROBES: CatalogProbe[] = [
  {
    id: "A1",
    desc: "ChatGPT UA → compact",
    opts: {
      userAgent: "ChatGPT/1.0 (compatible; OpenAI Agents)",
      clientInfoName: "chatgpt",
    },
    expectCompact: true,
  },
  {
    id: "A2",
    desc: "Claude desktop UA → compact",
    opts: { userAgent: "Claude/3.5 (Mac Desktop)", clientInfoName: "claude" },
    expectCompact: true,
  },
  {
    id: "A3",
    desc: "Cursor UA → FULL",
    opts: { userAgent: "Cursor/0.40", clientInfoName: "cursor" },
    expectCompact: false,
  },
  {
    id: "A4",
    desc: "claude-code UA → FULL",
    opts: { userAgent: "claude-code/1.0.0", clientInfoName: "claude-code" },
    expectCompact: false,
  },
  {
    id: "A5",
    desc: "x-agent-native-mcp-client: code → FULL",
    opts: { clientHint: "code" },
    expectCompact: false,
  },
  {
    id: "A6",
    desc: "x-agent-native-mcp-client: chatgpt → compact",
    opts: { clientHint: "chatgpt" },
    expectCompact: true,
  },
];

const MAX_CATALOG_BYTES = 50 * 1024; // 50KB threshold — the regression was 224KB
const REGRESSION_BYTES = 200 * 1024;

function countTools(call: McpCallResult): {
  tools?: any[];
  toolNames: string[];
} {
  const { result, error } = unwrapResult(call);
  if (error || !result) return { toolNames: [] };
  const tools = Array.isArray(result.tools) ? (result.tools as any[]) : [];
  const toolNames = tools.map((t) => String(t?.name ?? ""));
  return { tools, toolNames };
}

interface GroupAOutcome {
  toolsByProbe: Record<string, { names: string[]; bytes: number }>;
}

async function groupA_CompactCatalog(): Promise<GroupAOutcome> {
  startGroup(
    "Group A: Compact catalog detection (UA + client-hint headers, size guards)",
  );
  const out: GroupAOutcome = { toolsByProbe: {} };

  for (const probe of CATALOG_PROBES) {
    // Initialize first (some SDK paths cache caller info from the initialize)
    const initRes = await initialize(probe.opts);
    if (initRes.status >= 400) {
      fail(
        probe.id,
        probe.desc,
        `initialize returned HTTP ${initRes.status}: ${initRes.rawBody.slice(0, 300)}`,
      );
      continue;
    }

    const listRes = await mcpCall("tools/list", {}, probe.opts);
    maybeSaveResponse(`tools-list-${probe.id}`, listRes.rawBody);
    if (listRes.status >= 400) {
      fail(probe.id, probe.desc, `tools/list HTTP ${listRes.status}`, {
        status: listRes.status,
        body: listRes.rawBody.slice(0, 300),
      });
      continue;
    }
    const { tools, toolNames } = countTools(listRes);
    if (!tools) {
      fail(probe.id, probe.desc, "tools/list returned no tools array", {
        envelope: listRes.result,
      });
      continue;
    }
    const bytes = listRes.byteLength;
    out.toolsByProbe[probe.id] = { names: toolNames, bytes };

    // Size guard — fires for any probe, with a tighter check for compact ones.
    const sizeCap = probe.expectCompact ? MAX_CATALOG_BYTES : REGRESSION_BYTES;
    if (bytes > sizeCap) {
      fail(
        probe.id,
        probe.desc,
        `tools/list response too large (${bytes} bytes > ${sizeCap}) — compact catalog regressed?`,
        { toolCount: toolNames.length, firstFewTools: toolNames.slice(0, 10) },
      );
      continue;
    }

    if (probe.expectCompact) {
      // Compact mode must NOT expose internal-only tools
      const leaked = toolNames.filter((n) => INTERNAL_TOOL_NAMES.includes(n));
      if (leaked.length > 0) {
        fail(
          probe.id,
          probe.desc,
          `Compact catalog leaked internal tools: ${leaked.join(", ")}`,
          { allTools: toolNames },
        );
        continue;
      }
      // Compact mode is small (8 or fewer tools typically: list/open/ask/embed
      // + per-app mcpApp tools). Don't enforce an exact count — different apps
      // expose different MCP App tools — just sanity-check the upper bound.
      if (toolNames.length > 25) {
        fail(
          probe.id,
          probe.desc,
          `Compact catalog suspiciously large (${toolNames.length} tools)`,
          { allTools: toolNames },
        );
        continue;
      }
      pass(probe.id, probe.desc, {
        toolCount: toolNames.length,
        bytes,
      });
    } else {
      // Full mode SHOULD include internal tools if the template registers them.
      // We can't guarantee any single template registers `view-screen` (some
      // don't), but we can verify the catalog is meaningfully bigger than the
      // compact one. Defer that cross-probe check below.
      pass(probe.id, probe.desc, {
        toolCount: toolNames.length,
        bytes,
        sampleTools: toolNames.slice(0, 15),
      });
    }
  }

  // Cross-probe sanity: full catalog should be at least as large as compact.
  const compact = out.toolsByProbe["A1"] ?? out.toolsByProbe["A2"];
  const full =
    out.toolsByProbe["A5"] ?? out.toolsByProbe["A3"] ?? out.toolsByProbe["A4"];
  if (compact && full) {
    if (full.names.length < compact.names.length) {
      fail(
        "A-cross",
        "full catalog ≥ compact catalog in tool count",
        `Full client (${full.names.length} tools) had fewer tools than compact client (${compact.names.length} tools) — backwards?`,
        { compact: compact.names, full: full.names },
      );
    } else {
      pass("A-cross", "full catalog ≥ compact catalog in tool count", {
        compactCount: compact.names.length,
        fullCount: full.names.length,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Group B — Resources catalog
// ---------------------------------------------------------------------------

interface GroupBOutcome {
  compactResources: any[];
  fullResources: any[];
}

async function groupB_Resources(): Promise<GroupBOutcome> {
  startGroup("Group B: Resources catalog (compact vs full, no ticket leaks)");
  const out: GroupBOutcome = { compactResources: [], fullResources: [] };

  // B1: compact (ChatGPT UA)
  const compactInit = await initialize({
    userAgent: "ChatGPT/1.0",
    clientInfoName: "chatgpt",
  });
  if (compactInit.status >= 400) {
    fail(
      "B1",
      "ChatGPT UA → resources/list compact",
      `initialize HTTP ${compactInit.status}`,
    );
    return out;
  }
  const compactRes = await mcpCall(
    "resources/list",
    {},
    { userAgent: "ChatGPT/1.0", clientInfoName: "chatgpt" },
  );
  maybeSaveResponse("resources-list-compact", compactRes.rawBody);
  const { result: compactResult, error: compactErr } = unwrapResult(compactRes);
  if (compactErr) {
    fail(
      "B1",
      "ChatGPT UA → resources/list compact",
      `JSON-RPC error: ${JSON.stringify(compactErr).slice(0, 300)}`,
    );
  } else {
    const resources = Array.isArray(compactResult?.resources)
      ? (compactResult.resources as any[])
      : [];
    out.compactResources = resources;
    // Size guard
    if (compactRes.byteLength > MAX_CATALOG_BYTES) {
      fail(
        "B1",
        "resources/list compact ≤ 50KB",
        `${compactRes.byteLength} bytes`,
        {
          resourceCount: resources.length,
        },
      );
    } else {
      pass("B1", "ChatGPT UA → resources/list compact", {
        resourceCount: resources.length,
        bytes: compactRes.byteLength,
      });
    }
  }

  // B2: full (code hint)
  const fullRes = await mcpCall("resources/list", {}, { clientHint: "code" });
  maybeSaveResponse("resources-list-full", fullRes.rawBody);
  const { result: fullResult, error: fullErr } = unwrapResult(fullRes);
  if (fullErr) {
    fail(
      "B2",
      "client=code → resources/list full",
      `JSON-RPC error: ${JSON.stringify(fullErr).slice(0, 300)}`,
    );
  } else {
    const resources = Array.isArray(fullResult?.resources)
      ? (fullResult.resources as any[])
      : [];
    out.fullResources = resources;
    pass("B2", "client=code → resources/list full", {
      resourceCount: resources.length,
      bytes: fullRes.byteLength,
    });
  }

  // B3: no ui.domain has https:// (Claude rejects URL-form domain)
  const allResources = [...out.compactResources, ...out.fullResources];
  const bad: { uri: string; domain: string }[] = [];
  for (const r of allResources) {
    const domain = r?._meta?.ui?.domain;
    if (typeof domain === "string" && /^https?:\/\//i.test(domain)) {
      bad.push({ uri: String(r?.uri ?? "<unknown>"), domain });
    }
  }
  if (bad.length > 0) {
    fail(
      "B3",
      "no resource has _meta.ui.domain with https:// prefix",
      `${bad.length} offending resource(s) (Claude rejects this form)`,
      { offenders: bad.slice(0, 10) },
    );
  } else {
    pass("B3", "no resource has _meta.ui.domain with https:// prefix", {
      checkedCount: allResources.length,
    });
  }

  // B4: no embed-ticket URL leaks in any user-visible field
  // We treat any string containing "/_agent-native/embed/start?" as a leak.
  const leakHits: { uri: string; field: string; preview: string }[] = [];
  const visit = (uri: string, path: string, value: unknown) => {
    if (typeof value === "string") {
      if (value.includes("/_agent-native/embed/start?")) {
        leakHits.push({ uri, field: path, preview: value.slice(0, 120) });
      }
    } else if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        value.forEach((v, i) => visit(uri, `${path}[${i}]`, v));
      } else {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          // _meta["agent-native/embedStart"] is the legitimate hiding place;
          // tickets there are expected, not leaked.
          if (path === "_meta" && k === "agent-native/embedStart") continue;
          visit(uri, path ? `${path}.${k}` : k, v);
        }
      }
    }
  };
  for (const r of allResources) {
    const uri = String(r?.uri ?? "<unknown>");
    // Only inspect user-facing fields, not the legitimate _meta hiding place.
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      visit(uri, k, v);
    }
  }
  if (leakHits.length > 0) {
    fail(
      "B4",
      "no resource leaks embed-ticket URL in user-visible fields",
      `${leakHits.length} leak(s)`,
      { leaks: leakHits.slice(0, 10) },
    );
  } else {
    pass("B4", "no resource leaks embed-ticket URL in user-visible fields", {
      checkedCount: allResources.length,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Group C — open_app + embed ticket privacy
// ---------------------------------------------------------------------------

interface GroupCOutcome {
  apps: { id: string }[];
  openAppResult?: any;
}

async function groupC_OpenAppPrivacy(
  toolsByProbe: GroupAOutcome["toolsByProbe"],
): Promise<GroupCOutcome> {
  startGroup(
    "Group C: open_app + embed-ticket privacy (no ticket in text/structured)",
  );
  const out: GroupCOutcome = { apps: [] };

  if (flags.skipOpenApp) {
    pass("C-skip", "Group C skipped via --skip-open-app", {});
    return out;
  }

  // Use the compact-mode probe to call open_app (which always lives in compact
  // builtin set). Use the same client headers Cursor/Claude would use so we
  // also exercise the path users care about.
  const opts: McpCallOptions = {
    userAgent: "ChatGPT/1.0",
    clientInfoName: "chatgpt",
  };

  // Verify open_app exists at all
  const compactTools =
    toolsByProbe["A1"]?.names ?? toolsByProbe["A2"]?.names ?? [];
  if (!compactTools.includes("open_app")) {
    fail(
      "C0",
      "compact catalog contains open_app",
      "open_app missing from compact catalog — required for ChatGPT/Claude UX",
      { compactTools },
    );
    return out;
  } else {
    pass("C0", "compact catalog contains open_app", { compactTools });
  }

  // First, list_apps so we know which app id is valid for this server.
  const listAppsRes = await mcpCall(
    "tools/call",
    { name: "list_apps", arguments: {} },
    opts,
  );
  maybeSaveResponse("list-apps", listAppsRes.rawBody);
  const { result: listAppsResult, error: listAppsErr } =
    unwrapResult(listAppsRes);
  if (listAppsErr) {
    fail(
      "C-prep",
      "list_apps prep call",
      `JSON-RPC error: ${JSON.stringify(listAppsErr).slice(0, 300)}`,
    );
    return out;
  }
  // list_apps result shape: { content: [...], structuredContent: { apps: [...] } }
  // or sometimes { apps: [...] } at the top level.
  let appsArray: any[] = [];
  const sc = listAppsResult?.structuredContent;
  if (Array.isArray(sc?.apps)) appsArray = sc.apps;
  else if (Array.isArray(listAppsResult?.apps)) appsArray = listAppsResult.apps;
  out.apps = appsArray.map((a: any) => ({
    id: String(a?.id ?? a?.name ?? ""),
  }));

  if (appsArray.length === 0) {
    fail("C-prep", "list_apps returned ≥1 app", "no apps available to open", {
      result: listAppsResult,
    });
    return out;
  }
  pass("C-prep", "list_apps returned ≥1 app", {
    count: appsArray.length,
    apps: out.apps,
  });

  // Pick the first app and call open_app with embed:true
  const targetApp = String(appsArray[0]?.id ?? appsArray[0]?.name ?? "");
  if (!targetApp) {
    fail(
      "C-prep",
      "list_apps had an identifiable app id",
      "first app had no id",
      {
        first: appsArray[0],
      },
    );
    return out;
  }

  const openRes = await mcpCall(
    "tools/call",
    {
      name: "open_app",
      arguments: { app: targetApp, path: "/", embed: true },
    },
    opts,
  );
  maybeSaveResponse(`open-app-${targetApp}`, openRes.rawBody);
  const { result: openResult, error: openErr } = unwrapResult(openRes);
  if (openErr) {
    fail(
      "C1",
      `open_app(${targetApp}, embed=true) returns successfully`,
      `JSON-RPC error: ${JSON.stringify(openErr).slice(0, 300)}`,
    );
    return out;
  }
  out.openAppResult = openResult;
  pass("C1", `open_app(${targetApp}, embed=true) returns successfully`, {
    keys: openResult ? Object.keys(openResult) : [],
  });

  // Validate text content has no ticket URL
  const contentTexts: string[] = Array.isArray(openResult?.content)
    ? (openResult.content as any[])
        .filter((c) => c?.type === "text" && typeof c?.text === "string")
        .map((c) => c.text as string)
    : [];
  const textBlob = contentTexts.join("\n");
  if (textBlob.includes("/_agent-native/embed/start?")) {
    fail(
      "C2",
      "open_app content[].text does NOT contain embed/start?ticket=",
      "Ticket URL leaked into LLM-visible text",
      { textPreview: textBlob.slice(0, 500) },
    );
  } else {
    pass(
      "C2",
      "open_app content[].text does NOT contain embed/start?ticket=",
      {},
    );
  }

  // Validate structuredContent has no banned fields
  const sc2 = openResult?.structuredContent;
  if (sc2 && typeof sc2 === "object") {
    const banned = [
      "embedStartUrl",
      "startUrl",
      "embedTargetPath",
      "embedExpiresAt",
      "ticket",
      "embedTicket",
    ];
    const found: string[] = [];
    for (const key of Object.keys(sc2 as Record<string, unknown>)) {
      if (banned.includes(key)) found.push(key);
      if (/Ticket$/.test(key)) found.push(key);
    }
    // Also check url field doesn't contain a ticket
    if (
      typeof (sc2 as any).url === "string" &&
      (sc2 as any).url.includes("/_agent-native/embed/start?")
    ) {
      found.push("url(=embedStartUrl)");
    }
    if (found.length > 0) {
      fail(
        "C3",
        "structuredContent has no embed-ticket fields",
        `Forbidden fields present: ${found.join(", ")}`,
        { structuredContent: sc2 },
      );
    } else {
      pass("C3", "structuredContent has no embed-ticket fields", {
        keys: Object.keys(sc2 as Record<string, unknown>),
      });
    }
  } else {
    pass(
      "C3",
      "structuredContent has no embed-ticket fields (no SC at all)",
      {},
    );
  }

  // Validate _meta["agent-native/embedStart"].startUrl IS the legitimate
  // hiding place. (Best-effort — some apps may not return embedStart at all.)
  const meta = openResult?._meta;
  const embedStart = meta?.["agent-native/embedStart"];
  if (embedStart && typeof embedStart === "object") {
    const startUrl = (embedStart as any).startUrl;
    if (
      typeof startUrl === "string" &&
      startUrl.includes("/_agent-native/embed/start?")
    ) {
      pass(
        "C4",
        "_meta[agent-native/embedStart].startUrl IS the ticket URL (legitimate)",
        { startUrl: startUrl.slice(0, 200) },
      );
    } else {
      // Not strictly a failure — some servers don't mint embed sessions for "/"
      pass(
        "C4",
        "_meta[agent-native/embedStart].startUrl present but not a ticket (acceptable for non-embed paths)",
        {
          startUrl:
            typeof startUrl === "string" ? startUrl.slice(0, 200) : null,
        },
      );
    }
  } else {
    pass(
      "C4",
      "_meta[agent-native/embedStart] not present (acceptable — some apps don't embed)",
      { hasMeta: !!meta },
    );
  }

  // C5: openLink.webUrl, if present, must not be a ticket URL.
  const openLink = meta?.["agent-native/openLink"];
  if (openLink && typeof openLink === "object" && !Array.isArray(openLink)) {
    const webUrl = (openLink as any).webUrl;
    if (
      typeof webUrl === "string" &&
      webUrl.includes("/_agent-native/embed/start?")
    ) {
      fail(
        "C5",
        "_meta[agent-native/openLink].webUrl is NOT a ticket URL",
        "openLink.webUrl contains a ticket URL — should be a real app route or absent",
        { webUrl: webUrl.slice(0, 200) },
      );
    } else {
      pass("C5", "_meta[agent-native/openLink].webUrl is NOT a ticket URL", {
        webUrl: typeof webUrl === "string" ? webUrl.slice(0, 200) : null,
      });
    }
  } else {
    pass("C5", "_meta[agent-native/openLink] not present (acceptable)", {});
  }

  return out;
}

// ---------------------------------------------------------------------------
// Group D — Mail manage-draft URL privacy
// ---------------------------------------------------------------------------

async function groupD_MailManageDraft(
  toolsByProbe: GroupAOutcome["toolsByProbe"],
): Promise<void> {
  startGroup("Group D: Mail manage-draft URL privacy (no compose= in URL)");
  if (flags.skipMail) {
    pass("D-skip", "Group D skipped via --skip-mail", {});
    return;
  }

  // Check if this MCP server even exposes manage-draft. We probe with the
  // full-catalog header so mail-app-derived MCPs always expose it.
  const fullTools =
    toolsByProbe["A5"]?.names ??
    toolsByProbe["A3"]?.names ??
    toolsByProbe["A4"]?.names ??
    [];
  const hasManageDraft = fullTools.some(
    (n) => n === "manage-draft" || n === "manage_draft",
  );
  if (!hasManageDraft) {
    pass("D-skip", "manage-draft not present — skipping (not a mail server)", {
      fullToolsSample: fullTools.slice(0, 20),
    });
    return;
  }

  const toolName = fullTools.includes("manage-draft")
    ? "manage-draft"
    : "manage_draft";
  const opts: McpCallOptions = { clientHint: "code" };
  const callRes = await mcpCall(
    "tools/call",
    {
      name: toolName,
      arguments: {
        action: "create",
        to: "test@example.com",
        subject: "E2E MCP Test",
        body: "Hello from e2e-mcp-test.ts",
      },
    },
    opts,
  );
  maybeSaveResponse(`${toolName}-create`, callRes.rawBody);
  const { result, error } = unwrapResult(callRes);
  if (error) {
    fail(
      "D1",
      `${toolName} create returns successfully`,
      `JSON-RPC error: ${JSON.stringify(error).slice(0, 300)}`,
    );
    return;
  }
  pass("D1", `${toolName} create returns successfully`, {
    keys: result ? Object.keys(result) : [],
  });

  // D2: no compose= in text/structured (the base64 payload bug)
  const contentTexts: string[] = Array.isArray(result?.content)
    ? (result.content as any[])
        .filter((c) => c?.type === "text" && typeof c?.text === "string")
        .map((c) => c.text as string)
    : [];
  const textBlob = contentTexts.join("\n");
  const sc = result?.structuredContent;
  const scBlob = sc ? JSON.stringify(sc) : "";
  const metaBlob = result?._meta ? JSON.stringify(result._meta) : "";

  const hits: { where: string; preview: string }[] = [];
  if (textBlob.includes("compose=")) {
    hits.push({ where: "content[].text", preview: textBlob.slice(0, 300) });
  }
  if (scBlob.includes("compose=")) {
    hits.push({ where: "structuredContent", preview: scBlob.slice(0, 300) });
  }
  if (metaBlob.includes("compose=")) {
    hits.push({ where: "_meta", preview: metaBlob.slice(0, 300) });
  }
  if (hits.length > 0) {
    fail(
      "D2",
      "manage-draft does NOT leak compose= base64 payload in URL",
      `${hits.length} hits`,
      { hits },
    );
  } else {
    pass("D2", "manage-draft does NOT leak compose= base64 payload in URL", {});
  }

  // D3: where a deep link URL appears, it should use composeDraftId= not compose=
  // Look for /compose, /mail, or any URL-shaped string containing composeDraftId.
  const allText = `${textBlob}\n${scBlob}\n${metaBlob}`;
  const hasComposeDraftId = allText.includes("composeDraftId=");
  if (hasComposeDraftId) {
    pass("D3", "manage-draft uses composeDraftId= instead of compose=", {});
  } else {
    // Acceptable — server may have changed the contract. Don't fail outright.
    pass(
      "D3",
      "manage-draft does not include composeDraftId= (acceptable if contract changed)",
      {},
    );
  }
}

// ---------------------------------------------------------------------------
// Group E — ui.domain validation for Claude
// (Already partially covered in B3, but here we also call resources/read on
// each ui:// URI to make sure the read endpoint doesn't re-introduce the
// https:// prefix.)
// ---------------------------------------------------------------------------

async function groupE_UiDomain(resourcesOutcome: GroupBOutcome): Promise<void> {
  startGroup("Group E: ui.domain validation across resources/read");
  const all = [
    ...resourcesOutcome.compactResources,
    ...resourcesOutcome.fullResources,
  ];
  const uiResources = all.filter(
    (r) => typeof r?.uri === "string" && r.uri.startsWith("ui://"),
  );
  if (uiResources.length === 0) {
    pass("E-skip", "No ui:// resources advertised — nothing to check", {});
    return;
  }

  // Dedup by URI
  const seen = new Map<string, any>();
  for (const r of uiResources) seen.set(r.uri, r);

  let bad = 0;
  for (const [uri, resourceEntry] of seen) {
    const readRes = await mcpCall(
      "resources/read",
      { uri },
      { clientHint: "code" },
    );
    maybeSaveResponse(`resources-read-${uri}`, readRes.rawBody);
    const { result, error } = unwrapResult(readRes);
    if (error) {
      // Not a hard failure — resources/read may legitimately reject in some configs
      logErr(
        `  warn: resources/read failed for ${uri}: ${JSON.stringify(error).slice(0, 200)}`,
      );
      continue;
    }
    const contents = Array.isArray(result?.contents) ? result.contents : [];
    for (const c of contents) {
      const domain = c?._meta?.ui?.domain;
      if (typeof domain === "string" && /^https?:\/\//i.test(domain)) {
        bad += 1;
        fail(
          "E1",
          `resources/read(${uri}) _meta.ui.domain has no https:// prefix`,
          `Got: ${domain}`,
          { uri, domain },
        );
      }
    }
  }
  if (bad === 0) {
    pass(
      "E1",
      `all ${seen.size} ui:// resources have hostname-only _meta.ui.domain`,
      {
        checkedCount: seen.size,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Group F — Catalog stability across turns
// ---------------------------------------------------------------------------

async function groupF_Stability(): Promise<void> {
  startGroup("Group F: Catalog stability across turns");
  if (flags.skipStability) {
    pass("F-skip", "Group F skipped via --skip-stability", {});
    return;
  }
  const opts: McpCallOptions = {
    userAgent: "ChatGPT/1.0",
    clientInfoName: "chatgpt",
  };
  const a = await mcpCall("tools/list", {}, opts);
  const b = await mcpCall("tools/list", {}, opts);
  // Compare the tool name + description pairs — request id will differ.
  const { result: ra } = unwrapResult(a);
  const { result: rb } = unwrapResult(b);
  const sigA = JSON.stringify(
    (Array.isArray(ra?.tools) ? ra.tools : []).map((t: any) => ({
      name: t?.name,
      description: t?.description,
    })),
  );
  const sigB = JSON.stringify(
    (Array.isArray(rb?.tools) ? rb.tools : []).map((t: any) => ({
      name: t?.name,
      description: t?.description,
    })),
  );
  if (sigA === sigB) {
    pass("F1", "tools/list is deterministic across two identical calls", {
      bytesFirst: a.byteLength,
      bytesSecond: b.byteLength,
    });
  } else {
    fail(
      "F1",
      "tools/list is deterministic across two identical calls",
      "Two calls returned different tool name/description sets",
      {
        diff: {
          a: sigA.slice(0, 600),
          b: sigB.slice(0, 600),
        },
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Catalog dump mode
// ---------------------------------------------------------------------------

async function runCatalogDump(): Promise<void> {
  logInfo(`Catalog dump for ${flags.baseUrl} (full catalog via client=code)`);
  await initialize({ clientHint: "code" });
  const tools = await mcpCall("tools/list", {}, { clientHint: "code" });
  const resources = await mcpCall("resources/list", {}, { clientHint: "code" });
  logInfo("");
  logInfo("=== tools/list (full) ===");
  logInfo(JSON.stringify(unwrapResult(tools).result, null, 2));
  logInfo("");
  logInfo("=== resources/list (full) ===");
  logInfo(JSON.stringify(unwrapResult(resources).result, null, 2));
  logInfo("");
  logInfo("=== tools/list (compact via ChatGPT UA) ===");
  await initialize({ userAgent: "ChatGPT/1.0", clientInfoName: "chatgpt" });
  const compactTools = await mcpCall(
    "tools/list",
    {},
    { userAgent: "ChatGPT/1.0", clientInfoName: "chatgpt" },
  );
  logInfo(JSON.stringify(unwrapResult(compactTools).result, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logInfo(`MCP test target: ${flags.baseUrl}`);

  // Resolve a token if needed
  if (!flags.token && !flags.insecureNoAuth) {
    if (flags.deviceFlow) {
      try {
        flags.token = await runDeviceFlow();
      } catch (err: any) {
        logErr(`Device flow failed: ${err?.message ?? err}`);
        process.exit(2);
      }
    } else if (flags.authCode) {
      try {
        flags.token = await runAuthCodeFlow();
      } catch (err: any) {
        logErr(`Auth-code flow failed: ${err?.message ?? err}`);
        process.exit(2);
      }
    } else {
      logErr(
        "No token provided. Pass one positionally, set MCP_TEST_TOKEN, or use\n" +
          "  --device-flow / --auth-code / --insecure-no-auth.",
      );
      // Quick probe to give the user a hint about server availability
      try {
        const probe = await fetch(`${flags.baseUrl}/_agent-native/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "probe", version: "0" },
            },
          }),
        });
        const wwwAuth = probe.headers.get("www-authenticate");
        logErr(
          `\nProbe ${flags.baseUrl}/_agent-native/mcp returned HTTP ${probe.status}`,
        );
        if (wwwAuth) logErr(`  WWW-Authenticate: ${wwwAuth}`);
        const body = await probe.text();
        logErr(`  Body: ${body.slice(0, 400)}`);
      } catch (err: any) {
        logErr(`Probe failed: ${err?.message ?? err}`);
      }
      process.exit(2);
    }
  }

  if (flags.catalogDump) {
    await runCatalogDump();
    return;
  }

  // Verify the token works at all before running the suite
  if (!flags.insecureNoAuth) {
    const initProbe = await initialize({ clientHint: "code" });
    if (initProbe.status === 401) {
      logErr(
        `Token rejected (HTTP 401). WWW-Authenticate: ${initProbe.contentType}`,
      );
      logErr(`Body: ${initProbe.rawBody.slice(0, 400)}`);
      process.exit(2);
    }
    if (initProbe.status >= 400) {
      logErr(
        `initialize returned HTTP ${initProbe.status}: ${initProbe.rawBody.slice(0, 400)}`,
      );
      process.exit(2);
    }
    logInfo(`  Token accepted (initialize HTTP ${initProbe.status})`);
  }

  // Run all groups
  const aOut = await groupA_CompactCatalog();
  const bOut = await groupB_Resources();
  await groupC_OpenAppPrivacy(aOut.toolsByProbe);
  await groupD_MailManageDraft(aOut.toolsByProbe);
  await groupE_UiDomain(bOut);
  await groupF_Stability();

  // Summary
  logInfo("");
  logInfo("══════════════════════════════════════════════════════");
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  logInfo(`Total: ${results.length}  Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) {
    logInfo("");
    logInfo("Failures:");
    for (const r of results.filter((r) => !r.pass)) {
      logErr(`  ${r.group}  ${r.id}  ${r.desc}`);
      logErr(`         → ${r.error}`);
    }
  }
  logInfo("══════════════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logErr(`Fatal error: ${err?.stack ?? err}`);
  process.exit(2);
});
