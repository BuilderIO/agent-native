import Ajv, { type ValidateFunction } from "ajv";
import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
  getMethod,
} from "h3";
import type { EventHandler as H3EventHandler } from "h3";

import { isAgentActionStopError } from "../action.js";
import { readAppState } from "../application-state/script-helpers.js";
import { isReadOnlyShellCommand } from "../coding-tools/index.js";
import { isDemoModeEnabled } from "../demo/config.js";
import { redactDemoData, redactDemoString } from "../demo/redact.js";
import { extensionIdFromPathname } from "../extensions/path.js";
import { preUploadAttachments } from "../file-upload/pre-upload-attachments.js";
import { isMcpActionResult } from "../mcp-client/app-result.js";
import { extractMcpToolResultImages } from "../mcp-client/index.js";
import { isMcpToolAllowedForRequest } from "../mcp-client/visibility.js";
import {
  completeRun as completeProgressRun,
  startRun as startProgressRun,
  updateRunProgress,
} from "../progress/registry.js";
import {
  getFrontmatterValue,
  parseFrontmatter,
} from "../resources/metadata.js";
import {
  canUseDeployCredentialFallbackForRequest,
  getProviderCredentialAuthFailure,
  readDeployCredentialEnv,
} from "../server/credential-provider.js";
import { readBody } from "../server/h3-helpers.js";
import {
  getRequestRunContext,
  ensureRequestRunContext,
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "../server/request-context.js";
import { fireInternalDispatch } from "../server/self-dispatch.js";
import {
  isReasoningEffort,
  normalizeReasoningEffortForModel,
  stepDownReasoningEffort,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import { actionPreparationContinuationNote } from "./action-continuation-guidance.js";
import { applyContextDirectives } from "./context-xray/apply-directives.js";
import { loadContextDirectives } from "./context-xray/directives-store.js";
import {
  buildManifest,
  writeContextManifest,
} from "./context-xray/manifest.js";
import { computeProtectedSegmentIds } from "./context-xray/segments.js";
import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  AGENT_CHAT_PROCESS_RUN_PATH,
  backgroundRuntimeDiagnosticDetail,
  dispatchPathTargetsNetlifyBackgroundFunction,
  isAgentChatDurableBackgroundEnabled,
  isAgentChatForegroundSelfChainEnabled,
  resolveAgentChatProcessRunDispatchPath,
  shouldUseBackgroundFunctionTimeoutForWorker,
} from "./durable-background.js";
import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
  userFacingLlmCredentialError,
} from "./engine/credential-errors.js";
import {
  resolveEngine,
  registerBuiltinEngines,
  getStoredModelForEngine,
  normalizeModelForEngine,
  isResolvedEngineUsableForRequest,
} from "./engine/index.js";
import {
  resolveEmptyResponseRetryMaxOutputTokens,
  resolveMainChatMaxOutputTokens,
  resolveMaxOutputTokensForEngine,
} from "./engine/output-tokens.js";
import { PROVIDER_TO_ENV } from "./engine/provider-env-vars.js";
import {
  backfillEngineMessagesToolResults,
  stringifyToolUseInputForGateway,
  unmatchedToolResultReplayText,
} from "./engine/translate-anthropic.js";
import type {
  AgentEngine,
  EngineTool,
  EngineMessage,
  EngineContentPart,
  EngineEvent,
  EngineToolResultPart,
} from "./engine/types.js";
import { EngineError } from "./engine/types.js";
import {
  type AgentLoopSettings,
  getDefaultMaxIterations,
  MAX_AGENT_MAX_ITERATIONS,
  MIN_AGENT_MAX_ITERATIONS,
  normalizeMaxIterations,
  readAgentLoopSettings,
} from "./loop-settings.js";
import {
  maybeCompactThread,
  buildObservationalContext,
  hasObservationalMemory,
  serializeObservationalMemoryBlock,
} from "./observational-memory/index.js";
import {
  ProcessorChain,
  TripWire,
  toolCallsFromContent,
  type Processor,
} from "./processors.js";
import {
  startRun,
  subscribeToRun,
  getActiveRunForThread,
  getActiveRunForThreadAsync,
  getRun,
  abortRun,
  tryClaimRunSlot,
} from "./run-manager.js";
import type { ActiveRun } from "./run-manager.js";
import {
  writeLedgerEntry,
  readLedgerEntry,
  clearLedgerForThread,
  getCurrentTurnEventsForThread,
  insertRun,
  updateRunHeartbeat,
  updateRunStatusIfRunning,
  setRunTerminalReason,
  claimBackgroundRun,
  readBackgroundRunClaim,
  recordRunDiagnostic,
  countRunsForTurn,
  RUN_DIAG_STAGE,
  UNCLAIMED_BACKGROUND_RUN_GRACE_MS,
} from "./run-store.js";
import { buildCurrentTimeUserContext } from "./runtime-context.js";
import {
  classifyToolCallJournal,
  findCompletedJournalEntry,
  type ToolCallJournal,
} from "./tool-call-journal.js";
import {
  redactSensitiveFields,
  sanitizeToolErrorText,
  sanitizeToolErrorValue,
} from "./tool-error-redaction.js";
import {
  describeToolResultImages,
  extractAgentImagesFromActionResult,
} from "./tool-result-images.js";
import {
  createToolSearchEntry,
  TOOL_SEARCH_ACTION_NAME,
} from "./tool-search.js";
import type {
  ActionTool,
  AgentNativeJsonSchema,
  AgentChatAttachment,
  AgentChatRequest,
  AgentChatEvent,
  AgentChatReference,
  AgentChatStructuredMessage,
} from "./types.js";

// Register built-in engines on first import
registerBuiltinEngines();

export { PROVIDER_TO_ENV };

/**
 * Grace window + poll interval for the foreground circuit-breaker that confirms
 * a background worker actually CLAIMED a 202-dispatched run before recovering
 * inline. The grace must cover the worker's cold-start + per-request init before
 * it reaches `claimBackgroundRun`: light apps win the claim in ~1-2s, but heavy
 * apps (e.g. analytics) were observed in prod taking >8s, so an 8s grace made
 * their worker lose the race every time and always fall back to inline (adding
 * ~8s latency with no background budget). 15s covers the slow apps while staying
 * well within the foreground's ~40s soft-timeout.
 */
export const BACKGROUND_CLAIM_GRACE_MS = 15_000;
/**
 * Safety margin subtracted from the unclaimed-reaper grace when deciding how
 * long the foreground may keep waiting for a slow-but-live worker to claim. The
 * foreground recovers the run inline this many ms BEFORE `reapUnclaimedBackgroundRun`
 * would error an unclaimed row, so the foreground always wins the race to claim
 * and the two never collide — see `resolveBackgroundDispatchOutcome`.
 */
export const BACKGROUND_REAPER_SAFETY_MARGIN_MS = 2_000;
export const BACKGROUND_CLAIM_POLL_MS = 400;

export type BackgroundDispatchOutcome =
  | { action: "stream" }
  | { action: "subscribe" }
  | {
      action: "inline";
      reason: "dispatch-failed" | "worker-never-claimed" | "no-row";
    };

/**
 * `diag_stage` is persisted as a JSON payload (`{ stage, detail?, at }`) by
 * `recordRunDiagnostic`. Extract the bare stage name so it can be compared to
 * `RUN_DIAG_STAGE` constants. Falls back to the raw value when it is not JSON
 * (defensive — legacy rows or tests may store a bare stage).
 */
function parseRunDiagStage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { stage?: unknown };
    if (parsed && typeof parsed.stage === "string") return parsed.stage;
  } catch {
    // Not JSON — treat the raw value as the stage name.
  }
  return typeof raw === "string" ? raw : null;
}

/**
 * Decide what the foreground should do after attempting a durable background
 * dispatch. A Netlify async background function returns 202 the instant it
 * ENQUEUES the invocation — that is NOT proof the worker executed. If the
 * generated wrapper fails to import/hand off to the route, the worker never
 * reaches `claimBackgroundRun` and the run is reaped as "worker never claimed".
 *
 * So after a successful dispatch we poll briefly for the worker to CLAIM the run:
 *   - claimed within grace        → "stream"    (subscribe to the worker)
 *   - dispatch failed OR no claim  → recover inline by atomically claiming the
 *       run ourselves: if we win → "inline"; if a (delayed) worker already won
 *       it → "subscribe" (never double-run).
 *
 * Pure except for the injected `readClaim`/`claim`/`now`/`sleep` deps, so each
 * branch is unit-testable.
 */
export async function resolveBackgroundDispatchOutcome(opts: {
  dispatched: boolean;
  backgroundRowInserted: boolean;
  runId: string;
  graceMs: number;
  /**
   * The unclaimed-run reaper's grace (`UNCLAIMED_BACKGROUND_RUN_GRACE_MS`). When
   * provided, the foreground may keep waiting PAST `graceMs` while the worker is
   * provably alive and still in setup — but it recovers inline before the run has
   * been unclaimed this long (minus the safety margin), so it always claims
   * before the reaper can fire. Omit to disable the extension (behaves exactly
   * like the base grace).
   */
  reaperGraceMs?: number;
  /** Margin subtracted from `reaperGraceMs` (default `BACKGROUND_REAPER_SAFETY_MARGIN_MS`). */
  reaperSafetyMarginMs?: number;
  pollIntervalMs: number;
  readClaim: (runId: string) => Promise<{
    dispatchMode: string | null;
    status: string | null;
    diagStage?: string | null;
    /** COALESCE(heartbeat_at, started_at) — the reaper's liveness basis. */
    lastLivenessAt?: number | null;
  } | null>;
  claim: (runId: string) => Promise<boolean>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<BackgroundDispatchOutcome> {
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // Pre-claim diag stages that prove the worker is ALIVE and executing: it
  // reached the route, passed HMAC auth, and is grinding through handler setup
  // (system prompt build / action loading) on its way to `claimBackgroundRun`.
  // A dead handoff — the generated wrapper never reached the route — never
  // records these, so it is NOT eligible for the extended grace.
  const ALIVE_IN_SETUP: ReadonlySet<string> = new Set([
    RUN_DIAG_STAGE.authPassed,
    RUN_DIAG_STAGE.workerEntered,
  ]);
  // Pre-claim diag stages that prove the worker DIED before claiming — stop
  // waiting and recover inline immediately instead of burning the rest of the
  // grace on a worker that already failed.
  const DIED_BEFORE_CLAIM: ReadonlySet<string> = new Set([
    RUN_DIAG_STAGE.authFailed,
    RUN_DIAG_STAGE.routeThrew,
    RUN_DIAG_STAGE.workerThrew,
  ]);

  if (opts.dispatched) {
    // One now() at entry + one per iteration (so callers/tests that model a
    // stepping clock stay deterministic).
    const startedAt = now();
    const baseDeadline = startedAt + opts.graceMs;
    const reaperGraceMs = opts.reaperGraceMs;
    const reaperMargin =
      opts.reaperSafetyMarginMs ?? BACKGROUND_REAPER_SAFETY_MARGIN_MS;
    for (;;) {
      const claim = await opts.readClaim(opts.runId).catch(() => null);
      if (
        claim &&
        ((claim.dispatchMode && claim.dispatchMode !== "background") ||
          (claim.status && claim.status !== "running"))
      ) {
        return { action: "stream" };
      }
      // `diag_stage` is stored as JSON ({stage, detail?, at}); compare on the
      // bare stage name, not the raw payload.
      const stage = parseRunDiagStage(claim?.diagStage);
      // Worker recorded a pre-claim death — no point waiting out the grace.
      if (stage && DIED_BEFORE_CLAIM.has(stage)) break;
      const elapsedNow = now();
      // The unclaimed-reaper errors any still-`background` row once it has been
      // unclaimed for `reaperGraceMs`, measured from the row's OWN liveness
      // (COALESCE(heartbeat_at, started_at)) — NOT from when we began polling.
      // Recover inline just before that point so the foreground claims the run
      // first; anchoring to the row's liveness makes this immune to dispatch
      // latency between insertRun and the start of polling.
      const reaperWillFireSoon =
        reaperGraceMs != null &&
        claim?.lastLivenessAt != null &&
        elapsedNow - claim.lastLivenessAt >= reaperGraceMs - reaperMargin;
      if (reaperWillFireSoon) break;
      // ADAPTIVE GRACE: past the base window, keep polling ONLY while the worker
      // is provably alive and still in setup (heavy cold start). A dead handoff
      // never recorded an ALIVE_IN_SETUP stage, so it recovers inline at the base
      // grace; the reaper-anchored break above bounds how long a live worker can
      // extend. The extension is enabled only when a reaper grace was provided.
      const aliveInSetup =
        reaperGraceMs != null &&
        claim?.status === "running" &&
        !!stage &&
        ALIVE_IN_SETUP.has(stage);
      if (elapsedNow >= baseDeadline && !aliveInSetup) break;
      await sleep(opts.pollIntervalMs);
    }
  }

  // Dispatch fast-failed OR no worker claimed within grace → recover inline.
  if (!opts.backgroundRowInserted) {
    // No row to reconcile (insert failed / non-duplicate) — run a fresh inline
    // turn; `startRun` inserts the row.
    return { action: "inline", reason: "no-row" };
  }
  let claimedInline = false;
  try {
    claimedInline = await opts.claim(opts.runId);
  } catch {
    claimedInline = false;
  }
  if (claimedInline) {
    return {
      action: "inline",
      reason: opts.dispatched ? "worker-never-claimed" : "dispatch-failed",
    };
  }
  // The atomic claim was lost: a (delayed) background worker already owns the
  // run — subscribe to it, never run a second copy.
  return { action: "subscribe" };
}

const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

function normalizeBrowserTabId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return SAFE_BROWSER_TAB_ID_RE.test(trimmed) ? trimmed : undefined;
}

function normalizeChatScope(
  value: unknown,
): { type: string; id: string; label?: string } | null | undefined {
  if (value == null) return null;
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "";
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!type || !id || type.length > 64 || id.length > 256) {
    return undefined;
  }
  const label =
    typeof record.label === "string" && record.label.trim().length > 0
      ? record.label.trim().slice(0, 256)
      : undefined;
  return { type, id, ...(label ? { label } : {}) };
}

function appStateKeyForBrowserTab(key: string, browserTabId?: string): string {
  return browserTabId ? `${key}:${browserTabId}` : key;
}

async function readAppStateForBrowserTab<T>(
  key: string,
  browserTabId?: string,
): Promise<T | null> {
  const tabKey = appStateKeyForBrowserTab(key, browserTabId);
  if (tabKey !== key) {
    const scoped = (await readAppState(tabKey).catch(() => null)) as T | null;
    if (scoped) return scoped;
  }
  return (await readAppState(key)) as T | null;
}

/**
 * Look up a user's persisted API key for the given provider. Returns
 * `undefined` for unauthenticated callers.
 *
 * Read order:
 *   1. `app_secrets` — encrypted user override, then active org/workspace.
 *   2. Legacy `user-api-key:<provider>:<email>` settings row — pre-migration
 *      data that hasn't been backfilled yet. Surfaced for compat only;
 *      writes always go to app_secrets now.
 */
export async function getOwnerApiKey(
  provider: string,
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  if (!ownerEmail) return undefined;
  const secretKey =
    PROVIDER_TO_ENV[provider] ?? `${provider.toUpperCase()}_API_KEY`;
  try {
    const { readAppSecret } = await import("../secrets/storage.js");
    const refs: Array<{
      scope: "user" | "org" | "workspace";
      scopeId: string;
    }> = [{ scope: "user", scopeId: ownerEmail }];
    const orgId = getRequestOrgId();
    if (orgId) {
      refs.push(
        { scope: "org", scopeId: orgId },
        { scope: "workspace", scopeId: orgId },
      );
    } else {
      refs.push({ scope: "workspace", scopeId: `solo:${ownerEmail}` });
    }
    for (const ref of refs) {
      const fromSecrets = await readAppSecret({
        key: secretKey,
        scope: ref.scope,
        scopeId: ref.scopeId,
      });
      if (
        fromSecrets?.value &&
        !(await getProviderCredentialAuthFailure({
          key: secretKey,
          value: fromSecrets.value,
        }))
      ) {
        return fromSecrets.value;
      }
    }
  } catch {
    // app_secrets table not ready — fall through to legacy lookup.
  }
  try {
    const { getSetting } = await import("../settings/store.js");
    const stored = await getSetting(`user-api-key:${provider}:${ownerEmail}`);
    const key =
      stored && typeof stored.key === "string" ? stored.key.trim() : "";
    if (
      key &&
      !(await getProviderCredentialAuthFailure({ key: secretKey, value: key }))
    ) {
      return key;
    }
    if (provider === "anthropic") {
      const legacy = await getSetting(`user-anthropic-api-key:${ownerEmail}`);
      const legacyKey =
        legacy && typeof legacy.key === "string" ? legacy.key.trim() : "";
      if (
        legacyKey &&
        !(await getProviderCredentialAuthFailure({
          key: secretKey,
          value: legacyKey,
        }))
      ) {
        return legacyKey;
      }
      return undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Derive the provider name from the active engine setting.
 * "ai-sdk:openai" → "openai", "anthropic" → "anthropic"
 */
export function engineToProvider(engineName: string): string {
  return engineName.startsWith("ai-sdk:") ? engineName.slice(7) : engineName;
}

/**
 * Resolve the active engine's provider and look up the user's API key for it.
 *
 * If the owner has no scoped key, fall back to provider keys supplied by the
 * hosting environment only when the current request can safely use deploy-level
 * credentials. This is a read from process-level config, not a request-scoped
 * write to `process.env`.
 *
 * Callers that layer another deployment-key fallback after this should keep the
 * same precedence: scoped key first, host-provided env key second.
 */
export async function getOwnerActiveApiKey(
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  try {
    const { getSetting } = await import("../settings/store.js");
    const engineSetting = await getSetting("agent-engine");
    const activeEngine =
      (engineSetting?.engine as string | undefined) ?? "anthropic";
    const provider = engineToProvider(activeEngine);
    const userKey = await getOwnerApiKey(provider, ownerEmail);
    if (userKey) return userKey;
    const envVar = PROVIDER_TO_ENV[provider];
    if (!envVar || !canUseDeployCredentialFallbackForRequest(envVar)) {
      return undefined;
    }
    const envKey = readDeployCredentialEnv(envVar);
    if (
      envKey &&
      !(await getProviderCredentialAuthFailure({ key: envVar, value: envKey }))
    ) {
      return envKey;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** @deprecated Use getOwnerApiKey("anthropic", ownerEmail) instead */
export async function getOwnerAnthropicApiKey(
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  return getOwnerApiKey("anthropic", ownerEmail);
}

/**
 * Context passed as the optional second argument to an action's `run`.
 * Defined in `../action.js` (cycle-free home) and re-exported here so existing
 * importers (e.g. `scripts/call-agent.ts`) keep their import path.
 */
export type { ActionRunContext, ActionCaller } from "../action.js";

export interface ActionEntry {
  tool: ActionTool;
  run: (
    args: any,
    context?: import("../action.js").ActionRunContext,
  ) => Promise<any> | any;
  /** Standard Schema input validator when declared through defineAction. */
  schema?: unknown;
  /** HTTP exposure config. `false` = agent-only. Omitted = auto-inferred from name. */
  http?: import("../action.js").ActionHttpConfig | false;
  /** Whether HTTP/frontend action calls must have an authenticated owner.
   *  Defaults to true; false lets safe metadata/read actions run with
   *  `ctx.userEmail` undefined when auth resolution returns 401/403. */
  requiresAuth?: boolean;
  /** Max HTTP request body in bytes; the route 413s on `Content-Length` before
   *  parsing. For public, no-auth POST actions. */
  maxBodyBytes?: number;
  /** Whether the action is exposed to the agent as a callable tool. Only an
   *  explicit `false` hides it from every agent tool surface (in-app assistant,
   *  MCP, A2A, job/trigger runners) while leaving it frontend/HTTP-callable.
   *  Set by `defineAction`'s `agentTool` option. */
  agentTool?: boolean;
  /** Explicit opt-in metadata for public agent protocols. Public routes never
   *  imply public tool exposure; MCP/A2A/OpenAPI surfaces must filter for this. */
  publicAgent?: import("../action.js").PublicAgentActionConfig;
  /** If true, completion does NOT trigger a screen-refresh change event.
   *  Set automatically by `defineAction` when `http.method === "GET"`. */
  readOnly?: boolean;
  /** False keeps a read-only tool available in Act mode but hides/blocks it in
   *  Plan mode. Use for tools that perform substantive work even without
   *  mutating state. */
  allowInPlanMode?: boolean;
  /** If true, this action can run concurrently with other same-turn
   *  read-only/parallel-safe tool calls. Only use for actions that handle
   *  their own write ordering and idempotency. */
  parallelSafe?: boolean;
  /** Whether this action may be invoked from the tools-iframe bridge.
   *  **Default-allow opt-out**: only an explicit `false` returns 403.
   *  - `true` / `undefined` — allow.
   *  - `false` — explicit deny; the tools bridge returns 403.
   *  See `defineAction` (`packages/core/src/action.ts`) and audit H5 in
   *  `security-audit/05-tools-sandbox.md`. */
  toolCallable?: boolean;
  /** Optional deep-link builder. When set, MCP/A2A surfaces append an
   *  "Open in <app> →" link built from the call's args + result. Pure, sync,
   *  best-effort. See `defineAction` and the `external-agents` skill. */
  link?: import("../action.js").ActionLinkBuilder;
  /** Optional MCP Apps UI resource for hosts that support inline interactive
   *  app iframes. CLI/non-UI hosts still receive the normal tool result and
   *  any deep link from `link`. */
  mcpApp?: import("../action.js").ActionMcpAppConfig;
  /** Optional native Agent-Native chat renderer for this action's result. */
  chatUI?: import("../action-ui.js").ActionChatUIConfig;
  /**
   * Per-tool timeout override in milliseconds. When set, the agent loop uses
   * this value instead of the global TOOL_TIMEOUT_MS (60 s) for this action.
   * Useful for long-running tools such as sandboxed code execution.
   */
  timeoutMs?: number;
  /**
   * Per-tool max-result-chars override. When set, the agent loop truncates
   * the result to this many characters instead of the global 50 000 cap.
   */
  maxResultChars?: number;
  /**
   * Opt-in human-in-the-loop approval gate (default off). When truthy (or a
   * predicate that resolves truthy for the call's args), the loop emits
   * `approval_required` and stops the turn instead of executing this action,
   * until a human approves the specific call. Set by `defineAction`'s
   * `needsApproval` option. See `packages/core/docs/content/actions.mdx`.
   */
  needsApproval?:
    | boolean
    | ((
        args: any,
        ctx?: import("../action.js").ActionRunContext,
      ) => boolean | Promise<boolean>);
}

/** @deprecated Use `ActionEntry` instead */
export type ScriptEntry = ActionEntry;

export type AgentExecutionMode = "act" | "plan";

export const PLAN_MODE_SYSTEM_PROMPT = `## Plan Mode Active

You are in Plan mode. This turn is for research, clarification, and a proposed approach only.

Hard rules:
- Use only read-only tools. Do not edit files, write resources, run mutating bash commands, mutate SQL rows, navigate the UI, send notifications, create jobs, create tools, call external agents, or change external systems.
- If a needed detail is unclear, ask a concise clarifying question before proposing a plan.
- When ready, present a concrete plan with the files/tools you expect to touch, the intended changes, validation steps, and notable risks.
- Do not treat approval as implicit while Plan mode is still active. Tell the user to switch to Act mode with the mode selector or /act before implementation.`;

const PLAN_MODE_BLOCKED_READONLY_TOOLS = new Set([
  "refresh-screen",
  "set-search-params",
  "set-url-path",
]);

const PLAN_MODE_ALLOWED_ACTIONS: Record<string, readonly string[]> = {
  resources: ["list", "read"],
  "chat-history": ["search"],
  "agent-teams": ["status", "read-result", "list"],
  "manage-jobs": ["list"],
  "manage-automations": ["list-events", "list"],
  "manage-notifications": ["list"],
  "manage-progress": ["list"],
  "manage-agent-engine": ["list"],
};

const PLAN_MODE_WEB_REQUEST_METHODS = new Set(["GET", "HEAD"]);
const SOURCE_SWEEP_AGENT_TEAM_ALLOWED_ACTIONS = [
  "status",
  "read-result",
  "list",
] as const;

function getToolAction(name: string, args: unknown): string {
  const raw =
    args && typeof args === "object" && "action" in args
      ? (args as Record<string, unknown>).action
      : undefined;
  if (raw == null && name === "chat-history") return "search";
  return String(raw ?? "").toLowerCase();
}

function getWebRequestMethod(args: unknown): string {
  const raw =
    args && typeof args === "object" && "method" in args
      ? (args as Record<string, unknown>).method
      : undefined;
  return String(raw ?? "GET").toUpperCase();
}

function restrictActionEnum(
  parameters: ActionTool["parameters"] | undefined,
  allowedActions: readonly string[],
): ActionTool["parameters"] | undefined {
  if (!parameters) return parameters;
  const actionParam = parameters.properties.action;
  if (!actionParam) return parameters;
  return {
    ...parameters,
    properties: {
      ...parameters.properties,
      action: {
        ...actionParam,
        enum: [...allowedActions],
      },
    },
  };
}

function restrictWebRequestMethods(
  parameters: ActionTool["parameters"] | undefined,
): ActionTool["parameters"] | undefined {
  if (!parameters) return parameters;
  const methodParam = parameters.properties.method;
  if (!methodParam) return parameters;
  return {
    ...parameters,
    properties: {
      ...parameters.properties,
      method: {
        ...methodParam,
        enum: [...PLAN_MODE_WEB_REQUEST_METHODS],
      },
    },
  };
}

function planModeBlockedMessage(toolName: string, reason?: string): string {
  return (
    `Plan mode blocked \`${toolName}\`` +
    (reason ? ` (${reason})` : "") +
    ". Switch to Act mode after the user approves the plan, then retry the action."
  );
}

export function isPlanModeToolCallAllowed(
  name: string,
  input: unknown,
  entry: ActionEntry,
): boolean {
  if (entry.allowInPlanMode === false) return false;
  if (PLAN_MODE_BLOCKED_READONLY_TOOLS.has(name)) return false;

  if (name === "web-request") {
    return PLAN_MODE_WEB_REQUEST_METHODS.has(getWebRequestMethod(input));
  }

  if (name === "bash") {
    return isPlanModeReadOnlyBashCall(input);
  }

  const allowedActions = PLAN_MODE_ALLOWED_ACTIONS[name];
  if (allowedActions) {
    return allowedActions.includes(getToolAction(name, input));
  }

  return entry.readOnly === true;
}

function isPlanModeReadOnlyBashCall(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const command = (input as Record<string, unknown>).command;
  if (typeof command !== "string") return false;
  return isReadOnlyShellCommand(command);
}

function createPlanModeGuardedAction(
  name: string,
  entry: ActionEntry,
  allowedActions: readonly string[],
): ActionEntry {
  return {
    ...entry,
    readOnly: true,
    tool: {
      ...entry.tool,
      description:
        `${entry.tool.description}\n\nPlan mode: only these read-only actions are available: ` +
        allowedActions.map((action) => `"${action}"`).join(", ") +
        ".",
      parameters: restrictActionEnum(entry.tool.parameters, allowedActions),
    },
    run: async (args, context) => {
      const action = getToolAction(name, args);
      if (!allowedActions.includes(action)) {
        return planModeBlockedMessage(
          name,
          `action="${action || "(missing)"}"`,
        );
      }
      return entry.run(args, context);
    },
  };
}

function createPlanModeWebRequestAction(entry: ActionEntry): ActionEntry {
  return {
    ...entry,
    readOnly: true,
    tool: {
      ...entry.tool,
      description: `${entry.tool.description}\n\nPlan mode: only GET and HEAD requests are allowed.`,
      parameters: restrictWebRequestMethods(entry.tool.parameters),
    },
    run: async (args, context) => {
      const method = getWebRequestMethod(args);
      if (!PLAN_MODE_WEB_REQUEST_METHODS.has(method)) {
        return planModeBlockedMessage("web-request", `method="${method}"`);
      }
      return entry.run(args, context);
    },
  };
}

function createPlanModeBashAction(entry: ActionEntry): ActionEntry {
  return {
    ...entry,
    readOnly: true,
    tool: {
      ...entry.tool,
      description: `${entry.tool.description}\n\nPlan mode: only read-only inspection commands such as pwd, ls, find, rg, grep, cat, sed -n, head, tail, wc, and git status/diff/show/log are allowed.`,
    },
    run: async (args, context) => {
      if (!isPlanModeReadOnlyBashCall(args)) {
        return planModeBlockedMessage("bash", "command is not read-only");
      }
      return entry.run(args, context);
    },
  };
}

function createPlanModeBlockedAction(
  name: string,
  entry: ActionEntry,
  reason?: string,
): ActionEntry {
  return {
    ...entry,
    allowInPlanMode: false,
    readOnly: true,
    tool: {
      ...entry.tool,
      description: `${entry.tool.description}\n\nPlan mode blocked: ${reason ?? "not available while planning"}.`,
    },
    run: async () => planModeBlockedMessage(name, reason),
  };
}

export function createPlanModeActionRegistry(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  const filtered: Record<string, ActionEntry> = {};

  for (const [name, entry] of Object.entries(actions)) {
    if (name === TOOL_SEARCH_ACTION_NAME) continue;
    if (entry.allowInPlanMode === false) {
      filtered[name] = createPlanModeBlockedAction(
        name,
        entry,
        "not available while planning",
      );
      continue;
    }
    if (PLAN_MODE_BLOCKED_READONLY_TOOLS.has(name)) {
      filtered[name] = createPlanModeBlockedAction(
        name,
        entry,
        "not available while planning",
      );
      continue;
    }

    const allowedActions = PLAN_MODE_ALLOWED_ACTIONS[name];
    if (allowedActions) {
      filtered[name] = createPlanModeGuardedAction(name, entry, allowedActions);
      continue;
    }

    if (name === "web-request") {
      filtered[name] = createPlanModeWebRequestAction(entry);
      continue;
    }

    if (name === "bash") {
      filtered[name] = createPlanModeBashAction(entry);
      continue;
    }

    if (entry.readOnly === true) {
      filtered[name] = entry;
    } else {
      filtered[name] = createPlanModeBlockedAction(
        name,
        entry,
        "write or side-effecting tool",
      );
    }
  }

  if (actions[TOOL_SEARCH_ACTION_NAME]) {
    filtered[TOOL_SEARCH_ACTION_NAME] = createToolSearchEntry(() => filtered);
  }

  return filtered;
}

export interface ProductionAgentOptions {
  /** Action entries for the agent. Use `actions` (preferred) or `scripts` (deprecated alias). */
  actions?: Record<string, ActionEntry>;
  /** @deprecated Use `actions` instead */
  scripts?: Record<string, ActionEntry>;
  /** Static system prompt string, or async function called per-request with the H3 event */
  systemPrompt: string | ((event: any) => string | Promise<string>);
  /** Falls back to ANTHROPIC_API_KEY env var. Ignored when `engine` is provided. */
  apiKey?: string;
  /** Agent engine to use. Defaults to the "anthropic" engine. */
  engine?:
    | AgentEngine
    | string
    | { name: string; config: Record<string, unknown> };
  /** Model to use. Defaults to the resolved engine's default model. */
  model?: string;
  /** App/template id used for org-scoped per-app model defaults. */
  appId?: string;
  /** Default reasoning effort for requests that do not supply an override. */
  reasoningEffort?: ReasoningEffort;
  /** Provider-specific options passed through to the engine */
  providerOptions?: EngineMessage extends never ? never : any;
  /** Called when a run completes (for server-side thread persistence) */
  onRunComplete?: (run: ActiveRun, threadId: string | undefined) => void;
  /** Called after request validation but before a run is started. */
  onRunPrepared?: (details: {
    runId: string;
    threadId: string | undefined;
    message: string;
    attachments?: AgentChatAttachment[];
  }) => void | Promise<void>;
  /**
   * Optional per-template request normalizer. Runs after owner resolution and
   * before system/context assembly so templates can materialize uploaded chat
   * attachments or append app-specific, non-visible instructions.
   */
  prepareRequest?: (details: {
    event: any;
    ownerEmail: string | null;
    message: string;
    displayMessage?: string;
    attachments: AgentChatAttachment[];
    references: AgentChatReference[];
    threadId?: string;
    internalContinuation?: boolean;
    mode: AgentExecutionMode;
  }) =>
    | void
    | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
      }
    | Promise<void | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
      }>;
  /** Optional per-app agent run chunk budget in milliseconds. Defaults to
   *  AGENT_RUN_SOFT_TIMEOUT_MS when set, otherwise no framework-imposed
   *  timeout. When reached, the client receives an internal auto-continuation
   *  signal instead of a user-facing warning. */
  runSoftTimeoutMs?: number;
  /** Optional no-progress watchdog override for this app's runs. */
  runNoProgressTimeoutMs?: number;
  /**
   * Opt this app into durable Netlify background-function agent-chat runs. This
   * is a runtime opt-in layered on top of the hosted-runtime + A2A_SECRET gates;
   * single-template Netlify deploys must also enable the deploy-time
   * `AGENT_CHAT_DURABLE_BACKGROUND` flag so the background function is emitted.
   */
  durableBackgroundRuns?: boolean;
  /** Called when a run starts, with the send function for emitting events and the threadId */
  onRunStart?: (
    send: (event: AgentChatEvent) => void,
    threadId: string,
  ) => void | Promise<void>;
  /**
   * Called after the engine + model are resolved for this request. Used by
   * the plugin layer to thread the parent's choices into sub-agents so
   * delegated tasks don't default back to Anthropic + Claude.
   */
  onEngineResolved?: (engine: AgentEngine, model: string) => void;
  /** Resolve the owner email from the H3 event (for usage tracking) */
  resolveOwnerEmail?: (event: any) => string | Promise<string>;
  /**
   * Optional final-answer guard. If it returns a message after a text-only
   * assistant turn, the loop clears that draft once and asks the model to
   * continue with the returned corrective instruction before allowing a final.
   */
  finalResponseGuard?: AgentLoopFinalResponseGuard;
  /**
   * Skip auto-injecting the workspace files/skills/agents inventory on the
   * first message of a conversation. Useful for minimal/voice apps where
   * the ~2KB inventory of unrelated resources is noise, not signal.
   * Default: false (inventory is injected).
   */
  skipFilesContext?: boolean;
  /**
   * Optional starter tool catalog. When set, the first model request includes
   * only these tool schemas plus `tool-search`; the full action registry remains
   * searchable, and matching tool schemas from `tool-search` results are added
   * to the next model request. This keeps first-token latency low without
   * forcing rarely used capabilities into every prompt. The framework also
   * promotes common provider/corpus/code-execution tools when the current
   * app/mode registry exposes them, so prompts that teach broad integrations do
   * not describe tools that require an extra discovery turn before use.
   */
  initialToolNames?: string[];
  /**
   * App-level default tool limits. Each action's own `timeoutMs` /
   * `maxResultChars` takes precedence; this sets the fallback for actions
   * that don't declare their own limits.
   */
  toolLimits?: { timeoutMs?: number; maxResultChars?: number };
}

export async function resolveAgentOwnerEmail(
  options: Pick<ProductionAgentOptions, "resolveOwnerEmail">,
  event: any,
): Promise<string | null> {
  let ownerEmail: string | null = null;
  if (options.resolveOwnerEmail) {
    try {
      ownerEmail = await options.resolveOwnerEmail(event);
    } catch {
      ownerEmail = null;
    }
  }
  return ownerEmail ?? getRequestUserEmail() ?? null;
}

const MAX_RETRIES = 3;
/**
 * Retry budget override for `builder_gateway_error` — the no-detail Builder
 * gateway fallback. Production data shows this code is almost never
 * transient: it's the gateway emitting `{type:"stop",reason:"error"}` with
 * no explanation, which usually means the upstream provider rejected the
 * call (model quota, account misconfiguration). Retrying the same request
 * synchronously rarely recovers, and each retry emits a `clear` event that
 * wipes the user's visible content and re-streams from scratch — three
 * cycles of "regenerate, clear, regenerate" inside a single run for a
 * failure mode where retrying doesn't help. Keep the budget at 1 so we
 * cover genuinely transient cases without the visible flicker storm.
 */
const BUILDER_GATEWAY_ERROR_MAX_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 2000;

function maxRetriesForError(err: unknown): number {
  if (err instanceof EngineError) {
    const code = (err.errorCode ?? "").toLowerCase();
    if (code === "builder_gateway_error") {
      return BUILDER_GATEWAY_ERROR_MAX_RETRIES;
    }
  }
  return MAX_RETRIES;
}
const TOOL_INPUT_ACTIVITY_INTERVAL_MS = 1500;
const ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS = 90_000;
const ACTION_PREPARATION_ZERO_BYTE_RESTART_LIMIT = 2;
const MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS = 90_000;
// Raised from 1 -> 2 now that each retry actually adapts (raises the token
// ceiling and steps reasoning effort down a tier) instead of re-issuing the
// exact same doomed request twice.
const EMPTY_FINAL_RESPONSE_RETRY_LIMIT = 2;
const MAIN_CHAT_INTERNAL_CONTINUATION_LIMIT = 6;
const RUN_BUDGET_EXHAUSTED_ERROR_CODE = "run_budget_exhausted";
const RUN_BUDGET_EXHAUSTED_MESSAGE =
  "I ran out of time before finishing this step. " +
  "I stopped rather than keep retrying silently. " +
  "Check any completed tool cards above before retrying, ideally as one smaller follow-up.";
const MAX_TEXT_ATTACHMENT_CHARS = 60_000;
const MAX_SELECTION_CONTEXT_CHARS = 8_000;
const MAX_RESOURCE_INVENTORY_ITEMS = 40;
const MAX_RESOURCE_INVENTORY_DESCRIPTION_CHARS = 160;
const MAX_INLINE_SKILL_REFERENCE_CHARS = 40_000;
const SOURCE_SWEEP_TOOL_CALL_THRESHOLD = 12;

/**
 * Hard cap on the `<current-screen>` block injected into EVERY user message.
 *
 * The screen snapshot comes from the template's `view-screen` action, which can
 * be unbounded — e.g. a recording/meeting page returns the full transcript +
 * every segment. Injected on every turn with no cap, that single block can blow
 * past the model's context window and hard-error the chat with
 * `context_length_exceeded` (observed: a brand-new "hi" message failing because
 * an open recording's transcript shipped in `<current-screen>`). Keep this to a
 * compact page summary; the agent can call `view-screen` (or a data action like
 * `get-recording-player-data`) for full detail on demand.
 */
const MAX_SCREEN_CONTEXT_CHARS = 10_000;

function capScreenContext(text: string): string {
  if (text.length <= MAX_SCREEN_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_SCREEN_CONTEXT_CHARS)}\n\n…[current-screen snapshot truncated after ${MAX_SCREEN_CONTEXT_CHARS.toLocaleString()} chars to protect the context window. Call the view-screen action for the full snapshot, or a data action (e.g. get-recording-player-data) for full transcripts.]`;
}

function capSelectionContext(text: string): string {
  if (text.length <= MAX_SELECTION_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_SELECTION_CONTEXT_CHARS)}\n\n…[selection truncated after ${MAX_SELECTION_CONTEXT_CHARS.toLocaleString()} chars. Ask the user or use an app data action if the omitted text is required.]`;
}

function compactInventoryDescription(description: string): string {
  const oneLine = description.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_RESOURCE_INVENTORY_DESCRIPTION_CHARS) {
    return oneLine;
  }
  return `${oneLine.slice(0, MAX_RESOURCE_INVENTORY_DESCRIPTION_CHARS - 1)}…`;
}

function limitInventoryLines(lines: string[], label: string): string[] {
  if (lines.length <= MAX_RESOURCE_INVENTORY_ITEMS) return lines;
  const omitted = lines.length - MAX_RESOURCE_INVENTORY_ITEMS;
  return [
    ...lines.slice(0, MAX_RESOURCE_INVENTORY_ITEMS),
    `  … ${omitted} more ${label} omitted; use the resources tool with action "list" or "read" for the full inventory.`,
  ];
}

function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toolInputActivityLabel(toolName?: string): string {
  return toolName ? `Preparing ${toolName} action` : "Preparing action input";
}

/** Check if an error is transient and should be retried
 * @internal exported for unit tests only
 */
export function isContextTooLongError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (
    msg.includes("context_length_exceeded") ||
    msg.includes("input_too_long") ||
    msg.includes("too many tokens") ||
    msg.includes("prompt is too long") ||
    msg.includes("reduce the length") ||
    // Gemini phrasing
    msg.includes("input token count exceeds") ||
    msg.includes("request too large")
  )
    return true;
  if (err instanceof EngineError) {
    const code = (err.errorCode ?? "").toLowerCase();
    if (code.includes("context_length") || code.includes("input_too_long"))
      return true;
  }
  return false;
}

/** @internal exported for unit tests only */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const engineErr = err instanceof EngineError ? err : null;
  const code = (engineErr?.errorCode ?? "").toLowerCase();

  // Hard non-retryable codes — check these first.
  if (code === "builder_gateway_timeout") return false;
  if (
    code === "rate_limit_exceeded" ||
    msg.includes("daily gateway request cap")
  )
    return false;

  // Prefer structured fields from the engine before falling back to message
  // keyword matching — avoids false positives on user-supplied text that
  // happens to contain "rate_limit" etc.
  if (engineErr) {
    // Provider explicitly said it is retryable.
    if (engineErr.providerRetryable === true) return true;
    // HTTP status-code checks (429, 500, 502, 503, 529 = Anthropic overloaded).
    const sc = engineErr.statusCode;
    if (sc === 429 || sc === 500 || sc === 502 || sc === 503 || sc === 529)
      return true;
  }

  return (
    code === "builder_gateway_error" ||
    code === "builder_gateway_network_error" ||
    code === "provider_network_error" ||
    code === "http_429" ||
    code === "http_500" ||
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "timeout" ||
    // Anthropic
    msg.includes("overloaded") ||
    msg.includes("rate_limit") ||
    // Bare provider rate-limit messages that carry no structured status,
    // e.g. the Anthropic/AI-SDK "429 status code (no body)" format.
    /\b429\b/.test(msg) ||
    msg.includes("529") ||
    // OpenAI phrasing
    msg.includes("rate limit reached") ||
    // Google / Gemini
    msg.includes("resource_exhausted") ||
    msg.includes("quota exceeded") ||
    // Generic HTTP codes
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("gateway error") ||
    msg.includes("socket hang up") ||
    msg.includes("connection reset") ||
    // Anthropic SDK APIConnectionError default message is exactly
    // "Connection error." — Builder gateway often forwards it as a stop
    // event with no structured code. Without this match the run fails in
    // ~3s and the client recovery loop storms POSTs.
    msg.includes("connection error") ||
    msg.includes("too many requests") ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("too much time has passed without sending any data")
  );
}

