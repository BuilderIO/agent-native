import { decodeHTML } from "entities/decode";

import { isMcpReadOnlyTool } from "../action-call-classification.js";
import {
  isActionContractError,
  runActionInvocation,
  runOutsideActionInvocation,
  type ActionRunContext,
} from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  type McpActionResult,
  isMcpActionResult,
} from "../mcp-client/app-result.js";
import {
  assertServicePrincipalMayCall,
  assertServicePrincipalMayRun,
  recordServicePrincipalDenial,
  ServicePrincipalRefusedError,
} from "../org/service-principal-guard.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  consumeMcpApprovalGrant,
  createMcpApprovalGrant,
} from "./approval-store.js";
import type { MCPCallerIdentity } from "./build-server.js";
import { MCP_OAUTH_SCOPES, hasMcpOAuthScope } from "./oauth-token.js";

/**
 * The authorization, approval, execution and result-sanitizing steps of an
 * MCP action call, with no MCP request or response object. The direct
 * `tools/call` adapter in `build-server.ts` turns an outcome into a wire
 * result; anything else that runs actions for an MCP caller goes through
 * `executeMcpActionCall` so it gets the same scope, approval and redaction.
 */

export const MCP_ACTION_APPROVAL_TTL_SECONDS = 10 * 60;

export interface McpActionApprovalState {
  version: 1;
  nonce: string;
  actionName: string;
  argumentsHash: string;
  expiresAt: number;
}

export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("MCP action arguments must contain finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("MCP action arguments must be JSON values");
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

export function isActionVisibleForOAuthScope(
  entry: ActionEntry,
  scopes: string[] | undefined,
  readOnlyOverride = false,
): boolean {
  if (!scopes) return true;
  const required: McpOAuthScope =
    isMcpReadOnlyTool(entry) || readOnlyOverride ? "mcp:read" : "mcp:write";
  return hasMcpOAuthScope(scopes, required);
}

export function isEmbedStartUrl(value: string): boolean {
  try {
    const base = "http://agent-native.invalid";
    const url = value.startsWith("/") ? new URL(value, base) : new URL(value);
    return url.pathname.includes("/_agent-native/embed/start");
  } catch {
    return value.includes("/_agent-native/embed/start");
  }
}

/** The embed start route's last two segments, letters only. */
const EMBED_START_LETTERS = "embedstart";
const MAX_DECODE_ROUNDS = 8;

const PERCENT_ESCAPE = /%([0-9a-f]{2})/gi;
// Every JavaScript string escape, which covers every JSON one. A `\u` or `\x`
// without its hex digits is not an escape, and stays for a later layer.
const STRING_ESCAPE =
  /\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([0-3][0-7]{0,2}|[4-7][0-7]?)|([^ux]))/gi;
const SINGLE_CHARACTER_ESCAPES: Record<string, string> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};
const LINE_SEPARATOR = /^[\p{Zl}\p{Zp}]$/u;

/**
 * Removes one layer of escaping. Decoding a percent or HTML escape never takes
 * away a character a path reads, so those go first. Decoding a JavaScript
 * escape can take away a backslash a path reads as a slash, so a JavaScript
 * layer goes only once nothing else is left, after the text has been read
 * with it in place.
 */
