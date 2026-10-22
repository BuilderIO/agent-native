import type { H3Event } from "h3";
import {
  defineEventHandler,
  getMethod,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import type { ActionEntry } from "../agent/production-agent.js";
import { isProductionServerlessFunctionRuntime } from "../db/client.js";
import { registerRecurringSweepHandler } from "../jobs/sweep-hooks.js";
import {
  mcpApprovalMessagesForLocale,
  type McpApprovalMessages,
} from "../localization/mcp-approval-messages.js";
import { resolveLocaleFromRequest } from "../localization/server.js";
import {
  DEFAULT_LOCALE,
  LOCALIZATION_SETTING_KEY,
  localeDirection,
  normalizeLocalizationPreference,
  type LocaleCode,
  type ResolvedLocalizationPreference,
} from "../localization/shared.js";
import {
  getBrowserCookieSession,
  getConfiguredLoginHtml,
} from "../server/auth.js";
import { toAbsoluteOpenUrl } from "../server/deep-link.js";
import { getH3App } from "../server/framework-request-handler.js";
import { publicFrameworkPath } from "../server/framework-route-prefix.js";
import { readBody } from "../server/h3-helpers.js";
import { startIntervalJob } from "../server/interval-job.js";
import { declaredLinkOrigin } from "../server/origin-allowlist.js";
import { getUserSetting } from "../settings/user-settings.js";
import {
  decideMcpApproval,
  getMcpApprovalForOwner,
  isMcpApprovalInOtherOrganization,
  normalizeApprovalEmail,
  pruneMcpApprovalGrants,
  type McpApprovalReader,
  type McpApprovalRecord,
} from "./approval-store.js";
import {
  describeWallTime,
  mcpApprovalPromptText,
  summarizeMcpApproval,
  type McpApprovalSummary,
} from "./approval-summary.js";
import {
  findPriorApprovedRun,
  MCP_ACTION_APPROVAL_TTL_SECONDS,
  type McpApprovalPriorRun,
  type McpApprovalReview,
} from "./execute-action-call.js";
import { isUrlBasedOAuthClientId } from "./oauth-client-metadata.js";
import { getOAuthClientConnection } from "./oauth-store.js";

/**
 * The page where a person approves or denies an MCP action call their agent
 * could not get approved in its own client. The id in the URL is a lookup
 * handle, not a credential: every read and decision requires the browser
 * session cookie of the user the call would run as, in the same app and
 * organization, and a decision also requires a same-origin JSON POST carrying
 * a token minted for that session. Approving never runs anything; it lets the
 * identical call, from the same MCP caller, run once when the agent retries
 * it.
 */

export const MCP_APPROVAL_ROUTE = "/_agent-native/mcp/approvals";

/** The app whose grants a mounted review page reads and decides. */
export interface McpApprovalApp {
  appId: string;
  actions: Record<string, ActionEntry>;
}

const TTL_MS = MCP_ACTION_APPROVAL_TTL_SECONDS * 1000;
const GRANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The review page for one grant, absolute when an origin is known: the
 * request's, if the app declares it or declares none.
 */
export function mcpApprovalReviewUrl(
  nonce: string,
  requestOrigin: string | undefined,
): string {
  return toAbsoluteOpenUrl(
    publicFrameworkPath(`${MCP_APPROVAL_ROUTE}/${encodeURIComponent(nonce)}`),
    declaredLinkOrigin(requestOrigin),
  );
}

/** What the page shows, as JSON for an in-app review surface. */
export type McpApprovalViewState =
  | "pending"
  | "approved"
  | "used"
  | "denied"
  | "closed"
  | "expired";

/**
 * The connection that made the call. `name` is the one the client gave
 * itself (or, for a client identified by URL, that URL's host), so it is
 * shown with when this user connected it: a name alone can be copied.
 */
export interface McpApprovalRequester {
  name: string | null;
  connectedAt: number | null;
}

export interface McpApprovalView {
  id: string;
  state: McpApprovalViewState;
  actionName: string;
  summary: McpApprovalSummary;
  requester: McpApprovalRequester | undefined;
  createdAt: number | null;
  expiresAt: number;
  priorRun: McpApprovalPriorRun | undefined;
  /** The reader's chosen time zone; null means the device's own. */
  readerTimeZone: string | null;
  /** Present while a decision can be made; sent back with it. */
  csrfToken?: string;
}

export function mcpApprovalViewState(
  record: McpApprovalRecord,
  now: number,
): McpApprovalViewState {
  if (record.status === "denied") return "denied";
  if (record.status === "declined") return "closed";
  if (record.consumedAt !== null) return "used";
  if (record.expiresAt < now) return "expired";
  return record.status === "approved" ? "approved" : "pending";
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function decisionToken(
  nonce: string,
  reader: McpApprovalReader,
): Promise<string> {
  const { getAuthSecret } = await import("../server/better-auth-instance.js");
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `mcp-approval-decision\0${reader.appId}\0${nonce}\0${normalizeApprovalEmail(reader.email)}\0${reader.orgId ?? ""}`,
    ),
  );
  return base64Url(signature);
}

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

