/**
 * `/_agent-native/mcp/connect` — frictionless external-agent connection.
 *
 * A logged-in user on a deployed agent-native app (e.g. mail.agent-native.com)
 * mints a per-user, scoped, revocable MCP bearer token WITHOUT ever copying a
 * shared deployment secret. Two surfaces:
 *
 *   1. Browser  — `GET /connect` renders a minimal in-app page (same inline
 *      HTML approach as the auth pages). The Authorize button POSTs to
 *      `/connect/token`, then shows the ready-to-paste `.mcp.json` entry, the
 *      `agent-native connect <origin>` one-liner, and the user's existing
 *      tokens with Revoke buttons.
 *   2. CLI      — an OAuth-2.0-device-authorization-style flow:
 *        POST /connect/device/start      (unauth)  → device_code + user_code
 *        GET  /connect?user_code=…       (browser) → user signs in & approves
 *        POST /connect/device/authorize  (session) → binds user to the code
 *        POST /connect/device/poll       (unauth)  → mints + returns the token
 *
 * The minted token reuses the existing A2A signer (`signA2AToken`) — no new
 * crypto. We only add a random `jti` + `scope: "mcp-connect"` claim so it can
 * be revoked. `verifyAuth` already verifies A2A_SECRET JWTs and extracts
 * `sub`/`org_domain`, so a minted token works against `/_agent-native/mcp`
 * with no verify changes for the happy path (the revoke check is the only
 * addition there).
 *
 * Node-only (crypto + the A2A signer), bundled alongside the other framework
 * routes. Dialect-agnostic SQL lives in `connect-store.ts`.
 */

import type { H3Event } from "h3";
import { getMethod, getHeader } from "h3";
import { readBody } from "../server/h3-helpers.js";
import { getSession, getConfiguredLoginHtml } from "../server/auth.js";
import { signA2AToken } from "../a2a/client.js";
import { getOrgDomain } from "../org/context.js";
import { randomUUID } from "node:crypto";
import {
  recordMintedToken,
  listTokens,
  revokeToken,
  createDeviceCode,
  getDeviceCode,
  approveDeviceCode,
  claimDeviceCodeForMint,
  finishDeviceCodeMint,
  releaseDeviceCodeMint,
  expireDeviceCode,
  MCP_CONNECT_SCOPE,
  DEFAULT_TOKEN_TTL_DAYS,
  MIN_TOKEN_TTL_DAYS,
  MAX_TOKEN_TTL_DAYS,
  DEVICE_CODE_TTL_MS,
} from "./connect-store.js";

/** Device-flow poll interval hint (seconds). */
const DEVICE_POLL_INTERVAL_S = 3;

// Human-typable user code: 8 base32 chars, dashed XXXX-XXXX.
const USER_CODE_RE = /^[A-Z2-7]{4}-[A-Z2-7]{4}$/;

export interface McpConnectRouteOptions {
  /** App id (directory under apps/, e.g. `mail`). Used for the server name. */
  appId?: string;
  /** Human app name shown on the connect page. */
  appName?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Derive the running app's origin from request headers (same logic mountMCP
 *  uses) — `https` in prod / for non-loopback hosts, `http` for localhost. */
function deriveOrigin(event: H3Event): string {
  const forwardedProto = getHeader(event, "x-forwarded-proto");
  const host = getHeader(event, "x-forwarded-host") || getHeader(event, "host");
  const proto =
    forwardedProto?.split(",")[0]?.trim() ||
    (host && /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "/") return "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "");
}

function configuredBasePath(): string {
  return normalizeBasePath(
    process.env.APP_BASE_PATH || process.env.VITE_APP_BASE_PATH,
  );
}