// ---------------------------------------------------------------------------
// Context-window overflow recovery
// ---------------------------------------------------------------------------

/**
 * Number of recent messages to protect when trimming tool results.
 * Messages in the tail of this length are left completely intact; only
 * older messages have their tool-result text replaced with a stub.
 */
const CONTEXT_TRIM_KEEP_TAIL = 10;
const CONTEXT_TRIM_STUB =
  "[result trimmed to save context — re-run the tool if needed]";

/**
 * Attempt one aggressive trim of old tool-result content to reduce the
 * context window usage.  Tool-result messages older than the last
 * {@link CONTEXT_TRIM_KEEP_TAIL} messages have their text replaced with a
 * short stub.  All user/assistant text messages and the recent tail are
 * preserved exactly.
 *
 * Returns a new array — the original is not mutated.
 * Returns `null` when there are no trimable tool results (so the caller can
 * skip the retry).
 */
export function trimOldToolResults(
  messages: EngineMessage[],
  keepTail = CONTEXT_TRIM_KEEP_TAIL,
): EngineMessage[] | null {
  const cutoff = Math.max(0, messages.length - keepTail);
  let trimmed = false;

  const result = messages.map((msg, idx): EngineMessage => {
    // Keep messages in the protected tail intact
    if (idx >= cutoff) return msg;

    // Only touch user messages that contain tool-result parts
    if (msg.role !== "user") return msg;

    const hasToolResult = msg.content.some((p) => p.type === "tool-result");
    if (!hasToolResult) return msg;

    const stubbedContent = msg.content.map(
      (p): import("./engine/types.js").EngineContentPart => {
        if (p.type !== "tool-result") return p;
        trimmed = true;
        return { ...p, content: CONTEXT_TRIM_STUB };
      },
    );

    return { role: "user", content: stubbedContent };
  });

  return trimmed ? result : null;
}

/** Wait with exponential backoff, respecting abort signal */
function retryDelay(attempt: number, signal: AbortSignal): Promise<void> {
  const baseMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = baseMs * 0.1;
  const ms = Math.max(0, baseMs + (Math.random() * 2 - 1) * jitter);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

function isSupportedImageMediaType(
  mediaType: string,
): mediaType is SupportedImageMediaType {
  return (
    mediaType === "image/jpeg" ||
    mediaType === "image/png" ||
    mediaType === "image/gif" ||
    mediaType === "image/webp"
  );
}

function isSvgMediaType(mediaType: string | undefined): boolean {
  return mediaType?.split(";")[0]?.trim().toLowerCase() === "image/svg+xml";
}

function escapeAttachmentAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unwrapTextAttachmentEnvelope(text: string): string {
  const match = text.match(/^<attachment\b[^>]*>\n([\s\S]*)\n<\/attachment>$/);
  return match ? match[1] : text;
}

function truncateTextAttachment(text: string, attachmentName?: string): string {
  if (text.length <= MAX_TEXT_ATTACHMENT_CHARS) return text;

  const omitted = text.length - MAX_TEXT_ATTACHMENT_CHARS;
  const readHint = attachmentName
    ? ` Use the \`read-attachment\` tool with name="${escapeAttachmentAttribute(attachmentName)}" to read the rest.`
    : "";
  return `${text.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_TEXT_ATTACHMENT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted.${readHint}]`;
}

function formatTextAttachment(att: AgentChatAttachment): string | null {
  if (typeof att.text !== "string" || att.text.length === 0) return null;
  const text = truncateTextAttachment(
    unwrapTextAttachmentEnvelope(att.text),
    att.name,
  );

  const attrs = [
    `name="${escapeAttachmentAttribute(att.name || "attachment")}"`,
    att.contentType
      ? `contentType="${escapeAttachmentAttribute(att.contentType)}"`
      : null,
    att.type ? `type="${escapeAttachmentAttribute(att.type)}"` : null,
  ].filter(Boolean);

  return `<attachment ${attrs.join(" ")}>\n${text}\n</attachment>`;
}

function dataUrlToFilePart(
  att: AgentChatAttachment,
): { type: "file"; data: string; mediaType: string; filename?: string } | null {
  if (att.type !== "file" || typeof att.data !== "string") return null;
  const match = att.data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    type: "file",
    data: match[2],
    mediaType: att.contentType || match[1],
    filename: att.name || undefined,
  };
}

export function buildUserContentWithAttachments(opts: {
  text: string;
  attachments?: AgentChatAttachment[];
}): EngineContentPart[] {
  const userContent: EngineContentPart[] = [];
  const textAttachments: string[] = [];

  for (const att of opts.attachments ?? []) {
    const uploadedUrl = (att as any).url as string | undefined;
    if ((att as any).referenceOnly === true && uploadedUrl) {
      const label = att.name ? `"${att.name}"` : "A file";
      const contentType = att.contentType ? ` (${att.contentType})` : "";
      textAttachments.push(
        `[${label} was uploaded to ${uploadedUrl} as a reference-only file${contentType}. Use the URL for embedding/reference if needed; do not inline raw file contents unless the target app sanitizes it.]`,
      );
      continue;
    }

    if (att.type === "image") {
      if (!att.data) {
        if (uploadedUrl) {
          const label = att.name ? `"${att.name}"` : "An image";
          textAttachments.push(
            `[${label} was uploaded to ${uploadedUrl}, but was not sent as a vision image because no supported base64 image data was present. Use the URL for embedding/reference if needed.]`,
          );
        }
        continue;
      }
      const match = att.data.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match && isSupportedImageMediaType(match[1])) {
        userContent.push({
          type: "image",
          data: match[2],
          mediaType: match[1],
        });
      } else {
        // The client sent an image in an unsupported format (HEIC, TIFF, AVIF,
        // etc.). Inject a short text placeholder so the model knows the image
        // was present but could not be processed, rather than silently omitting
        // it and leaving the model confused ("I don't see an image").
        const mime = match?.[1] ?? att.contentType ?? "unknown format";
        const label = att.name ? `"${att.name}"` : "An image";
        const uploadedHint = uploadedUrl
          ? ` It is available at ${uploadedUrl}; use that URL for embedding/reference if the task does not require vision analysis.`
          : "";
        if (uploadedUrl && isSvgMediaType(mime)) {
          textAttachments.push(
            `[${label} was uploaded to ${uploadedUrl} as an SVG reference (${mime}). ` +
              `It was not sent as a vision image because SVG files are handled as reference-only vector files. ` +
              `Use the URL for embedding/reference if needed; ask for a JPEG, PNG, GIF, or WebP export only if rendered-pixel vision analysis is required.]`,
          );
          continue;
        }
        textAttachments.push(
          `[${label} could not be processed — unsupported image format (${mime}). ` +
            uploadedHint +
            ` Inform the user that only JPEG, PNG, GIF, and WebP images are supported for vision analysis, ` +
            `and ask them to convert the file before attaching.]`,
        );
      }
      continue;
    }

    const filePart = dataUrlToFilePart(att);
    if (filePart) {
      userContent.push(filePart);
      continue;
    }

    const textAttachment = formatTextAttachment(att);
    if (textAttachment) {
      textAttachments.push(textAttachment);
    }
  }

  userContent.push({
    type: "text",
    text:
      textAttachments.length > 0
        ? `${textAttachments.join("\n\n")}\n\n${opts.text}`
        : opts.text,
  });

  return userContent;
}

function coerceStructuredToolResultWire(part: {
  toolCallId?: unknown;
  content?: unknown;
}): { toolCallId: string; content: string } {
  const toolCallId =
    typeof part.toolCallId === "string"
      ? part.toolCallId.trim()
      : part.toolCallId === undefined || part.toolCallId === null
        ? ""
        : String(part.toolCallId).trim();
  let content = "";
  if (typeof part.content === "string") {
    content = part.content;
  } else if (part.content !== undefined && part.content !== null) {
    try {
      content = JSON.stringify(part.content);
    } catch {
      content = String(part.content);
    }
  }
  return { toolCallId, content };
}

export function structuredHistoryToEngineMessages(
  history: AgentChatStructuredMessage[] | undefined,
): EngineMessage[] | null {
  if (!Array.isArray(history)) return null;

  const toolUseById = new Map<string, { name: string; input: unknown }>();

  const messages: EngineMessage[] = [];
  for (const message of history) {
    if (
      !message ||
      (message.role !== "user" && message.role !== "assistant") ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    const content: EngineContentPart[] = [];
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text" && typeof part.text === "string") {
        if (part.text.length > 0) {
          content.push({ type: "text", text: part.text });
        }
        continue;
      }

      if (part.type === "tool-call" && message.role === "assistant") {
        const id =
          typeof part.id === "string"
            ? part.id
            : typeof part.toolCallId === "string"
              ? part.toolCallId
              : "";
        const name =
          typeof part.name === "string"
            ? part.name
            : typeof part.toolName === "string"
              ? part.toolName
              : "";
        if (!id || !name) continue;
        const input = part.input ?? part.args ?? {};
        toolUseById.set(id, { name, input });
        content.push({
          type: "tool-call",
          id,
          name,
          input,
        });
        continue;
      }

      if (part.type === "tool-result" && message.role === "user") {
        const wire = coerceStructuredToolResultWire(part);
        const lookup =
          wire.toolCallId.length > 0
            ? toolUseById.get(wire.toolCallId)
            : undefined;
        const toolName =
          typeof part.toolName === "string" && part.toolName.trim().length > 0
            ? part.toolName
            : lookup?.name;
        if (!toolName?.trim()) {
          content.push({
            type: "text",
            text: unmatchedToolResultReplayText({
              toolCallId:
                wire.toolCallId.length > 0 ? wire.toolCallId : "(missing)",
              content: wire.content,
              isError: part.isError,
            }),
          });
          continue;
        }
        if (!wire.toolCallId) {
          // Named tool but no id — cannot emit a valid paired `tool-result`.
          content.push({
            type: "text",
            text: unmatchedToolResultReplayText({
              toolCallId: "(missing)",
              content: wire.content,
              isError: part.isError,
            }),
          });
          continue;
        }
        const toolInput =
          typeof part.toolInput === "string" && part.toolInput.length > 0
            ? part.toolInput
            : stringifyToolUseInputForGateway(lookup?.input);
        content.push({
          type: "tool-result",
          toolCallId: wire.toolCallId,
          toolName,
          toolInput,
          content: wire.content,
          ...(part.isError ? { isError: true } : {}),
        });
      }
    }

    if (content.length > 0) {
      messages.push({ role: message.role, content });
    }
  }

  return messages.length > 0
    ? backfillEngineMessagesToolResults(messages)
    : null;
}

/** Build enriched message with file/skill/mention references */
function capInlineSkillReferenceContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_INLINE_SKILL_REFERENCE_CHARS) return trimmed;
  const omitted = trimmed.length - MAX_INLINE_SKILL_REFERENCE_CHARS;
  return `${trimmed.slice(0, MAX_INLINE_SKILL_REFERENCE_CHARS)}\n\n[Skill content truncated after ${MAX_INLINE_SKILL_REFERENCE_CHARS.toLocaleString()} chars; ${omitted.toLocaleString()} chars omitted.]`;
}

function escapeReferenceAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function isRuntimeVisibleSkillContent(content: string): boolean {
  const frontmatter = parseFrontmatter(content);
  const scope = getFrontmatterValue(frontmatter, "scope")?.trim().toLowerCase();
  return scope !== "dev";
}

export async function resolveSkillReferenceContent(
  ref: AgentChatReference,
): Promise<string | null> {
  if (!ref.path && !ref.name) return null;

  if (ref.source === "resource") {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail || !ref.path) return null;
    try {
      const { resourceEffectiveContext, resourceGet } =
        await import("../resources/store.js");
      const resourceOptions = {
        userEmail: ownerEmail,
        orgId: getRequestOrgId() ?? null,
      };
      const effective = await resourceEffectiveContext(ownerEmail, ref.path, {
        ...resourceOptions,
      });
      if (!effective.effectiveResource) return null;
      const full = await resourceGet(effective.effectiveResource.id, {
        ...resourceOptions,
      });
      if (!full?.content || !isRuntimeVisibleSkillContent(full.content)) {
        return null;
      }
      return full.content;
    } catch {
      return null;
    }
  }

  try {
    const { loadAgentsBundle, getRuntimeSkills } =
      await import("../server/agents-bundle.js");
    const bundle = await loadAgentsBundle();
    const normalizedPath = ref.path?.replace(/\/+$/g, "");
    const skill = getRuntimeSkills(bundle).find((candidate) => {
      const skillPath = candidate.dir.replace(/\/+$/g, "");
      return (
        candidate.meta.name === ref.name ||
        normalizedPath === skillPath ||
        normalizedPath === `${skillPath}/SKILL.md`
      );
    });
    return skill?.content ?? null;
  } catch {
    return null;
  }
}

async function enrichMessage(
  message: string,
  references: AgentChatReference[],
): Promise<string> {
  if (references.length === 0) return message;

  const fileRefs = references.filter((r) => r.type === "file");
  const skillRefs = references.filter((r) => r.type === "skill");
  const customAgentRefs = references.filter((r) => r.type === "custom-agent");
  const mentionRefs = references.filter((r) => r.type === "mention");

  const parts: string[] = [];
  if (fileRefs.length > 0) {
    parts.push(
      "Referenced files:\n" +
        fileRefs
          .map(
            (r) => `- ${r.path}${r.source === "resource" ? " (resource)" : ""}`,
          )
          .join("\n"),
    );
  }
  if (skillRefs.length > 0) {
    const skillLines = await Promise.all(
      skillRefs.map(async (r) => {
        const content = await resolveSkillReferenceContent(r);
        if (content?.trim()) {
          return `- ${r.name} (${r.path})\n\n<applied-skill name="${escapeReferenceAttribute(r.name)}" path="${escapeReferenceAttribute(r.path)}" source="${escapeReferenceAttribute(r.source)}">\n${capInlineSkillReferenceContent(content)}\n</applied-skill>`;
        }
        return `- ${r.name} (${r.path})${
          r.source === "resource"
            ? ' — content was not inlined; read with the resources tool (action: "read") if needed'
            : " — content was not inlined; read with the read tool if needed"
        }`;
      }),
    );
    parts.push(
      "Applied skills (read and follow before acting):\n" +
        skillLines.join("\n"),
    );
  }
  if (customAgentRefs.length > 0) {
    parts.push(
      "Requested custom agents:\n" +
        customAgentRefs
          .map(
            (r) =>
              `- ${r.name}${r.refId ? ` (id: ${r.refId})` : ""}${r.path ? ` (path: ${r.path})` : ""}`,
          )
          .join("\n"),
    );
  }
  if (mentionRefs.length > 0) {
    parts.push(
      "Referenced items:\n" +
        mentionRefs
          .map(
            (r) =>
              `- [${r.refType || "item"}] ${r.name}${r.refId ? ` (id: ${r.refId})` : ""}${r.path ? ` (path: ${r.path})` : ""}`,
          )
          .join("\n"),
    );
  }

  return `${parts.join("\n\n")}\n\n${message}`;
}

/** Accumulated token usage from an agent loop run */
export interface AgentLoopUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}

export interface AgentLoopToolCallSummary {
  name: string;
  input: unknown;
}

export interface AgentLoopToolResultSummary {
  name: string;
  content: string;
  isError: boolean;
}

export interface AgentLoopFinalResponseGuardContext {
  messages: EngineMessage[];
  assistantContent: EngineContentPart[];
  text: string;
  toolCalls: AgentLoopToolCallSummary[];
  toolResults: AgentLoopToolResultSummary[];
  retryCount: number;
  executionMode: AgentExecutionMode;
}

export type AgentLoopFinalResponseGuardResult =
  | string
  | {
      retryMessage: string;
      fallbackMessage?: string;
    };

export type AgentLoopFinalResponseGuard = (
  context: AgentLoopFinalResponseGuardContext,
) =>
  | AgentLoopFinalResponseGuardResult
  | null
  | undefined
  | Promise<AgentLoopFinalResponseGuardResult | null | undefined>;

