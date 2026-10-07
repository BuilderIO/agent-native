import { isActionContractError } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { isMcpActionResult } from "../mcp-client/app-result.js";
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
): boolean {
  if (!scopes) return true;
  const required: McpOAuthScope =
    entry.readOnly === true ? "mcp:read" : "mcp:write";
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
  return purge(value, seen, embedContext, false);
}

function purge(
  value: unknown,
  seen: WeakSet<object>,
  embedContext: boolean,
  keepAllKeys: boolean,
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
      purge(item, seen, arrayEmbedContext, keepAllKeys),
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
      const purged = purge(val, seen, localEmbedContext, keepAllKeys);
      // Assigning a `__proto__` key replaces the prototype instead of adding
      // the key. Direct wire output has always dropped such keys, so only the
      // JSON-preserving path defines them.
      if (keepAllKeys) {
        Object.defineProperty(out, key, {
          value: purged,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else {
        out[key] = purged;
      }
    }
    seen.delete(value);
    return out;
  }
  return value;
}

/** The contract error code a caller should see; generic failures have none. */
export function mcpActionErrorCode(error: unknown): string | undefined {
  return isActionContractError(error) && error.errorCode !== "action_failed"
    ? error.errorCode
    : undefined;
}

/** Whether an MCP proxy result says the upstream tool failed. */
export function isReportedProxyError(result: unknown): boolean {
  return (
    isMcpActionResult(result) &&
    !!result.raw &&
    typeof result.raw === "object" &&
    (result.raw as Record<string, unknown>).isError === true
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
 * Where a call failed. `approval` failed before the action ran. `action`
 * means the action was invoked and threw, so it may have done part of its
 * work. `result` means the action finished but its value could not be made
 * into JSON, so its work is done even though the caller gets no value.
 */
export type McpActionCallFailureStage = "approval" | "action" | "result";

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
 * The same steps, returning the action's own value, its thrown error and the
 * signed approval state with its grant nonce. These can hold credentials, so
 * only the direct `tools/call` adapter calls this (`.oxlintrc.json` rejects
 * other importers): it moves embed tickets into `_meta`, mints the approval
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
    const refusal = await authorizeApproval(
      context,
      call,
      entry,
      (args as Record<string, unknown>) ?? {},
    );
    if (refusal !== undefined) return refusal;
  } catch (error) {
    return { status: "threw", stage: "approval", error };
  }

  try {
    // coercion-ok: a call that omits `arguments` passes no arguments, which is an empty object.
    const result = await entry.run((args as Record<string, string>) ?? {}, {
      userEmail: getRequestUserEmail(),
      orgId: getRequestOrgId() ?? null,
      appId: context.appId,
      caller: "mcp",
      actionName: name,
    });
    return { status: "ran", entry, result };
  } catch (error) {
    return { status: "threw", stage: "action", error };
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
    const raw = isMcpActionResult(result) ? result.raw : result;
    return Object.freeze({
      status: "completed" as const,
      value: deepFreeze(purge(toJsonData(raw), new WeakSet(), false, true)),
      reportedError: isReportedProxyError(result),
    });
  } catch (error) {
    return failedOutcome("result", error);
  }
}

function redactText(text: string): string {
  return isEmbedStartUrl(text) ? "[hidden embed URL]" : text;
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
    const code: unknown = mcpActionErrorCode(error);
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
): Promise<McpActionCallRefusal<Readonly<McpActionApprovalState>> | undefined> {
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
    return undefined;
  }

  if (entry.needsApproval === undefined) return undefined;
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
  if (!mustApprove) return undefined;

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