function decodeOnce(text: string): string {
  const revealed = decodeHTML(
    text.replace(PERCENT_ESCAPE, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    ),
  );
  if (revealed !== text) return revealed;
  return text.replace(
    STRING_ESCAPE,
    (match, braced, unicode, hex, octal, single: string | undefined) => {
      if (single !== undefined) {
        if (LINE_SEPARATOR.test(single)) return "";
        return SINGLE_CHARACTER_ESCAPES[single] ?? single;
      }
      const code =
        octal !== undefined
          ? Number.parseInt(octal, 8)
          : Number.parseInt(braced ?? unicode ?? hex, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

// What is left of an escape once decoding stops: an HTML reference or a
// backslash escape that no decoder above reads.
const UNREAD_ESCAPE =
  /&[a-z0-9#]+;|\\(?:u\{[0-9a-f]*\}|u[0-9a-f]{4}|x[0-9a-f]{2}|[0-7]{1,3}|[\s\S])/g;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;
const DOT_SEGMENT = /^(?:\.|%2e)$/i;
const DOUBLE_DOT_SEGMENT = /^(?:\.|%2e){2}$/i;

/** The path a browser resolves from each run of `text` up to a `?` or `#`. */
function resolvedPaths(text: string): string {
  return text
    .split(/[?#]/)
    .map((run) => {
      const resolved: string[] = [];
      for (const segment of run.replace(/\\/g, "/").split("/")) {
        if (DOUBLE_DOT_SEGMENT.test(segment)) resolved.pop();
        else if (!DOT_SEGMENT.test(segment)) resolved.push(segment);
      }
      return resolved.join("/");
    })
    .join("?");
}

/**
 * The letters and digits of `text`, as written and with its paths resolved,
 * each read two ways. The exact reading only folds case, so its paths resolve
 * as a browser's do. The loose reading also folds compatibility forms such as
 * full-width letters and drops every escape still in the text, so an escape
 * nothing here decodes cannot keep the letters on either side of it apart.
 */
function readings(text: string): string[] {
  const exact = text.toLowerCase();
  const loose = text.normalize("NFKC").toLowerCase().replace(UNREAD_ESCAPE, "");
  return (loose === exact ? [exact] : [exact, loose])
    .flatMap((variant) =>
      // Resolving changes a path's letters only through `..` or `%2e`.
      /\.\.|%2e/.test(variant) ? [variant, resolvedPaths(variant)] : [variant],
    )
    .map((reading) => reading.replace(NOT_LETTER_OR_DIGIT, ""));
}

/**
 * The sanitized path's credential test: whether `embed/start` can be read
 * anywhere in a string, under any layering of percent, JavaScript string and
 * HTML escaping. It is loose on purpose. Any string whose letters run
 * `embedstart` counts, prose about an embed start included, because a missed
 * credential costs more than a hidden sentence.
 */
function mentionsEmbedStartRoute(text: string): boolean {
  let current = text;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    // A URL parser drops these anywhere in a URL before reading anything else.
    current = current.replace(/[\t\n\r]/g, "");
    if (
      readings(current).some((reading) => reading.includes(EMBED_START_LETTERS))
    ) {
      return true;
    }
    const decoded = decodeOnce(current);
    if (decoded === current) return false;
    current = decoded;
  }
  // Escaped more deeply than any real nesting: treated as carrying a
  // credential rather than passed through unread.
  return true;
}

/**
 * Recursively redact embed-ticket-bearing URLs from any value before it gets
 * serialized into a model-visible text payload. Embed start URLs carry a
 * single-use ticket that grants iframe access to the user's session — they
 * MUST stay in `_meta` (where the embed runtime can consume them) and never
 * appear in `content[].text` for the LLM. This is the generic safety net for
 * actions that return `{ embedStartUrl, ... }` without declaring
 * `mcpApp.resource` (the resource path already strips them via
 * `mcpAppStructuredContent`).
 *
 * Circular structures are replaced with a marker. Strings that embed an
 * `isEmbedStartUrl` substring (e.g. a longer message that includes the URL)
 * are replaced with `[hidden embed URL]`. Credential-like `ticket` fields are
 * removed only inside an embed-signaled object/branch, so ordinary business
 * fields from unrelated read actions remain faithful.
 */
const EMBED_RESULT_SENSITIVE_KEYS = new Set([
  "embedTargetPath",
  "embedExpiresAt",
  "embedTicket",
]);

function isEmbedCredentialKey(key: string): boolean {
  return key === "ticket" || /Ticket$/.test(key);
}

function containsEmbedRoutingSignal(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") return isEmbedStartUrl(value);
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.some((item) => containsEmbedRoutingSignal(item, seen));
    seen.delete(value);
    return result;
  }
  for (const [key, val] of Object.entries(value)) {
    if (EMBED_RESULT_SENSITIVE_KEYS.has(key)) {
      seen.delete(value);
      return true;
    }
    if (containsEmbedRoutingSignal(val, seen)) {
      seen.delete(value);
      return true;
    }
  }
  seen.delete(value);
  return false;
}

export function purgeEmbedStartUrls(
  value: unknown,
  seen = new WeakSet<object>(),
  embedContext = false,
): unknown {
  if (typeof value === "string") {
    return isEmbedStartUrl(value) ? "[hidden embed URL]" : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular result]";
    seen.add(value);
    // An embed marker in one array item puts the whole result in the embed
    // routing context. Credential fields in sibling items must not survive
    // just because the marker lives elsewhere in the array.
    const arrayEmbedContext = embedContext || containsEmbedRoutingSignal(value);
    const out = value.map((item) =>
      purgeEmbedStartUrls(item, seen, arrayEmbedContext),
    );
    seen.delete(value);
    return out;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[circular result]";
    seen.add(value);
    const entries = Object.entries(value as Record<string, unknown>);
    const localEmbedContext = embedContext || containsEmbedRoutingSignal(value);
    const out: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      if (
        EMBED_RESULT_SENSITIVE_KEYS.has(key) ||
        (localEmbedContext && isEmbedCredentialKey(key))
      ) {
        continue;
      }
      if (typeof val === "string" && isEmbedStartUrl(val)) {
        continue;
      }
      out[key] = purgeEmbedStartUrls(val, seen, localEmbedContext);
    }
    seen.delete(value);
    return out;
  }
  return value;
}

/**
 * The sanitized path's redaction. It reads the fresh JSON tree `toJsonData`
 * returns, which has no cycles or shared nodes. Unlike `purgeEmbedStartUrls`,
 * it finds the embed start route anywhere in a string
 * (`mentionsEmbedStartRoute`), treats object keys as values that can carry a
 * credential, and keeps every other key, `__proto__` included. Whether a
 * subtree holds an embed signal is worked out once per node, so the walk stays
 * linear in the size of the result however deeply it nests.
 */
function redactEmbedCredentials(json: unknown): unknown {
  const mentioned = new Map<string, boolean>();
  const mentions = (text: string): boolean => {
    let found = mentioned.get(text);
    if (found === undefined) {
      found = mentionsEmbedStartRoute(text);
      mentioned.set(text, found);
    }
    return found;
  };
  const signalByNode = new WeakMap<object, boolean>();
  const holdsSignal = (value: unknown): boolean => {
    if (typeof value === "string") return mentions(value);
    if (!value || typeof value !== "object") return false;
    let found = signalByNode.get(value);
    if (found === undefined) {
      found = Array.isArray(value)
        ? value.some(holdsSignal)
        : Object.entries(value).some(
            ([key, val]) =>
              EMBED_RESULT_SENSITIVE_KEYS.has(key) ||
              mentions(key) ||
              holdsSignal(val),
          );
      signalByNode.set(value, found);
    }
    return found;
  };
  // An embed signal anywhere in an object or array puts all of it in the embed
  // routing context, so credential fields beside the signal are dropped too.
  const redact = (value: unknown, embedContext: boolean): unknown => {
    if (typeof value === "string") {
      return mentions(value) ? "[hidden embed URL]" : value;
    }
    if (!value || typeof value !== "object") return value;
    const context = embedContext || holdsSignal(value);
    if (Array.isArray(value)) return value.map((item) => redact(item, context));
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (
        EMBED_RESULT_SENSITIVE_KEYS.has(key) ||
        (context && isEmbedCredentialKey(key)) ||
        mentions(key) ||
        (typeof val === "string" && mentions(val))
      ) {
        continue;
      }
      // Assigning a `__proto__` key replaces the prototype instead of adding
      // the key, so every kept key is defined.
      Object.defineProperty(out, key, {
        value: redact(val, context),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  };
  return redact(json, false);
}

/** The contract error code a caller should see; generic failures have none. */
export function mcpActionErrorCode(error: unknown): string | undefined {
  return isActionContractError(error) && error.errorCode !== "action_failed"
    ? error.errorCode
    : undefined;
}

/**
 * Whether an already classified MCP proxy result says the upstream tool
 * failed. A proxy's fields can be getters, so this reads only `raw` and never
 * classifies the value again.
 */
export function isReportedProxyError(
  mcpResult: McpActionResult | null,
): boolean {
  return (
    !!mcpResult &&
    !!mcpResult.raw &&
    typeof mcpResult.raw === "object" &&
    (mcpResult.raw as Record<string, unknown>).isError === true
  );
}

/** What one MCP caller may do, fixed for the lifetime of its server. */
export interface McpActionCallContext {
  appId: string | undefined;
  identity: MCPCallerIdentity | undefined;
  /** Binds approval grants to this caller; unset when no action needs approval. */
  approvalCallerKey: string | undefined;
  /** Whether this server can mint signed approval state for an elicitation. */
  canRequestApproval: boolean;
}

/** How a resumed call presents the approval it is answering. */
export interface McpActionApprovalResponse {
  /** The verified state a resumed call carries; undefined on a first call. */
  state(): McpActionApprovalState | undefined;
  /** The caller's answer to the approval elicitation. */
  decision(): unknown;
}

export interface McpActionCall {
  name: string;
  args: unknown;
  /** The actions this caller can reach in its catalog. */
  callable: Record<string, ActionEntry>;
  /** Adapter-specific facts to attach to the action's audit context. */
  actionRunContext?: Partial<ActionRunContext>;
  approval?: McpActionApprovalResponse;
}

type McpActionCallRefusal<Approval> =
  | { status: "unknown-tool"; message: string }
  | { status: "forbidden-scope"; message: string }
  | { status: "approval-denied"; message: string }
  | { status: "approval-required"; approval: Approval };

/**
 * A pending approval as an untrusted caller may see it. The signed state and
 * its grant nonce stay with the direct adapter, which mints the elicitation.
 */
export interface McpActionApprovalRequest {
  actionName: string;
  expiresAt: number;
}

/**
 * Where a call failed. `authorization` means the caller's service-principal
 * grant refused the call before the action was invoked, and `approval` failed
 * before the action ran; in both, nothing ran. `action` means the action was
 * invoked and threw, so it may have done part of its work. `result` means the
 * action finished but its value could not be made into JSON, so its work is
 * done even though the caller gets no value. No stage says whether partial
 * work was committed.
 */
export type McpActionCallFailureStage =
  | "authorization"
  | "approval"
  | "action"
  | "result";

/**
 * Plain, frozen JSON data in which every string has had embed session
 * credentials removed. An adapter that hands results to sandboxed or
 * model-authored code still serializes its own allowlisted DTO from this.
 */
export type McpActionCallOutcome =
  | McpActionCallRefusal<McpActionApprovalRequest>
  | {
      status: "completed";
      /** The action's value as JSON; an MCP proxy result contributes `raw`. */
      value: unknown;
      /** The action reported failure inside its own value. */
      reportedError: boolean;
    }
  | {
      status: "failed";
      stage: McpActionCallFailureStage;
      message: string;
      errorCode: string | undefined;
    };

/**
 * Runs inside the caller's request context (`runWithRequestContext`), which
 * supplies the user and org that approval predicates and the action see.
 * Never throws: the result is normalized and redacted before this returns.
 */
export async function executeMcpActionCall(
  context: McpActionCallContext,
  call: McpActionCall,
): Promise<McpActionCallOutcome> {
  const refused = await refuseOutsideServiceGrant(context, call.name);
  if (refused !== undefined) return refused;
  const outcome = await runMcpActionCallUnredacted(context, call);
  switch (outcome.status) {
    case "ran":
      return completedOutcome(outcome.result);
    case "threw":
      return failedOutcome(outcome.stage, outcome.error);
    case "approval-required":
      return Object.freeze({
        status: outcome.status,
        approval: Object.freeze({
          actionName: redactText(outcome.approval.actionName),
          expiresAt: outcome.approval.expiresAt,
        }),
      });
    default:
      return Object.freeze({
        status: outcome.status,
        message: redactText(outcome.message),
      });
  }
}

/**
 * The same steps after the service-principal check, which the direct adapter
 * makes itself before its own built-in tools. Returns the action's own value,
 * its thrown error and the signed approval state with its grant nonce. These
 * can hold credentials, so
 * only the direct `tools/call` adapter calls this (`.oxlintrc.json` and
 * `guard:mcp-unredacted-call-boundary` reject other importers, dynamic
 * imports and requires): it moves embed tickets into `_meta`, mints the approval
 * elicitation, and redacts every model-visible field itself.
 */
export async function runMcpActionCallUnredacted(
  context: McpActionCallContext,
  call: McpActionCall,
): Promise<
  | McpActionCallRefusal<Readonly<McpActionApprovalState>>
  | { status: "ran"; entry: ActionEntry; result: unknown }
  | { status: "threw"; stage: "approval" | "action"; error: unknown }
> {
  const { name, args } = call;
  const entry = call.callable[name];
  if (!entry) {
    return { status: "unknown-tool", message: `Unknown tool: ${name}` };
  }
  if (!isActionVisibleForOAuthScope(entry, context.identity?.oauthScopes)) {
    return {
      status: "forbidden-scope",
      message: `OAuth scope does not allow tool ${name}`,
    };
  }

  try {
    const authorization = await authorizeApproval(
      context,
      call,
      entry,
      (args as Record<string, unknown>) ?? {},
    );
    if (authorization.status !== "authorized") return authorization;

    const { clientAccepted } = authorization;

    try {
      const result = await runActionInvocation(
        entry,
        // coercion-ok: a call that omits `arguments` passes no arguments, which is an empty object.
        (args as Record<string, string>) ?? {},
        {
          userEmail: getRequestUserEmail(),
          orgId: getRequestOrgId() ?? null,
          appId: context.appId,
          caller: "mcp",
          actionName: name,
          ...call.actionRunContext,
        },
        clientAccepted ? { mcpClientAccepted: true } : undefined,
      );
      return { status: "ran", entry, result };
    } catch (error) {
      return { status: "threw", stage: "action", error };
    }
  } catch (error) {
    return { status: "threw", stage: "approval", error };
  }
}

function toJsonData(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError("The action returned a value that is not JSON data.");
  }
  return JSON.parse(json);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function completedOutcome(result: unknown): McpActionCallOutcome {
  try {
    const mcpResult = isMcpActionResult(result) ? result : null;
    const raw = mcpResult ? mcpResult.raw : result;
    return Object.freeze({
      status: "completed" as const,
      value: deepFreeze(redactEmbedCredentials(toJsonData(raw))),
      reportedError: isReportedProxyError(mcpResult),
    });
  } catch (error) {
    return failedOutcome("result", error);
  }
}

/**
 * The direct adapter refuses a service principal outside its grant before it
 * looks up the tool, and this is the same check at the same point. The
 * action's own wrapper checks again when it runs, but a refusal thrown from
 * inside `run` cannot prove the action body never started, so only a refusal
 * from here is reported at the `authorization` stage.
 */
async function refuseOutsideServiceGrant(
  context: McpActionCallContext,
  name: string,
): Promise<McpActionCallOutcome | undefined> {
  const email = context.identity?.userEmail;
  try {
    const { allowedActions } = await assertServicePrincipalMayRun(
      email,
      typeof context.identity?.orgId === "string"
        ? context.identity.orgId
        : undefined,
    );
    assertServicePrincipalMayCall(allowedActions, name);
    return undefined;
  } catch (error) {
    if (error instanceof ServicePrincipalRefusedError) {
      try {
        await runOutsideActionInvocation(() =>
          recordServicePrincipalDenial({
            email,
            orgId: getRequestOrgId(),
            actionName: name,
            caller: "mcp",
            error,
          }),
        );
      } catch (recordError) {
        console.error(
          "[mcp] Could not record a service-principal denial",
          recordError,
        );
      }
    }
    return failedOutcome("authorization", error);
  }
}

function redactText(text: string): string {
  return mentionsEmbedStartRoute(text) ? "[hidden embed URL]" : text;
}

function failedOutcome(
  stage: McpActionCallFailureStage,
  error: unknown,
): McpActionCallOutcome {
  let message: string;
  let errorCode: string | undefined;
  try {
    const raw = error instanceof Error ? error.message : error;
    message =
      typeof raw === "string"
        ? redactText(raw)
        : "The call failed without an error message.";
    // A service-principal refusal carries a typed code the direct adapter
    // never prints, so only this path reads it.
    const code: unknown =
      error instanceof ServicePrincipalRefusedError
        ? error.errorCode
        : mcpActionErrorCode(error);
    if (code !== undefined && typeof code !== "string") {
      throw new TypeError("The error code is not a string.");
    }
    errorCode = code === undefined ? undefined : redactText(code);
  } catch {
    message = "The call failed, and its error could not be read.";
    errorCode = undefined;
  }
  return Object.freeze({
    status: "failed" as const,
    stage,
    message,
    errorCode,
  });
}

async function authorizeApproval(
  context: McpActionCallContext,
  call: McpActionCall,
  entry: ActionEntry,
  args: Record<string, unknown>,
): Promise<
  | McpActionCallRefusal<Readonly<McpActionApprovalState>>
  | { status: "authorized"; clientAccepted: boolean }
> {
  const { name } = call;
  const { identity, approvalCallerKey } = context;
  const verifiedState = call.approval?.state();
  const argumentsHash = await sha256Base64Url(canonicalJson(args));
  const hasVerifiedUserIdentity =
    identity?.identityAssurance === "user" &&
    Boolean(identity.userEmail?.trim());

  if (verifiedState !== undefined) {
    if (!hasVerifiedUserIdentity) {
      return approvalDenied(
        `${name} requires approval from a verified user identity.`,
      );
    }
    if (
      verifiedState.version !== 1 ||
      typeof verifiedState.nonce !== "string" ||
      verifiedState.actionName !== name ||
      verifiedState.argumentsHash !== argumentsHash ||
      !Number.isFinite(verifiedState.expiresAt) ||
      verifiedState.expiresAt < Date.now() ||
      !approvalCallerKey
    ) {
      return approvalDenied(
        `Approval for ${name} is invalid or does not match this exact call.`,
      );
    }

    const consumed = await consumeMcpApprovalGrant({
      nonce: verifiedState.nonce,
      callerKey: approvalCallerKey,
      actionName: name,
      argumentsHash,
      expiresAt: verifiedState.expiresAt,
    });
    if (!consumed) {
      return approvalDenied(
        `Approval for ${name} is invalid, expired, or already used.`,
      );
    }

    if (call.approval?.decision() !== "approve") {
      return approvalDenied(`${name} was not approved.`);
    }
    return { status: "authorized", clientAccepted: true };
  }

  if (entry.needsApproval === undefined) {
    return { status: "authorized", clientAccepted: false };
  }
  let mustApprove = false;
  try {
    mustApprove =
      typeof entry.needsApproval === "function"
        ? Boolean(
            await entry.needsApproval(args, {
              userEmail: getRequestUserEmail(),
              orgId: getRequestOrgId() ?? null,
              appId: context.appId,
              caller: "mcp",
              actionName: name,
            }),
          )
        : entry.needsApproval === true;
  } catch {
    mustApprove = true;
  }
  if (!mustApprove) return { status: "authorized", clientAccepted: false };

  if (!hasVerifiedUserIdentity) {
    return approvalDenied(
      `${name} requires approval from a verified user identity.`,
    );
  }

  if (!context.canRequestApproval || !approvalCallerKey) {
    return approvalDenied(
      `${name} requires approval, but secure MCP approval is not configured on this server.`,
    );
  }

  const now = Date.now();
  const approval: McpActionApprovalState = {
    version: 1,
    nonce: globalThis.crypto.randomUUID(),
    actionName: name,
    argumentsHash,
    expiresAt: now + MCP_ACTION_APPROVAL_TTL_SECONDS * 1000,
  };
  await createMcpApprovalGrant({ ...approval, callerKey: approvalCallerKey });
  return { status: "approval-required", approval: Object.freeze(approval) };
}

function approvalDenied(
  message: string,
): McpActionCallRefusal<Readonly<McpActionApprovalState>> {
  return { status: "approval-denied", message };
}