function joinAppPath(basePath: string, path: string): string {
  if (!basePath) return path;
  if (path === "/") return basePath;
  return `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
}

function appLabel(origin: string, options: McpConnectRouteOptions): string {
  if (options.appId) return options.appId;
  try {
    const h = new URL(origin).hostname;
    return h.split(".")[0] || h;
  } catch {
    return options.appName || "app";
  }
}

function serverName(origin: string, options: McpConnectRouteOptions): string {
  return `agent-native-${appLabel(origin, options)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Resolve the org domain for a session. Used as the JWT `org_domain` claim so
 * the receiving MCP endpoint can map it back to an org id (same as A2A). Best
 * effort — a missing org just yields a user-scoped (no-org) token.
 */
async function resolveOrgDomain(
  orgId: string | undefined,
): Promise<string | undefined> {
  if (!orgId) return undefined;
  try {
    return (await getOrgDomain(orgId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function clampTtlDays(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return DEFAULT_TOKEN_TTL_DAYS;
  return Math.min(
    MAX_TOKEN_TTL_DAYS,
    Math.max(MIN_TOKEN_TTL_DAYS, Math.floor(n)),
  );
}

/**
 * Mint a connect-scoped JWT and record it. The JWT is signed by the existing
 * A2A signer (HS256 over A2A_SECRET); we add a random `jti` and
 * `scope: "mcp-connect"` so the token is individually revocable. The token
 * value is returned to the caller exactly once and never persisted.
 */
async function mintConnectToken(params: {
  email: string;
  orgId: string | undefined;
  label: string | null;
  ttlDays: number;
}): Promise<{ token: string; jti: string }> {
  const orgDomain = await resolveOrgDomain(params.orgId);
  const jti = randomUUID();
  // signA2AToken signs { sub: email, org_domain? } over A2A_SECRET (global)
  // or the org secret. We extend its claims via the standard jose builder by
  // re-using the same signer with extra claims threaded through `options`.
  const token = await signA2AToken(params.email, orgDomain, undefined, {
    preferGlobalSecret: true,
    expiresIn: `${params.ttlDays}d`,
    extraClaims: { jti, scope: MCP_CONNECT_SCOPE },
  });
  await recordMintedToken({
    jti,
    ownerEmail: params.email,
    orgId: params.orgId ?? null,
    label: params.label,
  });
  return { token, jti };
}

function mcpResultPayload(
  appUrl: string,
  token: string,
  options: McpConnectRouteOptions,
) {
  const mcpUrl = `${appUrl}/_agent-native/mcp`;
  const name = serverName(appUrl, options);
  return {
    token,
    mcpUrl,
    serverName: name,
    mcpServerEntry: {
      type: "http" as const,
      url: mcpUrl,
      headers: { Authorization: `Bearer ${token}` },
    },
    cli: `agent-native connect ${appUrl}`,
  };
}

// ---------------------------------------------------------------------------
// Connect page (server-rendered HTML string)
// ---------------------------------------------------------------------------

function agentNativeMarkSvg(className: string, gradientId: string): string {
  return `<svg class="${className}" width="114" height="66" viewBox="0 0 114 66" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path d="M24.5537 65.7695H0L15.0859 39.4619L37.708 0L60.4912 39.4619H39.6396L24.5537 65.7695Z" fill="white"/>
  <path d="M89.446 0H114L76.2921 65.7704H51.7383L89.446 0Z" fill="url(#${gradientId})"/>
  <defs>
    <linearGradient id="${gradientId}" x1="101.702" y1="67.4791" x2="113.672" y2="-37.4275" gradientUnits="userSpaceOnUse">
      <stop stop-color="#00B5FF"/>
      <stop offset="1" stop-color="#48FFE4"/>
    </linearGradient>
  </defs>
</svg>`;
}

function renderConnectPage(params: {
  origin: string;
  connectBasePath: string;
  email: string;
  appName: string;
  userCode: string | null;
}): string {
  const { origin, connectBasePath, email, appName, userCode } = params;
  const safeOrigin = escapeHtml(origin);
  const safeEmail = escapeHtml(email);
  const safeApp = escapeHtml(appName);
  const brandMarkSvg = agentNativeMarkSvg(
    "brand-mark",
    "agent-native-connect-brand-gradient",
  );
  const flowMarkSvg = agentNativeMarkSvg(
    "flow-mark",
    "agent-native-connect-flow-gradient",
  );
  const safeUserCode =
    userCode && USER_CODE_RE.test(userCode) ? escapeHtml(userCode) : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect ${safeApp}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    color-scheme: dark;
    --bg: #09090b; --panel: #121214; --panel-2: #0c0c0e;
    --panel-soft: rgba(255,255,255,0.025);
    --border: rgba(255,255,255,0.075); --border-strong: rgba(255,255,255,0.14);
    --text: #f7f7f8; --muted: #a1a1aa; --subtle: #74747d;
    --accent: #f4f4f5; --accent-fg: #09090b;
    --ring: rgba(250,250,250,0.55);
    --error: #fca5a5; --error-bg: rgba(127,29,29,0.18);
    --ok: #86efac; --ok-bg: rgba(20,83,45,0.12); --ok-border: rgba(134,239,172,0.18);
  }
  html, body { -webkit-font-smoothing: antialiased; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: linear-gradient(180deg, #101013 0%, var(--bg) 58%);
    color: var(--text); display: flex; align-items: center;
    justify-content: center; min-height: 100vh; padding: 1.5rem 1rem;
  }
  .card {
    width: 100%; max-width: 440px;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset,
      0 30px 90px rgba(0,0,0,0.5);
    padding: 1.25rem;
  }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.75rem; margin-bottom: 1.75rem;
  }
  .brand-lockup {
    display: flex; align-items: center; gap: 0.55rem;
    color: var(--muted); font-size: 0.78rem; font-weight: 600;
  }
  .brand-mark { width: 18px; height: auto; display: block; }
  .app-pill {
    max-width: 50%; border: 1px solid var(--border);
    border-radius: 999px; padding: 0.28rem 0.55rem;
    color: var(--subtle); font-size: 0.72rem; line-height: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .hero { padding: 0 0.75rem; text-align: center; }
  .flow {
    display: flex; align-items: center; justify-content: center;
    gap: 0; margin: 0 auto 1.1rem; width: fit-content;
  }
  .flow .tile {
    width: 42px; height: 42px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    background: var(--panel-2); border: 1px solid var(--border-strong);
    color: var(--text); flex-shrink: 0;
  }
  .flow-mark { width: 26px; height: auto; display: block; }
  .flow .agent-symbol {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95rem; font-weight: 700; letter-spacing: -0.04em;
  }
  .flow .conn {
    width: 30px; height: 1px; flex-shrink: 0;
    background: linear-gradient(90deg, transparent, var(--border-strong), transparent);
    background-position: center;
  }
  .eyebrow {
    text-align: center; font-size: 0.72rem; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--subtle); margin-bottom: 0.55rem;
  }
  h1 {
    text-align: center; font-size: 1.45rem; font-weight: 680;
    line-height: 1.25; margin-bottom: 0.55rem;
    letter-spacing: -0.01em;
  }
  .sub {
    text-align: center; color: var(--muted); font-size: 0.9rem;
    line-height: 1.5; margin: 0 auto 0.9rem; max-width: 36ch;
  }
  .identity {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
    gap: 0.25rem 0.45rem; color: var(--subtle); font-size: 0.78rem;
    line-height: 1.35; margin: 0 auto 1.4rem; max-width: 34ch;
  }
  .identity strong { color: var(--muted); font-weight: 600; }
  .identity .origin { overflow-wrap: anywhere; }
  .device-strip {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.75rem; border: 1px solid var(--border);
    border-radius: 8px; padding: 0.55rem 0.65rem; margin: 0 0 0.9rem;
    background: var(--panel-soft); color: var(--muted);
  }
  .device-strip .label {
    font-size: 0.76rem; font-weight: 560; color: var(--subtle);
  }
  .device-strip .value {
    font-size: 0.9rem; font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.08em; color: var(--text);
  }
  button {
    cursor: pointer; font: inherit; font-weight: 600; border: none;
    border-radius: 8px; padding: 0.78rem 1rem;
  }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .primary {
    background: var(--accent); color: var(--accent-fg); width: 100%;
    font-size: 0.95rem;
  }
  .primary:hover:not(:disabled) { background: #e4e4e7; }
  .primary:disabled { opacity: 0.55; cursor: default; }
  .ghost {
    background: transparent; color: var(--muted);
    border: 1px solid var(--border-strong); padding: 0.35rem 0.7rem;
    font-size: 0.78rem; font-weight: 500; border-radius: 8px;
  }
  .ghost:hover:not(:disabled) { color: var(--text); border-color: var(--subtle); }
  pre {
    background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 0.9rem; font-size: 0.78rem; line-height: 1.5; overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #d4d4d8; margin: 0.5rem 0 1rem;
  }
  /* Advanced disclosure */
  .advanced { margin: 0 0 1rem; }
  .advanced > summary {
    list-style: none; cursor: pointer; user-select: none;
    display: flex; align-items: center; justify-content: center; gap: 0.35rem;
    color: var(--subtle); font-size: 0.8rem; font-weight: 500;
    padding: 0.5rem 0; text-align: center;
  }
  .advanced > summary::-webkit-details-marker { display: none; }
  .advanced > summary:hover { color: var(--muted); }
  .advanced > summary:focus-visible { outline: 2px solid var(--ring);
    outline-offset: 2px; border-radius: 6px; }
  .advanced > summary .chev {
    width: 7px; height: 7px; border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor; transform: rotate(45deg);
    transition: transform 0.15s ease; margin-top: -3px;
  }
  .advanced[open] > summary .chev { transform: rotate(225deg); margin-top: 2px; }
  .advanced-body {
    padding: 0.85rem 0.1rem 0.25rem;
  }
  .field { margin-bottom: 0.9rem; }
  .field:last-child { margin-bottom: 0; }
  .field label { display: block; font-size: 0.78rem; color: var(--muted);
    margin-bottom: 0.35rem; }
  .field input {
    width: 100%; padding: 0.6rem 0.7rem; font: inherit; color: var(--text);
    background: var(--panel-2); border: 1px solid var(--border-strong);
    border-radius: 8px;
  }
  .field input:focus-visible {
    outline: none; border-color: var(--ring);
    box-shadow: 0 0 0 3px rgba(250,250,250,0.12);
  }
  .connections {
    margin-top: 1.1rem; border-top: 1px solid var(--border);
    padding-top: 0.35rem;
  }
  .connections > summary {
    list-style: none; cursor: pointer; user-select: none;
    display: flex; align-items: center; gap: 0.55rem;
    min-height: 2.2rem; color: var(--muted); font-size: 0.82rem;
  }
  .connections > summary::-webkit-details-marker { display: none; }
  .connections > summary:focus-visible {
    outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 6px;
  }
  .connections-title { font-weight: 600; color: var(--muted); }
  .connections-state {
    margin-left: auto; color: var(--subtle); font-size: 0.73rem;
    border: 1px solid var(--border); border-radius: 999px;
    padding: 0.18rem 0.45rem; line-height: 1;
  }
  .connections .chev {
    width: 7px; height: 7px; border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor; transform: rotate(45deg);
    transition: transform 0.15s ease; margin: -3px 0 0 0.15rem;
  }
  .connections[open] .chev { transform: rotate(225deg); margin-top: 2px; }
  .token-list { padding-top: 0.4rem; }
  .tok { display: flex; align-items: center; justify-content: space-between;
    gap: 0.75rem; padding: 0.6rem 0; border-bottom: 1px solid var(--border);
    font-size: 0.83rem; }
  .tok:last-child { border-bottom: none; }
  .tok .meta { color: var(--subtle); font-size: 0.74rem; margin-top: 0.1rem; }
  .tok.revoked { opacity: 0.45; }
  .empty-state {
    color: var(--subtle); font-size: 0.78rem; line-height: 1.45;
    padding: 0.3rem 0 0.45rem;
  }
  .msg { font-size: 0.83rem; padding: 0.7rem 0.8rem; border-radius: 8px;
    margin-bottom: 0.9rem; display: none; line-height: 1.4; }
  .msg.err { display: block; color: var(--error); background: var(--error-bg);
    border: 1px solid rgba(252,165,165,0.16); }
  .msg.ok { display: block; color: var(--ok); background: var(--ok-bg);
    border: 1px solid var(--ok-border); }
  .result-panel { padding-top: 0.15rem; }
  .result-title {
    color: var(--text); font-size: 0.95rem; font-weight: 650;
    text-align: center; margin-bottom: 0.35rem;
  }
  .result-copy {
    color: var(--muted); font-size: 0.83rem; line-height: 1.45;
    text-align: center; margin: 0 auto 0.85rem; max-width: 34ch;
  }
  .section-label {
    color: var(--subtle); font-size: 0.7rem; font-weight: 650;
    letter-spacing: 0.08em; text-transform: uppercase; margin-top: 0.85rem;
  }
  @media (max-width: 480px) {
    body { align-items: flex-start; padding: 0.75rem; }
    .card { padding: 1rem; }
    .hero { padding: 0; }
    .topbar { margin-bottom: 1.35rem; }
    h1 { font-size: 1.3rem; }
    .app-pill { max-width: 46%; }
    pre { font-size: 0.72rem; }
  }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div class="card">
  <div class="topbar">
    <div class="brand-lockup">
      ${brandMarkSvg}
      <span>Agent Native</span>
    </div>
    <div class="app-pill" title="${safeApp}">${safeApp}</div>
  </div>

  <div class="hero">
    <!-- "Connect an external agent" is kept as the accessible consent label. -->
    <div class="flow" role="img" aria-label="Connect an external agent to ${safeApp}">
      <span class="tile" aria-hidden="true">
        ${flowMarkSvg}
      </span>
      <span class="conn" aria-hidden="true"></span>
      <span class="tile" aria-hidden="true">
        <span class="agent-symbol">&lt;/&gt;</span>
      </span>
    </div>

    <div class="eyebrow">Connect an external agent</div>
    <h1>${safeUserCode ? `Authorize ${safeApp} from your terminal?` : `Connect ${safeApp} to an agent`}</h1>
    <p class="sub">Allow Claude Code, Codex, or Cowork to use ${safeApp} with your account. You can revoke access anytime.</p>
    <p class="identity">
      <span>Signed in as <strong>${safeEmail}</strong></span>
      <span aria-hidden="true">&middot;</span>
      <span class="origin">${safeOrigin}</span>
    </p>
  </div>

  <div id="codeCallout" class="device-strip ${safeUserCode ? "" : "hidden"}">
    <span class="label">Device code</span>
    <span class="value" id="userCodeValue">${safeUserCode}</span>
  </div>

  <div id="msg" class="msg"></div>

  <div id="mintForm">
    <button id="authorizeBtn" class="primary">${safeUserCode ? "Authorize device" : "Create connection token"}</button>
    <details class="advanced">
      <summary>
        Advanced options
        <span class="chev" aria-hidden="true"></span>
      </summary>
      <div class="advanced-body">
        <div class="field">
          <label for="label">Label (optional)</label>
          <input id="label" type="text" placeholder="e.g. Claude Code on my laptop" maxlength="120" />
        </div>
        <div class="field">
          <label for="ttl">Expires in (days, 1–365)</label>
          <input id="ttl" type="number" min="1" max="365" value="${DEFAULT_TOKEN_TTL_DAYS}" />
        </div>
      </div>
    </details>
  </div>

  <div id="result" class="result-panel hidden">
    <div class="result-title">Connection token created</div>
    <p class="result-copy" id="resultMsg">Paste this into your agent's MCP config. The token is shown only once.</p>
    <div class="section-label">MCP config</div>
    <pre id="mcpJson"></pre>
    <details class="advanced">
      <summary>
        Terminal alternative
        <span class="chev" aria-hidden="true"></span>
      </summary>
      <div class="advanced-body">
        <pre id="cliLine"></pre>
      </div>
    </details>
  </div>

  <details id="connections" class="connections">
    <summary>
      <span class="connections-title">Existing connections</span>
      <span id="connectionsState" class="connections-state">Checking</span>
      <span class="chev" aria-hidden="true"></span>
    </summary>
    <div id="tokenList" class="token-list"><div class="empty-state">Checking connections...</div></div>
  </details>
</div>
<script>
(function () {
  var BASE = ${JSON.stringify(joinAppPath(connectBasePath, "/_agent-native/mcp/connect"))};
  var USER_CODE = ${JSON.stringify(safeUserCode || null)};
  var msgEl = document.getElementById("msg");
  var connectionsEl = document.getElementById("connections");
  var connectionsStateEl = document.getElementById("connectionsState");
  function showMsg(text, kind) {
    msgEl.textContent = text;
    msgEl.className = "msg " + (kind || "err");
  }
  function clearMsg() { msgEl.className = "msg"; msgEl.textContent = ""; }

  function renderResult(data) {
    document.getElementById("mintForm").classList.add("hidden");
    var entry = {};
    entry[data.serverName] = data.mcpServerEntry;
    document.getElementById("mcpJson").textContent =
      JSON.stringify({ mcpServers: entry }, null, 2);
    document.getElementById("cliLine").textContent = data.cli;
    document.getElementById("result").classList.remove("hidden");
  }

  async function postJson(path, body) {
    var res = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body || {})
    });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data: data };
  }

  async function loadTokens() {
    var listEl = document.getElementById("tokenList");
    try {
      var res = await fetch(BASE + "/tokens", { credentials: "same-origin" });
      if (!res.ok) {
        connectionsStateEl.textContent = "Unavailable";
        connectionsEl.open = true;
        listEl.innerHTML = '<div class="empty-state">Could not load connections.</div>';
        return;
      }
      var data = await res.json();
      var tokens = (data && data.tokens) || [];
      if (!tokens.length) {
        connectionsStateEl.textContent = "None";
        connectionsEl.open = false;
        listEl.innerHTML = '<div class="empty-state">Created connections will appear here for revoking later.</div>';
        return;
      }
      var activeCount = tokens.filter(function (t) { return !t.revokedAt; }).length;
      connectionsStateEl.textContent = activeCount === 1 ? "1 active" : activeCount + " active";
      connectionsEl.open = true;
      listEl.innerHTML = "";
      tokens.forEach(function (t) {
        var div = document.createElement("div");
        div.className = "tok" + (t.revokedAt ? " revoked" : "");
        var when = t.createdAt ? new Date(t.createdAt).toLocaleString() : "";
        var used = t.lastUsedAt ? " · last used " + new Date(t.lastUsedAt).toLocaleString() : "";
        var left = document.createElement("div");
        var label = document.createElement("div");
        label.textContent = t.label || "(unlabeled)";
        var meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = (t.revokedAt ? "Revoked · " : "Created ") + when + used;
        left.appendChild(label); left.appendChild(meta);
        div.appendChild(left);
        if (!t.revokedAt) {
          var btn = document.createElement("button");
          btn.className = "ghost";
          btn.textContent = "Revoke";
          btn.onclick = async function () {
            btn.disabled = true;
            var r = await postJson("/tokens/revoke", { id: t.id });
            if (r.ok) { loadTokens(); }
            else { btn.disabled = false; showMsg("Could not revoke token."); }
          };
          div.appendChild(btn);
        }
        listEl.appendChild(div);
      });
    } catch (e) {
      connectionsStateEl.textContent = "Unavailable";
      connectionsEl.open = true;
      listEl.innerHTML = '<div class="empty-state">Could not load connections.</div>';
    }
  }

  document.getElementById("authorizeBtn").onclick = async function () {
    var btn = this;
    btn.disabled = true;
    clearMsg();
    var label = document.getElementById("label").value || undefined;
    var ttlDays = parseInt(document.getElementById("ttl").value, 10) || undefined;
    try {
      if (USER_CODE) {
        var a = await postJson("/device/authorize", { user_code: USER_CODE });
        if (!a.ok) {
          btn.disabled = false;
          showMsg((a.data && a.data.error) || "Could not authorize this device code.");
          return;
        }
        showMsg("Device authorized. Return to your terminal; it will connect automatically.", "ok");
        btn.classList.add("hidden");
        document.getElementById("mintForm").classList.add("hidden");
        document.getElementById("codeCallout").classList.add("hidden");
      } else {
        var m = await postJson("/token", { label: label, ttlDays: ttlDays });
        if (!m.ok) {
          btn.disabled = false;
          showMsg((m.data && m.data.error) || "Could not create token.");
          return;
        }
        renderResult(m.data);
      }
      loadTokens();
    } catch (e) {
      btn.disabled = false;
      showMsg("Network error. Please try again.");
    }
  };

  loadTokens();
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Handler — single entry point; core-routes-plugin dispatches the subpath.
// ---------------------------------------------------------------------------

/**
 * Handle a `/_agent-native/mcp/connect[...]` request. `subpath` is the part
 * after `/connect` (empty string = the page itself, otherwise e.g.
 * `/token`, `/device/start`). The core-routes-plugin computes it from the
 * stripped event path so this module stays mount-agnostic.
 */
export async function handleMcpConnect(
  event: H3Event,
  subpath: string,
  options: McpConnectRouteOptions = {},
): Promise<Response> {
  const method = getMethod(event);
  const origin = deriveOrigin(event);
  const basePath = configuredBasePath();
  const appUrl = `${origin}${basePath}`;
  const sub = ("/" + subpath.replace(/^\/+/, "").replace(/\/+$/, "")).replace(
    /^\/$/,
    "",
  );

  // ---- The connect page (GET) ------------------------------------------
  if (sub === "") {
    if (method !== "GET" && method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405);
    }
    const session = await getSession(event);
    if (!session?.email) {
      // Serve the SAME login form the guard would, at this same URL — the
      // login form reloads window.location so we re-enter here authed.
      const loginHtml = getConfiguredLoginHtml(event);
      if (loginHtml) return html(loginHtml, 200);
      // Fully-open app (no auth guard): nothing to scope a mint to.
      return html(
        renderConnectPage({
          origin: appUrl,
          connectBasePath: basePath,
          email: "(no auth configured)",
          appName: options.appName || appLabel(appUrl, options),
          userCode: null,
        }),
      );
    }
    let userCode: string | null = null;
    try {
      const u = new URL(
        event.node?.req?.url ?? event.path ?? "/",
        "http://an.invalid",
      );
      const raw = u.searchParams.get("user_code");
      if (raw && USER_CODE_RE.test(raw)) userCode = raw;
    } catch {
      userCode = null;
    }
    return html(
      renderConnectPage({
        origin: appUrl,
        connectBasePath: basePath,
        email: session.email,
        appName: options.appName || appLabel(appUrl, options),
        userCode,
      }),
    );
  }

  // ---- POST /token  (session-required) ---------------------------------
  if (sub === "/token") {
    if (method !== "POST") return json({ error: "Method not allowed" }, 405);
    const session = await getSession(event);
    if (!session?.email) return json({ error: "Unauthorized" }, 401);
    if (!process.env.A2A_SECRET) {
      return json(
        {
          error:
            "This deployment has no A2A_SECRET configured, so connect tokens cannot be minted.",
        },
        503,
      );
    }
    const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
      label?: unknown;
      ttlDays?: unknown;
    };
    const label =
      typeof body.label === "string" && body.label.trim()
        ? body.label.trim().slice(0, 120)
        : null;
    const ttlDays = clampTtlDays(body.ttlDays);
    try {
      const { token } = await mintConnectToken({
        email: session.email,
        orgId: session.orgId,
        label,
        ttlDays,
      });
      return json(mcpResultPayload(appUrl, token, options));
    } catch {
      return json({ error: "Failed to mint token." }, 500);
    }
  }

  // ---- POST /device/start  (UNAUTH) ------------------------------------
  if (sub === "/device/start") {
    if (method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const row = await createDeviceCode();
      const verificationUri = `${appUrl}/_agent-native/mcp/connect`;
      return json({
        device_code: row.deviceCode,
        user_code: row.userCode,
        verification_uri: verificationUri,
        verification_uri_complete: `${verificationUri}?user_code=${row.userCode}`,
        interval: DEVICE_POLL_INTERVAL_S,
        expires_in: Math.floor(DEVICE_CODE_TTL_MS / 1000),
      });
    } catch (err: any) {
      if (err?.message === "RATE_LIMITED") {
        return json({ error: "Rate limited. Try again shortly." }, 429);
      }
      return json({ error: "Could not start device flow." }, 500);
    }
  }

  // ---- POST /device/authorize  (session-required) ----------------------
  if (sub === "/device/authorize") {
    if (method !== "POST") return json({ error: "Method not allowed" }, 405);
    const session = await getSession(event);
    if (!session?.email) return json({ error: "Unauthorized" }, 401);
    const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
      user_code?: unknown;
    };
    const userCode =
      typeof body.user_code === "string" ? body.user_code.trim() : "";
    if (!USER_CODE_RE.test(userCode)) {
      return json({ error: "Invalid user code." }, 400);
    }
    const orgId =
      typeof session.orgId === "string" && session.orgId.trim()
        ? session.orgId.trim()
        : null;
    const result = await approveDeviceCode(userCode, session.email, orgId);
    if (result === "not_found") {
      return json({ error: "Unknown device code." }, 404);
    }
    if (result === "expired") {
      return json({ error: "This device code has expired." }, 410);
    }
    if (result === "already") {
      return json({ error: "This device code was already used." }, 409);
    }
    return json({ status: "approved" });
  }

  // ---- POST /device/poll  (UNAUTH) -------------------------------------
  if (sub === "/device/poll") {
    if (method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
      device_code?: unknown;
    };
    const deviceCode =
      typeof body.device_code === "string" ? body.device_code : "";
    if (!deviceCode) return json({ error: "device_code required" }, 400);
    const row = await getDeviceCode(deviceCode);
    if (!row) return json({ status: "not_found" }, 404);
    if (row.status === "consumed") return json({ status: "consumed" });
    if (
      row.status === "expired" ||
      (row.expiresAt != null && row.expiresAt < Date.now())
    ) {
      if (row.status !== "expired") void expireDeviceCode(deviceCode);
      return json({ status: "expired" });
    }
    if (
      row.status === "pending" ||
      row.status === "minting" ||
      !row.ownerEmail
    ) {
      return json({ status: "pending" });
    }
    // status === "approved" && ownerEmail bound → mint exactly once.
    if (!process.env.A2A_SECRET) {
      return json({ status: "error", error: "A2A_SECRET not configured" }, 503);
    }
    try {
      const jti = randomUUID();
      // Claim a retryable minting state first. If signing or recording fails,
      // release the row back to approved so the CLI can poll again.
      const claimed = await claimDeviceCodeForMint(deviceCode, jti);
      if (!claimed) {
        const fresh = await getDeviceCode(deviceCode);
        if (fresh?.status === "consumed") return json({ status: "consumed" });
        return json({ status: "pending" });
      }
      let token: string;
      try {
        const orgDomain = await resolveOrgDomain(claimed.orgId ?? undefined);
        token = await signA2AToken(claimed.ownerEmail!, orgDomain, undefined, {
          preferGlobalSecret: true,
          expiresIn: `${DEFAULT_TOKEN_TTL_DAYS}d`,
          extraClaims: { jti, scope: MCP_CONNECT_SCOPE },
        });
        await recordMintedToken({
          jti,
          ownerEmail: claimed.ownerEmail!,
          orgId: claimed.orgId,
          label: "Device connection",
        });
        if (!(await finishDeviceCodeMint(deviceCode, jti))) {
          return json({ status: "pending" });
        }
      } catch (err) {
        await releaseDeviceCodeMint(deviceCode, jti);
        throw err;
      }
      return json({
        status: "approved",
        ...mcpResultPayload(appUrl, token, options),
      });
    } catch {
      return json({ status: "error", error: "Failed to mint token." }, 500);
    }
  }

  // ---- GET /tokens  (session-required) ---------------------------------
  if (sub === "/tokens") {
    if (method !== "GET") return json({ error: "Method not allowed" }, 405);
    const session = await getSession(event);
    if (!session?.email) return json({ error: "Unauthorized" }, 401);
    const rows = await listTokens(session.email);
    return json({
      tokens: rows.map((r) => ({
        id: r.id,
        label: r.label,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt,
      })),
    });
  }

  // ---- POST /tokens/revoke  (session-required) -------------------------
  if (sub === "/tokens/revoke") {
    if (method !== "POST") return json({ error: "Method not allowed" }, 405);
    const session = await getSession(event);
    if (!session?.email) return json({ error: "Unauthorized" }, 401);
    const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
      id?: unknown;
    };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return json({ error: "id required" }, 400);
    const revoked = await revokeToken(session.email, id);
    return json({ ok: revoked });
  }

  return json({ error: "Not found" }, 404);
}