function collectTextParts(parts: EngineContentPart[]): string {
  return parts
    .filter(
      (part): part is import("./engine/types.js").EngineTextPart =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

export const AGENT_INTERNAL_CONTINUE_PROMPT =
  "Continue from where you left off and finish the user's original request. Do not repeat completed work, do not mention internal reconnects, time limits, or step limits, and continue as if this is the same uninterrupted run.";

export type AgentLoopContinuationReason =
  | "run_timeout"
  | "loop_limit"
  | "max_tokens"
  | "stream_ended"
  | "gateway_timeout"
  | "network_interrupted"
  | "no_progress";

export function appendAgentLoopContinuation(
  messages: EngineMessage[],
  reason: AgentLoopContinuationReason,
  options: { actionPreparationTool?: string } = {},
) {
  const note =
    reason === "loop_limit"
      ? "The previous run reached an internal step budget."
      : reason === "max_tokens"
        ? "The previous LLM call reached the model output-token cap before the response finished."
        : reason === "stream_ended"
          ? "The previous stream ended before the agent sent a final completion signal."
          : reason === "gateway_timeout"
            ? "The previous LLM call hit an upstream gateway timeout before the response finished streaming."
            : reason === "network_interrupted"
              ? "The previous LLM call was cut off by a transport-level interruption (socket dropped, connection reset, or stream closed unexpectedly)."
              : reason === "no_progress"
                ? "The previous run stopped producing progress events while the connection stayed open."
                : "The previous run reached an internal execution budget.";
  const actionInputNote = options.actionPreparationTool
    ? actionPreparationContinuationNote(options.actionPreparationTool)
    : "";
  messages.push({
    role: "user",
    content: [
      {
        type: "text",
        text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: ${note}${actionInputNote}`,
      },
    ],
  });
}

function isAgentLoopContinuationReason(
  reason: unknown,
): reason is AgentLoopContinuationReason {
  return (
    reason === "run_timeout" ||
    reason === "loop_limit" ||
    reason === "max_tokens" ||
    reason === "stream_ended" ||
    reason === "gateway_timeout" ||
    reason === "network_interrupted" ||
    reason === "no_progress"
  );
}

/**
 * True when an error thrown by `runAgentLoop` is a recoverable transport- or
 * gateway-level interruption that the agent can resume from rather than a
 * terminal failure. The continuation pattern works because the LLM call's
 * conversation prefix is preserved on the next attempt — Anthropic's prompt
 * cache rescues the latency, and the agent gets a "you got cut off, continue"
 * nudge so it doesn't redo work it already finished.
 *
 * Distinct from `isRetryableError` which guides per-engine quick retries:
 * `isResumableEngineError` is checked AFTER engine retries are exhausted, at
 * the run level. It catches both gateway-reported timeouts (where engine
 * retries don't apply because the gateway already gave up) and transport
 * errors that survived engine retry budgets.
 */
export function isResumableEngineError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code =
    err instanceof EngineError ? (err.errorCode ?? "").toLowerCase() : "";
  if (
    code === "builder_gateway_timeout" ||
    code === "builder_gateway_network_error" ||
    code === "provider_network_error"
  ) {
    return true;
  }
  if (
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "timeout"
  ) {
    return true;
  }
  const text = errorSearchText(err);
  return (
    text.includes("socket hang up") ||
    text.includes("econnreset") ||
    text.includes("enetreset") ||
    text.includes("econnaborted") ||
    text.includes("fetch failed") ||
    text.includes("network error") ||
    text.includes("connection error") ||
    text.includes("connection reset") ||
    text.includes("connection closed") ||
    text.includes("stream closed") ||
    text.includes("inactivity timeout") ||
    text.includes("gateway timeout") ||
    text.includes("upstream timeout") ||
    text.includes("function timeout") ||
    text.includes("too much time has passed without sending any data") ||
    text.includes("terminated")
  );
}

/**
 * Map a resumable error to the most descriptive continuation reason. Used
 * when surfacing the resume to the agent and to clients via the
 * `auto_continue` event.
 */
export function continuationReasonForResumableError(
  err: unknown,
): "gateway_timeout" | "network_interrupted" {
  const code =
    err instanceof EngineError ? (err.errorCode ?? "").toLowerCase() : "";
  if (code === "builder_gateway_timeout") return "gateway_timeout";
  const text = err instanceof Error ? err.message.toLowerCase() : "";
  if (
    text.includes("gateway timeout") ||
    text.includes("upstream timeout") ||
    text.includes("function timeout")
  ) {
    return "gateway_timeout";
  }
  return "network_interrupted";
}

function errorSearchText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.name, err.message);
    const maybe = err as Error & { code?: unknown; cause?: unknown };
    if (typeof maybe.code === "string") parts.push(maybe.code);
    if (maybe.cause) parts.push(errorSearchText(maybe.cause));
  } else {
    parts.push(String(err));
  }
  return parts.join(" ").toLowerCase();
}

function textFromEngineMessage(message: EngineMessage): string {
  return message.content
    .filter(
      (part): part is import("./engine/types.js").EngineTextPart =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

function isInternalContinuationTurn(messages: EngineMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    return textFromEngineMessage(message).startsWith(
      AGENT_INTERNAL_CONTINUE_PROMPT,
    );
  }
  return false;
}

function isToolResultOnlyUserMessage(message: EngineMessage): boolean {
  return (
    message.role === "user" &&
    message.content.length > 0 &&
    message.content.every((part) => part.type === "tool-result")
  );
}

/** Start of the active turn on an internal continuation (real user prompt). */
function findCurrentTurnStartForContinuation(
  messages: EngineMessage[],
): number {
  let i = messages.length - 1;
  while (i >= 0) {
    const message = messages[i];
    if (message.role !== "user") {
      i--;
      continue;
    }
    const userText = textFromEngineMessage(message);
    if (userText.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT)) {
      i--;
      continue;
    }
    if (isToolResultOnlyUserMessage(message)) {
      i--;
      continue;
    }
    return i;
  }
  return 0;
}

/**
 * First message index that is safe to start a trimmed window on. A window must
 * not begin with a tool-result-only user message — that would orphan it from
 * the assistant tool-call turn it answers and break Anthropic's tool_use /
 * tool_result pairing. We walk forward from `desiredStart` to the first
 * non-orphaned boundary; if none exists we refuse to trim (return -1).
 */
function findSafeWindowStart(
  messages: EngineMessage[],
  desiredStart: number,
): number {
  for (let i = Math.max(0, desiredStart); i < messages.length; i++) {
    if (!isToolResultOnlyUserMessage(messages[i])) return i;
  }
  return -1;
}

/**
 * Observational Memory consumer (threshold-gated, conservative).
 *
 * Builds the three-tier OM context for a thread and, ONLY when the thread has
 * already crossed the compaction threshold (i.e. it has at least one persisted
 * observation/reflection), returns a rewritten message list that:
 *   - prepends a single system-role "Observational Memory" block holding the
 *     reflections + observations, and
 *   - replaces the raw older history with just the recent-raw-message window,
 *     keeping the current user turn and any pending tool results intact.
 *
 * For threads with NO OM entries (every short thread) it returns the input
 * array unchanged by reference, so the common path is byte-for-byte identical.
 *
 * Best-effort: any failure returns the input unchanged so OM can never break a
 * normal turn.
 */
async function applyObservationalMemoryToContext(
  messages: EngineMessage[],
  opts: {
    threadId: string;
    ownerEmail?: string | null;
    orgId?: string | null;
  },
): Promise<EngineMessage[]> {
  if (!opts.ownerEmail) return messages;

  try {
    const context = await buildObservationalContext({
      threadId: opts.threadId,
      ownerEmail: opts.ownerEmail,
      orgId: opts.orgId ?? null,
      messages,
    });

    // No compacted memory yet → short thread, leave context untouched.
    if (!hasObservationalMemory(context)) return messages;

    const block = serializeObservationalMemoryBlock(context);
    if (!block.trim()) return messages;

    // EngineMessage has no "system" role; the framework injects auxiliary
    // context as leading user messages (same convention as the continuation
    // nudge and the resume journal note), and the serialized block is clearly
    // self-labeled "[Observational Memory]".
    const omMessage: EngineMessage = {
      role: "user",
      content: [{ type: "text", text: block }],
    };

    // Trim the raw prefix to only the recent-raw window. The window is the tail
    // of `messages`, so it always contains the latest user turn and any pending
    // tool results. Guard the boundary so we never start mid tool_use/result
    // pair; if a safe boundary can't be found, additively inject the memory
    // block WITHOUT trimming (the conservative fallback) so we never drop a
    // pending tool result.
    const recentCount = context.recentMessages.length;
    if (recentCount === 0 || recentCount >= messages.length) {
      return [omMessage, ...messages];
    }
    const desiredStart = messages.length - recentCount;
    const safeStart = findSafeWindowStart(messages, desiredStart);
    if (safeStart < 0) {
      // Whole tail is tool-result-only (degenerate) — don't trim.
      return [omMessage, ...messages];
    }
    return [omMessage, ...messages.slice(safeStart)];
  } catch (err) {
    console.warn(
      "[observational-memory] context injection skipped:",
      err instanceof Error ? err.message : String(err),
    );
    return messages;
  }
}

function seedReadOnlyToolResultsFromHistory(
  messages: EngineMessage[],
  actions: Record<string, ActionEntry>,
): Map<string, string> {
  const cache = new Map<string, string>();
  if (!isInternalContinuationTurn(messages)) return cache;

  const pendingToolCalls = new Map<string, { name: string; input: unknown }>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "tool-call") continue;
        const entry = actions[part.name];
        if (entry?.readOnly !== true) continue;
        pendingToolCalls.set(part.id, {
          name: part.name,
          input: part.input,
        });
      }
      continue;
    }

    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const call = pendingToolCalls.get(part.toolCallId);
      if (!call) continue;
      if (!isReusableReadOnlyToolResult(part)) continue;
      cache.set(toolCallCacheKey(call.name, call.input), part.content);
    }
  }

  return cache;
}

function isReusableReadOnlyToolResult(part: EngineToolResultPart): boolean {
  if (part.isError) return false;
  const lower = part.content.trim().toLowerCase();
  if (!lower) return false;
  return !(
    lower.startsWith("invalid action parameters for ") ||
    lower.startsWith("error running ") ||
    lower.includes("run aborted") ||
    lower.includes("tool call timed out") ||
    lower.includes("stale_run") ||
    lower.includes("connection_error")
  );
}

/**
 * Counts how many times each write (non-read-only) tool call was interrupted
 * before returning a result in the continuation history. When a connection
 * drops mid-tool-execution the client sends a placeholder result
 * ("Interrupted before this tool returned a result.") so the model knows
 * what was attempted. If the same write tool is called again with identical
 * input in the next continuation, this count prevents infinite retry loops.
 */
const INTERRUPTED_TOOL_RESULT_MARKER =
  "Interrupted before this tool returned a result.";
const MAX_WRITE_TOOL_INTERRUPTIONS = 2;
const MAX_IDENTICAL_TOOL_ERRORS = 3;

function seedWriteToolInterruptionsFromHistory(
  messages: EngineMessage[],
  actions: Record<string, ActionEntry>,
): Map<string, number> {
  const interruptions = new Map<string, number>();
  if (!isInternalContinuationTurn(messages)) return interruptions;

  const turnStart = findCurrentTurnStartForContinuation(messages);
  const turnMessages = messages.slice(turnStart);

  const pendingToolCalls = new Map<string, { name: string; input: unknown }>();
  for (const message of turnMessages) {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "tool-call") continue;
        const entry = actions[part.name];
        if (entry?.readOnly === true) continue;
        pendingToolCalls.set(part.id, { name: part.name, input: part.input });
      }
      continue;
    }

    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const call = pendingToolCalls.get(part.toolCallId);
      if (!call) continue;
      if (
        typeof part.content === "string" &&
        part.content.includes(INTERRUPTED_TOOL_RESULT_MARKER)
      ) {
        const key = toolCallCacheKey(call.name, call.input);
        interruptions.set(key, (interruptions.get(key) ?? 0) + 1);
      }
    }
  }

  return interruptions;
}

/**
 * Convert ActionEntry registry to EngineTool array.
 */
export function actionsToEngineTools(
  actions: Record<string, ActionEntry>,
): EngineTool[] {
  const tools: EngineTool[] = [];
  for (const [name, entry] of Object.entries(actions)) {
    if (entry.agentTool === false) continue;
    const inputSchema = normalizeToolInputSchema(entry.tool.parameters);
    if (!inputSchema) {
      console.warn(
        `[agent] Skipping tool "${name}" because its input schema is not an object.`,
      );
      continue;
    }
    tools.push({
      name,
      description: entry.tool.description,
      inputSchema,
    });
  }
  return tools;
}

export function filterInitialEngineTools(
  tools: EngineTool[],
  initialToolNames?: string[],
): EngineTool[] {
  if (!initialToolNames) return tools;
  const names = new Set(initialToolNames);
  names.add(TOOL_SEARCH_ACTION_NAME);
  for (const tool of tools) {
    if (isDefaultLeanInitialToolName(tool.name)) {
      names.add(tool.name);
    }
  }
  return tools.filter((tool) => names.has(tool.name));
}

const DEFAULT_LEAN_INITIAL_TOOL_NAMES = new Set([
  // Broad provider/API/corpus primitives should be callable as soon as the
  // prompt teaches them; waiting for a discovery round-trip caused prod runs to
  // waste turns on provider work that was described but not loaded.
  "data-source-status",
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
  "provider-corpus-job",
  "provider-corpus-jobs",
  "query-staged-dataset",
  "list-staged-datasets",
  "delete-staged-dataset",
  "run-code",
  "get-code-execution",
  "list-extensions",
  "get-extension",
  "update-extension",
  "list-extension-history",
  "get-extension-history-version",
  // Common first-class integration shortcuts. These are included only when the
  // current app/mode registry actually exposes them.
  "bigquery",
  "search-bigquery-schema",
  "bigquery-table-info",
  "ga4",
  "amplitude",
  "prometheus",
  "grafana",
  "sentry",
  "stripe",
  "account-deep-dive",
  "slack-messages",
  "hubspot-deals",
  "hubspot-records",
  "hubspot-pipelines",
  "hubspot-metrics",
  "gong-calls",
  "github-repo-files",
  "jira",
  "jira-search",
  "gcloud",
  "notion-search",
  "pylon-search",
]);

function isDefaultLeanInitialToolName(name: string): boolean {
  if (DEFAULT_LEAN_INITIAL_TOOL_NAMES.has(name)) return true;
  return (
    name.startsWith("provider-api-") || name.startsWith("provider-corpus-")
  );
}

function extractToolSearchResultNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const result = value as { query?: unknown; results?: unknown };
  if (typeof result.query !== "string" || result.query.trim().length === 0) {
    return [];
  }
  if (!Array.isArray(result.results)) return [];
  const names: string[] = [];
  for (const item of result.results) {
    if (!item || typeof item !== "object") continue;
    const name = (item as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) names.push(name);
  }
  return names;
}

function extractToolSearchResultNamesFromMessages(
  messages: EngineMessage[],
): string[] {
  const names: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.content) {
      if (
        part.type !== "tool-result" ||
        part.toolName !== TOOL_SEARCH_ACTION_NAME ||
        typeof part.content !== "string"
      ) {
        continue;
      }
      try {
        names.push(...extractToolSearchResultNames(JSON.parse(part.content)));
      } catch {
        // Tool results are best-effort history hints; ignore non-JSON content.
      }
    }
  }
  return names;
}

function normalizeToolInputSchema(
  schema: ActionTool["parameters"] | undefined,
): EngineTool["inputSchema"] | null {
  if (!schema) return { type: "object", properties: {} };
  if (schema.type !== "object") return null;
  return {
    ...schema,
    type: "object",
    properties:
      schema.properties && typeof schema.properties === "object"
        ? schema.properties
        : {},
    required: Array.isArray(schema.required) ? schema.required : [],
  };
}

function stringifyToolInput(input: unknown): string {
  try {
    const str = JSON.stringify(redactSensitiveFields(input));
    if (!str) return String(input);
    return str.length > 500 ? `${str.slice(0, 500)}…` : str;
  } catch {
    return String(input);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

function toolCallCacheKey(toolName: string, input: unknown): string {
  return `${toolName}:${stableStringify(normalizeToolCallInputForHistory(input))}`;
}

const INTERRUPTED_TOOL_LEDGER_POLL_MS =
  process.env.NODE_ENV === "test" ? 0 : 2_000;

async function waitForInterruptedToolLedgerEntry(opts: {
  threadId: string;
  toolKey: string;
  toolName: string;
  timeoutMs: number;
  signal: AbortSignal;
  send: (event: AgentChatEvent) => void;
}): Promise<string | null> {
  const pollMs = INTERRUPTED_TOOL_LEDGER_POLL_MS;
  // Wait up to the tool's OWN declared timeout — the abandoned zombie can keep
  // running that long (e.g. a 12-minute image generation, whose provider keeps
  // generating after the run aborts), and giving up early re-runs the same
  // write tool while the original is still in flight, duplicating work and
  // double-charging. A flat sub-tool-timeout cap (previously 5 min) silently
  // truncated long tools. The run's AbortSignal still bounds this to the run's
  // remaining budget: when the run is cut off, the poll returns null and the
  // re-dispatch hits the already-aborted signal instead of launching a real
  // second call, so the wait never outlives the run.
  const maxWaitMs =
    process.env.NODE_ENV === "test" ? 1 : Math.max(0, opts.timeoutMs);
  const maxPolls =
    process.env.NODE_ENV === "test"
      ? 3
      : Math.max(1, Math.ceil(maxWaitMs / Math.max(1, pollMs)) + 1);

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    if (opts.signal.aborted) return null;
    const ledgerResult = await readLedgerEntry(opts.threadId, opts.toolKey);
    if (ledgerResult !== null) return ledgerResult;

    if (attempt >= maxPolls - 1) break;
    opts.send({
      type: "activity",
      tool: opts.toolName,
      label: `Waiting for previous ${opts.toolName} result.`,
    });
    if (pollMs <= 0) continue;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, pollMs);
      opts.signal.addEventListener("abort", done, { once: true });
    });
  }

  return null;
}

function normalizeToolErrorForBreaker(error: string): string {
  return error.replace(/\s+/g, " ").trim();
}

function rateLimitRecoveryHint(message: string): string {
  if (
    !/\b(?:429|rate[-\s]?limit|rate limited|quota exceeded|too many requests|calls limit exceeded)\b/i.test(
      message,
    )
  ) {
    return "";
  }
  return "\n\nProvider rate-limit guidance: stop retrying this provider in this turn. Report the rate limit as a coverage gap, include any evidence already gathered, and ask the user to retry after the provider quota resets if full coverage is required.";
}

const SOURCE_SWEEP_TOOL_NAME =
  /\b(?:api|calls?|deals?|events?|issues?|messages?|metrics?|provider|query|records?|request|search|tickets?|transcripts?)\b/i;

const SOURCE_SWEEP_PROVIDER_TOKEN =
  /\b(?:amplitude|apollo|bigquery|commonroom|data-source|ga4|github|gong|grafana|hubspot|jira|mixpanel|notion|posthog|postgres|postgresql|pylon|sentry|slack|stripe)\b/i;

const SOURCE_SWEEP_EXCLUDED_TOOLS = new Set([
  "chat-history",
  "list-staged-datasets",
  "manage-agent-engine",
  "manage-agent-loop-settings",
  "manage-automations",
  "manage-jobs",
  "manage-notifications",
  "manage-progress",
  "read-attachment",
  "refresh-screen",
  "resources",
  "tool-search",
  "view-screen",
]);

function normalizeToolNameForHeuristics(name: string): string {
  return name.replace(/[_-]+/g, " ");
}

function isLikelySourceSweepTool(
  name: string,
  entry: ActionEntry | undefined,
): boolean {
  if (!entry || entry.readOnly === false) return false;
  const lower = name.toLowerCase();
  if (SOURCE_SWEEP_EXCLUDED_TOOLS.has(lower)) return false;
  const normalized = normalizeToolNameForHeuristics(lower);
  return (
    SOURCE_SWEEP_PROVIDER_TOKEN.test(normalized) ||
    SOURCE_SWEEP_TOOL_NAME.test(normalized)
  );
}

function hasExhaustedSourceSweepBudget(opts: {
  priorToolCalls: readonly AgentLoopToolCallSummary[];
  actions: Record<string, ActionEntry>;
  threshold?: number;
}): boolean {
  const threshold = opts.threshold ?? SOURCE_SWEEP_TOOL_CALL_THRESHOLD;
  const counts = new Map<string, number>();
  for (const call of opts.priorToolCalls) {
    if (!isLikelySourceSweepTool(call.name, opts.actions[call.name])) continue;
    const next = (counts.get(call.name) ?? 0) + 1;
    if (next >= threshold) return true;
    counts.set(call.name, next);
  }
  return false;
}

function sourceSweepDelegationText(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  return ["task", "instructions", "message", "name"]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function isLikelySourceSweepDelegation(opts: {
  toolName: string;
  input: unknown;
}): boolean {
  if (opts.toolName !== "agent-teams") return false;
  const action = getToolAction(opts.toolName, opts.input);
  if (!["spawn", "send"].includes(action)) return false;
  const normalized = normalizeToolNameForHeuristics(
    sourceSweepDelegationText(opts.input).toLowerCase(),
  );
  if (!normalized) return false;
  return (
    SOURCE_SWEEP_PROVIDER_TOKEN.test(normalized) ||
    SOURCE_SWEEP_TOOL_NAME.test(normalized)
  );
}

function sourceSweepDelegationGuardMessage(action: string): string {
  return (
    `Skipped agent-teams ${action || "action"}: this turn already exhausted ` +
    `a read-only source/search convergence budget. Do not move that same ` +
    `provider/source sweep into agent teams, background sub-agents, or a ` +
    `follow-up thread; delegation is not a bulk mechanism and does not remove ` +
    `provider quota, timeout, or cost limits. Continue in the main turn with a ` +
    `bulk/code/provider API path if one is available, or answer from gathered ` +
    `evidence with explicit coverage gaps.`
  );
}

function restrictAgentTeamsAfterSourceSweep(tools: EngineTool[]): EngineTool[] {
  return tools.map((tool) => {
    if (tool.name !== "agent-teams") return tool;
    const actionParam = tool.inputSchema.properties?.action;
    if (!actionParam || typeof actionParam !== "object") return tool;
    return {
      ...tool,
      description:
        `${tool.description}\n\nSource-sweep budget exhausted: only these ` +
        `read-only coordination actions are available: ` +
        SOURCE_SWEEP_AGENT_TEAM_ALLOWED_ACTIONS.map(
          (action) => `"${action}"`,
        ).join(", ") +
        ". Do not spawn or message background sub-agents to continue the same provider/source sweep.",
      inputSchema: {
        ...tool.inputSchema,
        properties: {
          ...tool.inputSchema.properties,
          action: {
            ...actionParam,
            enum: [...SOURCE_SWEEP_AGENT_TEAM_ALLOWED_ACTIONS],
          },
        },
      },
    };
  });
}

export function repeatedSourceSweepGuardMessage(opts: {
  toolName: string;
  priorCalls: number;
  threshold?: number;
}): string {
  const threshold = opts.threshold ?? SOURCE_SWEEP_TOOL_CALL_THRESHOLD;
  return (
    `Skipped ${opts.toolName}: this turn already made ${opts.priorCalls} ` +
    `call(s) to the same read-only source/search tool, which exceeds the ` +
    `${threshold}-call convergence budget. Stop calling ${opts.toolName} ` +
    `one item at a time and change strategy before answering. If a broader ` +
    `read-only bulk/source mechanism is available, use it now: provider API ` +
    `catalog/docs/request tools with pagination or staging, code execution ` +
    `against staged/provider data, workspace files, or another batch-capable ` +
    `tool that can join, grep, classify, count, or aggregate without flooding ` +
    `the chat context. Do not ask the user whether to run the obvious bulk/code ` +
    `workflow when it is read-only and needed to satisfy their request; either ` +
    `do it in this turn or state exactly why it is unavailable. Do not delegate ` +
    `this same one-item-at-a-time source sweep to agent teams, background ` +
    `sub-agents, or a follow-up thread; delegation is not a bulk mechanism and ` +
    `does not remove provider quota, timeout, or cost limits. Do not leave the ` +
    `user with a "come back later" answer for this turn. If no broader path ` +
    `exists or quota/timeouts block it, answer from the evidence already ` +
    `gathered: state the source filters, count what was inspected, list ` +
    `confirmed hits, and explicitly name remaining gaps or uninspected records.`
  );
}

export function shouldGuardRepeatedSourceSweep(opts: {
  toolName: string;
  entry: ActionEntry | undefined;
  priorToolCalls: readonly AgentLoopToolCallSummary[];
  threshold?: number;
}): { toolName: string; priorCalls: number; message: string } | null {
  if (!isLikelySourceSweepTool(opts.toolName, opts.entry)) return null;
  const threshold = opts.threshold ?? SOURCE_SWEEP_TOOL_CALL_THRESHOLD;
  const priorCalls = opts.priorToolCalls.filter(
    (call) => call.name === opts.toolName,
  ).length;
  if (priorCalls < threshold) return null;
  return {
    toolName: opts.toolName,
    priorCalls,
    message: repeatedSourceSweepGuardMessage({
      toolName: opts.toolName,
      priorCalls,
      threshold,
    }),
  };
}

function seedSourceSweepToolCallsFromHistory(
  messages: EngineMessage[],
  actions: Record<string, ActionEntry>,
): AgentLoopToolCallSummary[] {
  if (!isInternalContinuationTurn(messages)) return [];

  const seeded: AgentLoopToolCallSummary[] = [];
  const turnStart = findCurrentTurnStartForContinuation(messages);
  for (const message of messages.slice(turnStart)) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool-call") continue;
      if (!isLikelySourceSweepTool(part.name, actions[part.name])) continue;
      seeded.push({
        name: part.name,
        input: normalizeToolCallInputForHistory(part.input),
      });
    }
  }
  return seeded;
}

function normalizeToolCallInputForHistory(
  input: unknown,
): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { rawInput: input };
}

function toolInputSchemaErrorResult(
  toolName: string,
  input: unknown,
  error: string,
): string {
  return (
    `Invalid action parameters for ${toolName}: ${sanitizeToolErrorText(error)}. ` +
    `Received: ${stringifyToolInput(input)}. ` +
    "The tool was not executed; retry with arguments that match the tool schema."
  );
}

type RawJsonSchema = AgentNativeJsonSchema;

const rawToolInputAjv = new Ajv({
  strict: false,
  allErrors: true,
  coerceTypes: true,
  useDefaults: false,
  removeAdditional: false,
});

const rawToolInputValidatorCache = new WeakMap<object, ValidateFunction>();

function getRawToolInputValidator(schema: RawJsonSchema): ValidateFunction {
  const cached = rawToolInputValidatorCache.get(schema);
  if (cached) return cached;
  const validator = rawToolInputAjv.compile(schema);
  rawToolInputValidatorCache.set(schema, validator);
  return validator;
}

function shouldValidateRawToolParameters(entry: ActionEntry): boolean {
  const maybeSchema = entry.schema as
    | { "~standard"?: unknown }
    | null
    | undefined;
  return !maybeSchema?.["~standard"] && Boolean(entry.tool.parameters);
}

function validateRawToolInput(
  entry: ActionEntry,
  input: unknown,
): string | null {
  if (!shouldValidateRawToolParameters(entry)) return null;
  const parameters = entry.tool.parameters;
  if (!parameters) return null;
  let validator: ValidateFunction;
  try {
    validator = getRawToolInputValidator(parameters);
  } catch (err) {
    return `tool schema is invalid: ${sanitizeToolErrorValue(err)}`;
  }
  if (validator(input === undefined ? {} : input)) return null;
  return rawToolInputAjv.errorsText(validator.errors, {
    separator: "; ",
    dataVar: "input",
  });
}

/**
 * The core agent loop — calls the engine iteratively until no more tool calls.
 * Decoupled from HTTP transport so it can run in the background.
 * Returns accumulated token usage for cost tracking.
 */
export async function runAgentLoop(opts: {
  engine: AgentEngine;
  model: string;
  systemPrompt: string;
  tools: EngineTool[];
  availableTools?: EngineTool[];
  messages: EngineMessage[];
  actions: Record<string, ActionEntry>;
  send: (event: AgentChatEvent) => void;
  signal: AbortSignal;
  ownerEmail?: string | null;
  orgId?: string | null;
  /**
   * Attachments submitted with this turn (pasted text, files, images), passed
   * through to each tool's `ActionRunContext.attachments` so actions can
   * consume a large pasted artifact by reference instead of having the model
   * re-emit it as a tool argument. See `create-extension`'s
   * `contentFromAttachment`.
   */
  attachments?: AgentChatAttachment[];
  reasoningEffort?: ReasoningEffort;
  providerOptions?: any;
  maxOutputTokens?: number;
  executionMode?: AgentExecutionMode;
  maxIterations?: number;
  finalResponseGuard?: AgentLoopFinalResponseGuard;
  threadId?: string;
  turnId?: string;
  /**
   * App-level default limits applied to every tool call unless the individual
   * ActionEntry overrides them with its own timeoutMs / maxResultChars.
   */
  toolLimits?: { timeoutMs?: number; maxResultChars?: number };
  /**
   * Stable approval keys granted by a human for actions declared
   * `needsApproval`. A call whose key is present here runs even though the
   * action requires approval; otherwise the loop pauses with
   * `approval_required`. See `AgentChatRequest.approvedToolCalls`.
   */
  approvedToolCalls?: string[];
  /**
   * In-loop processor seam (see `processors.ts`). Each processor can observe
   * streamed chunks, observe model responses around tool execution, and
   * `abort()` the run. Loop-internal config, NOT a tool/authoring surface —
   * processors only observe/mutate-stream/abort; they never define app
   * behavior or replace actions. When omitted or empty, none of the seam code
   * runs and the loop is byte-for-byte unchanged (zero overhead).
   */
  processors?: Processor[];
}): Promise<AgentLoopUsage> {
  const {
    engine,
    model,
    systemPrompt,
    tools,
    availableTools,
    messages,
    actions,
    send,
    signal,
  } = opts;
  const availableToolMap = new Map(
    (availableTools ?? tools).map((tool) => [tool.name, tool]),
  );
  const activeToolNames = new Set(tools.map((tool) => tool.name));
  let activeTools = tools;

  const expandActiveTools = (names: string[]): string[] => {
    const added: string[] = [];
    for (const name of names) {
      if (activeToolNames.has(name)) continue;
      const tool = availableToolMap.get(name);
      if (!tool) continue;
      activeToolNames.add(name);
      added.push(name);
    }
    if (added.length > 0) {
      activeTools = (availableTools ?? tools).filter((tool) =>
        activeToolNames.has(tool.name),
      );
    }
    return added;
  };

  expandActiveTools(extractToolSearchResultNamesFromMessages(messages));

  // Build the processor chain only when at least one processor is supplied so
  // the common (no-processors) path is unchanged and carries zero overhead.
  const processorChain =
    opts.processors && opts.processors.length > 0
      ? new ProcessorChain(opts.processors)
      : null;

  const usage: AgentLoopUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model,
  };

  const maxIterations = normalizeMaxIterations(
    opts.maxIterations,
    getDefaultMaxIterations(),
  );
  const toolCallHistory: AgentLoopToolCallSummary[] = [];
  const sourceSweepToolCallHistory = seedSourceSweepToolCallsFromHistory(
    messages,
    actions,
  );
  let sourceSweepDelegationGuardActive = hasExhaustedSourceSweepBudget({
    priorToolCalls: sourceSweepToolCallHistory,
    actions,
  });
  const toolResultHistory: AgentLoopToolResultSummary[] = [];
  const runCtx = getRequestRunContext();
  if (runCtx) {
    runCtx.toolCalls = toolCallHistory;
    runCtx.toolResults = toolResultHistory;
  }
  const readOnlyToolResultCache = seedReadOnlyToolResultsFromHistory(
    messages,
    actions,
  );
  const duplicateReadOnlyToolCalls = new Map<string, number>();
  const writeToolInterruptions = seedWriteToolInterruptionsFromHistory(
    messages,
    actions,
  );
  const repeatedToolErrors = new Map<string, number>();

  // Tool-call journal hard-block (resume safety). Snapshot the per-turn journal
  // ONCE here, before any tool runs in this chunk, so it reflects only PRIOR
  // run chunks of this logical turn. A write tool whose exact call already
  // completed in an earlier interrupted chunk must not re-fire its side effect;
  // when matched, runToolCall returns the journaled result instead of executing.
  // Loaded eagerly (not lazily mid-loop) so the current chunk's own
  // asynchronously-persisted tool_done events can never leak in and make a
  // same-chunk call wrongly short-circuit. Best-effort: any ledger failure
  // leaves the journal empty and all calls run normally. Fresh first-turn calls
  // see an empty journal and are unaffected.
  let toolCallJournal: ToolCallJournal | null = null;
  const consumedJournalKeys = new Set<string>();
  if (opts.threadId) {
    try {
      const priorEvents = await getCurrentTurnEventsForThread(opts.threadId);
      if (priorEvents.length > 0) {
        toolCallJournal = classifyToolCallJournal(priorEvents);
      }
    } catch {
      // Journal is a hardening layer, never a gate — a failed ledger read just
      // means no hard-block this turn.
    }
  }

  let finalGuardRetries = 0;
  let emptyFinalResponseRetries = 0;
  let iterations = 0;
  // Overridden (raised tokens, lowered effort) only after an empty-final-
  // response retry below — kept separate from `opts.maxOutputTokens`/
  // `opts.reasoningEffort` so the very first attempt is unaffected and later
  // tool-loop turns revert to the caller's original request after a success.
  let effectiveMaxOutputTokens = opts.maxOutputTokens;
  let effectiveReasoningEffort = opts.reasoningEffort;

  // Set when an in-loop processor aborts via `abort()` / throws a `TripWire`.
  // The loop emits the `tripwire` event, surfaces the reason as a final
  // assistant message, and stops cleanly.
  let tripwire: TripWire | null = null;
  const emitTripwire = (err: TripWire) => {
    tripwire = err;
    send({
      type: "tripwire",
      reason: err.message,
      ...(err.processor ? { processor: err.processor } : {}),
    });
    send({ type: "text", text: err.message });
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: err.message }],
    });
  };

  while (true) {
    if (signal.aborted) break;
    if (++iterations > maxIterations) {
      appendAgentLoopContinuation(messages, "loop_limit");
      iterations = 1;
    }

    let assistantContent: EngineContentPart[] | undefined;
    let streamedAssistantText = "";
    let terminalStopReason:
      | Extract<EngineEvent, { type: "stop" }>["reason"]
      | undefined;
    const toolCallErrors = new Map<
      string,
      { name: string; input: unknown; error: string }
    >();
    let contextMessages = messages;

    if (opts.threadId) {
      try {
        const directives = await loadContextDirectives(opts.threadId, {
          ownerEmail: opts.ownerEmail ?? null,
        });
        const protectedSegmentIds = computeProtectedSegmentIds(messages);
        const { messages: transformedMessages, appliedStatus } =
          applyContextDirectives(messages, directives, {
            protectedSegmentIds,
          });
        const manifest = await buildManifest({
          threadId: opts.threadId,
          ...(opts.turnId ? { turnId: opts.turnId } : {}),
          model,
          rawMessages: messages,
          sentMessages: transformedMessages,
          appliedStatus,
          directives,
          protectedSegmentIds,
          source: "structured",
          enforceable: true,
        });
        contextMessages = transformedMessages;
        void writeContextManifest(opts.threadId, manifest).catch((err) => {
          console.warn(
            "[context-xray] failed to write manifest:",
            err instanceof Error ? err.message : String(err),
          );
        });
      } catch (err) {
        console.warn(
          "[context-xray] context transform skipped:",
          err instanceof Error ? err.message : String(err),
        );
      }

      // Observational Memory (consumer): for long threads that have already been
      // compacted, fold the reflections+observations in as a leading context
      // block and prefer the recent-raw-message window over the full raw
      // history. No-op (returns the same array) for short threads with no OM
      // entries, so the common path is unchanged. Runs after the context-xray
      // transform so the two compose; best-effort inside the helper. Gated on an
      // authenticated owner so anonymous threads never read OM scoped to a
      // shared default identity.
      if (opts.ownerEmail) {
        contextMessages = await applyObservationalMemoryToContext(
          contextMessages,
          {
            threadId: opts.threadId,
            ownerEmail: opts.ownerEmail,
            orgId: opts.orgId ?? null,
          },
        );
      }
    }

    for (let retry = 0; ; retry++) {
      assistantContent = undefined;
      streamedAssistantText = "";
      terminalStopReason = undefined;
      toolCallErrors.clear();
      try {
        const streamOpts = {
          model,
          systemPrompt,
          messages: contextMessages,
          tools: sourceSweepDelegationGuardActive
            ? restrictAgentTeamsAfterSourceSweep(activeTools)
            : activeTools,
          abortSignal: signal,
          maxOutputTokens: resolveMaxOutputTokensForEngine(
            engine.name,
            effectiveMaxOutputTokens,
            model,
          ),
          reasoningEffort: effectiveReasoningEffort,
          providerOptions: opts.providerOptions,
        };

        const eventStream = engine.stream(streamOpts);
        let thinkingBuffer = "";
        const toolInputNames = new Map<string, string>();
        const toolInputBytes = new Map<string, number>();
        let lastToolInputActivityAt = 0;
        type ActiveToolInputPreparation = {
          id: string;
          toolName?: string;
          startedAt: number;
          lastProgressAt: number;
          bytes: number;
        };
        type ZeroByteToolInputRestart = {
          toolName: string;
          firstStartedAt: number;
          lastStartedAt: number;
          count: number;
        };
        const activeToolInputs = new Map<string, ActiveToolInputPreparation>();
        let zeroByteToolInputRestart: ZeroByteToolInputRestart | undefined;
        let endedForNoProgress = false;
        let lastModelStreamProgressAt = Date.now();
        const sendToolInputActivity = (
          toolName: string | undefined,
          toolInputId?: string,
          progressBytes?: number,
          force = false,
        ) => {
          const now = Date.now();
          if (
            !force &&
            now - lastToolInputActivityAt < TOOL_INPUT_ACTIVITY_INTERVAL_MS
          ) {
            return;
          }
          lastToolInputActivityAt = now;
          send({
            type: "activity",
            label: toolInputActivityLabel(toolName),
            ...(toolName ? { tool: toolName } : {}),
            ...(toolInputId ? { id: toolInputId } : {}),
            ...(typeof progressBytes === "number" ? { progressBytes } : {}),
          });
        };
        const actionPreparationDeadlineAt = () => {
          let deadlineAt = Number.POSITIVE_INFINITY;
          if (zeroByteToolInputRestart) {
            deadlineAt = Math.min(
              deadlineAt,
              zeroByteToolInputRestart.firstStartedAt +
                ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS,
            );
          }
          let earliestStartedAt = Number.POSITIVE_INFINITY;
          let latestPositiveProgressAt = 0;
          for (const active of activeToolInputs.values()) {
            if (active.startedAt < earliestStartedAt) {
              earliestStartedAt = active.startedAt;
            }
            if (
              active.bytes > 0 &&
              active.lastProgressAt > latestPositiveProgressAt
            ) {
              latestPositiveProgressAt = active.lastProgressAt;
            }
          }
          const progressAt =
            latestPositiveProgressAt > 0
              ? latestPositiveProgressAt
              : earliestStartedAt;
          if (Number.isFinite(progressAt)) {
            deadlineAt = Math.min(
              deadlineAt,
              progressAt + ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS,
            );
          }
          return Number.isFinite(deadlineAt) ? deadlineAt : undefined;
        };
        const modelStreamNoProgressDeadlineAt = () =>
          lastModelStreamProgressAt + MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS;
        const noProgressDeadlineAt = () => {
          const actionDeadlineAt = actionPreparationDeadlineAt();
          const modelDeadlineAt = modelStreamNoProgressDeadlineAt();
          return actionDeadlineAt === undefined
            ? modelDeadlineAt
            : Math.min(actionDeadlineAt, modelDeadlineAt);
        };
        const hasNoProgressStalled = () => Date.now() >= noProgressDeadlineAt();
        const checkpointNoProgress = () => {
          if (endedForNoProgress) return;
          send({
            type: "auto_continue",
            reason: "no_progress",
          });
          endedForNoProgress = true;
        };
        let eventIteratorReturnRequested = false;
        const requestEventIteratorReturn = (
          iterator: AsyncIterator<EngineEvent>,
          awaitReturn: boolean,
        ) => {
          if (eventIteratorReturnRequested) return;
          eventIteratorReturnRequested = true;
          let returnPromise:
            | ReturnType<NonNullable<typeof iterator.return>>
            | undefined;
          try {
            returnPromise = iterator.return?.();
          } catch {
            return;
          }
          if (!returnPromise) return;
          if (awaitReturn) return returnPromise.catch(() => undefined);
          void returnPromise.catch(() => undefined);
        };
        const nextEngineEventWithNoProgressTimeout = async (
          iterator: AsyncIterator<EngineEvent>,
        ): Promise<IteratorResult<EngineEvent>> => {
          const deadlineAt = noProgressDeadlineAt();
          const timeoutMs = Math.max(0, deadlineAt - Date.now());
          if (timeoutMs <= 0) {
            checkpointNoProgress();
            requestEventIteratorReturn(iterator, false);
            return { done: true, value: undefined };
          }
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const next = iterator.next();
          void next.catch(() => undefined);
          const timeout = new Promise<"timeout">((resolve) => {
            timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
          });
          try {
            const result = await Promise.race([next, timeout]);
            if (result === "timeout") {
              checkpointNoProgress();
              requestEventIteratorReturn(iterator, false);
              return { done: true, value: undefined };
            }
            return result;
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        };
        const trackActiveToolInput = (
          key: string,
          toolName: string | undefined,
          bytes: number,
        ) => {
          const now = Date.now();
          const previous = activeToolInputs.get(key);
          const resolvedToolName = toolName ?? previous?.toolName;
          activeToolInputs.set(key, {
            id: key,
            ...(resolvedToolName ? { toolName: resolvedToolName } : {}),
            startedAt: previous?.startedAt ?? now,
            lastProgressAt: now,
            bytes,
          });
        };
        const resetZeroByteToolInputRestart = (toolName?: string) => {
          if (!zeroByteToolInputRestart) return;
          if (!toolName || zeroByteToolInputRestart.toolName === toolName) {
            zeroByteToolInputRestart = undefined;
          }
        };
        const noteZeroByteToolInputStart = (toolName?: string) => {
          if (!toolName) return false;
          const now = Date.now();
          if (zeroByteToolInputRestart?.toolName === toolName) {
            zeroByteToolInputRestart = {
              ...zeroByteToolInputRestart,
              lastStartedAt: now,
              count: zeroByteToolInputRestart.count + 1,
            };
          } else {
            zeroByteToolInputRestart = {
              toolName,
              firstStartedAt: now,
              lastStartedAt: now,
              count: 1,
            };
          }
          return (
            zeroByteToolInputRestart.count >=
              ACTION_PREPARATION_ZERO_BYTE_RESTART_LIMIT &&
            now - zeroByteToolInputRestart.firstStartedAt >=
              ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS
          );
        };
        const eventIterator = eventStream[Symbol.asyncIterator]();
        let eventIteratorDone = false;
        try {
          while (true) {
            const nextEvent =
              await nextEngineEventWithNoProgressTimeout(eventIterator);
            if (nextEvent.done) {
              eventIteratorDone = true;
              break;
            }
            const event = nextEvent.value;
            if (hasNoProgressStalled()) {
              checkpointNoProgress();
              break;
            }
            if (event.type !== "gateway-heartbeat") {
              lastModelStreamProgressAt = Date.now();
            }
            // In-loop processor seam (stream hook). Each chunk is offered to every
            // processor's `processOutputStream` before the loop handles it. A
            // processor `abort()` throws a TripWire; catch it locally so it is not
            // mistaken for a retryable engine error, then break out cleanly.
            if (processorChain) {
              try {
                await processorChain.runStream(event);
              } catch (err) {
                if (err instanceof TripWire) {
                  emitTripwire(err);
                  break;
                }
                throw err;
              }
            }
            if (event.type === "text-delta") {
              resetZeroByteToolInputRestart();
              streamedAssistantText += event.text;
              send({ type: "text", text: event.text });
            } else if (event.type === "thinking-delta") {
              thinkingBuffer += event.text;
              // Forward thinking deltas as a distinct event type so the UI
              // can render a collapsible "Thinking…" cell while the model
              // reasons, then collapse it when content arrives.
              send({ type: "thinking", text: event.text });
            } else if (event.type === "tool-input-start") {
              const key = event.id ?? event.name;
              if (key && event.name) {
                toolInputNames.set(key, event.name);
                toolInputBytes.set(key, 0);
                trackActiveToolInput(key, event.name, 0);
              }
              sendToolInputActivity(event.name, key, undefined, true);
              if (noteZeroByteToolInputStart(event.name)) {
                send({
                  type: "auto_continue",
                  reason: "no_progress",
                });
                endedForNoProgress = true;
                break;
              }
            } else if (event.type === "tool-input-delta") {
              const key = event.id ?? event.name;
              const toolName =
                event.name ??
                (event.id ? toolInputNames.get(event.id) : undefined);
              let progressBytes: number | undefined;
              let startedZeroByteInput = false;
              if (key) {
                const hadByteRecord = toolInputBytes.has(key);
                const previous = hadByteRecord
                  ? (toolInputBytes.get(key) ?? 0)
                  : 0;
                progressBytes =
                  previous +
                  new TextEncoder().encode(event.text ?? "").byteLength;
                toolInputBytes.set(key, progressBytes);
                if (!hadByteRecord || progressBytes > previous) {
                  trackActiveToolInput(key, toolName, progressBytes);
                  if (progressBytes > 0) {
                    resetZeroByteToolInputRestart();
                  } else if (!hadByteRecord) {
                    startedZeroByteInput = true;
                  }
                }
              }
              sendToolInputActivity(toolName, key, progressBytes);
              if (
                startedZeroByteInput &&
                toolName &&
                noteZeroByteToolInputStart(toolName)
              ) {
                send({
                  type: "auto_continue",
                  reason: "no_progress",
                });
                endedForNoProgress = true;
                break;
              }
            } else if (event.type === "gateway-heartbeat") {
              send({ type: "stream_keepalive" });
            } else if (event.type === "tool-call") {
              // The authoritative tool-call blocks arrive in assistant-content.
            } else if (event.type === "tool-call-error") {
              toolCallErrors.set(event.id, {
                name: event.name,
                input: event.input,
                error: event.error,
              });
            } else if (event.type === "assistant-content") {
              assistantContent = event.parts;
            } else if (event.type === "usage") {
              usage.inputTokens += event.inputTokens;
              usage.outputTokens += event.outputTokens;
              usage.cacheReadTokens += event.cacheReadTokens ?? 0;
              usage.cacheWriteTokens += event.cacheWriteTokens ?? 0;
            } else if (event.type === "stop") {
              terminalStopReason = event.reason;
              if (event.reason === "error") {
                throw new EngineError(event.error ?? "Engine stream error", {
                  errorCode: event.errorCode,
                  upgradeUrl: event.upgradeUrl,
                  statusCode: event.statusCode,
                  providerRetryable: event.providerRetryable,
                });
              }
            }
            if (hasNoProgressStalled()) {
              checkpointNoProgress();
              break;
            }
          }
        } finally {
          if (!eventIteratorDone) {
            await requestEventIteratorReturn(
              eventIterator,
              !eventIteratorReturnRequested,
            );
          }
        }

        if (endedForNoProgress) {
          return usage;
        }

        break;
      } catch (err: unknown) {
        if (signal.aborted) throw err;
        if (isContextTooLongError(err)) {
          // ── One-shot recovery: trim old tool results and retry once ────────
          // Only attempt recovery on the first overflow (retry === 0) to avoid
          // infinite trim loops. On subsequent overflows fall through to the
          // terminal error.
          if (retry === 0) {
            const trimmed = trimOldToolResults(contextMessages);
            if (trimmed !== null) {
              // Replace the sent messages for this iteration with the trimmed
              // version, clear any partial output, and retry immediately
              // (no delay — context errors are not transient).
              contextMessages = trimmed;
              send({ type: "clear" });
              continue;
            }
          }
          throw new EngineError(
            "Conversation has grown too long. The agent tried to recover automatically but the context is still too large. You can continue in a new chat, or ask the agent to summarize the conversation and continue.",
            { errorCode: "context_length_exceeded" },
          );
        }
        if (retry < maxRetriesForError(err) && isRetryableError(err)) {
          // Clear partial text from the failed attempt so the retry
          // doesn't produce garbled duplicate output. Keep the retry itself
          // silent so transient provider/backend failures do not leak into
          // the assistant's final answer.
          send({ type: "clear" });
          await retryDelay(retry, signal);
          continue;
        }
        throw err;
      }
    }

    // A processor aborted mid-stream. The tripwire event + final message were
    // already emitted; halt the loop without sending a normal `done`.
    if (tripwire) break;

    if (!assistantContent && toolCallErrors.size > 0) {
      assistantContent = [];
    }

    if (!assistantContent) {
      // No content — done
      break;
    }

    if (toolCallErrors.size > 0) {
      const existingToolCallIds = new Set(
        assistantContent
          .filter(
            (part): part is import("./engine/types.js").EngineToolCallPart =>
              part.type === "tool-call",
          )
          .map((part) => part.id),
      );
      for (const [id, info] of toolCallErrors) {
        if (!existingToolCallIds.has(id)) {
          assistantContent.push({
            type: "tool-call",
            id,
            name: info.name,
            input: info.input,
          });
        }
      }
    }

    const assistantContentForHistory = assistantContent.map((part) =>
      part.type === "tool-call"
        ? {
            ...part,
            input: normalizeToolCallInputForHistory(part.input),
          }
        : part,
    );

    messages.push({ role: "assistant", content: assistantContentForHistory });

    const toolCallParts = assistantContent.filter(
      (p): p is import("./engine/types.js").EngineToolCallPart =>
        p.type === "tool-call",
    );

    // In-loop processor seam (step hook). Fires once per model response, around
    // tool execution, with the tool calls the model just requested (empty for a
    // final answer) plus the stop reason and cumulative usage. A coverage gate
    // can inspect what the model is about to do and `abort()` before tools run.
    if (processorChain) {
      try {
        await processorChain.runStep({
          toolCalls: toolCallsFromContent(assistantContent),
          ...(terminalStopReason ? { finishReason: terminalStopReason } : {}),
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
          },
        });
      } catch (err) {
        if (err instanceof TripWire) {
          emitTripwire(err);
          break;
        }
        throw err;
      }
    }

    const flushUnstreamedAssistantText = () => {
      if (streamedAssistantText) return;
      const text = collectTextParts(assistantContentForHistory);
      if (text) send({ type: "text", text });
    };

    if (toolCallParts.length === 0) {
      if (terminalStopReason === "max_tokens") {
        flushUnstreamedAssistantText();
        appendAgentLoopContinuation(messages, "max_tokens");
        continue;
      }
      let guard: Awaited<ReturnType<AgentLoopFinalResponseGuard>> | null = null;
      if (opts.finalResponseGuard) {
        try {
          guard = await opts.finalResponseGuard({
            messages,
            assistantContent: assistantContentForHistory,
            text: collectTextParts(assistantContentForHistory),
            toolCalls: [...toolCallHistory],
            toolResults: [...toolResultHistory],
            retryCount: finalGuardRetries,
            executionMode: opts.executionMode ?? "act",
          });
        } catch (err) {
          send({ type: "clear" });
          throw err;
        }
      }
      let guardEmittedFallback = false;
      if (guard) {
        const retryMessage =
          typeof guard === "string" ? guard : guard.retryMessage;
        const fallbackMessage =
          typeof guard === "string" ? guard : guard.fallbackMessage;
        if (finalGuardRetries < 1) {
          finalGuardRetries += 1;
          send({ type: "clear" });
          messages.push({
            role: "user",
            content: [{ type: "text", text: retryMessage }],
          });
          continue;
        }
        send({ type: "clear" });
        send({ type: "text", text: fallbackMessage ?? retryMessage });
        guardEmittedFallback = true;
      } else {
        flushUnstreamedAssistantText();
      }
      // Some providers (notably OpenAI Responses for gpt-5+) can stream a
      // successful turn that contains only reasoning content and zero output
      // text — typically when reasoning consumes the entire output-token
      // budget. Without a final text part the SSE stream still ends with a
      // clean `done`, which renders as a totally empty assistant bubble.
      // Retry so a reasoning-budget miss can still finish; each retry raises
      // the token ceiling and steps reasoning effort down a tier so it's not
      // just re-issuing the identical doomed request. If retries also come
      // back empty, surface a plain-language error.
      const hasEmptyFinalResponse =
        !guardEmittedFallback &&
        collectTextParts(assistantContentForHistory).trim().length === 0 &&
        streamedAssistantText.trim().length === 0;
      if (hasEmptyFinalResponse) {
        if (emptyFinalResponseRetries < EMPTY_FINAL_RESPONSE_RETRY_LIMIT) {
          emptyFinalResponseRetries += 1;
          effectiveMaxOutputTokens =
            resolveEmptyResponseRetryMaxOutputTokens(model);
          effectiveReasoningEffort = stepDownReasoningEffort(
            effectiveReasoningEffort,
          );
          appendAgentLoopContinuation(messages, "max_tokens");
          continue;
        }
        send({
          type: "text",
          text: "The model returned an empty response. This usually means reasoning used the full output-token budget. Try again, or pick a different model from the model menu.",
        });
      } else {
        emptyFinalResponseRetries = 0;
        effectiveMaxOutputTokens = opts.maxOutputTokens;
        effectiveReasoningEffort = opts.reasoningEffort;
      }
      break;
    }

    // Reached only when the model made tool calls (toolCallParts.length > 0),
    // i.e. it's about to do more work and produce a *new* final answer. Give
    // that next final-answer cycle a fresh guard-retry budget; otherwise
    // finalGuardRetries stays at 1 from a prior cycle and the guard is
    // permanently disabled for the rest of a long multi-step run.
    finalGuardRetries = 0;
    emptyFinalResponseRetries = 0;

    flushUnstreamedAssistantText();

    let requestedActionStop: { message: string; errorCode?: string } | null =
      null;

    // Human-in-the-loop approvals granted by the user for this turn (opt-in;
    // empty for the overwhelming majority of turns). Keyed by the stable
    // tool-call approval key so a re-issued continuation can let an approved
    // call run. The model cannot populate this — it comes from the request.
    const approvedToolCallKeys = new Set<string>(opts.approvedToolCalls ?? []);

    const runToolCall = async (
      toolCall: import("./engine/types.js").EngineToolCallPart,
    ): Promise<EngineContentPart> => {
      const wireToolInput = JSON.stringify(toolCall.input ?? {});
      const normalizedToolInput = normalizeToolCallInputForHistory(
        toolCall.input,
      );
      const actionEntry = actions[toolCall.name];
      const sourceSweepGuard = shouldGuardRepeatedSourceSweep({
        toolName: toolCall.name,
        entry: actionEntry,
        priorToolCalls: sourceSweepToolCallHistory,
      });
      const sourceSweepDelegationGuard =
        sourceSweepDelegationGuardActive &&
        isLikelySourceSweepDelegation({
          toolName: toolCall.name,
          input: toolCall.input,
        })
          ? sourceSweepDelegationGuardMessage(
              getToolAction(toolCall.name, toolCall.input),
            )
          : null;
      toolCallHistory.push({
        name: toolCall.name,
        input: normalizedToolInput,
      });
      sourceSweepToolCallHistory.push({
        name: toolCall.name,
        input: normalizedToolInput,
      });
      const recordToolResult = (content: string, isError: boolean) => {
        toolResultHistory.push({
          name: toolCall.name,
          content,
          isError,
        });
      };
      const finalizeToolErrorResult = (rawResult: string): string => {
        const sanitizedResult = sanitizeToolErrorText(rawResult);
        const errorKey = `${toolCallCacheKey(
          toolCall.name,
          toolCall.input,
        )}:${normalizeToolErrorForBreaker(sanitizedResult)}`;
        const count = (repeatedToolErrors.get(errorKey) ?? 0) + 1;
        repeatedToolErrors.set(errorKey, count);
        if (count < MAX_IDENTICAL_TOOL_ERRORS) return sanitizedResult;
        const result =
          `Stopped after ${count} identical errors from ${toolCall.name} with the same arguments. ` +
          `Last error: ${sanitizedResult}`;
        requestedActionStop ??= {
          message:
            `Stopped because ${toolCall.name} failed ${count} times with the same arguments and error. ` +
            "Fix the underlying issue or change the arguments before retrying.",
          errorCode: "repeated_identical_tool_error",
        };
        return result;
      };
      if (sourceSweepGuard) {
        sourceSweepDelegationGuardActive = true;
        const result = sourceSweepGuard.message;
        send({
          type: "tool_start",
          tool: toolCall.name,
          input: toolCall.input as Record<string, string>,
        });
        send({
          type: "tool_done",
          tool: toolCall.name,
          input: toolCall.input as Record<string, unknown>,
          result,
          completedSideEffect: false,
        });
        recordToolResult(result, false);
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: wireToolInput,
          content: result,
        };
      }

      if (sourceSweepDelegationGuard) {
        const result = sourceSweepDelegationGuard;
        send({
          type: "tool_start",
          tool: toolCall.name,
          input: toolCall.input as Record<string, string>,
        });
        send({
          type: "tool_done",
          tool: toolCall.name,
          input: toolCall.input as Record<string, unknown>,
          result,
          completedSideEffect: false,
        });
        recordToolResult(result, false);
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: wireToolInput,
          content: result,
        };
      }

      if (!actionEntry) {
        const result = finalizeToolErrorResult(
          `Error: Unknown tool "${toolCall.name}"`,
        );
        send({
          type: "tool_start",
          tool: toolCall.name,
          input: toolCall.input as Record<string, string>,
        });
        send({
          type: "tool_done",
          tool: toolCall.name,
          input: toolCall.input as Record<string, unknown>,
          result,
          isError: true,
          completedSideEffect: false,
        });
        recordToolResult(result, true);
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: wireToolInput,
          content: result,
          isError: true,
        };
      }

      // Human-in-the-loop approval gate (opt-in via defineAction
      // `needsApproval`; default off). When an action requires approval and
      // this specific call has NOT been approved by a human, pause the turn
      // instead of executing. The action's side effect never happens until a
      // human re-issues the turn approving this call's stable key.
      const approvalKey = toolCallCacheKey(toolCall.name, toolCall.input);
      if (actionEntry.needsApproval && !approvedToolCallKeys.has(approvalKey)) {
        let mustApprove = false;
        try {
          mustApprove =
            typeof actionEntry.needsApproval === "function"
              ? Boolean(
                  await actionEntry.needsApproval(toolCall.input, {
                    userEmail: getRequestUserEmail(),
                    orgId: getRequestOrgId() ?? null,
                    caller: "tool",
                  }),
                )
              : actionEntry.needsApproval === true;
        } catch {
          // Fail closed: a throwing predicate means we require approval rather
          // than silently running a high-consequence action.
          mustApprove = true;
        }
        if (mustApprove) {
          send({
            type: "tool_start",
            tool: toolCall.name,
            input: toolCall.input as Record<string, string>,
          });
          send({
            type: "approval_required",
            tool: toolCall.name,
            input: toolCall.input as Record<string, string>,
            approvalKey,
            ...(toolCall.id ? { toolCallId: toolCall.id } : {}),
          });
          // Audit the blocked attempt: the action did NOT run, but "the agent
          // tried to do X and was gated" is itself worth recording. Best-effort,
          // but AWAITED (not fire-and-forget) so the row isn't lost to a
          // serverless freeze / request teardown when the turn pauses.
          try {
            const { recordActionAudit } = await import("../audit/record.js");
            await recordActionAudit({
              config: undefined,
              args: toolCall.input,
              ctx: {
                actionName: toolCall.name,
                caller: "tool",
                userEmail: getRequestUserEmail(),
                orgId: getRequestOrgId() ?? null,
                ...(opts.threadId ? { threadId: opts.threadId } : {}),
                ...(opts.turnId ? { turnId: opts.turnId } : {}),
              },
              status: "denied",
            });
          } catch {
            // Best-effort — auditing must never break the approval pause.
          }
          const result =
            `Awaiting human approval to run "${toolCall.name}". This action did ` +
            `NOT execute — a human must approve this specific call before it ` +
            `can run. The turn is paused; do not retry.`;
          send({
            type: "tool_done",
            tool: toolCall.name,
            input: toolCall.input as Record<string, unknown>,
            result,
            completedSideEffect: false,
          });
          recordToolResult(result, false);
          requestedActionStop ??= {
            message: `Waiting for your approval to run ${toolCall.name}.`,
            errorCode: "needs-approval",
          };
          return {
            type: "tool-result" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolInput: wireToolInput,
            content: result,
          };
        }
      }

      const DEFAULT_TOOL_RESULT_CHARS = 50_000;
      // Default action tools should not undercut durable/background runs. The
      // run-manager still aborts foreground hosted runs around 40s, while
      // background runs get nearly the full 15-minute function budget.
      const DEFAULT_TOOL_TIMEOUT_MS = 12 * 60_000;
      const toolTimeoutMs =
        actionEntry.timeoutMs ??
        opts.toolLimits?.timeoutMs ??
        DEFAULT_TOOL_TIMEOUT_MS;
      const toolMaxResultChars =
        actionEntry.maxResultChars ??
        opts.toolLimits?.maxResultChars ??
        DEFAULT_TOOL_RESULT_CHARS;

      // TOOL-CALL JOURNAL HARD-BLOCK (resume safety, tool-layer enforcement).
      // The prompt-level resume journal already TELLS a resuming model not to
      // re-run completed tool calls; this enforces it at the tool layer so a
      // re-dispatched write call whose exact (tool name + input) already
      // completed in an earlier interrupted chunk of this turn does NOT execute
      // its side effect again — we return the journaled result instead and emit
      // the normal tool_start/tool_done so the transcript stays coherent.
      //
      // Gated on a non-readOnly tool + an existing prior-chunk journal (so fresh
      // calls with no completed journal entry are completely unaffected). The
      // snapshot was taken before this chunk's tools ran, so it can only match a
      // PRIOR completion, never one from the current chunk.
      if (!actionEntry.readOnly && toolCallJournal) {
        const journaled = findCompletedJournalEntry(
          toolCallJournal,
          toolCall.name,
          toolCall.input,
          consumedJournalKeys,
        );
        if (journaled) {
          const recordedResult = journaled.result ?? "";
          const result =
            `(Already completed in an earlier interrupted attempt - not re-run to avoid a duplicate side effect.)\n\n` +
            recordedResult;
          send({
            type: "tool_start",
            tool: toolCall.name,
            input: toolCall.input as Record<string, string>,
          });
          send({
            type: "tool_done",
            tool: toolCall.name,
            input: toolCall.input as Record<string, unknown>,
            result,
            completedSideEffect: false,
          });
          recordToolResult(result, false);
          return {
            type: "tool-result" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolInput: wireToolInput,
            content: result,
          };
        }
      }

      // Guard against write tools that have been interrupted too many times in
      // this turn (connection drop mid-execution → agent retries → repeat).
      // A write tool that keeps failing likely has a timeout / large-payload
      // problem; retrying indefinitely creates duplicates and confuses users.
      //
      // LEDGER RECOVERY: before applying the give-up budget, check whether the
      // previous invocation's zombie actually completed and wrote its result to
      // the durable ledger. If so, return the ledger result without re-executing
      // (prevents the duplicate side effect) and skip counting it toward the
      // interruption budget. A just-abandoned long tool may need a short grace
      // period before its detached promise writes the ledger, so wait while the
      // current run still has budget instead of immediately re-running it.
      if (!actionEntry.readOnly) {
        const writeCacheKey = toolCallCacheKey(toolCall.name, toolCall.input);
        const priorInterruptions =
          writeToolInterruptions.get(writeCacheKey) ?? 0;

        if (priorInterruptions > 0 && opts.threadId) {
          const ledgerResult = await waitForInterruptedToolLedgerEntry({
            threadId: opts.threadId,
            toolKey: writeCacheKey,
            toolName: toolCall.name,
            timeoutMs: toolTimeoutMs,
            signal,
            send,
          });
          if (ledgerResult !== null) {
            // Zombie completed — recover the real result without re-executing.
            const result =
              `(Recovered from prior interrupted chunk — action already completed.)\n\n` +
              ledgerResult;
            send({
              type: "tool_start",
              tool: toolCall.name,
              input: toolCall.input as Record<string, string>,
            });
            send({
              type: "tool_done",
              tool: toolCall.name,
              input: toolCall.input as Record<string, unknown>,
              result,
              ...(actionEntry.chatUI ? { chatUI: actionEntry.chatUI } : {}),
            });
            recordToolResult(result, false);
            return {
              type: "tool-result" as const,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              toolInput: wireToolInput,
              content: result,
            };
          }
        }

        if (priorInterruptions >= MAX_WRITE_TOOL_INTERRUPTIONS) {
          const result =
            `The ${toolCall.name} action was interrupted ${priorInterruptions} time(s) in this session — ` +
            `likely a connection timeout with a large payload. Please start a new chat and try again, ` +
            `or split the request into smaller pieces.`;
          send({
            type: "tool_start",
            tool: toolCall.name,
            input: toolCall.input as Record<string, string>,
          });
          send({
            type: "tool_done",
            tool: toolCall.name,
            input: toolCall.input as Record<string, unknown>,
            result,
            isError: true,
            completedSideEffect: false,
          });
          recordToolResult(result, true);
          requestedActionStop ??= {
            message:
              `I stopped because the ${toolCall.name} action was interrupted ${priorInterruptions} time(s) in a row. ` +
              `This usually means the connection timed out while processing a large request. ` +
              `Please start a new chat and try again, or break the request into smaller parts.`,
            errorCode: "repeated_write_tool_interruption",
          };
          return {
            type: "tool-result" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolInput: wireToolInput,
            content: result,
            isError: true,
          };
        }
      }

      // Stop BEFORE emitting tool_start if the run was already aborted —
      // typically because the ledger wait above polled for minutes and the soft
      // timeout fired meanwhile. Emitting tool_start/tool_done here would leave a
      // bogus interrupted pair in the transcript for a tool that never re-ran,
      // and re-invoking would spawn a duplicate zombie. Return the interrupted
      // marker (no events) so the next continuation recovers via the ledger.
      // (A second guard inside the try below still covers an abort that lands in
      // the tiny sync window between here and the action invocation.)
      if (signal.aborted) {
        recordToolResult(INTERRUPTED_TOOL_RESULT_MARKER, false);
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: wireToolInput,
          content: INTERRUPTED_TOOL_RESULT_MARKER,
        };
      }

      send({
        type: "tool_start",
        tool: toolCall.name,
        input: toolCall.input as Record<string, string>,
      });

      const toolCallSchemaError = toolCallErrors.get(toolCall.id);
      if (toolCallSchemaError) {
        const result = finalizeToolErrorResult(
          toolInputSchemaErrorResult(
            toolCall.name,
            toolCallSchemaError.input,
            toolCallSchemaError.error,
          ),
        );
        send({
          type: "tool_done",
          tool: toolCall.name,
          input: toolCall.input as Record<string, unknown>,
          result,
          isError: true,
          completedSideEffect: false,
        });
        recordToolResult(result, true);
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: wireToolInput,
          content: result,
          isError: true,
        };
      }

      const rawToolInputError = validateRawToolInput(
        actionEntry,
        toolCall.input,
      );
      if (rawToolInputError) {
        const result = finalizeToolErrorResult(
          toolInputSchemaErrorResult(
            toolCall.name,
            toolCall.input,
            rawToolInputError,
          ),
        );
        send({
          type: "tool_done",
          tool: toolCall.name,
          input: toolCall.input as Record<string, unknown>,
          result,
          isError: true,
          completedSideEffect: false,
        });
        recordToolResult(result, true);
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: wireToolInput,
          content: result,
          isError: true,
        };
      }

      const cacheKey =
        actionEntry.readOnly === true
          ? toolCallCacheKey(toolCall.name, toolCall.input)
          : null;
      if (cacheKey && readOnlyToolResultCache.has(cacheKey)) {
        const repeats = (duplicateReadOnlyToolCalls.get(cacheKey) ?? 0) + 1;
        duplicateReadOnlyToolCalls.set(cacheKey, repeats);
        const previousResult = readOnlyToolResultCache.get(cacheKey) ?? "";
        const result =
          `Skipped duplicate read-only call to ${toolCall.name}: identical input already ran in this turn. ` +
          `Use the previous result already in the conversation instead of calling this tool again.\n\n` +
          `Previous result:\n${previousResult}`;
        send({
          type: "tool_done",
          tool: toolCall.name,
          input: toolCall.input as Record<string, unknown>,
          result,
          completedSideEffect: false,
        });
        recordToolResult(result, false);
        if (repeats >= 3) {
          requestedActionStop ??= {
            message:
              "I stopped because the agent kept asking for the same read-only context it already had. Please send the request again if you want me to retry from a fresh turn.",
            errorCode: "duplicate_read_only_tool",
          };
        }
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: wireToolInput,
          content: result,
        };
      }

      if (
        opts.executionMode === "plan" &&
        !isPlanModeToolCallAllowed(toolCall.name, toolCall.input, actionEntry)
      ) {
        const result = planModeBlockedMessage(toolCall.name);
        send({
          type: "tool_done",
          tool: toolCall.name,
          input: toolCall.input as Record<string, unknown>,
          result,
          isError: true,
          completedSideEffect: false,
        });
        recordToolResult(result, true);
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: wireToolInput,
          content: result,
          isError: true,
        };
      }

      let result: string;
      let isError = false;
      let mcpApp:
        | import("../mcp-client/app-result.js").AgentMcpAppPayload
        | undefined;
      let toolResultImages:
        | import("./engine/types.js").EngineToolResultImagePart[]
        | undefined;
      try {
        // The run may have been aborted while we waited above for an
        // interrupted tool's ledger result (the wait can poll for minutes).
        // Re-check before invoking the action: starting it now would spawn a
        // fresh zombie execution — a duplicate side effect / double charge —
        // which the ledger-recovery path exists to prevent. The Promise.race
        // "Run aborted" leg below only rejects AFTER the action is invoked, so
        // it cannot guard this. Throw here instead, handled like any abort.
        if (signal.aborted) {
          throw new Error("Run aborted");
        }
        const timeoutSignal = AbortSignal.timeout(toolTimeoutMs);
        const actionUserEmail = opts.ownerEmail ?? getRequestUserEmail();
        const actionOrgId = opts.orgId ?? getRequestOrgId() ?? null;
        const actionContext = {
          send,
          userEmail: actionUserEmail ?? undefined,
          orgId: actionOrgId,
          caller: "tool" as const,
          attachments: opts.attachments,
          signal,
          // Audit attribution: the action name + the agent thread/turn that
          // triggered this call, so a mutation can be traced to its run.
          actionName: toolCall.name,
          ...(opts.threadId ? { threadId: opts.threadId } : {}),
          ...(opts.turnId ? { turnId: opts.turnId } : {}),
        };
        const requestContext = getRequestContext();
        const invokeAction = () =>
          actionEntry.run(
            toolCall.input as Record<string, string>,
            actionContext,
          );
        // Keep a reference to the action promise so we can attach a zombie-
        // detection continuation AFTER Promise.race abandons it on run abort.
        // The promise itself is not awaited here — Promise.race owns the await.
        const actionPromise = Promise.resolve(
          runWithRequestContext(
            {
              ...(requestContext ?? {}),
              ...(actionUserEmail ? { userEmail: actionUserEmail } : {}),
              ...(actionOrgId ? { orgId: actionOrgId } : {}),
              ...(requestContext?.run ? { run: requestContext.run } : {}),
            },
            invokeAction,
          ),
        );

        // When the run is aborted (soft-timeout / user cancel) while this tool
        // call is in flight, Promise.race below will throw "Run aborted" and the
        // action's promise becomes a zombie — it keeps running but its result is
        // never returned to the loop. If the zombie eventually resolves, write
        // the result to the durable ledger keyed by (threadId, toolKey) so the
        // next continuation chunk can recover it instead of re-executing the
        // side effect.
        if (opts.threadId && !actionEntry.readOnly) {
          const ledgerThreadId = opts.threadId;
          const ledgerToolKey = toolCallCacheKey(toolCall.name, toolCall.input);
          actionPromise
            .then((zombieRaw: unknown) => {
              const zombieMcp = isMcpActionResult(zombieRaw) ? zombieRaw : null;
              if (
                zombieMcp &&
                zombieMcp.raw &&
                typeof zombieMcp.raw === "object" &&
                (zombieMcp.raw as Record<string, unknown>).isError === true
              ) {
                return;
              }
              const zombieText = zombieMcp ? zombieMcp.text : zombieRaw;
              const zombieStr =
                typeof zombieText === "string"
                  ? zombieText
                  : JSON.stringify(zombieText, null, 2);
              void writeLedgerEntry(ledgerThreadId, ledgerToolKey, zombieStr);
            })
            .catch(() => {
              // Action errored in the zombie — no result to ledger.
            });
        }

        const raw = await Promise.race([
          actionPromise,
          new Promise<never>((_, reject) => {
            timeoutSignal.addEventListener("abort", () =>
              reject(
                new Error(
                  `Tool call timed out after ${toolTimeoutMs / 1000} seconds`,
                ),
              ),
            );
          }),
          // Stop waiting on the tool when the run itself is aborted (e.g. the
          // run-manager soft timeout, or a user cancel). Without this leg the
          // loop blocks on an in-flight tool for up to TOOL_TIMEOUT_MS after
          // the run signal has already fired.
          new Promise<never>((_, reject) => {
            if (signal.aborted) {
              reject(new Error("Run aborted"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => reject(new Error("Run aborted")),
              { once: true },
            );
          }),
        ]);
        const mcpResult = isMcpActionResult(raw) ? raw : null;
        const rawForAgent = mcpResult ? mcpResult.text : raw;
        if (
          mcpResult &&
          mcpResult.raw &&
          typeof mcpResult.raw === "object" &&
          (mcpResult.raw as Record<string, unknown>).isError === true
        ) {
          isError = true;
        }
        mcpApp = mcpResult?.mcpApp;
        // Demo mode: the agent must see the same fake data the UI shows, so
        // it can't read out a real name/email on a live screen share. Redact
        // the structured result (not the JSON string) so IDs/dates/URLs stay
        // intact and follow-up tool calls still work. Gated — the expensive
        // walk only runs when demo mode is on.
        let redacted: unknown = rawForAgent;
        const demoMode = await isDemoModeEnabled();
        if (demoMode) {
          mcpApp = undefined;
          if (typeof rawForAgent === "string") {
            try {
              redacted = JSON.stringify(
                redactDemoData(JSON.parse(rawForAgent)),
                null,
                2,
              );
            } catch {
              redacted = redactDemoString(rawForAgent);
            }
          } else {
            redacted = redactDemoData(rawForAgent);
          }
        }
        // Vision images for the model: MCP tools return standard `image`
        // content parts; first-party actions opt in via the well-known
        // `_agentImages` result field (stripped from the JSON the model
        // reads, even in demo mode). Demo mode drops the images themselves —
        // text redaction can't scrub pixels, and a screenshot would leak the
        // real names/emails the redaction exists to hide. The images array
        // never touches the ledger — only the compact text notes appended
        // below are persisted.
        let imageNotes: string[] = [];
        if (mcpResult) {
          if (!demoMode) {
            const mcpImages = extractMcpToolResultImages(mcpResult.raw);
            if (mcpImages.length > 0) toolResultImages = mcpImages;
          }
        } else {
          const extracted = extractAgentImagesFromActionResult(redacted);
          redacted = extracted.value;
          imageNotes = extracted.notes;
          if (extracted.images.length > 0 && !demoMode) {
            toolResultImages = extracted.images;
          }
        }
        if (toolResultImages) {
          imageNotes = [
            ...describeToolResultImages(toolResultImages),
            ...imageNotes,
          ];
        }
        let resultStr =
          typeof redacted === "string"
            ? redacted
            : JSON.stringify(redacted, null, 2);
        if (resultStr.length > toolMaxResultChars) {
          const truncated = resultStr.slice(0, toolMaxResultChars);
          resultStr = `${truncated}\n\n...[truncated — full result was ${resultStr.length.toLocaleString()} chars; only first ${toolMaxResultChars.toLocaleString()} shown]`;
        }
        // Image notes go after truncation so they always survive into the
        // persisted result string (the durable record that an image existed).
        if (imageNotes.length > 0) {
          resultStr = `${resultStr}\n\n${imageNotes.join("\n")}`;
        }
        result = resultStr;
        if (toolCall.name === TOOL_SEARCH_ACTION_NAME && !isError) {
          const added = expandActiveTools(
            extractToolSearchResultNames(rawForAgent),
          );
          if (added.length > 0) {
            result += `\n\nLoaded matching tool schemas for next step: ${added.join(", ")}`;
          }
        }
      } catch (err: any) {
        if (isAgentActionStopError(err)) {
          const message =
            sanitizeToolErrorValue(err.message) ||
            `Stopped after ${toolCall.name} failed.`;
          result = sanitizeToolErrorValue(err.toolResult || message);
          requestedActionStop ??= {
            message,
            ...(err.errorCode ? { errorCode: err.errorCode } : {}),
          };
        } else {
          const message = sanitizeToolErrorValue(err);
          result = `Error running ${toolCall.name}: ${message}${rateLimitRecoveryHint(message)}`;
        }
        isError = true;
      }
      if (isError) {
        result = finalizeToolErrorResult(result);
      }

      // Auto-refresh the UI after a successful mutating tool call. Any action
      // that isn't explicitly read-only is assumed to mutate. The client's
      // useDbSync listener sees a change event with source:"action" and
      // invalidates ["action"] queries so list-* / get-* refetch. This makes
      // refresh after agent writes reliable without the model needing to
      // remember to call `refresh-screen` itself.
      if (!isError && actionEntry.readOnly !== true) {
        try {
          const { notifyActionChange } =
            await import("../server/action-change.js");
          const owner = opts.ownerEmail ?? getRequestUserEmail() ?? undefined;
          const orgId = opts.orgId ?? getRequestOrgId() ?? undefined;
          await notifyActionChange({
            actionName: toolCall.name,
            ...(owner ? { owner } : {}),
            ...(orgId ? { orgId } : {}),
          });
        } catch {
          // poll module may be unavailable in non-server contexts — ignore
        }
      }

      send({
        type: "tool_done",
        tool: toolCall.name,
        input: toolCall.input as Record<string, unknown>,
        result,
        ...(isError ? { isError: true } : {}),
        ...(isError
          ? { completedSideEffect: false }
          : actionEntry.readOnly !== true
            ? { completedSideEffect: true }
            : {}),
        ...(mcpApp ? { mcpApp } : {}),
        ...(actionEntry.chatUI ? { chatUI: actionEntry.chatUI } : {}),
      });
      recordToolResult(result, isError);
      if (!isError) {
        if (cacheKey) {
          readOnlyToolResultCache.set(cacheKey, result);
        } else {
          readOnlyToolResultCache.clear();
          duplicateReadOnlyToolCalls.clear();
        }
      }
      return {
        type: "tool-result" as const,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolInput: wireToolInput,
        content: result,
        ...(isError ? { isError } : {}),
        ...(!isError && toolResultImages && toolResultImages.length > 0
          ? { images: toolResultImages }
          : {}),
      };
    };

    type ParallelBatchKind = "read" | "parallel-write";
    const getParallelBatchKind = (
      toolCall: import("./engine/types.js").EngineToolCallPart,
    ): ParallelBatchKind | null => {
      const entry = actions[toolCall.name];
      // Unknown tool name → serialize (null), don't fold it into the read-only
      // parallel batch. Misclassifying it as "read" lets it run via Promise.all
      // alongside genuine reads, which can reorder it ahead of a later mutating
      // call and break the model's intended sequencing.
      if (!entry) return null;
      if (entry.readOnly === true) return "read";
      if (entry.parallelSafe === true) return "parallel-write";
      return null;
    };

    // Engines can emit several tool-call blocks in one turn. Read-only calls
    // are always parallel. Mutating calls remain serialized by default, but
    // consecutive actions that explicitly declare `parallelSafe` can run in a
    // write batch. Reads and writes are separate batches so the model's stated
    // order still controls what data a same-turn read can observe.
    const toolResultParts: EngineContentPart[] = [];
    let parallelBatch: import("./engine/types.js").EngineToolCallPart[] = [];
    let parallelBatchKind: ParallelBatchKind | null = null;
    const flushParallelBatch = async () => {
      if (parallelBatch.length === 0) return;
      const batch = parallelBatch;
      parallelBatch = [];
      parallelBatchKind = null;
      toolResultParts.push(...(await Promise.all(batch.map(runToolCall))));
    };

    for (const toolCall of toolCallParts) {
      const batchKind = getParallelBatchKind(toolCall);
      if (batchKind) {
        if (parallelBatchKind && parallelBatchKind !== batchKind) {
          await flushParallelBatch();
        }
        parallelBatchKind = batchKind;
        parallelBatch.push(toolCall);
      } else {
        await flushParallelBatch();
        toolResultParts.push(await runToolCall(toolCall));
      }
    }
    await flushParallelBatch();

    messages.push({ role: "user", content: toolResultParts });
    if (requestedActionStop) {
      // TypeScript can't track ??= through async closures; cast to known type.
      const stop = requestedActionStop as {
        message: string;
        errorCode?: string;
      };
      send({ type: "text", text: stop.message });
      break;
    }
  }

  // A processor halted the run: the `tripwire` event and final message were
  // already emitted at the abort site. Do NOT send the normal `done` — the run
  // ended on a guardrail, not a clean turn. The result hook still fires below
  // so processors can observe the (halted) final text.
  if (tripwire) {
    if (processorChain) {
      try {
        await processorChain.runResult(
          collectTextParts(
            messages.flatMap((m) => (m.role === "assistant" ? m.content : [])),
          ),
        );
      } catch (err) {
        if (!(err instanceof TripWire)) throw err;
        // A result-hook abort is a no-op: the run is already halting.
      }
    }
    return usage;
  }

  if (!signal.aborted) {
    // In-loop processor seam (result hook). Fires once at clean run end with the
    // final assistant text so processors (e.g. a proof-of-done gate) can record
    // a verdict. A result-hook abort cannot un-finish a completed run, so a
    // TripWire here is swallowed.
    if (processorChain) {
      try {
        await processorChain.runResult(
          collectTextParts(
            messages.flatMap((m) => (m.role === "assistant" ? m.content : [])),
          ),
        );
      } catch (err) {
        if (!(err instanceof TripWire)) throw err;
      }
    }
    send({ type: "done" });
    // Clean up any zombie-completion ledger entries for this thread now that
    // the turn completed normally. If the run was aborted the ledger must stay
    // intact so the next continuation chunk can still recover from it.
    if (opts.threadId) {
      void clearLedgerForThread(opts.threadId).catch(() => {});

      // Observational Memory (producer): after a clean turn, run a best-effort
      // compaction pass so long threads accrue observations/reflections that the
      // consumer above will surface on later turns. Both the Observer and the
      // Reflector no-op below their token thresholds, so this is cheap for short
      // threads. Fire-and-forget; any failure is swallowed so OM never affects
      // the user-visible turn.
      if (opts.ownerEmail) {
        const compactThreadId = opts.threadId;
        void maybeCompactThread({
          threadId: compactThreadId,
          ownerEmail: opts.ownerEmail,
          orgId: opts.orgId ?? null,
          messages,
        }).catch((err) => {
          console.warn(
            "[observational-memory] post-turn compaction skipped:",
            err instanceof Error ? err.message : String(err),
          );
        });
      }
    }
  }
  return usage;
}

function backgroundChatProgressRunId(turnId: string): string {
  const normalized = turnId
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  return `agent-chat-${normalized || "turn"}`;
}

function isRecoverableContinuationError(event: {
  type: "error";
  error: string;
  errorCode?: string;
  recoverable?: boolean;
}): boolean {
  const code = String(event.errorCode ?? "").toLowerCase();
  const message = event.error.toLowerCase();
  if (code === "builder_gateway_error") return false;
  return (
    event.recoverable === true ||
    code === "builder_gateway_timeout" ||
    code === "builder_gateway_network_error" ||
    code === "provider_network_error" ||
    code === "stale_run" ||
    code === "timeout" ||
    code === "timeout_error" ||
    code === "http_408" ||
    code === "http_429" ||
    code === "http_529" ||
    code === "run_timeout" ||
    message.includes("timeout") ||
    message.includes("connection error") ||
    message.includes("temporarily unavailable")
  );
}

function endsAtInternalContinuationBoundary(run: ActiveRun): boolean {
  const last = run.events.at(-1)?.event;
  if (!last) return false;
  if (last.type === "auto_continue" || last.type === "loop_limit") {
    return true;
  }
  return last.type === "error" && isRecoverableContinuationError(last);
}

function isPreparingActionActivityEvent(
  event: AgentChatEvent,
): event is Extract<AgentChatEvent, { type: "activity" }> {
  if (event.type !== "activity") return false;
  const label = event.label.trim().toLowerCase();
  return label.startsWith("preparing ") && label.includes(" action");
}

export function lastUnfinishedPreparingActionToolFromEvents(
  events: readonly AgentChatEvent[],
): string | undefined {
  const active = new Map<
    string,
    {
      id?: string;
      order: number;
      tool: string;
    }
  >();
  const idlessToolStarts = new Map<string, number>();
  const removeOldestMatchingActivePreparation = (
    tool: string,
    shouldRemove: (value: {
      id?: string;
      order: number;
      tool: string;
    }) => boolean = () => true,
  ) => {
    let oldest:
      | {
          key: string;
          order: number;
        }
      | undefined;
    for (const [key, value] of active) {
      if (value.tool !== tool || !shouldRemove(value)) continue;
      if (!oldest || value.order < oldest.order) {
        oldest = {
          key,
          order: value.order,
        };
      }
    }
    if (oldest) active.delete(oldest.key);
    return Boolean(oldest);
  };
  const removeMatchingActivePreparation = (event: {
    id?: string;
    tool?: string;
    type: "tool_done" | "tool_start";
  }) => {
    const id = event.id?.trim();
    const tool = event.tool?.trim();
    if (!tool) return;
    if (id) {
      if (!active.delete(`id:${id}`)) {
        removeOldestMatchingActivePreparation(tool, (value) => !value.id);
      }
      return;
    }

    if (event.type === "tool_start") {
      if (removeOldestMatchingActivePreparation(tool)) {
        idlessToolStarts.set(tool, (idlessToolStarts.get(tool) ?? 0) + 1);
      }
      return;
    }

    const startedCount = idlessToolStarts.get(tool) ?? 0;
    if (startedCount > 0) {
      if (startedCount === 1) {
        idlessToolStarts.delete(tool);
      } else {
        idlessToolStarts.set(tool, startedCount - 1);
      }
      return;
    }
    removeOldestMatchingActivePreparation(tool);
  };
  events.forEach((event, order) => {
    if (isPreparingActionActivityEvent(event)) {
      const tool = event.tool?.trim();
      if (tool) {
        const id = event.id?.trim();
        const key = id ? `id:${id}` : `tool:${tool}:${order}`;
        active.set(key, {
          tool,
          order,
          ...(id ? { id } : {}),
        });
      }
      return;
    }
    if (event.type === "tool_start" || event.type === "tool_done") {
      removeMatchingActivePreparation(event);
      return;
    }
    if (event.type === "error" && isRecoverableContinuationError(event)) {
      return;
    }
    if (
      event.type === "clear" ||
      event.type === "done" ||
      event.type === "error" ||
      event.type === "missing_api_key"
    ) {
      active.clear();
      idlessToolStarts.clear();
    }
  });
  let latest:
    | {
        order: number;
        tool: string;
      }
    | undefined;
  for (const value of active.values()) {
    if (!latest || value.order > latest.order) {
      latest = value;
    }
  }
  return latest?.tool;
}

function endsAfterCompletedToolWithoutAssistantFinal(run: ActiveRun): boolean {
  let completedToolAfterLastAssistantText = false;
  for (const { event } of run.events) {
    if (event.type === "text" && event.text.trim().length > 0) {
      completedToolAfterLastAssistantText = false;
      continue;
    }
    if (event.type === "tool_done" && event.isError !== true) {
      completedToolAfterLastAssistantText = true;
      continue;
    }
    if (
      event.type === "clear" ||
      event.type === "error" ||
      event.type === "missing_api_key" ||
      event.type === "auto_continue" ||
      event.type === "loop_limit"
    ) {
      completedToolAfterLastAssistantText = false;
    }
  }
  return completedToolAfterLastAssistantText;
}

function lastUnfinishedPreparingActionTool(run: ActiveRun): string | undefined {
  return lastUnfinishedPreparingActionToolFromEvents(
    run.events.map(({ event }) => event),
  );
}

export function backgroundContinuationReasonForRun(
  run: ActiveRun,
): AgentLoopContinuationReason {
  const last = run.events.at(-1)?.event;
  if (last?.type === "loop_limit") return "loop_limit";
  if (
    last?.type === "auto_continue" &&
    isAgentLoopContinuationReason(last.reason)
  ) {
    return last.reason;
  }
  if (last?.type === "error" && isRecoverableContinuationError(last)) {
    return continuationReasonForResumableError(
      new EngineError(last.error, { errorCode: last.errorCode }),
    );
  }
  if (endsAfterCompletedToolWithoutAssistantFinal(run)) {
    return "stream_ended";
  }
  return "run_timeout";
}

export async function runAgentLoopWithMainChatInternalContinuations(
  opts: Parameters<typeof runAgentLoop>[0],
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const usage: Awaited<ReturnType<typeof runAgentLoop>> = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: opts.model,
  };
  const addUsage = (next: Awaited<ReturnType<typeof runAgentLoop>>) => {
    usage.inputTokens += next.inputTokens;
    usage.outputTokens += next.outputTokens;
    usage.cacheReadTokens += next.cacheReadTokens;
    usage.cacheWriteTokens += next.cacheWriteTokens;
    usage.model = next.model;
  };

  const localTurnEvents: AgentChatEvent[] = [];
  let lastAttemptWasUnfinishedContinuation = false;
  for (
    let attempt = 0;
    !opts.signal.aborted && attempt < MAIN_CHAT_INTERNAL_CONTINUATION_LIMIT;
    attempt++
  ) {
    lastAttemptWasUnfinishedContinuation = false;
    let continuationReason: AgentLoopContinuationReason | undefined;
    const attemptStartIndex = localTurnEvents.length;
    const send = (event: AgentChatEvent) => {
      localTurnEvents.push(event);
      if (
        event.type === "auto_continue" &&
        isAgentLoopContinuationReason(event.reason)
      ) {
        continuationReason = event.reason;
        return;
      }
      opts.send(event);
    };

    const nextUsage = await runAgentLoop({ ...opts, send });
    addUsage(nextUsage);

    if (!continuationReason || opts.signal.aborted) {
      return usage;
    }

    lastAttemptWasUnfinishedContinuation = true;
    const attemptEvents = localTurnEvents.slice(attemptStartIndex);
    const completedSideEffect = attemptEvents.some(
      (event) =>
        event.type === "tool_done" &&
        event.completedSideEffect === true &&
        event.isError !== true,
    );
    if (!completedSideEffect) {
      opts.send({ type: "clear" });
    }
    const actionPreparationTool =
      lastUnfinishedPreparingActionToolFromEvents(localTurnEvents);
    appendAgentLoopContinuation(opts.messages, continuationReason, {
      ...(actionPreparationTool ? { actionPreparationTool } : {}),
    });
  }

  if (!opts.signal.aborted && lastAttemptWasUnfinishedContinuation) {
    opts.send({
      type: "error",
      error: RUN_BUDGET_EXHAUSTED_MESSAGE,
      errorCode: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
      recoverable: true,
    });
  }
  return usage;
}

function endsAtContinuationBoundary(run: ActiveRun): boolean {
  return (
    endsAtInternalContinuationBoundary(run) ||
    endsAfterCompletedToolWithoutAssistantFinal(run)
  );
}

/**
 * Hard cap on server-driven background→background continuation chunks for a
 * single logical turn. A `backgroundFunction` run gets a ~13-min soft timeout,
 * so reaching this boundary at all is the rare exception (most turns finish in
 * one chunk). The cap bounds a pathological turn that would otherwise chain
 * background invocations forever, mirroring `MAX_AGENT_TEAM_CONTINUATIONS`.
 */
export const MAX_BACKGROUND_RUN_CONTINUATIONS = 20;

/**
 * Whether this run should self-fire the next server-driven continuation chunk
 * instead of depending on the client to re-POST `auto_continue`. True for
 * either of two independently-gated cases, both requiring a recoverable
 * unfinished boundary (not aborted/stopped) and a chain still under its
 * budget:
 *   - a durable-background WORKER run (`isBackgroundWorker`) — unconditional,
 *     unchanged from before; or
 *   - a FOREGROUND run when the resolved `foregroundSelfChainEligible` gate is
 *     true (see `isAgentChatForegroundSelfChainEnabled` in
 *     `durable-background.ts`) AND this specific run was never dispatched to
 *     the durable background worker (`dispatchedToBackground` false) — a run
 *     already headed to the durable background path chains via the
 *     `isBackgroundWorker` branch above, never both.
 * Aborted / user-stopped runs do NOT chain either way.
 */
export function shouldChainBackgroundContinuation(opts: {
  isBackgroundWorker: boolean;
  run: ActiveRun;
  continuationCount: number;
  /**
   * Opt-in: allow a FOREGROUND (non-background-worker) run to also
   * self-chain server-side. Default false — preserves the exact prior
   * behavior (foreground runs never chain; the client's `auto_continue`
   * re-POST is the only continuation path) when omitted.
   */
  foregroundSelfChainEligible?: boolean;
  /**
   * True when this run was dispatched to the durable background worker
   * (`dispatchToBackground` in the handler). When true, foreground self-chain
   * is never eligible — the run either IS the background worker (chains via
   * `isBackgroundWorker`) or is a foreground POST whose recovery is already
   * owned by the background circuit-breaker, not this path.
   */
  dispatchedToBackground?: boolean;
}): boolean {
  const eligible =
    opts.isBackgroundWorker ||
    (opts.foregroundSelfChainEligible === true &&
      opts.dispatchedToBackground !== true);
  return (
    eligible &&
    opts.run.status !== "aborted" &&
    endsAtContinuationBoundary(opts.run) &&
    opts.continuationCount < MAX_BACKGROUND_RUN_CONTINUATIONS
  );
}

export async function markBackgroundContinuationChunkTerminal(opts: {
  runId: string;
  continuationReason: AgentLoopContinuationReason;
  deps?: {
    updateRunStatusIfRunning?: typeof updateRunStatusIfRunning;
    setRunTerminalReason?: typeof setRunTerminalReason;
  };
}): Promise<boolean> {
  const updateStatus =
    opts.deps?.updateRunStatusIfRunning ?? updateRunStatusIfRunning;
  const setTerminalReason =
    opts.deps?.setRunTerminalReason ?? setRunTerminalReason;
  const updated = await updateStatus(opts.runId, "completed");
  if (updated) {
    await setTerminalReason(opts.runId, opts.continuationReason);
  }
  return updated;
}

export async function claimBackgroundWorkerRunEarly(opts: {
  runId: string;
  threadId?: string | null;
  markerTurnId?: string | null;
  requestTurnId?: string | null;
  continuationCount: number;
  runsInBackgroundFunction: boolean;
  backgroundRuntimeDetail?: string;
  deps?: {
    recordRunDiagnostic?: typeof recordRunDiagnostic;
    insertRun?: typeof insertRun;
    claimBackgroundRun?: typeof claimBackgroundRun;
    updateRunHeartbeat?: typeof updateRunHeartbeat;
  };
}): Promise<{ claimed: true } | { claimed: false; skipped: string }> {
  const record = opts.deps?.recordRunDiagnostic ?? recordRunDiagnostic;
  const insert = opts.deps?.insertRun ?? insertRun;
  const claim = opts.deps?.claimBackgroundRun ?? claimBackgroundRun;
  const heartbeat = opts.deps?.updateRunHeartbeat ?? updateRunHeartbeat;
  const threadId =
    typeof opts.threadId === "string" && opts.threadId.trim()
      ? opts.threadId.trim()
      : opts.runId;
  const turnId =
    typeof opts.markerTurnId === "string" && opts.markerTurnId.trim()
      ? opts.markerTurnId.trim()
      : typeof opts.requestTurnId === "string" && opts.requestTurnId.trim()
        ? opts.requestTurnId.trim()
        : opts.runId;

  await record(
    opts.runId,
    RUN_DIAG_STAGE.workerEntered,
    [
      `runsInBackgroundFunction=${opts.runsInBackgroundFunction}`,
      `continuationCount=${opts.continuationCount}`,
      opts.backgroundRuntimeDetail,
    ]
      .filter(Boolean)
      .join(" "),
  ).catch(() => {});

  if (opts.continuationCount > 0) {
    await insert(opts.runId, threadId, turnId, {
      dispatchMode: "background",
    }).catch(() => {});
  }

  const won = await claim(opts.runId);
  if (!won) {
    await record(opts.runId, RUN_DIAG_STAGE.workerClaimLost).catch(() => {});
    return { claimed: false, skipped: "already-claimed" };
  }

  await record(opts.runId, RUN_DIAG_STAGE.workerClaimed).catch(() => {});
  await heartbeat(opts.runId).catch(() => {});
  return { claimed: true };
}

/** Injectable dependencies for `chainServerDrivenContinuation` (unit tests). */
export interface ChainServerDrivenContinuationDeps {
  countRunsForTurn?: typeof countRunsForTurn;
  insertRun?: typeof insertRun;
  fireInternalDispatch?: typeof fireInternalDispatch;
  readBackgroundRunClaim?: typeof readBackgroundRunClaim;
  updateRunHeartbeat?: typeof updateRunHeartbeat;
  updateRunStatusIfRunning?: typeof updateRunStatusIfRunning;
  setRunTerminalReason?: typeof setRunTerminalReason;
  recordRunDiagnostic?: typeof recordRunDiagnostic;
  markBackgroundContinuationChunkTerminal?: typeof markBackgroundContinuationChunkTerminal;
  generateRunId?: typeof generateRunId;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Server-driven continuation handoff for a chunk that hit its soft-timeout
 * boundary still unfinished: mint the next chunk's runId, PRE-INSERT its run
 * row (so `/runs/active` never shows an idle gap and a lost dispatch is
 * reaped loudly instead of hanging silently), fire the HMAC-signed
 * `_process-run` self-dispatch carrying ids only (the body is persisted on
 * the row as `dispatch_payload`), fully AWAIT the dispatch acknowledgment
 * with retries, and mark this chunk terminal only after the handoff landed.
 * On failure every path is loud: the successor row is errored, the failure
 * is recorded as the run's diag stage, and this chunk is flipped to errored
 * with a terminal reason — never a silent loss. (For a FOREGROUND self-chain
 * the client additionally still receives the terminal `auto_continue` event
 * — run-manager emits it after this callback — so the existing client
 * re-POST path takes over as the fallback.)
 *
 * `chainViaDurableBackground` selects the dispatch target:
 *   - true  → the durable-background worker chain (unchanged behavior): the
 *     resolved background-function url on hosted Netlify (15-min budget), 3
 *     attempts, 15s response timeout (Netlify async functions 202 on enqueue).
 *   - false → the OPT-IN foreground self-chain: the framework `_process-run`
 *     route on the REGULAR function. With `AGENT_CHAT_DURABLE_BACKGROUND`
 *     off the `-background` function is never emitted into the deploy
 *     output, so the regular function is the only guaranteed target; the
 *     successor keeps the 40s chunk clamp (`backgroundFunctionRuntimeExpected`
 *     is false for this path). The regular function responds only after the
 *     successor chunk FINISHES (~40s), so a response timeout is NOT proof of
 *     a dead handoff — after a failed/timed-out attempt the successor's
 *     ATOMIC CLAIM is consulted (`readBackgroundRunClaim`): a row that
 *     flipped to `background-processing` (or already went terminal) proves
 *     the handoff landed, so no retry is fired. 2 attempts, ~10s settle.
 *
 * Never throws — all failure paths are handled (recorded + marked) inside.
 */
export async function chainServerDrivenContinuation(opts: {
  event: unknown;
  run: ActiveRun;
  effectiveThreadId: string;
  effectiveTurnId: string;
  /** The current chunk's request body — the successor's rehydration payload
   *  is derived from it (marker stripped, `internalContinuation` set). */
  requestBody: Record<string, unknown>;
  backgroundContinuationCount: number;
  chainViaDurableBackground: boolean;
  deps?: ChainServerDrivenContinuationDeps;
}): Promise<void> {
  const d = {
    countRunsForTurn: opts.deps?.countRunsForTurn ?? countRunsForTurn,
    insertRun: opts.deps?.insertRun ?? insertRun,
    fireInternalDispatch:
      opts.deps?.fireInternalDispatch ?? fireInternalDispatch,
    readBackgroundRunClaim:
      opts.deps?.readBackgroundRunClaim ?? readBackgroundRunClaim,
    updateRunHeartbeat: opts.deps?.updateRunHeartbeat ?? updateRunHeartbeat,
    updateRunStatusIfRunning:
      opts.deps?.updateRunStatusIfRunning ?? updateRunStatusIfRunning,
    setRunTerminalReason:
      opts.deps?.setRunTerminalReason ?? setRunTerminalReason,
    recordRunDiagnostic: opts.deps?.recordRunDiagnostic ?? recordRunDiagnostic,
    markBackgroundContinuationChunkTerminal:
      opts.deps?.markBackgroundContinuationChunkTerminal ??
      markBackgroundContinuationChunkTerminal,
    generateRunId: opts.deps?.generateRunId ?? generateRunId,
    sleep:
      opts.deps?.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
  };
  const { run, effectiveThreadId, effectiveTurnId } = opts;
  const runId = run.runId;

  // DURABLE PER-TURN LEDGER: bound the total number of runs one logical turn
  // may consume, counted in SQL. The in-marker `continuationCount` resets
  // whenever a fresh POST starts a new chain for the same turn (client
  // recovery, duplicate delivery), so it cannot bound cross-chain loops — the
  // SQL count survives every recovery path and is what actually kills a
  // pathological turn (the "dozens of runs on one prompt" incident class).
  const turnRunCount = await d
    .countRunsForTurn(effectiveThreadId, effectiveTurnId)
    .catch(() => null);
  if (
    turnRunCount !== null &&
    turnRunCount > MAX_BACKGROUND_RUN_CONTINUATIONS + 5
  ) {
    console.error(
      `[agent-chat] turn ${effectiveTurnId} consumed ${turnRunCount} runs — refusing to chain further`,
      runId,
    );
    const statusUpdated = await d
      .updateRunStatusIfRunning(runId, "errored")
      .catch(() => false);
    if (statusUpdated) {
      await d
        .setRunTerminalReason(runId, "turn_continuation_budget_exhausted")
        .catch(() => {});
    }
    return;
  }

  // Mint the next chunk's runId here and sign the dispatch token over it, so
  // the `_process-run` route's HMAC check and the worker's run identity
  // agree. Fresh runId (not this chunk's) so its seq log starts clean; same
  // turnId folds the assistant message across chunks.
  const nextRunId = d.generateRunId();
  const actionPreparationTool = lastUnfinishedPreparingActionTool(run);
  const continuationReason = backgroundContinuationReasonForRun(run);
  const continuationDispatchPath = opts.chainViaDurableBackground
    ? resolveAgentChatProcessRunDispatchPath()
    : AGENT_CHAT_PROCESS_RUN_PATH;
  const continuationExpectsNetlifyBackgroundFunction =
    dispatchPathTargetsNetlifyBackgroundFunction(continuationDispatchPath);
  const maxDispatchAttempts = opts.chainViaDurableBackground ? 3 : 2;
  const dispatchResponseTimeoutMs = opts.chainViaDurableBackground
    ? 15_000
    : 10_000;
  const continuationMarker = {
    runId: nextRunId,
    turnId: effectiveTurnId,
    continuationCount: opts.backgroundContinuationCount + 1,
    continuationReason,
    ...(actionPreparationTool ? { actionPreparationTool } : {}),
    backgroundFunctionRuntimeExpected:
      continuationExpectsNetlifyBackgroundFunction,
  };
  // Strip this chunk's own marker before persisting/forwarding — the next
  // chunk gets the fresh marker above.
  const continuationBody: Record<string, unknown> = {
    ...opts.requestBody,
    internalContinuation: true,
  };
  delete continuationBody[AGENT_CHAT_BACKGROUND_RUN_FIELD];
  try {
    await d
      .recordRunDiagnostic(
        runId,
        RUN_DIAG_STAGE.workerSetupStep,
        `chain_dispatch_start nextRunId=${nextRunId} reason=${continuationReason} path=${continuationDispatchPath}`,
      )
      .catch(() => {});
    // ── TRANSACTIONAL HANDOFF ──────────────────────────────────────────────
    // 1. Insert the successor row (with its rehydration payload) BEFORE
    //    firing the dispatch, so:
    //    - /runs/active shows an active run continuously across the chunk
    //      boundary (no idle gap for the client to misread as "the turn
    //      ended"), and
    //    - a lost dispatch leaves a row the unclaimed-run sweep reaps into a
    //      LOUD error instead of a silent hang.
    // 2. Await the dispatch response fully (`awaitResponse`) — this
    //    invocation is about to finish, and the old 250ms settle race let a
    //    still-in-flight handoff fetch be killed by the post-return freeze
    //    WITHOUT rejecting: the turn just stopped, silently. A Netlify
    //    background function 202s on enqueue (normally well under a second);
    //    a regular-function target instead responds only after the successor
    //    chunk finishes, so its timeout falls back to the claim check below.
    //    Retried with backoff for transient network blips.
    let nextRowInserted = false;
    try {
      await d.insertRun(nextRunId, effectiveThreadId, effectiveTurnId, {
        dispatchMode: "background",
        dispatchPayload: JSON.stringify(continuationBody),
      });
      nextRowInserted = true;
    } catch (insertErr) {
      await d
        .recordRunDiagnostic(
          runId,
          RUN_DIAG_STAGE.workerSetupStep,
          `chain_successor_insert_failed nextRunId=${nextRunId} ${
            insertErr instanceof Error ? insertErr.message : String(insertErr)
          }`,
        )
        .catch(() => {});
      console.error(
        "[agent-chat] continuation insertRun failed; dispatching with inline body:",
        insertErr instanceof Error ? insertErr.message : insertErr,
      );
    }
    const dispatchBody = nextRowInserted
      ? {
          internalContinuation: true,
          [AGENT_CHAT_BACKGROUND_RUN_FIELD]: {
            ...continuationMarker,
            payloadRef: true,
          },
        }
      : {
          ...continuationBody,
          [AGENT_CHAT_BACKGROUND_RUN_FIELD]: continuationMarker,
        };
    let dispatched = false;
    let lastDispatchErr: unknown;
    for (
      let attempt = 0;
      attempt < maxDispatchAttempts && !dispatched;
      attempt++
    ) {
      try {
        if (attempt > 0) {
          await d.sleep(500 * 2 ** attempt);
          // Keep the pre-inserted successor row visibly alive while we
          // retry: the awaited attempts + backoff can outlast
          // UNCLAIMED_BACKGROUND_RUN_GRACE_MS (25s), and without a fresh
          // heartbeat the unclaimed-run reaper / sweep could error a handoff
          // we are still delivering.
          if (nextRowInserted) {
            await d.updateRunHeartbeat(nextRunId).catch(() => {});
          }
        }
        await d.fireInternalDispatch({
          event: opts.event,
          // Durable chain: same path resolution as the initial dispatch —
          // on hosted Netlify the background function's DEFAULT url (no
          // custom config.path; async via background:true; never shadowed
          // because /.netlify/* is excluded from the /* catch-all) so each
          // chunk keeps the 15-min budget; off-Netlify the in-process
          // framework route. Foreground self-chain: always the framework
          // `_process-run` route on the regular function (see the fn doc).
          path: continuationDispatchPath,
          taskId: nextRunId,
          body: dispatchBody,
          awaitResponse: true,
          responseTimeoutMs: dispatchResponseTimeoutMs,
        });
        dispatched = true;
      } catch (dispatchErr) {
        lastDispatchErr = dispatchErr;
        // Regular-function targets (foreground self-chain) respond only
        // after the successor chunk FINISHES, so an await timeout is not
        // proof of a dead handoff. The successor's ATOMIC CLAIM is: a row
        // that left `dispatch_mode='background'` (claimed) or is already
        // terminal proves the handoff landed — stop retrying. A duplicate
        // delivery would lose the claim and no-op anyway; skipping it saves
        // wall-clock this close to the invocation deadline.
        if (!opts.chainViaDurableBackground && nextRowInserted) {
          const claim = await d
            .readBackgroundRunClaim(nextRunId)
            .catch(() => null);
          if (
            claim &&
            ((claim.dispatchMode && claim.dispatchMode !== "background") ||
              (claim.status && claim.status !== "running"))
          ) {
            dispatched = true;
            break;
          }
        }
        console.error(
          `[agent-chat] background continuation dispatch attempt ${attempt + 1} failed:`,
          dispatchErr instanceof Error ? dispatchErr.message : dispatchErr,
        );
      }
    }
    if (!dispatched) {
      // The pre-inserted successor row would otherwise sit unclaimed until
      // the sweep reaps it — error it now so the failure is immediate and
      // truthful.
      if (nextRowInserted) {
        const nextStatusUpdated = await d
          .updateRunStatusIfRunning(nextRunId, "errored")
          .catch(() => false);
        if (nextStatusUpdated) {
          await d
            .setRunTerminalReason(
              nextRunId,
              "background_continuation_dispatch_failed",
            )
            .catch(() => {});
        }
      }
      throw lastDispatchErr instanceof Error
        ? lastDispatchErr
        : new Error(String(lastDispatchErr));
    }
    await d
      .recordRunDiagnostic(
        runId,
        RUN_DIAG_STAGE.workerSetupStep,
        `chain_dispatch_sent nextRunId=${nextRunId} reason=${continuationReason}`,
      )
      .catch(() => {});
    await d
      .markBackgroundContinuationChunkTerminal({
        runId,
        continuationReason,
      })
      .catch(() => {});
  } catch (chainErr) {
    // Chain dispatch failed — fail loud so the held row goes terminal
    // instead of spinning. The reaper would also catch it, but this is
    // immediate and truthful. (Foreground self-chain: the client still
    // receives the terminal auto_continue after this returns, so its
    // existing re-POST continuation path takes over.)
    await d
      .recordRunDiagnostic(
        runId,
        RUN_DIAG_STAGE.workerThrew,
        `chain_dispatch_failed nextRunId=${nextRunId} ${
          chainErr instanceof Error ? chainErr.message : String(chainErr)
        }`,
      )
      .catch(() => {});
    console.error(
      "[agent-chat] background continuation dispatch failed:",
      chainErr instanceof Error ? chainErr.message : chainErr,
    );
    const statusUpdated = await d
      .updateRunStatusIfRunning(runId, "errored")
      .catch(() => false);
    if (statusUpdated) {
      await d
        .setRunTerminalReason(runId, "background_continuation_dispatch_failed")
        .catch(() => {});
    }
  }
}

function progressStepFromAgentChatEvent(event: AgentChatEvent): string | null {
  switch (event.type) {
    case "activity":
      return event.label;
    case "tool_start":
      return `Using ${event.tool}.`;
    case "tool_done":
      return `Finished ${event.tool}.`;
    case "agent_call":
      return event.status === "start"
        ? `Calling ${event.agent}.`
        : event.status === "done"
          ? `Finished ${event.agent}.`
          : `${event.agent} failed.`;
    case "agent_task":
      return event.status === "running"
        ? "Started background task."
        : event.status === "completed"
          ? "Background task completed."
          : "Background task failed.";
    case "agent_task_update":
      return event.currentStep || event.preview || "Background task updated.";
    case "text":
      return "Agent is responding.";
    default:
      return null;
  }
}

export function createProductionAgentHandler(
  options: ProductionAgentOptions,
): H3EventHandler {
  // Undefined = let each engine pick its own defaultModel at request time.
  const configuredModel = options.model;

  // Resolve actions — prefer `actions`, fall back to deprecated `scripts`
  const resolvedActions = options.actions ?? options.scripts ?? {};

  // Engine tools are derived from the action registry at request time so that
  // registries which mutate after handler creation (e.g. MCP servers added via
  // the settings UI) show up to the LLM without a process restart. MCP tools
  // are also scope-filtered per request — a user-scope server added by Alice
  // must not appear in Bob's tool list in a shared-process deployment.
  const getEngineTools = (
    actions: Record<string, ActionEntry> = resolvedActions,
  ) => {
    const filtered: Record<string, ActionEntry> = {};
    for (const [name, entry] of Object.entries(actions)) {
      if (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name)) {
        continue;
      }
      filtered[name] = entry;
    }
    return actionsToEngineTools(filtered);
  };

  return defineEventHandler(async (event) => {
    // Diagnostic-only setup-timing instrumentation. Captures wall-clock offsets
    // from handler entry through the work done BEFORE startRun so a slow pre-run
    // setup phase is visible in the run diagnostics. Never alters control flow.
    const setupT0 = Date.now();
    const setupMarks: Record<string, number> = {};
    const setupMark = (k: string) => {
      setupMarks[k] = Date.now() - setupT0;
    };
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    let body: AgentChatRequest;
    // The durable-background `_process-run` route already consumed and verified
    // the request body (h3 v2's web Request body stream is single-use, so a
    // second readBody would fail). It stashes the verified+augmented body here
    // so this re-entered handler reads it instead of the spent stream.
    const preInjectedBody = (event as any)?.context
      ?.__agentChatBackgroundBody as AgentChatRequest | undefined;
    if (preInjectedBody && typeof preInjectedBody === "object") {
      body = preInjectedBody;
    } else {
      try {
        body = await readBody(event);
      } catch {
        setResponseStatus(event, 400);
        return { error: "Invalid request body" };
      }
    }

    const {
      message,
      history = [],
      structuredHistory,
      references = [],
      threadId,
      attachments,
      displayMessage,
      internalContinuation,
      turnId: requestTurnId,
      model: requestModel,
      engine: requestEngine,
      effort: requestEffort,
      browserTabId,
      scope,
      trackInRunsTray,
    } = body;
    setupMark("bodyParsed");

    // Durable-background marker. Present ONLY when this handler was re-entered
    // as the Netlify background worker via the `_process-run` self-dispatch
    // (the route HMAC-verifies the dispatch before invoking us). When set, we
    // run the loop inline with the background soft-timeout, reusing the
    // pre-claimed runId/turnId — we must NOT re-claim the slot or re-dispatch.
    const backgroundRunMarker =
      body[AGENT_CHAT_BACKGROUND_RUN_FIELD] &&
      typeof body[AGENT_CHAT_BACKGROUND_RUN_FIELD] === "object" &&
      typeof body[AGENT_CHAT_BACKGROUND_RUN_FIELD]!.runId === "string"
        ? body[AGENT_CHAT_BACKGROUND_RUN_FIELD]!
        : null;
    const isBackgroundWorker = backgroundRunMarker !== null;
    // DIAGNOSTIC-ONLY: progressive per-stage hang localizer for the bg worker.
    // The worker's runId is available EARLY on the marker (the general `runId`
    // var resolves much later), so capture it now and emit the LAST setup stage
    // reached as the run's `diag_stage`. Best-effort, gated on the worker, never
    // blocks or alters control flow.
    const bgRunId = isBackgroundWorker
      ? (backgroundRunMarker?.runId as string)
      : null;
    const workerStep = (s: string) => {
      if (bgRunId)
        void recordRunDiagnostic(
          bgRunId,
          RUN_DIAG_STAGE.workerSetupStep,
          `${s}=${Date.now() - setupT0}ms`,
        ).catch(() => {});
    };
    // Whether this worker is REALLY executing inside a 15-min Netlify
    // `-background` function (proven by the runtime function name), not merely a
    // `_process-run` re-entry that may have landed on the ~60s synchronous
    // function. Only a true value unlocks the ~13-min soft-timeout budget; a
    // worker on the 60s function keeps the 40s clamp and checkpoints cleanly.
    const runsInBackgroundFunction =
      isBackgroundWorker &&
      shouldUseBackgroundFunctionTimeoutForWorker(backgroundRunMarker);
    const backgroundRuntimeDetail = isBackgroundWorker
      ? backgroundRuntimeDiagnosticDetail(backgroundRunMarker)
      : "";
    // How many server-driven background continuations have already chained into
    // this logical turn (0 on the first chunk). Used to bound the chain.
    const backgroundContinuationCount =
      isBackgroundWorker &&
      typeof backgroundRunMarker?.continuationCount === "number" &&
      Number.isFinite(backgroundRunMarker.continuationCount)
        ? Math.max(0, Math.floor(backgroundRunMarker.continuationCount))
        : 0;
    let backgroundRunClaimedEarly = false;
    if (isBackgroundWorker && bgRunId) {
      const earlyClaim = await claimBackgroundWorkerRunEarly({
        runId: bgRunId,
        threadId,
        markerTurnId:
          typeof backgroundRunMarker?.turnId === "string"
            ? backgroundRunMarker.turnId
            : null,
        requestTurnId,
        continuationCount: backgroundContinuationCount,
        runsInBackgroundFunction,
        backgroundRuntimeDetail,
      });
      if (!earlyClaim.claimed) {
        return { ok: true, skipped: earlyClaim.skipped };
      }
      backgroundRunClaimedEarly = true;
    }
    // The foreground POST decides whether to dispatch into a background
    // function. The background worker itself never re-dispatches.
    const dispatchToBackground =
      !isBackgroundWorker &&
      isAgentChatDurableBackgroundEnabled({
        appOptIn: options.durableBackgroundRuns === true,
      });
    const requestBrowserTabId = normalizeBrowserTabId(browserTabId);
    const requestChatScope = normalizeChatScope(scope);
    const requestRunCtx = ensureRequestRunContext();
    if (requestRunCtx) {
      requestRunCtx.browserTabId = requestBrowserTabId;
      requestRunCtx.chatScope = requestChatScope;
      // Let template extraContext / system-prompt builders detect the durable
      // background worker so they can skip heavy hang-prone enrichment (e.g. the
      // analytics data-dictionary read) that otherwise stalls the worker before
      // it claims its run. Set early — before the system-prompt build runs.
      requestRunCtx.isBackgroundWorker = isBackgroundWorker;
    }
    const requestMode: AgentExecutionMode =
      body.mode === "plan" ? "plan" : "act";
    const hasMessageText =
      typeof message === "string" && message.trim().length > 0;
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!hasMessageText && !hasAttachments) {
      setResponseStatus(event, 400);
      return { error: "message is required" };
    }
    let requestMessage = hasMessageText ? message : "Use the attached context.";
    let requestAttachments = Array.isArray(attachments) ? attachments : [];
    let requestDisplayMessage = displayMessage;

    // Resolve owner first so we can look up a per-owner API key. Users
    // who bring their own key use their key for this request (durable
    // across serverless cold starts via the settings table).
    const ownerEmail = await resolveAgentOwnerEmail(options, event);
    const preparedRequest = await options.prepareRequest?.({
      event,
      ownerEmail,
      message: requestMessage,
      displayMessage: requestDisplayMessage,
      attachments: requestAttachments,
      references,
      threadId,
      internalContinuation: Boolean(internalContinuation),
      mode: requestMode,
    });
    if (preparedRequest) {
      if (
        typeof preparedRequest.message === "string" &&
        preparedRequest.message.trim().length > 0
      ) {
        requestMessage = preparedRequest.message;
      }
      if (typeof preparedRequest.displayMessage === "string") {
        requestDisplayMessage = preparedRequest.displayMessage;
      }
      if (Array.isArray(preparedRequest.attachments)) {
        requestAttachments = preparedRequest.attachments;
      }
    }
    // DIAGNOSTIC-ONLY: owner/request context prep (resolveAgentOwnerEmail +
    // prepareRequest) finished. A worker stuck before this points at the
    // owner/request-context awaits.
    workerStep("db_request_ctx");

    // DIAGNOSTIC-ONLY: bracket attachment upload + text-attachment persistence.
    workerStep("attach_start");
    // Pre-upload chat attachments (images AND files/PDFs) through the framework
    // file-upload provider (Builder.io by default). The model still sees the
    // base64 multimodal content for the current turn; each uploaded attachment
    // also gets a hosted `url` injected so the agent can embed it in slides,
    // docs, or outbound messages, and callers can persist a URL reference
    // instead of the raw base64.
    //
    // When no provider is configured, leave attachments untouched and inject a
    // hint recommending Builder.io connect — the model can still see images via
    // base64, and files via their data URL / text, but has no hosted URL.
    if (
      hasAttachments &&
      requestAttachments.some(
        (a) => a.type === "image" || a.type === "file" || a.type === "document",
      )
    ) {
      try {
        const preUpload = await preUploadAttachments({
          attachments: requestAttachments,
          ownerEmail,
          includeFiles: true,
        });
        if (preUpload.injectedText) {
          requestMessage = requestMessage
            ? `${requestMessage}\n\n${preUpload.injectedText}`
            : preUpload.injectedText;
        }
      } catch (err) {
        console.warn(
          "[agent-native] preUploadAttachments failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Persist text-ish attachments as thread-scoped agent_scratch resources so
    // the model can page through them with the `read-attachment` tool. We do
    // this here — before buildUserContentWithAttachments — so the resource IDs
    // are available when we inject the truncation notice into the text content.
    const textAttachmentResourceMap = new Map<
      number,
      { resourceId: string; path: string; totalChars: number }
    >();
    if (hasAttachments && threadId) {
      try {
        const { persistTextAttachmentsAsResources } =
          await import("../server/attachment-actions.js");
        const stored = await persistTextAttachmentsAsResources({
          attachments: requestAttachments,
          threadId,
          ownerEmail,
        });
        for (const [k, v] of stored) {
          textAttachmentResourceMap.set(k, v);
        }
      } catch (err) {
        console.warn(
          "[agent-native] persistTextAttachmentsAsResources failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    // DIAGNOSTIC-ONLY: attachment upload + persistence finished.
    workerStep("attach_done");

    // When a per-request engine override is specified, resolve the API key
    // for that provider instead of the global active engine's provider.
    // DIAGNOSTIC-ONLY: bracket per-owner API-key resolution (settings/app_secrets reads).
    workerStep("apikey_start");
    let userApiKey: string | undefined;
    if (requestEngine) {
      const provider = engineToProvider(requestEngine);
      userApiKey = await getOwnerApiKey(provider, ownerEmail);
      const envVar = PROVIDER_TO_ENV[provider];
      if (
        !userApiKey &&
        envVar &&
        canUseDeployCredentialFallbackForRequest(envVar)
      ) {
        // Read-only env fallback for the requested provider.
        userApiKey = envVar ? readDeployCredentialEnv(envVar) : undefined;
      }
    } else {
      userApiKey = await getOwnerActiveApiKey(ownerEmail);
    }
    // DIAGNOSTIC-ONLY: API-key resolution finished.
    workerStep("apikey_done");

    // `options.apiKey` is the value the template constructed the plugin with
    // (often wired from a deployment env var). Honor it as host-provided
    // read-only configuration after scoped keys when deploy fallback is safe.
    const hostApiKey = canUseDeployCredentialFallbackForRequest(
      "ANTHROPIC_API_KEY",
    )
      ? (options.apiKey ?? readDeployCredentialEnv("ANTHROPIC_API_KEY"))
      : undefined;
    const effectiveApiKey = userApiKey ?? hostApiKey;

    // Resolve engine — per-request engine override takes priority
    // DIAGNOSTIC-ONLY: bracket engine resolution (Builder credential / app-default
    // settings reads inside resolveEngine).
    workerStep("engine_start");
    let engine: AgentEngine;
    try {
      engine = await resolveEngine({
        engineOption: requestEngine ?? options.engine,
        apiKey: effectiveApiKey,
        model: configuredModel,
        appId: options.appId,
      });
    } catch {
      engine = await resolveEngine({
        apiKey: effectiveApiKey,
        appId: options.appId,
      });
    }
    // DIAGNOSTIC-ONLY: engine resolution finished.
    workerStep("engine_done");

    // Honor the model the user picked in the settings UI (written via
    // `manage-agent-engine` action="set"), but only when the caller hasn't overridden it for
    // this request or at plugin construction time. Read per-request so a
    // dropdown change in the UI takes effect without a server restart. Skip
    // the DB read entirely when a higher-precedence value is set.
    // DIAGNOSTIC-ONLY: bracket stored-model resolution (getStoredModelForEngine
    // settings read).
    workerStep("model_start");
    const modelCandidate =
      requestModel ??
      configuredModel ??
      (await getStoredModelForEngine(engine, { appId: options.appId })) ??
      engine.defaultModel;
    // DIAGNOSTIC-ONLY: stored-model resolution finished.
    workerStep("model_done");
    const model = normalizeModelForEngine(engine, modelCandidate);
    const reasoningEffort = normalizeReasoningEffortForModel(
      model,
      isReasoningEffort(requestEffort)
        ? requestEffort
        : options.reasoningEffort,
    );

    options.onEngineResolved?.(engine, model);

    // One-line per-turn resolution log so it's obvious in dev which engine
    // is actually handling the request. `requestEngine` is what the client
    // sent from the model picker; `engine.name` is what resolveEngine picked.
    // Divergence between them is the usual cause of "status says builder but
    // no [builder-engine] log lines appear" confusion.
    console.log(
      `[agent-chat] resolved engine=${engine.name} model=${model} requestEngine=${requestEngine ?? "(none)"}`,
    );

    if (
      !(await isResolvedEngineUsableForRequest(engine, {
        apiKey: effectiveApiKey,
      }))
    ) {
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      setResponseHeader(event, "Connection", "keep-alive");
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                error: LLM_MISSING_CREDENTIALS_MESSAGE,
                errorCode: LLM_MISSING_CREDENTIALS_ERROR_CODE,
              })}\n\n`,
            ),
          );
          controller.close();
        },
      });
    }

    setupMark("prepDone");
    // DIAGNOSTIC-ONLY: engine/model/api-key resolution finished. A worker that
    // reached db_request_ctx but not env_config hung in attachment upload or
    // engine/model resolution.
    workerStep("env_config");
    // Run all independent pre-send steps in parallel. Each of these hits
    // the DB or invokes an action; running them sequentially was the
    // single biggest contributor to pre-LLM latency.
    const enrichedMessageThunk = () =>
      enrichMessage(requestMessage, references);
    const loopSettingsThunk = () =>
      readAgentLoopSettings({
        userEmail: ownerEmail ?? getRequestUserEmail() ?? null,
        orgId: getRequestOrgId() ?? null,
      }).catch(() => readAgentLoopSettings({}));

    let systemPromptError: any = null;
    const systemPromptThunk = (): Promise<string> =>
      (async (): Promise<string> => {
        const sysPromptStart = Date.now();
        try {
          const built =
            typeof options.systemPrompt === "function"
              ? await options.systemPrompt(event)
              : options.systemPrompt;
          return built;
        } catch (error) {
          systemPromptError = error;
          return "";
        } finally {
          setupMarks.sysPromptMs = Date.now() - sysPromptStart;
        }
      })();

    // Precise current time is volatile (changes every request) and must never
    // live in the cached system-prompt prefix — see buildRuntimeContextPrompt
    // in runtime-context.ts. It is injected here, per-turn, into the user
    // message instead, following the same pattern as the screen/url/selection
    // context below. This keeps "what time is it" answerable while leaving
    // the system prompt's runtime-context block stable at day granularity.
    const timeContextThunk = (): Promise<string> =>
      (async (): Promise<string> => {
        try {
          const tzRaw = getHeader(event, "x-user-timezone");
          const timezone =
            typeof tzRaw === "string" &&
            tzRaw.trim().length > 0 &&
            tzRaw.trim().length < 64
              ? tzRaw.trim()
              : undefined;
          return buildCurrentTimeUserContext({ timezone });
        } catch {
          return buildCurrentTimeUserContext();
        }
      })();

    const screenContextThunk = (): Promise<string> =>
      (async (): Promise<string> => {
        const screenStart = Date.now();
        try {
          const viewScreenAction = resolvedActions["view-screen"];
          if (viewScreenAction) {
            const result = await viewScreenAction.run(
              {},
              {
                userEmail: getRequestUserEmail(),
                orgId: getRequestOrgId() ?? null,
                caller: "tool",
              },
            );
            if (result && result !== "(no output)") {
              const screenText =
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2);
              return `\n\n<current-screen>\n${capScreenContext(screenText)}\n</current-screen>`;
            }
          } else {
            const navigation = await readAppStateForBrowserTab(
              "navigation",
              requestBrowserTabId,
            );
            if (navigation) {
              return `\n\n<current-screen>\n${capScreenContext(JSON.stringify(navigation, null, 2))}\n</current-screen>`;
            }
          }
        } catch {
          // DB not ready or no navigation state — skip silently
        } finally {
          setupMarks.screenMs = Date.now() - screenStart;
        }
        return "";
      })();

    const urlContextThunk = (): Promise<string> =>
      (async (): Promise<string> => {
        try {
          const url = (await readAppStateForBrowserTab(
            "__url__",
            requestBrowserTabId,
          )) as {
            pathname?: string;
            search?: string;
            hash?: string;
            searchParams?: Record<string, string>;
          } | null;
          if (url && (url.pathname || url.search || url.hash)) {
            const lines: string[] = [];
            if (url.pathname) lines.push(`pathname: ${url.pathname}`);
            const extensionId = url.pathname
              ? extensionIdFromPathname(url.pathname)
              : null;
            if (extensionId) lines.push(`extensionId: ${extensionId}`);
            if (url.search) lines.push(`search: ${url.search}`);
            if (url.hash) lines.push(`hash: ${url.hash}`);
            if (url.searchParams && Object.keys(url.searchParams).length > 0) {
              lines.push("searchParams:");
              for (const [k, v] of Object.entries(url.searchParams)) {
                lines.push(`  ${k}: ${v}`);
              }
            }
            return `\n\n<current-url>\n${lines.join("\n")}\n</current-url>`;
          }
        } catch {
          // DB not ready — skip silently
        }
        return "";
      })();

    // Selection context: written by the client when the user presses Cmd+I
    // with text selected on the page. Treat anything older than 5 minutes
    // as stale and ignore it.
    const SELECTION_TTL_MS = 5 * 60 * 1000;
    const selectionContextThunk = (): Promise<string> =>
      (async (): Promise<string> => {
        try {
          const sel = (await readAppState("pending-selection-context")) as {
            text?: string;
            capturedAt?: number;
          } | null;
          if (!sel?.text) return "";
          const capturedAt =
            typeof sel.capturedAt === "number" ? sel.capturedAt : 0;
          if (Date.now() - capturedAt > SELECTION_TTL_MS) return "";
          return (
            `\n\nThe user has selected the following text and pressed Cmd+I to focus the agent. ` +
            `Treat this as the immediate context to act on:\n` +
            `<selection>\n${capSelectionContext(sel.text)}\n</selection>`
          );
        } catch {
          // DB not ready — skip silently
        }
        return "";
      })();

    // On the first message of a conversation, inject workspace inventory
    // so the agent knows what files, skills, jobs, and custom agents exist.
    // Templates can opt out via `skipFilesContext: true` when the inventory
    // is unrelated to the app's job (e.g. a voice-first macro tracker).
    const filesContextThunk = (): Promise<string> =>
      (async (): Promise<string> => {
        let filesContext = "";
        if (options.skipFilesContext) return filesContext;
        if (history.length === 0) {
          try {
            const {
              resourceListAccessible,
              SHARED_OWNER,
              WORKSPACE_OWNER,
              resourceGet,
            } = await import("../resources/store.js");
            const {
              getResourceKind,
              parseCustomAgentProfile,
              parseRemoteAgentManifest,
              parseSkillMetadata,
            } = await import("../resources/metadata.js");
            const ownerEmail = getRequestUserEmail();
            const orgId = getRequestOrgId();
            if (!ownerEmail) throw new Error("no authenticated user");
            const allResources = await resourceListAccessible(
              ownerEmail,
              undefined,
              { userEmail: ownerEmail, orgId },
            );

            if (allResources.length > 0) {
              const fileLines: string[] = [];
              const skillLines: string[] = [];
              const agentLines: string[] = [];
              const jobLines: string[] = [];
              for (const r of allResources) {
                const scope =
                  r.owner === WORKSPACE_OWNER
                    ? "workspace"
                    : r.owner === SHARED_OWNER
                      ? "shared"
                      : "personal";
                const kind = getResourceKind(r.path);
                if (kind === "file") {
                  fileLines.push(`  ${r.path} (${scope})`);
                  continue;
                }

                if (kind === "job") {
                  jobLines.push(`  ${r.path} (${scope})`);
                  continue;
                }

                if (
                  kind === "skill" ||
                  kind === "agent" ||
                  kind === "remote-agent"
                ) {
                  const full = await resourceGet(r.id, {
                    userEmail: ownerEmail,
                    orgId,
                  });
                  if (!full) continue;
                  if (kind === "skill") {
                    const skill = parseSkillMetadata(full.content, r.path);
                    skillLines.push(
                      `  ${skill?.name || r.path} — ${compactInventoryDescription(skill?.description || r.path)} (${scope}, ${r.path})`,
                    );
                  } else if (kind === "agent") {
                    const agent = parseCustomAgentProfile(full.content, r.path);
                    agentLines.push(
                      `  ${agent?.name || r.path} — ${compactInventoryDescription(agent?.description || "Custom workspace agent")} (${scope}, ${r.path}${agent?.model ? `, model: ${agent.model}` : ""})`,
                    );
                  } else {
                    const agent = parseRemoteAgentManifest(
                      full.content,
                      r.path,
                    );
                    agentLines.push(
                      `  ${agent?.name || r.path} — ${compactInventoryDescription(agent?.description || "Connected A2A agent")} (${scope}, remote via ${r.path})`,
                    );
                  }
                }
              }
              const blocks: string[] = [];
              if (fileLines.length > 0) {
                const lines = limitInventoryLines(fileLines, "files");
                blocks.push(
                  `<available-files>\nFiles in the workspace:\n${lines.join("\n")}\n\nTo read a resource file's contents, use the resources tool with action "read" and the file path.\n</available-files>`,
                );
              }
              if (skillLines.length > 0) {
                const lines = limitInventoryLines(skillLines, "skills");
                blocks.push(
                  `<available-skills>\nSkills in the workspace:\n${lines.join("\n")}\n\nBefore using a matching workspace skill, read its path with the resources tool using action "read"; slash-selected skills are inlined automatically when available.\n</available-skills>`,
                );
              }
              if (agentLines.length > 0) {
                const lines = limitInventoryLines(agentLines, "agents");
                blocks.push(
                  `<available-agents>\nCustom and connected agents in the workspace:\n${lines.join("\n")}\n\nCustom agents under agents/*.md can be mentioned or used via agent-teams (action: "spawn") with the agent parameter.\n</available-agents>`,
                );
              }
              if (jobLines.length > 0) {
                const lines = limitInventoryLines(jobLines, "jobs");
                blocks.push(
                  `<available-jobs>\nScheduled tasks in the workspace:\n${lines.join("\n")}\n</available-jobs>`,
                );
              }
              filesContext =
                blocks.length > 0 ? `\n\n${blocks.join("\n\n")}` : "";
            }
          } catch {
            // Resources not available — skip silently
          }
        }
        return filesContext;
      })();

    // Durable bg worker: a pre-send step that HANGS (rather than erroring) would
    // otherwise stall the worker until the foreground inline-recovery grace
    // (~16s) — wasting the entire 15-min durable budget and leaving the run
    // un-claimed (the exact analytics symptom: diag stuck at model_done,
    // preStart≈18s). `presendCap` takes a THUNK (not an eagerly-started promise):
    // the work runs INSIDE the cap, after the timer is armed, so a step whose
    // own synchronous prefix is heavy can still be timed out — an eagerly-created
    // promise would start (and could block the loop) before the cap ever wrapped
    // it. On timeout it records `presend_timeout:<label>` so a stalled phase is
    // attributable, then degrades to the fallback so the worker proceeds to
    // claim. Foreground keeps the un-capped path (thunk invoked immediately), so
    // its behaviour is unchanged. A rejected step (e.g. enrichMessage has no
    // .catch) resolves to the fallback instead of rejecting the whole batch.
    const presendCap = <T>(
      label: string,
      thunk: () => Promise<T>,
      fallback: T,
      ms: number,
    ): Promise<T> => {
      if (!isBackgroundWorker) return thunk();
      return new Promise<T>((resolve) => {
        const timer = setTimeout(() => {
          workerStep(`presend_timeout:${label}`);
          resolve(fallback);
        }, ms);
        // Defer invocation one microtask so every sibling cap arms its timer
        // before any thunk's synchronous prefix runs.
        void Promise.resolve()
          .then(thunk)
          .then(
            (v) => {
              clearTimeout(timer);
              resolve(v);
            },
            () => {
              clearTimeout(timer);
              resolve(fallback);
            },
          );
      });
    };
    const fallbackLoopSettings: AgentLoopSettings = {
      maxIterations: getDefaultMaxIterations(),
      defaultMaxIterations: getDefaultMaxIterations(),
      minMaxIterations: MIN_AGENT_MAX_ITERATIONS,
      maxMaxIterations: MAX_AGENT_MAX_ITERATIONS,
      scope: "default",
      source: "default",
    };
    const [
      systemPrompt,
      timeBlock,
      screenBlock,
      urlBlock,
      selectionBlock,
      filesContext,
      loopSettings,
      enrichedMessage,
    ] = await Promise.all([
      presendCap("systemPrompt", systemPromptThunk, "", 13000),
      presendCap("time", timeContextThunk, "", 9000),
      presendCap("screen", screenContextThunk, "", 9000),
      presendCap("url", urlContextThunk, "", 9000),
      presendCap("selection", selectionContextThunk, "", 9000),
      presendCap("files", filesContextThunk, "", 12000),
      presendCap("loopSettings", loopSettingsThunk, fallbackLoopSettings, 9000),
      presendCap("enrichedMessage", enrichedMessageThunk, requestMessage, 9000),
    ]);
    setupMark("ctxAll");
    // DIAGNOSTIC-ONLY: all parallel context gathering (system prompt, screen,
    // files, loop settings, enriched message) resolved.
    workerStep("context_all");

    if (systemPromptError) {
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      const encoder = new TextEncoder();
      const err = systemPromptError;
      return new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: `Failed to load system prompt: ${err?.message ?? String(err)}` })}\n\n`,
            ),
          );
          controller.close();
        },
      });
    }
    const screenContext = timeBlock + screenBlock + urlBlock + selectionBlock;
    const requestActions =
      requestMode === "plan"
        ? createPlanModeActionRegistry(resolvedActions)
        : resolvedActions;
    const availableRequestTools = getEngineTools(requestActions);
    const requestTools = filterInitialEngineTools(
      availableRequestTools,
      options.initialToolNames,
    );
    setupMark("actions");
    // DIAGNOSTIC-ONLY: action/tool resolution + engine-tool filtering finished.
    workerStep("action_tool_setup");
    const requestSystemPrompt =
      requestMode === "plan"
        ? `${systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`
        : systemPrompt;

    // Pre-compute agent references for A2A resolution inside the run
    const agentRefs = references.filter((r) => r.type === "agent");
    const customAgentRefs = references.filter((r) => r.type === "custom-agent");
    const planModeAgentNote =
      requestMode === "plan" && agentRefs.length > 0
        ? "\n\n<plan-mode-note>Connected external agent mentions were not called because Plan mode is read-only. Mention that they can be called after the user switches to Act mode if the plan needs them.</plan-mode-note>"
        : "";

    const userContent = buildUserContentWithAttachments({
      text: enrichedMessage + screenContext + filesContext + planModeAgentNote,
      attachments: requestAttachments,
    });

    const historyMessages =
      structuredHistoryToEngineMessages(structuredHistory) ??
      history
        .filter((m) => m.content.trim())
        .map(
          (m): EngineMessage => ({
            role: m.role as "user" | "assistant",
            content: [{ type: "text" as const, text: m.content }],
          }),
        );

    const messages: EngineMessage[] = [
      ...historyMessages,
      { role: "user" as const, content: userContent },
    ];

    // Atomically claim the run slot for this thread. The claim checks SQL for
    // a live (non-stale) running row so two near-simultaneous POSTs on
    // different serverless isolates both see the correct state — a plain
    // read-then-act check races on multi-isolate deployments because both
    // reads see no running row before either insert commits.
    //
    // The background worker SKIPS this: the foreground POST already claimed the
    // slot and inserted the run row before dispatching, so re-claiming here
    // would falsely 409 against the row the foreground holds.
    if (threadId && !isBackgroundWorker) {
      const slot = await tryClaimRunSlot(threadId);
      if (!slot.claimed) {
        setResponseStatus(event, 409);
        return {
          error: "Run already in progress for this thread",
          activeRunId: slot.activeRunId,
        };
      }
    }

    // Start agent loop in background via run-manager. The background worker
    // reuses the runId carried in the marker (signed into the dispatch token):
    //  - First background chunk (count 0): the foreground generated + INSERTED
    //    this runId, so the event stream the client is already subscribed to is
    //    the one we write to.
    //  - Chained continuation chunk (count > 0): the prior chunk minted a FRESH
    //    runId for this one (a reused runId would restart `startRun`'s in-memory
    //    seq log at 0 and collide with the prior chunk's persisted seqs, which
    //    insertRunEvent's ON CONFLICT would drop — making the continuation
    //    invisible). A fresh runId on the SAME thread + SAME turnId folds onto
    //    one assistant message and is surfaced by the existing
    //    `/runs/active?threadId` reconnect path. The continuation worker inserts
    //    its own background row below (the foreground only inserted chunk-0's).
    const isChainedBackgroundContinuation =
      isBackgroundWorker && backgroundContinuationCount > 0;
    const runId = backgroundRunMarker?.runId ?? generateRunId();
    const effectiveThreadId = threadId ?? runId;
    const effectiveTurnId =
      typeof backgroundRunMarker?.turnId === "string" &&
      backgroundRunMarker.turnId.trim()
        ? backgroundRunMarker.turnId.trim()
        : typeof requestTurnId === "string" && requestTurnId.trim()
          ? requestTurnId.trim()
          : runId;
    const messageToPersist =
      typeof requestDisplayMessage === "string" &&
      requestDisplayMessage.trim().length > 0
        ? requestDisplayMessage
        : requestMessage;

    // Server-driven background continuation: when the background worker re-fired
    // itself at a soft-timeout boundary (a chained continuation chunk), rebuild
    // the conversation from the persisted thread_data so the next chunk resumes
    // from committed progress instead of restarting from the original user
    // message (which would re-do work — the re-hydration thrash the design doc
    // calls out). Mirrors the agent-teams continuation, which seeds from
    // thread_data + appends a continuation nudge. Falls back to the body-derived
    // `messages` if thread_data is empty/unreadable — a continuation that
    // restarts is worse than one that resumes, but both are correct.
    if (isChainedBackgroundContinuation && effectiveThreadId) {
      try {
        const { getThread } = await import("../chat-threads/store.js");
        const { threadDataToEngineMessages } =
          await import("./thread-data-builder.js");
        const priorThreadData = (await getThread(effectiveThreadId))
          ?.threadData;
        const resumed = threadDataToEngineMessages(priorThreadData);
        if (resumed.length > 0) {
          const actionPreparationTool =
            typeof backgroundRunMarker?.actionPreparationTool === "string" &&
            backgroundRunMarker.actionPreparationTool.trim()
              ? backgroundRunMarker.actionPreparationTool.trim()
              : undefined;
          const continuationReason = isAgentLoopContinuationReason(
            backgroundRunMarker?.continuationReason,
          )
            ? backgroundRunMarker.continuationReason
            : "run_timeout";
          appendAgentLoopContinuation(resumed, continuationReason, {
            ...(actionPreparationTool ? { actionPreparationTool } : {}),
          });
          messages.length = 0;
          messages.push(...resumed);
        }
      } catch {
        // Keep the body-derived messages — never drop the run.
      }
    }
    setupMark("depsThread");
    // DIAGNOSTIC-ONLY: owner/thread resolution + runId/effectiveThreadId +
    // chained-continuation thread fetch finished.
    workerStep("owner_thread");

    // Persist the user's turn exactly once. The foreground POST does this
    // before dispatching; the background worker must NOT repeat it (it re-enters
    // with the same body, which would double-persist the user message).
    if (options.onRunPrepared && !internalContinuation && !isBackgroundWorker) {
      await options.onRunPrepared({
        runId,
        threadId,
        message: messageToPersist,
        attachments: requestAttachments,
      });
    }

    // ─── Durable-background dispatch decision ──────────────────────────────
    // Flag active (hosted + A2A_SECRET + AGENT_CHAT_DURABLE_BACKGROUND) and we
    // are the FOREGROUND POST: insert the run row (marked background), fire an
    // HMAC-signed self-dispatch into the Netlify background function (15-min
    // budget), and return the SSE subscription immediately. The client streams
    // the same events via the cross-isolate SQL-poll path with no client
    // change. With the flag OFF this whole branch is skipped and the inline
    // `startRun` path below runs exactly as before (byte-for-byte).
    if (dispatchToBackground) {
      let backgroundRowInserted = false;
      try {
        // Insert the run row up front so /runs/active sees it immediately and
        // the slot stays held while the background function cold-starts. Mark
        // it background-dispatched so the stale reaper uses the wider window.
        // The full request body is persisted ON the row (dispatch_payload) so
        // the self-POST below can carry only the tiny marker — Netlify caps
        // background-function request bodies at 256KB, and a large chat
        // history (inline attachments especially) silently exceeded that.
        await insertRun(runId, effectiveThreadId, effectiveTurnId, {
          dispatchMode: "background",
          dispatchPayload: JSON.stringify(body),
        });
        backgroundRowInserted = true;
      } catch (err) {
        // A duplicate-PK collision means the row already exists (ret­ried POST);
        // any other failure means we can't safely hand off — fall back to the
        // inline path rather than dropping the turn.
        console.error(
          "[agent-chat] background insertRun failed; falling back to inline:",
          err instanceof Error ? err.message : err,
        );
      }

      let dispatched = false;
      const backgroundDispatchPath = resolveAgentChatProcessRunDispatchPath();
      const expectsNetlifyBackgroundFunction =
        dispatchPathTargetsNetlifyBackgroundFunction(backgroundDispatchPath);
      try {
        await fireInternalDispatch({
          event,
          // On hosted Netlify this resolves to the background function's DEFAULT
          // url (/.netlify/functions/<name>, or per-app <app>-agent-background for
          // workspaces) — the function declares NO custom config.path, so it keeps
          // its default url, and `background: true` makes that url async (202,
          // 15-min budget). The `server` /* catch-all already excludes /.netlify/*
          // so it never shadows it. Off-Netlify this resolves to the framework
          // `_process-run` route and the same in-process catch-all handles it
          // inline. `fireInternalDispatch` strips the app base path for
          // /.netlify/* targets so the request reaches the host-root function url;
          // the Authorization Bearer HMAC is preserved either way.
          path: backgroundDispatchPath,
          taskId: runId,
          // When the row (and its persisted payload) landed, send only the
          // marker — the worker rehydrates the body from dispatch_payload
          // (`payloadRef`), keeping the self-POST far under Netlify's 256KB
          // background-function body cap. If the insert failed we fall back to
          // carrying the full body inline, exactly as before.
          body: backgroundRowInserted
            ? {
                [AGENT_CHAT_BACKGROUND_RUN_FIELD]: {
                  runId,
                  turnId: effectiveTurnId,
                  backgroundFunctionRuntimeExpected:
                    expectsNetlifyBackgroundFunction,
                  payloadRef: true,
                },
              }
            : {
                ...body,
                // Carry the pre-claimed identity so the worker reuses this run.
                [AGENT_CHAT_BACKGROUND_RUN_FIELD]: {
                  runId,
                  turnId: effectiveTurnId,
                  backgroundFunctionRuntimeExpected:
                    expectsNetlifyBackgroundFunction,
                },
              },
        });
        dispatched = true;
      } catch (err) {
        console.error(
          "[agent-chat] background dispatch failed; falling back to inline:",
          err instanceof Error ? err.message : err,
        );
      }

      // ─── Circuit-breaker: a 202 only ENQUEUES the background invocation ─────
      // It is NOT proof the worker executed. If the generated background-function
      // wrapper fails to import `./main.mjs` or hand off to the Nitro
      // `_process-run` route, the worker never reaches `claimBackgroundRun`: the
      // row sits at `dispatch_mode='background'` until the reaper errors it
      // ("worker never claimed the run"). `resolveBackgroundDispatchOutcome`
      // polls briefly for the claim and decides:
      //   - "stream":    a worker claimed the run → subscribe to it.
      //   - "subscribe": a (delayed) worker already owns it → subscribe, NEVER
      //                  run a second copy.
      //   - "inline":    dispatch failed OR no worker claimed within grace → we
      //                  atomically own the run; recover by running it inline so a
      //                  dead worker degrades to a working synchronous turn.
      const backgroundOutcome = await resolveBackgroundDispatchOutcome({
        dispatched,
        backgroundRowInserted,
        runId,
        graceMs: BACKGROUND_CLAIM_GRACE_MS,
        reaperGraceMs: UNCLAIMED_BACKGROUND_RUN_GRACE_MS,
        pollIntervalMs: BACKGROUND_CLAIM_POLL_MS,
        readClaim: readBackgroundRunClaim,
        claim: claimBackgroundRun,
      });

      if (
        backgroundOutcome.action === "stream" ||
        backgroundOutcome.action === "subscribe"
      ) {
        const stream = subscribeToRun(runId, 0);
        if (stream) {
          setResponseHeader(event, "Content-Type", "text/event-stream");
          setResponseHeader(event, "Cache-Control", "no-cache");
          setResponseHeader(event, "Connection", "keep-alive");
          setResponseHeader(event, "X-Run-Id", runId);
          setResponseHeader(event, "X-Dispatch-Mode", "background");
          return stream;
        }
        // A background worker owns this run but we cannot subscribe — surface an
        // error rather than risk a double-run by falling through to inline.
        const terminalReason =
          backgroundOutcome.action === "stream"
            ? "background_subscribe_failed"
            : "background_dispatch_failed";
        const statusUpdated = await updateRunStatusIfRunning(
          runId,
          "errored",
        ).catch(() => false);
        if (statusUpdated) {
          await setRunTerminalReason(runId, terminalReason).catch(() => {});
        }
        setResponseStatus(event, 500);
        return {
          error:
            backgroundOutcome.action === "stream"
              ? "Failed to subscribe to background run"
              : "Failed to dispatch background run",
        };
      }

      // backgroundOutcome.action === "inline": we atomically own the run (or
      // there was no row to reconcile), so falling through to the inline
      // `startRun` path below cannot double-execute. `startRun` calls `insertRun`
      // again, but its duplicate-PK collision is swallowed, so an existing
      // `background-processing` row is reused — no double row.
      if (backgroundOutcome.reason === "worker-never-claimed") {
        // The async 202 landed but no worker claimed within grace. PRESERVE the
        // bg-fn's last-recorded diag_stage (route_entered / auth_failed / ... or
        // "none" if it never reached the route) in the recovery detail BEFORE we
        // overwrite diag_stage — otherwise foreground_inline_recovery clobbers
        // the only clue to WHY the worker died (its own logs are unreadable).
        const priorClaim = await readBackgroundRunClaim(runId).catch(
          () => null,
        );
        const priorDiag = priorClaim?.diagStage ?? "none";
        console.error(
          "[agent-chat] background worker did not claim the 202-dispatched run " +
            `within grace; recovering inline. bgFnPriorDiag=${priorDiag}`,
          runId,
        );
        await recordRunDiagnostic(
          runId,
          RUN_DIAG_STAGE.foregroundInlineRecovery,
          `202 dispatched but no worker claimed within grace; bgFnPriorDiag=${priorDiag}`,
        ).catch(() => {});
      }
      // Fall through to the inline `startRun` path below.
    }

    const trackedProgressOwner =
      trackInRunsTray === true && ownerEmail ? ownerEmail : null;
    const trackedProgressRunId = trackedProgressOwner
      ? backgroundChatProgressRunId(effectiveTurnId)
      : null;
    const trackedProgressMetadata = trackedProgressRunId
      ? {
          kind: "agent-chat-background",
          threadId: effectiveThreadId,
          surfaceUrl: `agent-native://threads/${encodeURIComponent(effectiveThreadId)}`,
          turnId: effectiveTurnId,
        }
      : null;
    // Foreground self-chain: gated on hosted runtime + A2A_SECRET, with an
    // explicit env opt-out, AND this specific run never having been routed to
    // the durable background worker. A run that WAS dispatched to background
    // (`dispatchToBackground`) already has its recovery owned by the background
    // circuit-breaker / `isBackgroundWorker` chain above — this flag must never
    // double up with that path, only stand in for it on plain foreground turns. A persistent
    // threadId is required: the client discovers the pre-inserted successor
    // via `/runs/active?threadId` and the successor chunk resumes from the
    // thread's persisted thread_data — without a thread there is neither a
    // discovery channel nor durable progress to resume from.
    const foregroundSelfChainEligible =
      !isBackgroundWorker &&
      !dispatchToBackground &&
      typeof threadId === "string" &&
      threadId.trim().length > 0 &&
      isAgentChatForegroundSelfChainEnabled();
    const willChainBackgroundContinuation = (run: ActiveRun) =>
      shouldChainBackgroundContinuation({
        isBackgroundWorker,
        run,
        continuationCount: backgroundContinuationCount,
        foregroundSelfChainEligible,
        dispatchedToBackground: dispatchToBackground,
      });

    const completeTrackedProgressRun = async (
      run: ActiveRun,
      completionError?: unknown,
    ) => {
      if (!trackedProgressRunId || !trackedProgressOwner) return;
      if (!completionError && willChainBackgroundContinuation(run)) {
        return;
      }
      const terminalStatus =
        run.status === "aborted"
          ? "cancelled"
          : run.status === "errored" || completionError
            ? "failed"
            : "succeeded";
      const step =
        terminalStatus === "succeeded"
          ? "Agent finished."
          : terminalStatus === "cancelled"
            ? "Agent run was cancelled."
            : "Agent stopped with an error.";
      await completeProgressRun(
        trackedProgressRunId,
        trackedProgressOwner,
        terminalStatus,
        {
          step,
          metadata: {
            ...(trackedProgressMetadata ?? {}),
            runId: run.runId,
          },
        },
      ).catch(() => {});
    };

    let lastTrackedProgressUpdateAt = 0;
    const updateTrackedProgressFromEvent = (event: AgentChatEvent) => {
      if (!trackedProgressRunId || !trackedProgressOwner) return;
      const step = progressStepFromAgentChatEvent(event);
      if (!step) return;
      const now = Date.now();
      if (now - lastTrackedProgressUpdateAt < 15_000) return;
      lastTrackedProgressUpdateAt = now;
      void updateRunProgress(trackedProgressRunId, trackedProgressOwner, {
        step,
        metadata: {
          ...(trackedProgressMetadata ?? {}),
          runId,
        },
      }).catch(() => {});
    };

    if (trackedProgressRunId && trackedProgressOwner && !internalContinuation) {
      await startProgressRun({
        id: trackedProgressRunId,
        owner: trackedProgressOwner,
        title: messageToPersist,
        step: "Starting agent.",
        metadata: trackedProgressMetadata ?? undefined,
      }).catch(() => {});
    }

    // The background worker must AWAIT the run to completion before returning,
    // or Netlify freezes/kills the function the instant the handler returns and
    // the detached run dies mid-turn (mirrors the agent-teams processor, which
    // wraps startRun in `await new Promise(resolve => startRun(..., onComplete:
    // () => resolve()))`). We resolve this when the run's onComplete fires.
    let resolveBackgroundRunDone: (() => void) | null = null;
    const backgroundRunDone = isBackgroundWorker
      ? new Promise<void>((resolve) => {
          resolveBackgroundRunDone = resolve;
        })
      : null;

    const baseHandleRunComplete =
      options.onRunComplete || trackedProgressRunId
        ? async (run: ActiveRun) => {
            try {
              await options.onRunComplete?.(run, threadId);
            } catch (err) {
              await completeTrackedProgressRun(run, err);
              throw err;
            }
            await completeTrackedProgressRun(run);
          }
        : undefined;

    // Wrap so the background worker is unblocked even when there is no app
    // onRunComplete / tracked-progress callback configured. Also installed for
    // a foreground run eligible for self-chain — that path needs this same
    // wrapper to fire the continuation dispatch below.
    const handleRunComplete =
      isBackgroundWorker || foregroundSelfChainEligible || baseHandleRunComplete
        ? async (run: ActiveRun) => {
            try {
              // DIAGNOSTIC: a background worker that completed in an errored
              // state threw inside the loop. Record it (with the last error
              // event's message when available) so the failure cause is
              // readable from the client. Skipped for clean completions and for
              // recoverable soft-timeout boundaries (those chain a continuation
              // below, they did not "throw").
              if (
                isBackgroundWorker &&
                run.status === "errored" &&
                !willChainBackgroundContinuation(run)
              ) {
                const errEvent = [...run.events]
                  .reverse()
                  .find((e) => e.event.type === "error")?.event as
                  | { error?: string; errorCode?: string }
                  | undefined;
                await recordRunDiagnostic(
                  run.runId,
                  RUN_DIAG_STAGE.workerThrew,
                  errEvent?.errorCode || errEvent?.error
                    ? `${errEvent.errorCode ?? ""} ${errEvent.error ?? ""}`.trim()
                    : "run ended in errored state",
                ).catch(() => {});
              }
              // Persist the (partial) assistant turn to thread_data FIRST — the
              // server-driven continuation below rebuilds from it, so it must be
              // committed before we re-fire.
              await baseHandleRunComplete?.(run);

              // Server-driven background→background continuation. If this chunk
              // hit its soft-timeout still unfinished (ended at an auto_continue
              // / loop_limit / recoverable boundary), chain the next chunk by
              // re-firing the `_process-run` self-dispatch with mode "continue"
              // (carried as internalContinuation + an incremented count),
              // instead of relying on the client to re-POST. Mirrors the
              // agent-teams `fireInternalDispatch({ body: { mode: "continue" }})`
              // chain. Bounded by MAX_BACKGROUND_RUN_CONTINUATIONS. Aborted /
              // user-stopped runs do NOT chain.
              // Self-chain server-side for EVERY durable worker, not only the
              // ones inside a `-background` function. Server-driven
              // continuation is the whole point of durable background: the run
              // must survive the client disconnecting (closed tab), so it
              // cannot depend on the browser re-POSTing `auto_continue`. A
              // worker on the regular ~60s function — a Netlify routing miss,
              // or a non-Netlify host (Vercel/Cloudflare/Render/Fly) that
              // never emits a `-background` function — checkpoints at the 40s
              // soft-timeout and self-dispatches the next 40s chunk; a worker
              // in a real `-background` function chains ~13-min chunks. Only
              // the per-chunk BUDGET differs by function type (gated by
              // `runsInBackgroundFunction` at the startRun call below); the
              // continuation itself must stay server-driven on both. (The
              // self-chain is only reachable when the initial dispatch already
              // succeeded — a dispatch fast-fail degrades to the inline
              // foreground fallback, which is not a worker and rides the
              // connected client's auto_continue instead.)
              if (willChainBackgroundContinuation(run)) {
                // Full handoff discipline lives in
                // `chainServerDrivenContinuation` (exported + unit-tested):
                // per-turn SQL run budget, successor row PRE-INSERTED before
                // the dispatch, fully awaited dispatch with retries, loud
                // diag/terminal marking on failure. Never throws.
                await chainServerDrivenContinuation({
                  event,
                  run,
                  effectiveThreadId,
                  effectiveTurnId,
                  requestBody: body as unknown as Record<string, unknown>,
                  backgroundContinuationCount,
                  // Re-evaluate the durable gate rather than keying off
                  // isBackgroundWorker: a successor chunk of a FOREGROUND
                  // self-chain re-enters as a worker too, and must keep
                  // chaining via the regular function — the Netlify
                  // `-background` function is only emitted into the deploy
                  // output when the durable flag is on.
                  chainViaDurableBackground:
                    isAgentChatDurableBackgroundEnabled({
                      appOptIn: options.durableBackgroundRuns === true,
                    }),
                });
              }
            } finally {
              resolveBackgroundRunDone?.();
            }
          }
        : undefined;

    // Background worker: the run was claimed immediately after the authenticated
    // `_process-run` body was parsed, before owner/model/prompt/tool setup. That
    // early claim is what lets the foreground subscribe to the real background
    // worker instead of racing slow setup and falling back to the 40s inline
    // path. This late block is a defensive fallback for older/custom callers
    // that somehow reach here without the early claim.
    if (isBackgroundWorker) {
      if (!backgroundRunClaimedEarly) {
        await recordRunDiagnostic(
          runId,
          RUN_DIAG_STAGE.workerEntered,
          [
            `runsInBackgroundFunction=${runsInBackgroundFunction}`,
            `continuationCount=${backgroundContinuationCount}`,
            backgroundRuntimeDetail,
          ]
            .filter(Boolean)
            .join(" "),
        ).catch(() => {});
        if (isChainedBackgroundContinuation) {
          await insertRun(runId, effectiveThreadId, effectiveTurnId, {
            dispatchMode: "background",
          }).catch(() => {});
        }
        const won = await claimBackgroundRun(runId);
        if (!won) {
          await recordRunDiagnostic(
            runId,
            RUN_DIAG_STAGE.workerClaimLost,
          ).catch(() => {});
          return { ok: true, skipped: "already-claimed" };
        }
        await recordRunDiagnostic(runId, RUN_DIAG_STAGE.workerClaimed).catch(
          () => {},
        );
        await updateRunHeartbeat(runId).catch(() => {});
      }
    }

    // DIAGNOSTIC-ONLY: build the pre-startRun setup-timing breakdown now (so the
    // marks reflect the work done BEFORE the loop), but EMIT it from inside
    // startRun's callback below — the run row does not exist until startRun
    // inserts it, so a pre-startRun write would no-op on the inline path.
    setupMark("preStart");
    // DIAGNOSTIC-ONLY: last stage before startRun fires. A worker that reaches
    // prestart but never workerStarted is hanging inside startRun itself.
    workerStep("prestart");
    const setupDetail =
      Object.entries(setupMarks)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ") +
      ` total=${Date.now() - setupT0}` +
      (backgroundRuntimeDetail ? ` ${backgroundRuntimeDetail}` : "");

    startRun(
      runId,
      effectiveThreadId,
      async (rawSend, signal) => {
        const send = (event: AgentChatEvent) => {
          rawSend(event);
          updateTrackedProgressFromEvent(event);
        };

        send({ type: "activity", label: "Starting agent" });

        // DIAGNOSTIC: the agent loop body actually started running. For a
        // background worker, a run that is claimed but never reaches this stage
        // died between claiming and loop start. The pre-startRun setup-timing
        // breakdown rides along here so it persists now that the run row exists
        // (startRun inserted it), WITHOUT adding a separate DB hop to the
        // run-start path: on the worker it is folded into this same
        // already-awaited worker_started write (one hop, correctly ordered, no
        // clobber); on the inline path there is no later diag stage to overwrite,
        // so it is fire-and-forget to keep run-start non-blocking. Best-effort.
        if (isBackgroundWorker) {
          await recordRunDiagnostic(
            runId,
            RUN_DIAG_STAGE.workerStarted,
            setupDetail,
          ).catch(() => {});
        } else {
          void recordRunDiagnostic(
            runId,
            RUN_DIAG_STAGE.setupTimings,
            setupDetail,
          ).catch(() => {});
        }

        // Notify listeners that a run has started (used by agent teams)
        if (options.onRunStart) {
          await options.onRunStart(send, threadId ?? runId);
        }

        // Resolve custom workspace agent mentions first.
        if (customAgentRefs.length > 0) {
          const ownerEmail = getRequestUserEmail();
          if (!ownerEmail) throw new Error("no authenticated user");
          const { findAccessibleCustomAgent } =
            await import("../resources/agents.js");
          const customResults = await Promise.allSettled(
            customAgentRefs.map(async (ref) => {
              send({
                type: "agent_call",
                agent: ref.name,
                status: "start",
              });
              try {
                const profile = await findAccessibleCustomAgent(
                  ownerEmail,
                  ref.refId || ref.path || ref.name,
                );
                if (!profile) {
                  throw new Error("Profile not found");
                }

                const profilePrompt =
                  `${requestSystemPrompt}\n\n<custom-agent-profile name="${profile.name}" path="${profile.path}">\n` +
                  (profile.description ? `${profile.description}\n\n` : "") +
                  `${profile.instructions}\n</custom-agent-profile>`;

                let responseText = "";
                const subUsage = await runAgentLoop({
                  engine,
                  model: profile.model ?? model,
                  systemPrompt: profilePrompt,
                  tools: requestTools,
                  availableTools: availableRequestTools,
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: enrichedMessage + screenContext },
                      ],
                    },
                  ],
                  actions: requestActions,
                  send: (event) => {
                    if (event.type === "text") {
                      responseText += event.text;
                      send({
                        type: "agent_call_text",
                        agent: ref.name,
                        text: event.text,
                      });
                    }
                  },
                  signal,
                  reasoningEffort,
                  providerOptions: options.providerOptions,
                  executionMode: requestMode,
                  maxIterations: loopSettings.maxIterations,
                });

                // Attribute custom-agent sub-calls under their own label
                // so the Usage panel separates them from the main chat.
                try {
                  const ownerEmail = options.resolveOwnerEmail
                    ? await options.resolveOwnerEmail(event)
                    : getRequestUserEmail();
                  if (!ownerEmail) {
                    // Skip usage recording for unauthenticated runs.
                    return;
                  }
                  const { recordUsage } = await import("../usage/store.js");
                  await recordUsage({
                    ownerEmail,
                    inputTokens: subUsage.inputTokens,
                    outputTokens: subUsage.outputTokens,
                    cacheReadTokens: subUsage.cacheReadTokens,
                    cacheWriteTokens: subUsage.cacheWriteTokens,
                    model: subUsage.model,
                    label: `custom-agent:${ref.name}`,
                  });
                } catch {}

                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "done",
                });
                return `<agent-response name="${ref.name}" id="${ref.refId}" type="custom-agent">\n${responseText}\n</agent-response>`;
              } catch (err: any) {
                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "error",
                });
                const message =
                  userFacingLlmCredentialError(err, {
                    agentName: ref.name,
                  }) ?? `Failed to run ${ref.name}: ${err?.message}`;
                return `<agent-response name="${ref.name}" id="${ref.refId}" type="custom-agent" error="true">\n${message}\n</agent-response>`;
              }
            }),
          );

          const customResponses = customResults
            .filter(
              (result): result is PromiseFulfilledResult<string> =>
                result.status === "fulfilled",
            )
            .map((result) => result.value);

          if (customResponses.length > 0) {
            const agentContext =
              "Responses from custom workspace agents:\n\n" +
              customResponses.join("\n\n");
            const lastMsg = messages[messages.length - 1];
            if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
              const textPart = lastMsg.content.find(
                (p): p is import("./engine/types.js").EngineTextPart =>
                  p.type === "text",
              );
              if (textPart) {
                textPart.text = agentContext + "\n\n" + textPart.text;
              }
            }
          }
        }

        // Resolve connected agent @-mentions via A2A calls.
        if (agentRefs.length > 0 && requestMode !== "plan") {
          const [{ A2AClient, callAgent }, { resolveA2ACallerAuth }] =
            await Promise.all([
              import("../a2a/client.js"),
              import("../a2a/caller-auth.js"),
            ]);
          const results = await Promise.allSettled(
            agentRefs.map(async (ref) => {
              send({
                type: "agent_call",
                agent: ref.name,
                status: "start",
              });
              try {
                const callerAuth = await resolveA2ACallerAuth({
                  includeGoogleToken: true,
                });
                const a2aClient = new A2AClient(ref.path, callerAuth.apiKey, {
                  ...(callerAuth.apiKeyFallbacks
                    ? { fallbackApiKeys: callerAuth.apiKeyFallbacks }
                    : {}),
                });
                const a2aMetadata = callerAuth.metadata;

                let responseText = "";
                let lastSentLength = 0;

                try {
                  for await (const task of a2aClient.stream(
                    {
                      role: "user",
                      parts: [
                        {
                          type: "text",
                          text: enrichedMessage + screenContext,
                        },
                      ],
                    },
                    Object.keys(a2aMetadata).length > 0
                      ? { metadata: a2aMetadata }
                      : undefined,
                  )) {
                    const newText =
                      task.status?.message?.parts
                        ?.filter(
                          (p): p is { type: "text"; text: string } =>
                            p.type === "text",
                        )
                        ?.map((p) => p.text)
                        ?.join("") ?? "";

                    if (newText.length > lastSentLength) {
                      send({
                        type: "agent_call_text",
                        agent: ref.name,
                        text: newText.slice(lastSentLength),
                      });
                      lastSentLength = newText.length;
                    }
                    responseText = newText;
                  }
                } catch {
                  if (!responseText) {
                    responseText = await callAgent(
                      ref.path,
                      enrichedMessage + screenContext,
                      {
                        apiKey: callerAuth.apiKey,
                        userEmail: callerAuth.userEmail,
                        orgDomain: callerAuth.orgDomain,
                        orgSecret: callerAuth.orgSecret,
                      },
                    );
                  }
                }
                responseText =
                  userFacingLlmCredentialError(responseText, {
                    agentName: ref.name,
                  }) ?? responseText;

                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "done",
                });
                return `<agent-response name="${ref.name}" id="${ref.refId}">\n${responseText}\n</agent-response>`;
              } catch (err: any) {
                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "error",
                });
                const message =
                  userFacingLlmCredentialError(err, {
                    agentName: ref.name,
                  }) ?? `Failed to reach ${ref.name}: ${err?.message}`;
                return `<agent-response name="${ref.name}" id="${ref.refId}" error="true">\n${message}\n</agent-response>`;
              }
            }),
          );

          const agentResponses_local: string[] = [];
          for (const result of results) {
            if (result.status === "fulfilled") {
              agentResponses_local.push(result.value);
            }
          }

          if (agentResponses_local.length > 0) {
            const agentContext =
              "Responses from other agents:\n\n" +
              agentResponses_local.join("\n\n");
            const lastMsg = messages[messages.length - 1];
            if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
              const textPart = lastMsg.content.find(
                (p): p is import("./engine/types.js").EngineTextPart =>
                  p.type === "text",
              );
              if (textPart) {
                textPart.text = agentContext + "\n\n" + textPart.text;
              }
            }
          }
        }

        // Apply experiment variant overrides (A/B testing)
        let effectiveModel = model;
        try {
          const { resolveActiveExperimentConfig } =
            await import("../observability/experiments.js");
          if (!ownerEmail) {
            // Without an authenticated owner we can't resolve user-scoped experiments.
            throw new Error("no authenticated user");
          }
          const expConfig = await resolveActiveExperimentConfig(ownerEmail);
          if (expConfig) {
            if (typeof expConfig.configs.model === "string") {
              effectiveModel = expConfig.configs.model;
            }
          }
        } catch {
          // Experiments module unavailable — use default model
        }

        // TODO(processor-seam): thread `processors` from ProductionAgentOptions
        // through to runAgentLoop here once the handler exposes a way to
        // configure them (e.g. a `processors` field on ProductionAgentOptions
        // or a per-request resolver). The loop-level seam (runAgentLoop's
        // `processors` opt + ProcessorChain/TripWire) is the deliverable and is
        // already callable directly by sub-agents, A2A, MCP, and tests; this is
        // only the HTTP-handler convenience plumbing.
        const agentLoopOpts = {
          engine,
          model: effectiveModel,
          systemPrompt: requestSystemPrompt,
          tools: requestTools,
          availableTools: availableRequestTools,
          messages,
          actions: requestActions,
          send,
          signal,
          ownerEmail,
          orgId: getRequestOrgId() ?? null,
          attachments: requestAttachments,
          reasoningEffort,
          // The interactive chat turn needs real completion headroom — the
          // flat per-engine defaults (4096-8192) exist for internal/eval
          // callers and are far below what a hard, long-context turn needs
          // once extended thinking is in play. See output-tokens.ts.
          maxOutputTokens: resolveMainChatMaxOutputTokens(effectiveModel),
          providerOptions: options.providerOptions,
          executionMode: requestMode,
          maxIterations: loopSettings.maxIterations,
          finalResponseGuard: options.finalResponseGuard,
          ...(options.toolLimits ? { toolLimits: options.toolLimits } : {}),
          ...(threadId
            ? { threadId: effectiveThreadId, turnId: effectiveTurnId }
            : {}),
          // Human-in-the-loop approval grants for this turn (sanitized — the
          // request is untrusted; accept only a bounded list of string keys).
          ...(Array.isArray(body.approvedToolCalls) &&
          body.approvedToolCalls.length
            ? {
                approvedToolCalls: body.approvedToolCalls
                  .filter((k: unknown): k is string => typeof k === "string")
                  .slice(0, 200),
              }
            : {}),
        };

        send({ type: "activity", label: "Contacting model" });

        // loopUsage is always assigned — either via instrumentAgentLoop or
        // runAgentLoop before use below. The definite-assignment guard is
        // conservative because the try/catch makes the control flow non-obvious.
        let loopUsage: AgentLoopUsage = undefined!;
        let instrumented = false;
        try {
          const { getObservabilityConfig, instrumentAgentLoop } =
            await import("../observability/traces.js");
          const obsConfig = await getObservabilityConfig();
          if (obsConfig.enabled) {
            instrumented = true;
            loopUsage = await instrumentAgentLoop({
              runAgentLoop: runAgentLoopWithMainChatInternalContinuations,
              loopOpts: agentLoopOpts,
              runId,
              threadId: threadId ?? null,
              userId: ownerEmail,
              config: obsConfig,
              classifyError: () => {
                if (
                  agentLoopOpts.signal.aborted &&
                  agentLoopOpts.signal.reason === "run_timeout"
                ) {
                  return {
                    status: "success",
                    errorMessage: null,
                    metadata: {
                      terminalReason: "run_timeout",
                      recoverableContinuation: true,
                    },
                  };
                }
                return null;
              },
            });
          }
        } catch (err) {
          // If instrumentation setup failed, fall through to uninstrumented.
          // If the agent loop itself failed (via instrumentAgentLoop), re-throw.
          if (instrumented) throw err;
        }
        if (!instrumented) {
          loopUsage =
            await runAgentLoopWithMainChatInternalContinuations(agentLoopOpts);
        }

        // Record token usage for cost monitoring so the Usage panel in
        // settings works in every mode, including local dev.
        try {
          const ownerEmail = options.resolveOwnerEmail
            ? await options.resolveOwnerEmail(event)
            : getRequestUserEmail();
          if (
            ownerEmail &&
            (loopUsage.inputTokens > 0 ||
              loopUsage.outputTokens > 0 ||
              loopUsage.cacheReadTokens > 0 ||
              loopUsage.cacheWriteTokens > 0)
          ) {
            const { recordUsage } = await import("../usage/store.js");
            await recordUsage({
              ownerEmail,
              inputTokens: loopUsage.inputTokens,
              outputTokens: loopUsage.outputTokens,
              cacheReadTokens: loopUsage.cacheReadTokens,
              cacheWriteTokens: loopUsage.cacheWriteTokens,
              model: loopUsage.model,
              label: body.usageLabel || "chat",
            });
          }
        } catch {
          // Usage recording failed — don't break the run
        }
      },
      handleRunComplete,
      {
        softTimeoutMs: options.runSoftTimeoutMs,
        useHostedSoftTimeoutDefault: true,
        // Lift the soft-timeout clamp to ~13min ONLY when this run is actually
        // executing inside a real Netlify `-background` function (15-min budget,
        // no ~60s wall). Being the `_process-run` worker (`isBackgroundWorker`)
        // is NOT sufficient: if the `-background` function wasn't emitted, or
        // Netlify routed the self-POST to the synchronous function, the worker
        // landed on the regular ~60s `server` function — there it MUST keep the
        // 40s clamp and checkpoint before the wall, or it overshoots the 60s
        // hard kill and re-dispatches in a loop. `runsInBackgroundFunction`
        // gates the 13-min budget on the proven runtime, not merely on "I'm the
        // worker." Foreground runs never set this, so their 40s clamp is
        // unchanged.
        backgroundFunction: runsInBackgroundFunction,
        noProgressTimeoutMs: options.runNoProgressTimeoutMs,
        // Fold continuation runs of one logical turn onto a single durable
        // assistant message. Falls back to the runId (turn == run) when the
        // client doesn't supply a turnId.
        turnId: effectiveTurnId,
        dispatchMode: foregroundSelfChainEligible
          ? "foreground-self-chain"
          : "foreground",
      },
    );

    // Background worker: await the run to completion so Netlify keeps the
    // background function alive for the whole turn (the client is streaming the
    // same events via the foreground POST's cross-isolate SQL subscription).
    // The onComplete wrapper above resolves `backgroundRunDone`.
    if (isBackgroundWorker) {
      if (backgroundRunDone) await backgroundRunDone;
      return { ok: true, runId };
    }

    // Subscribe to the run and stream events to the client
    const stream = subscribeToRun(runId, 0);
    if (!stream) {
      setResponseStatus(event, 500);
      return { error: "Failed to start agent run" };
    }

    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache");
    setResponseHeader(event, "Connection", "keep-alive");
    setResponseHeader(event, "X-Run-Id", runId);
    setResponseHeader(
      event,
      "X-Dispatch-Mode",
      foregroundSelfChainEligible ? "foreground-self-chain" : "foreground",
    );

    return stream;
  });
}

export {
  getActiveRunForThread,
  getActiveRunForThreadAsync,
  getRun,
  abortRun,
  subscribeToRun,
};