async function readerPreference(
  email: string | undefined,
): Promise<ResolvedLocalizationPreference | undefined> {
  return email
    ? normalizeLocalizationPreference(
        await getUserSetting(email, LOCALIZATION_SETTING_KEY),
      )
    : undefined;
}

function readerTimeZone(
  preference: ResolvedLocalizationPreference | undefined,
): string | undefined {
  const zone = preference?.timezone;
  return zone && zone !== "system" ? zone : undefined;
}

async function requesterFor(
  record: McpApprovalRecord,
  email: string,
): Promise<McpApprovalRequester | undefined> {
  const clientId = record.oauthClientId;
  if (!clientId) return undefined;
  const connection = await getOAuthClientConnection(clientId, email);
  let name = connection.clientName;
  if (isUrlBasedOAuthClientId(clientId)) {
    try {
      name = new URL(clientId).host || name;
    } catch {
      // coercion-ok: an unparseable URL client id keeps its registered name.
    }
  }
  return { name, connectedAt: connection.connectedAt };
}

async function buildView(
  record: McpApprovalRecord,
  reader: McpApprovalReader,
  entry: ActionEntry | undefined,
  messages: McpApprovalMessages,
  preference: ResolvedLocalizationPreference | undefined,
): Promise<McpApprovalView> {
  const now = Date.now();
  const state = mcpApprovalViewState(record, now);
  return {
    id: record.nonce,
    state,
    actionName: record.actionName,
    summary: summarizeMcpApproval({
      entry,
      actionName: record.actionName,
      argumentsJson: record.argumentsJson,
      labels: messages,
    }),
    requester: await requesterFor(record, reader.email),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    priorRun:
      state === "pending"
        ? await findPriorApprovedRun(record, record.retrySafe)
        : undefined,
    readerTimeZone: readerTimeZone(preference) ?? null,
    ...(state === "pending"
      ? { csrfToken: await decisionToken(record.nonce, reader) }
      : {}),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type TimeStyle = "time" | "date-time" | "date";

/**
 * A time the page script rewrites into the reader's zone. With `zone`, the
 * call's own zone, it adds the time as the call wrote it when that differs.
 */
function timeElement(
  at: number,
  style: TimeStyle = "time",
  zone?: string,
  fallback?: string,
): string {
  const iso = new Date(at).toISOString();
  return `<time data-ts="${at}" data-style="${style}"${
    zone ? ` data-zone="${escapeHtml(zone)}"` : ""
  } datetime="${iso}">${escapeHtml(fallback ?? iso)}</time>`;
}

/** Escapes a message, then puts the reader-local time where `{time}` was. */
function messageHtml(
  message: string,
  at?: number,
  style?: TimeStyle,
  client?: string,
): string {
  let escaped = escapeHtml(message);
  if (client !== undefined) {
    escaped = escaped.replace("{client}", escapeHtml(client));
  }
  return at === undefined
    ? escaped
    : escaped.replace("{time}", timeElement(at, style));
}

function stateMessage(
  view: Pick<McpApprovalView, "state" | "expiresAt">,
  messages: McpApprovalMessages,
): string {
  switch (view.state) {
    case "approved":
      return messageHtml(messages.approved, view.expiresAt);
    case "used":
      return messageHtml(messages.used);
    case "denied":
      return messageHtml(messages.denied);
    case "closed":
      return messageHtml(messages.closed);
    case "expired":
      return messageHtml(messages.expired);
    case "pending":
      return "";
  }
}

const PAGE_STYLE = `
:root{color-scheme:light dark;font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
body{margin:0;background:Canvas;color:CanvasText}
main{max-width:640px;margin:8vh auto;padding:0 20px}
h1{font-size:22px;line-height:1.3;margin:0 0 16px}
h2{font-size:13px;font-weight:600;margin:20px 0 6px;color:GrayText}
ul{margin:0;padding:0;list-style:none}
li{font-weight:600}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:20px 0}
dt{color:GrayText}
dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
details{margin:20px 0}
summary{cursor:pointer;color:GrayText}
pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid GrayText;border-radius:8px;padding:12px;max-height:40vh;overflow:auto;font-size:13px}
.warn{background:Mark;color:MarkText;border-radius:8px;padding:10px 12px;margin:0 0 16px}
.muted{color:GrayText}
.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
button{font:inherit;font-weight:600;border-radius:8px;padding:9px 18px;cursor:pointer;border:1px solid GrayText;background:Canvas;color:CanvasText}
button.primary{background:CanvasText;color:Canvas;border-color:CanvasText}
button[disabled]{opacity:.5;cursor:default}
#result{margin-top:20px;font-weight:600}
`;

function renderPage(input: {
  view: McpApprovalView | undefined;
  /** Why there's no view: the grant is the reader's, from another organization. */
  otherOrganization: boolean;
  email: string;
  locale: LocaleCode;
  messages: McpApprovalMessages;
  scriptNonce: string;
}): string {
  const { view, otherOrganization, email, locale, messages, scriptNonce } =
    input;
  const head = (title?: string) =>
    `<!doctype html><html lang="${escapeHtml(locale)}" dir="${localeDirection(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="referrer" content="no-referrer">${title === undefined ? "" : `<title>${escapeHtml(title)}</title>`}<style>${PAGE_STYLE}</style></head>`;
  if (!view) {
    const message = otherOrganization
      ? messages.otherOrganization
      : messages.notFound;
    return `${head()}<body><main><p>${escapeHtml(message.replace("{email}", email))}</p></main></body></html>`;
  }
  const { summary } = view;
  const pending = view.state === "pending";
  // A final or expired grant keeps no arguments, so there are none to show.
  const live = pending || view.state === "approved";
  const prior = view.priorRun
    ? `<p class="warn" role="alert">${messageHtml(
        view.priorRun.status === "completed"
          ? messages.priorCompleted
          : messages.priorUnknown,
        view.priorRun.at,
      )}</p>`
    : "";
  const cut =
    live && summary.cut
      ? `<p class="warn" role="alert">${escapeHtml(messages.argumentsCut)}</p>`
      : "";
  const recipients =
    summary.recipients.length > 0
      ? `<h2>${escapeHtml(messages.reaches)}</h2><ul>${summary.recipients
          .map((recipient) => `<li>${escapeHtml(recipient)}</li>`)
          .join("")}</ul>`
      : "";
  const requester = view.requester
    ? `<dt>${escapeHtml(messages.requestedThrough)}</dt><dd>${
        view.requester.connectedAt === null
          ? escapeHtml(view.requester.name ?? messages.unnamedClient)
          : messageHtml(
              messages.connectedClient,
              view.requester.connectedAt,
              "date",
              view.requester.name ?? messages.unnamedClient,
            )
      }</dd>`
    : "";
  const rows = summary.fields
    .map(
      (field) =>
        `<dt>${escapeHtml(field.label)}</dt><dd>${
          field.time
            ? timeElement(
                field.time.at,
                "date-time",
                field.time.zone,
                field.value,
              )
            : field.wallTime
              ? escapeHtml(describeWallTime(field.wallTime, locale, messages))
              : escapeHtml(field.value)
        }</dd>`,
    )
    .join("");
  const fields = requester || rows ? `<dl>${requester}${rows}</dl>` : "";
  const details = !live
    ? ""
    : summary.arguments === "stored"
      ? `<details><summary>${escapeHtml(messages.details)}</summary><pre>${escapeHtml(summary.details ?? "")}</pre></details>`
      : `<p class="muted">${escapeHtml(
          summary.arguments === "not-stored"
            ? messages.argumentsNotStored
            : messages.argumentsUnreadable,
        )}</p>`;
  const decision = pending
    ? `<p class="muted" id="deadline">${messageHtml(messages.decideBy, view.expiresAt)}</p><div class="actions" id="actions"><button type="button" id="deny">${escapeHtml(messages.deny)}</button><button type="button" class="primary" id="approve">${escapeHtml(messages.approve)}</button></div>`
    : "";
  // `<` escaped so no stored value can close the script element.
  const data = JSON.stringify({
    locale,
    timeZone: view.readerTimeZone,
    csrfToken: view.csrfToken,
    messages: {
      requestedAs: messages.requestedAs,
      approved: messages.approved,
      used: messages.used,
      denied: messages.denied,
      closed: messages.closed,
      expired: messages.expired,
      saving: messages.saving,
      saveFailed: messages.saveFailed,
    },
  }).replace(/</g, "\\u003c");
  return `${head(messages.documentTitle.replace("{action}", summary.title))}<body><main><h1>${escapeHtml(summary.title)}</h1>${prior}${cut}${recipients}${fields}${details}${decision}<p id="result" role="status">${stateMessage(view, messages)}</p></main><script type="application/json" id="approval-data">${data}</script><script nonce="${scriptNonce}">${PAGE_SCRIPT}</script></body></html>`;
}

const PAGE_SCRIPT = `(function(){
var data=JSON.parse(document.getElementById("approval-data").textContent);
var readerZone=data.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
var FIXED=/^([+-])(\\d{2}):?(\\d{2})$/;
var STYLES={time:{hour:"numeric",minute:"2-digit"},"date-time":{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"},date:{year:"numeric",month:"short",day:"numeric"}};
function offset(at,zone){var m=FIXED.exec(zone);if(m){var v=Number(m[2])*60+Number(m[3]);return m[1]==="-"?-v:v;}if(zone==="UTC")return 0;var p=new Intl.DateTimeFormat("en-US",{timeZone:zone,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric"}).formatToParts(new Date(at));function g(t){for(var i=0;i<p.length;i++)if(p[i].type===t)return Number(p[i].value);return 0;}return Math.round((Date.UTC(g("year"),g("month")-1,g("day"),g("hour")%24,g("minute"),g("second"))-Math.floor(at/1000)*1000)/60000);}
function utcLabel(min){if(min===0)return "UTC";var a=Math.abs(min);return "UTC"+(min<0?"-":"+")+String(Math.floor(a/60)).padStart(2,"0")+":"+String(a%60).padStart(2,"0");}
function fmt(at,zone,style){var o=Object.assign({},STYLES[style]||STYLES.time);if(FIXED.test(zone)){o.timeZone="UTC";var m=offset(at,zone);var t=new Intl.DateTimeFormat(data.locale,o).format(new Date(at+m*60000));return style==="date"?t:t+" "+utcLabel(m);}o.timeZone=zone;if(style!=="date")o.timeZoneName="short";return new Intl.DateTimeFormat(data.locale,o).format(new Date(at));}
function localize(root){root.querySelectorAll("time[data-ts]").forEach(function(el){var at=Number(el.getAttribute("data-ts"));var style=el.getAttribute("data-style")||"time";var zone=el.getAttribute("data-zone");var text=fmt(at,readerZone,style);if(zone&&offset(at,zone)!==offset(at,readerZone))text+=" ("+data.messages.requestedAs.replace("{time}",fmt(at,zone,style))+")";el.textContent=text;});}
localize(document);
var result=document.getElementById("result");
var actions=document.getElementById("actions");
var deadline=document.getElementById("deadline");
function show(state,expiresAt){
var message=data.messages[state];
if(!message)return false;
if(actions)actions.remove();
if(deadline)deadline.remove();
var parts=message.split("{time}");
result.textContent=parts[0];
if(parts.length>1){var t=document.createElement("time");t.setAttribute("data-ts",String(expiresAt));result.appendChild(t);result.appendChild(document.createTextNode(parts.slice(1).join("{time}")));localize(result);}
return true;
}
function setBusy(busy){if(!actions)return;actions.querySelectorAll("button").forEach(function(b){b.disabled=busy;});}
function decide(decision){
setBusy(true);
result.textContent=data.messages.saving;
fetch(location.pathname,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({decision:decision,csrfToken:data.csrfToken})})
.then(function(r){return r.json();})
.then(function(body){if(!(body&&show(body.state,body.expiresAt))){result.textContent=data.messages.saveFailed;setBusy(false);}})
.catch(function(){result.textContent=data.messages.saveFailed;setBusy(false);});
}
var approve=document.getElementById("approve");
var deny=document.getElementById("deny");
if(approve)approve.addEventListener("click",function(){decide("approve");});
if(deny)deny.addEventListener("click",function(){decide("deny");});
})();`;

function setPageHeaders(event: H3Event, scriptNonce?: string) {
  setResponseHeader(event, "cache-control", "no-store");
  setResponseHeader(event, "x-frame-options", "DENY");
  setResponseHeader(event, "referrer-policy", "no-referrer");
  setResponseHeader(event, "x-content-type-options", "nosniff");
  setResponseHeader(
    event,
    "content-security-policy",
    scriptNonce
      ? `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
      : "frame-ancestors 'none'",
  );
}

// CSRF protection for the page's own requests. Any client can send this
// header; it only shows a browser didn't send the request for another site.
function isSameOriginFetch(event: H3Event): boolean {
  return getRequestHeader(event, "sec-fetch-site") === "same-origin";
}

function wantsJson(event: H3Event): boolean {
  const accept = getRequestHeader(event, "accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

function grantIdFrom(event: H3Event): string | undefined {
  // A grant id is a UUID, so it never needs percent-decoding.
  const segment = (event.path || "").split("?")[0].replace(/^\/+/, "");
  return GRANT_ID.test(segment) ? segment : undefined;
}

export async function handleMcpApprovalRequest(
  event: H3Event,
  app: McpApprovalApp,
): Promise<unknown> {
  const method = getMethod(event);
  if (method !== "GET" && method !== "POST") {
    setResponseStatus(event, 405);
    setResponseHeader(event, "allow", "GET, POST");
    return { error: "Method not allowed" };
  }
  // The HTML page opens from a link in another app; its data and decisions
  // only go to the page itself.
  if ((method === "POST" || wantsJson(event)) && !isSameOriginFetch(event)) {
    setPageHeaders(event);
    setResponseStatus(event, 403);
    return { error: "Cross-origin request denied" };
  }
  const id = grantIdFrom(event);
  const session = await getBrowserCookieSession(event);
  if (!session?.email) {
    if (method === "GET" && !wantsJson(event)) {
      const loginPage = getConfiguredLoginHtml(event);
      if (loginPage) {
        setPageHeaders(event);
        return new Response(loginPage.html, {
          status: loginPage.status,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    }
    setResponseStatus(event, 401);
    return { error: "Sign in to review this request" };
  }
  const owner: McpApprovalReader = {
    appId: app.appId,
    email: session.email,
    orgId: session.orgId ?? null,
  };
  const record = id ? await getMcpApprovalForOwner(id, owner) : null;
  const preference = await readerPreference(owner.email);
  const { locale } = resolveLocaleFromRequest({
    preference,
    acceptLanguage: getRequestHeader(event, "accept-language"),
  });
  const messages = mcpApprovalMessagesForLocale(locale);
  const entry = record ? app.actions[record.actionName] : undefined;

  if (method === "GET") {
    const view = record
      ? await buildView(record, owner, entry, messages, preference)
      : undefined;
    const otherOrganization =
      !view && id ? await isMcpApprovalInOtherOrganization(id, owner) : false;
    if (wantsJson(event)) {
      setPageHeaders(event);
      if (!view) {
        setResponseStatus(event, 404);
        return {
          error: "Approval not found",
          ...(otherOrganization ? { reason: "other-organization" } : {}),
        };
      }
      return view;
    }
    const scriptNonce = base64Url(
      globalThis.crypto.getRandomValues(new Uint8Array(16)).buffer,
    );
    setPageHeaders(event, scriptNonce);
    setResponseHeader(event, "content-type", "text/html; charset=utf-8");
    if (!view) setResponseStatus(event, 404);
    return renderPage({
      view,
      otherOrganization,
      email: owner.email,
      locale,
      messages,
      scriptNonce,
    });
  }

  setPageHeaders(event);
  const contentType = getRequestHeader(event, "content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    setResponseStatus(event, 415);
    return { error: "Send the decision as JSON" };
  }
  const body = await readBody<Record<string, unknown> | undefined>(event);
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "deny") {
    setResponseStatus(event, 400);
    return { error: 'decision must be "approve" or "deny"' };
  }
  if (!id || !record) {
    setResponseStatus(event, 404);
    return { error: "Approval not found" };
  }
  const expected = await decisionToken(id, owner);
  const csrfToken = body?.csrfToken;
  if (typeof csrfToken !== "string" || !sameToken(csrfToken, expected)) {
    setResponseStatus(event, 403);
    return { error: "This page is out of date. Reload it and decide again." };
  }
  const approvedUntil = Date.now() + TTL_MS;
  const decided = await decideMcpApproval(id, owner, decision, approvedUntil);
  if (!decided) {
    const current = await getMcpApprovalForOwner(id, owner);
    setResponseStatus(event, current ? 409 : 404);
    return current
      ? {
          error: "This request was already decided or has expired.",
          state: mcpApprovalViewState(current, Date.now()),
          expiresAt: current.expiresAt,
        }
      : { error: "Approval not found" };
  }
  return decision === "approve"
    ? { state: "approved", expiresAt: approvedUntil }
    : { state: "denied", expiresAt: record.expiresAt };
}

/**
 * The in-client approval prompt for a grant: the review page's summary, as
 * text, in the owner's language and time zone.
 */
export async function mcpApprovalPrompt(input: {
  entry: ActionEntry | undefined;
  review: McpApprovalReview;
  ownerEmail: string | undefined;
  mode: "form" | "url";
  requestOrigin: string | undefined;
}): Promise<{ message: string; decisionTitle: string; decisionHelp: string }> {
  const preference = await readerPreference(input.ownerEmail);
  const { locale } = resolveLocaleFromRequest({
    preference,
    fallback: DEFAULT_LOCALE,
  });
  const messages = mcpApprovalMessagesForLocale(locale);
  const summary = summarizeMcpApproval({
    entry: input.entry,
    actionName: input.review.actionName,
    argumentsJson: input.review.argumentsJson,
    labels: messages,
  });
  return {
    message: mcpApprovalPromptText({
      summary,
      priorRun: input.review.priorRun,
      messages,
      locale,
      readerZone: readerTimeZone(preference),
      mode: input.mode,
      reviewUrl: mcpApprovalReviewUrl(input.review.nonce, input.requestOrigin),
    }),
    decisionTitle: messages.decisionTitle.replace("{action}", summary.title),
    decisionHelp: messages.decisionHelp,
  };
}

export const MCP_APPROVAL_PRUNE_SWEEP_ID = "mcp-approval-grants";

let pruneWorkerStarted = false;

// Sweep handlers run only from the platform's sweep route, which nothing
// calls on a long-lived server, so that server prunes on its own timer.
function startPruneWorker(): void {
  if (pruneWorkerStarted || isProductionServerlessFunctionRuntime()) return;
  pruneWorkerStarted = true;
  startIntervalJob(() => pruneMcpApprovalGrants(), {
    intervalMs: TTL_MS,
    leading: false,
    onError: (error) =>
      console.error("[mcp-approvals] Pruning approval grants failed:", error),
  });
}

export function mountMcpApprovalRoute(
  nitroApp: any,
  app: McpApprovalApp,
  routePrefix = "/_agent-native",
): void {
  getH3App(nitroApp).use(
    `${routePrefix}/mcp/approvals`,
    defineEventHandler((event) =>
      handleMcpApprovalRequest(event as H3Event, app),
    ),
  );
  registerRecurringSweepHandler(MCP_APPROVAL_PRUNE_SWEEP_ID, () =>
    pruneMcpApprovalGrants(),
  );
  startPruneWorker();
}
