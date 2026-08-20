import { randomUUID } from "node:crypto";

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
  getMethod,
} from "h3";
import type { EventHandler as H3EventHandler } from "h3";

import { parseA2AAgentActivityPart } from "../a2a/activity.js";
import type { Task } from "../a2a/types.js";
import {
  describeToolParameterSignature,
  isAgentActionStopError,
  type ActionAutomationContext,
  type ActionCaller,
  stripUnsupportedSchemaKeywords,
} from "../action.js";
import { readAppState } from "../application-state/script-helpers.js";
import { isReadOnlyShellCommand } from "../coding-tools/index.js";
import type { AgentNativeHarnessSetting } from "../config.js";
import { getDbExec, isTransientDatabaseError } from "../db/client.js";
import { extensionIdFromPathname } from "../extensions/path.js";
import { preUploadAttachments } from "../file-upload/pre-upload-attachments.js";
import { isMcpActionResult } from "../mcp-client/app-result.js";
import { extractMcpToolResultImages } from "../mcp-client/index.js";
import { isMcpToolAllowedForRequest } from "../mcp-client/visibility.js";
import { shouldInferSentimentForTurn } from "../observability/sentiment.js";
import {
  completeRun as completeProgressRun,
  startRun as startProgressRun,
  updateRunProgress,
} from "../progress/registry.js";
import {
  isRuntimeVisibleScope,
  parseSkillFrontmatter,
} from "../server/agent-chat/skill-frontmatter.js";
import {
  canUseDeployCredentialFallbackForRequest,
  getProviderCredentialAuthFailure,
  isBuilderGatewayDeployConfigured,
  readDeployCredentialEnv,
} from "../server/credential-provider.js";
import { readBody } from "../server/h3-helpers.js";
import { resolveHostedHarnessPolicy } from "../server/hosted-harness-policy.js";
import {
  assertRequestActionSurfaceIsolation,
  getRequestRunContext,
  ensureRequestRunContext,
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "../server/request-context.js";
import { fireInternalDispatch } from "../server/self-dispatch.js";
import { ANALYTICS_CLIENT_PLATFORM_BODY_FIELD } from "../shared/analytics-platform.js";
import {
  isReasoningEffort,
  normalizeReasoningEffortForRequest,
  stepDownReasoningEffort,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import { actionPreparationContinuationNote } from "./action-continuation-guidance.js";
import {
  drainAgentWarnings,
  formatAgentWarningsForToolResult,
} from "./action-warnings.js";
import {
  buildSystemManifestSections,
  readContextXraySystemSections,
} from "./context-xray/manifest.js";
import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  AGENT_CHAT_PROCESS_RUN_PATH,
  backgroundRuntimeDiagnosticDetail,
  dispatchPathTargetsNetlifyBackgroundFunction,
  isAgentChatDurableBackgroundEnabled,
  isAgentChatForegroundSelfChainEnabled,
  isInBackgroundFunctionRuntime,
  resolveAgentChatProcessRunDispatchPath,
  shouldUseBackgroundFunctionTimeoutForWorker,
} from "./durable-background.js";
import { applyContextXrayTransformForIteration } from "./engine/context-directives-transform.js";
import { attemptContinuationDispatch } from "./engine/continuation-dispatch-retry.js";
import {
  formatLlmCredentialErrorMessage,
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
  userFacingLlmCredentialError,
} from "./engine/credential-errors.js";
import {
  BUILDER_GATEWAY_INTERNAL_ERROR_CODE,
  isContextOverflowCode,
  isContextOverflowMessage,
  isProviderConnectionErrorMessage,
} from "./engine/error-detail.js";
import {
  resolveEngine,
  explicitEngineName,
  registerBuiltinEngines,
  getStoredModelForEngine,
  normalizeModelForEngine,
  isResolvedEngineUsableForRequest,
  type ResolveEngineConfig,
} from "./engine/index.js";
import {
  resolveEmptyResponseRetryMaxOutputTokens,
  resolveMainChatMaxOutputTokens,
  resolveMaxOutputTokensForEngine,
} from "./engine/output-tokens.js";
import { PROVIDER_TO_ENV } from "./engine/provider-env-vars.js";
import { loadPriorTurnToolCallJournal } from "./engine/tool-call-journal-seed.js";
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
  filterHostedHarnessToolNames,
  normalizeHostedHarnessRuntime,
} from "./harness/hosted.js";
import {
  type AgentLoopSettings,
  getDefaultMaxIterations,
  getDefaultMaxRunInputTokens,
  MAX_AGENT_MAX_ITERATIONS,
  MIN_AGENT_MAX_ITERATIONS,
  normalizeMaxIterations,
  normalizeMaxRunInputTokens,
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
  abortRunDurably,
  abortTurnDurably,
  tryClaimRunSlot,
  isHostedRuntime,
  resolveRunSoftTimeoutMs,
  resolveRunToolTimeoutCeilingMs,
  endsAfterCompletedToolWithoutAssistantFinal,
} from "./run-manager.js";
import type { ActiveRun } from "./run-manager.js";
import {
  writeLedgerEntry,
  readLedgerEntry,
  clearLedgerForThread,
  insertRun,
  insertRunEvent,
  isTurnAborted,
  markRunAborted,
  updateRunHeartbeat,
  updateRunStatusIfRunning,
  setRunError,
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
  consumeAgentToolApproval,
  createAgentToolApproval,
  resolveAgentToolApprovalTurnId,
} from "./tool-approval-store.js";
import type { AgentToolApprovalBinding } from "./tool-approval-store.js";
import {
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
  searchToolRegistry,
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
  RunEvent,
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

/** An API key together with the env var it was issued for. */
export interface ResolvedOwnerApiKey {
  apiKey: string | undefined;
  /** Undefined when no key was found, or when the key's provider is unknown. */
  apiKeyEnvVar: string | undefined;
}

const NO_OWNER_API_KEY: ResolvedOwnerApiKey = {
  apiKey: undefined,
  apiKeyEnvVar: undefined,
};

/**
 * Resolve the owner's key for one named engine, tagged with the env var it was
 * issued for.
 *
 * If the owner has no scoped key, fall back to provider keys supplied by the
 * hosting environment only when the current request can safely use deploy-level
 * credentials. This is a read from process-level config, not a request-scoped
 * write to `process.env`.
 */
export async function getOwnerApiKeyForEngine(
  engineName: string,
  ownerEmail: string | null | undefined,
): Promise<ResolvedOwnerApiKey> {
  try {
    const provider = engineToProvider(engineName);
    const envVar = PROVIDER_TO_ENV[provider];
    const userKey = await getOwnerApiKey(provider, ownerEmail);
    if (userKey) return { apiKey: userKey, apiKeyEnvVar: envVar };
    if (!envVar || !canUseDeployCredentialFallbackForRequest(envVar)) {
      return NO_OWNER_API_KEY;
    }
    const envKey = readDeployCredentialEnv(envVar);
    if (
      envKey &&
      !(await getProviderCredentialAuthFailure({ key: envVar, value: envKey }))
    ) {
      return { apiKey: envKey, apiKeyEnvVar: envVar };
    }
    return NO_OWNER_API_KEY;
  } catch {
    return NO_OWNER_API_KEY;
  }
}

/**
 * Resolve the active engine's provider and look up the user's API key for it.
 *
 * Callers that layer another deployment-key fallback after this should keep the
 * same precedence: scoped key first, host-provided env key second.
 *
 * The returned key is untagged, so it is only safe to hand to `resolveEngine`
 * when the caller has no explicit engine of its own — otherwise the active
 * setting and the selected engine can name different providers. Prefer
 * {@link resolveOwnerEngineApiKey}, which decides that per call site.
 */
export async function getOwnerActiveApiKey(
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  try {
    const { getSetting } = await import("../settings/store.js");
    const engineSetting = await getSetting("agent-engine");
    const activeEngine =
      (engineSetting?.engine as string | undefined) ?? "anthropic";
    return (await getOwnerApiKeyForEngine(activeEngine, ownerEmail)).apiKey;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the credential to hand `resolveEngine` alongside `engineOption`.
 *
 * The provenance is the point. An explicitly named engine skips the registry's
 * value-comparison path, so an untagged key resolved from the saved
 * `agent-engine` setting would ride along to whatever provider the caller
 * named — shipping, say, a live Anthropic secret to OpenAI's endpoint and
 * making the resulting 401 blame a key the user never saved. Resolving the key
 * for the named engine keeps the two in step; only the no-explicit-engine case
 * may stay untagged, because the registry's automatic branches re-derive the
 * credential themselves.
 */
export async function resolveOwnerEngineApiKey(input: {
  engineOption?: ResolveEngineConfig["engineOption"];
  ownerEmail: string | null | undefined;
  /**
   * Host-provided credential, which is Anthropic by contract
   * (`AgentChatPluginOptions.apiKey` / `WebhookHandlerOptions.apiKey`). Used
   * only when no owner key was found.
   */
  anthropicFallback?: string;
}): Promise<ResolvedOwnerApiKey> {
  const engineName = explicitEngineName(input.engineOption);
  if (engineName) {
    const resolved = await getOwnerApiKeyForEngine(
      engineName,
      input.ownerEmail,
    );
    if (resolved.apiKey) return resolved;
  } else {
    const activeKey = await getOwnerActiveApiKey(input.ownerEmail);
    if (activeKey) return { apiKey: activeKey, apiKeyEnvVar: undefined };
  }
  const fallback = input.anthropicFallback?.trim();
  return fallback &&
    canUseDeployCredentialFallbackForRequest("ANTHROPIC_API_KEY")
    ? { apiKey: fallback, apiKeyEnvVar: "ANTHROPIC_API_KEY" }
    : NO_OWNER_API_KEY;
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
  /** If true, a successful call returns evidence retrieved from a live source. */
  grounding?: boolean;
  /** False keeps a read-only tool available in Act mode but hides/blocks it in
   *  Plan mode. Use for tools that perform substantive work even without
   *  mutating state. */
  allowInPlanMode?: boolean;
  /** First-class Plan-mode effect policy. Mixed tools should classify each
   *  invocation so read variants remain available while writes fail closed. */
  planMode?: import("../action.js").ActionPlanModeConfig<any>;
  /** If true, this action can run concurrently with other same-turn
   *  read-only/parallel-safe tool calls. Only use for actions that handle
   *  their own write ordering and idempotency. */
  parallelSafe?: boolean;
  /** Set false to exempt a read-only tool from the duplicate read-only
   *  tool-call guard (per-turn result cache + repeat-kill). Default true. Use
   *  for volatile/polling reads that are expected to return a different
   *  result on each identical call. See `defineAction`'s `dedupe` option. */
  dedupe?: boolean;
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
  /**
   * The action hands control back to the user: once it succeeds the loop stops
   * the turn instead of asking the model for another step, and any remaining
   * tool calls in the same assistant message do not execute. Only for actions
   * whose whole purpose is to wait on a human (`ask-question`) — telling the
   * model to stop in the tool result does not make it stop.
   */
  endsTurn?: boolean;
  /** Which framework tool group contributed this action. Set by the framework,
   *  never by an app: apps own their action names, and a tagged action is one
   *  the app can switch off wholesale through `frameworkTools`. Tagged actions
   *  are also excluded from the DEFAULT first-request tool list — they stay
   *  reachable through `tool-search` unless named in `initialToolNames`. */
  frameworkGroup?: import("../framework-tools.js").FrameworkToolGroup;
}

/** @deprecated Use `ActionEntry` instead */
export type ScriptEntry = ActionEntry;

export type AgentExecutionMode = "act" | "plan";

export interface AgentActionSurface {
  allowedActionNames: readonly string[];
}

export interface DefaultAgentActionSurface {
  mode: "default";
}

export type AgentActionSurfaceResolution =
  | AgentActionSurface
  | DefaultAgentActionSurface;

type NormalizedAgentActionSurface =
  | DefaultAgentActionSurface
  | { mode: "allowlist"; allowedActionNames: string[] };

export interface AgentActionSurfaceDetails {
  event: any;
  ownerEmail: string | null;
  orgId: string | null;
  threadId?: string;
  mode: AgentExecutionMode;
  internalContinuation: boolean;
  availableActionNames: readonly string[];
}

function hasOwn(
  value: unknown,
  propertyName: string,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, propertyName)
  );
}

/** Read a persisted allowlist while preserving legacy absence and failing
 * closed when the field is present but malformed. */
export function readPersistedAllowedActionNames(
  value: unknown,
): string[] | undefined {
  if (!hasOwn(value, "allowedActionNames")) return undefined;
  const names = value.allowedActionNames;
  if (
    !Array.isArray(names) ||
    !names.every((name) => typeof name === "string")
  ) {
    return [];
  }
  return [...new Set(names)];
}

export function normalizeAgentActionSurfaceResolution(
  value: unknown,
): NormalizedAgentActionSurface {
  if (hasOwn(value, "mode")) {
    if (value.mode === "default" && !hasOwn(value, "allowedActionNames")) {
      return { mode: "default" };
    }
    throw new Error("resolveActionSurface returned an invalid default surface");
  }
  if (!hasOwn(value, "allowedActionNames")) {
    throw new Error("resolveActionSurface returned an invalid action surface");
  }
  const allowedActionNames = value.allowedActionNames;
  if (
    !Array.isArray(allowedActionNames) ||
    !allowedActionNames.every((name) => typeof name === "string")
  ) {
    throw new Error("resolveActionSurface returned an invalid action surface");
  }
  return {
    mode: "allowlist",
    allowedActionNames: [...new Set(allowedActionNames)],
  };
}

export type PersistedActionSurface =
  | {
      orgId: string | null;
      allowedActionNames: string[];
    }
  | {
      orgId: string | null;
      mode: "default";
    };

/** Read a nested persisted action surface. An absent envelope is legacy;
 * a present but invalid envelope is an explicit org-less, empty surface. */
export function readPersistedActionSurface(
  value: unknown,
  propertyName: string,
): PersistedActionSurface | undefined {
  if (!hasOwn(value, propertyName)) return undefined;
  const surface = value[propertyName];
  if (!hasOwn(surface, "orgId")) {
    return { orgId: null, allowedActionNames: [] };
  }
  const orgId = surface.orgId;
  if (
    orgId !== null &&
    (typeof orgId !== "string" || orgId.trim().length === 0)
  ) {
    return { orgId: null, allowedActionNames: [] };
  }
  if (hasOwn(surface, "mode")) {
    if (surface.mode === "default" && !hasOwn(surface, "allowedActionNames")) {
      return { orgId, mode: "default" };
    }
    return { orgId: null, allowedActionNames: [] };
  }
  const allowedActionNames = readPersistedAllowedActionNames(surface) ?? [];
  return { orgId, allowedActionNames };
}

export function filterActionsByAllowedNames(
  actions: Record<string, ActionEntry>,
  allowedActionNames: readonly string[],
): Record<string, ActionEntry> {
  const allowedNames = [...new Set(allowedActionNames)];
  const unknownNames = allowedNames.filter(
    (name) => !Object.prototype.hasOwnProperty.call(actions, name),
  );
  if (unknownNames.length > 0) {
    throw new Error(
      `resolveActionSurface returned unknown action name(s): ${unknownNames.join(", ")}`,
    );
  }
  const filtered = Object.fromEntries(
    allowedNames.map((name) => [name, actions[name]!]),
  );

  // `attachToolSearch` closes over the registry it was originally attached to.
  // Rebind it to this request's filtered registry so explicitly allowing
  // `tool-search` cannot disclose actions that the resolver omitted.
  if (filtered[TOOL_SEARCH_ACTION_NAME]) {
    filtered[TOOL_SEARCH_ACTION_NAME] = createToolSearchEntry(() => filtered);
  }

  return filtered;
}

export const PLAN_MODE_SYSTEM_PROMPT = `## Plan Mode Active

You are in Plan mode. This turn is for research, clarification, and a proposed approach only.

Hard rules:
- Use only read-only tools. Do not edit files, write resources, run mutating bash commands, mutate SQL rows, navigate the UI, send notifications, create jobs, create tools, send messages or tasks to external agents, or change external systems.
- If a needed detail is unclear, ask a concise clarifying question before proposing a plan.
- When ready, present a concrete plan with the files/tools you expect to touch, the intended changes, validation steps, and notable risks.
- Do not treat approval as implicit while Plan mode is still active. Tell the user to switch to Act mode with the mode selector or /act before implementation.`;

const PLAN_MODE_BLOCKED_READONLY_TOOLS = new Set([
  "refresh-screen",
  "set-search-params",
  "set-url-path",
]);

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

function projectPlanModeParameters(
  parameters: ActionTool["parameters"] | undefined,
  planMode: import("../action.js").ActionPlanModeConfig<any> | undefined,
): ActionTool["parameters"] | undefined {
  if (!parameters || !planMode) return parameters;
  const allowedProperties = planMode.allowedProperties
    ? new Set(planMode.allowedProperties)
    : undefined;
  const omittedProperties = new Set(planMode.omittedProperties ?? []);
  const properties = Object.fromEntries(
    Object.entries(parameters.properties).filter(
      ([key]) =>
        (!allowedProperties || allowedProperties.has(key)) &&
        !omittedProperties.has(key),
    ),
  ) as typeof parameters.properties;
  let changed = false;
  for (const [key, values] of Object.entries(planMode.allowedValues ?? {})) {
    const parameter = properties[key];
    if (!parameter) continue;
    properties[key] = { ...parameter, enum: [...values] };
    changed = true;
  }
  if (
    !changed &&
    !allowedProperties &&
    omittedProperties.size === 0 &&
    (planMode.requiredProperties?.length ?? 0) === 0
  ) {
    return parameters;
  }
  const required = Array.from(
    new Set([
      ...(parameters.required?.filter((key) => key in properties) ?? []),
      ...(planMode.requiredProperties?.filter((key) => key in properties) ??
        []),
    ]),
  );
  return {
    ...parameters,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function matchesPlanModeInputPolicy(
  input: unknown,
  planMode: import("../action.js").ActionPlanModeConfig<any>,
): boolean {
  const hasPropertyPolicy =
    planMode.allowedProperties !== undefined ||
    (planMode.omittedProperties?.length ?? 0) > 0 ||
    planMode.allowedValues !== undefined;
  if (!hasPropertyPolicy) return true;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const values = input as Record<string, unknown>;
  const allowedProperties = planMode.allowedProperties
    ? new Set(planMode.allowedProperties)
    : undefined;
  const omittedProperties = new Set(planMode.omittedProperties ?? []);
  if (
    Object.keys(values).some(
      (key) =>
        (allowedProperties && !allowedProperties.has(key)) ||
        omittedProperties.has(key),
    )
  ) {
    return false;
  }
  return Object.entries(planMode.allowedValues ?? {}).every(
    ([key, allowed]) => {
      const value = values[key];
      return (
        value == null || (typeof value === "string" && allowed.includes(value))
      );
    },
  );
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

  if (name === "bash") {
    return isPlanModeReadOnlyBashCall(input);
  }

  if (entry.planMode) {
    if (!matchesPlanModeInputPolicy(input, entry.planMode)) {
      return false;
    }
    try {
      const effect =
        typeof entry.planMode.effect === "function"
          ? entry.planMode.effect(input)
          : entry.planMode.effect;
      return effect === "read";
    } catch {
      return false;
    }
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
): ActionEntry {
  const allowedValues = entry.planMode?.allowedValues;
  const allowedDescription = allowedValues
    ? Object.entries(allowedValues)
        .map(
          ([key, values]) =>
            `\`${key}\`: ${values.map((value) => `"${value}"`).join(", ")}`,
        )
        .join("; ")
    : "";
  const guidance =
    entry.planMode?.description ??
    (allowedDescription
      ? `only these argument values are available: ${allowedDescription}.`
      : "only calls classified as read-only are available.");
  return {
    ...entry,
    readOnly: true,
    tool: {
      ...entry.tool,
      description: `${entry.tool.description}\n\nPlan mode: ${guidance}`,
      parameters: projectPlanModeParameters(
        entry.tool.parameters,
        entry.planMode,
      ),
    },
    run: async (args, context) => {
      if (!isPlanModeToolCallAllowed(name, args, entry)) {
        return planModeBlockedMessage(name, "call is not read-only");
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

    if (name === "bash") {
      filtered[name] = createPlanModeBashAction(entry);
      continue;
    }

    if (entry.planMode) {
      if (typeof entry.planMode.effect === "function") {
        filtered[name] = createPlanModeGuardedAction(name, entry);
      } else if (entry.planMode.effect === "read") {
        filtered[name] = createPlanModeGuardedAction(name, entry);
      } else {
        filtered[name] = createPlanModeBlockedAction(
          name,
          entry,
          "write or unknown effect",
        );
      }
    } else if (entry.readOnly === true) {
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
  /** Static app capability for the hosted tools-only harness picker. */
  hostedHarnessConfig?: AgentNativeHarnessSetting;
  /** Default effort for requests that do not supply an override. */
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
    queuedMessageId?: string;
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
  /**
   * Resolve the exact action registry exposed to one interactive agent-chat
   * request. Return an allowlist to remove omitted actions from both provider
   * schemas and the searchable registry, or `{ mode: "default" }` to preserve
   * the normal initial-tool and discovery behavior for that request. Every
   * allowlisted action is loaded directly on the first model request.
   */
  resolveActionSurface?: (
    details: AgentActionSurfaceDetails,
  ) => AgentActionSurfaceResolution | Promise<AgentActionSurfaceResolution>;
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
  /** Called when a run starts, with the send function, threadId, and runId. */
  onRunStart?: (
    send: (event: AgentChatEvent) => void,
    threadId: string,
    runId: string,
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
  toolLimits?: {
    timeoutMs?: number;
    maxResultChars?: number;
    /** Absolute cap applied after action-level overrides. */
    hardMaxResultChars?: number;
  };
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
const COMPLETION_DATABASE_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

/**
 * A transient database failure in the completion callback used to prevent a
 * background continuation from ever being handed off. Keep the retry bounded
 * and database-only so a permanent persistence error still fails loudly.
 */
export async function runCompletionCallbackWithDatabaseRetry(
  callback: () => void | Promise<void>,
  options?: { sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const sleep =
    options?.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; ; attempt += 1) {
    try {
      await callback();
      return;
    } catch (error) {
      const retryDelay = COMPLETION_DATABASE_RETRY_DELAYS_MS[attempt];
      if (!isTransientDatabaseError(error) || retryDelay === undefined) {
        throw error;
      }
      await sleep(retryDelay);
    }
  }
}

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
/**
 * How long an attempt must have run before its retry is worth narrating.
 *
 * Below this, the retry is invisible: the clear-and-retry completes faster
 * than a person can register the blank. Above it, silence reads as a freeze.
 */
const VISIBLE_RETRY_THRESHOLD_MS = 10_000;
/**
 * FIX 2 (durable-background incident): tighter no-progress deadline for ONLY
 * the FIRST engine-stream event of a model call, and ONLY on the clamped
 * HOSTED foreground runtime — `isHostedRuntime()` (run-manager.ts, the same
 * predicate that selects the 40s soft budget) AND NOT proven to be running
 * inside a Netlify background function (`isInBackgroundFunctionRuntime`). A
 * hung first model event previously rode the full
 * `MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS` (90s) before the in-loop watchdog
 * could emit `auto_continue` — but the hosted foreground function is killed
 * around 40s, so that watchdog could never actually fire: the run died as a
 * silent platform kill instead of a recoverable checkpoint (observed: ~40s of
 * "Contacting model" with zero tokens, then a hard timeout with no
 * auto_continue ever emitted). Once a real model event has been observed for
 * this model call, subsequent gaps revert to the normal 90s watchdog — this
 * only guards the "nothing has happened yet" window. A `gateway-heartbeat`
 * does NOT count as that first event (it proves the transport is up, not that
 * the model started); it is excluded from stream progress for the same reason.
 *
 * ORDERING INVARIANT (each bound must stay strictly smaller than the next —
 * do not change one without re-checking the others). This cap exists ONLY
 * where the 40s ceiling exists: off hosted runtimes (local dev, self-hosted
 * long-lived Node) `resolveRunSoftTimeoutMs` resolves to 0 (no soft-timeout
 * regime, no platform wall), a genuinely slow first token — large local
 * contexts, slow local providers — is legitimate, and the full 90s window
 * applies unchanged:
 *   FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS (25s, here)
 * < HOSTED_SOFT_TIMEOUT_CEILING_MS           (40s, run-manager.ts)
 * < MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS      (90s, above)
 * < RUN_NO_PROGRESS_HARD_TIMEOUT_MS          (150s, run-manager.ts)
 *
 * Background-function runs (proven 15-min budget, no ~40s wall) are likewise
 * unaffected — they keep the full 90s window for every event, first or not.
 */
const FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS = 25_000;
// Raised from 1 -> 2 now that each retry actually adapts (raises the token
// ceiling and steps effort down a tier) instead of re-issuing the
// exact same doomed request twice.
const EMPTY_FINAL_RESPONSE_RETRY_LIMIT = 2;
const MAIN_CHAT_INTERNAL_CONTINUATION_LIMIT = 6;
const RUN_BUDGET_EXHAUSTED_ERROR_CODE = "run_budget_exhausted";
const RUN_BUDGET_EXHAUSTED_MESSAGE =
  "I ran out of time before finishing this step. " +
  "I stopped rather than keep retrying silently. " +
  "Check any completed tool cards above before retrying, ideally as one smaller follow-up.";
/**
 * Text attachments have been capped since forever; binary ones never were, so
 * a large PDF or screenshot went to the provider as unbounded inline base64.
 * OpenAI rejects the whole request over 1,048,576 chars in one `file_url`
 * ("string too long", measured at 4,149,128), which kills the turn — the cap is
 * on the encoded string, so that is what this counts rather than decoded bytes.
 * Held under the limit to leave room for the `data:<mediaType>;base64,` prefix.
 */
const MAX_INLINE_ATTACHMENT_BASE64_CHARS = 1_000_000;
const MAX_TEXT_ATTACHMENT_CHARS = 60_000;
const MAX_TEXT_ATTACHMENTS_TOTAL_CHARS = 80_000;
const MAX_SELECTION_CONTEXT_CHARS = 8_000;
const MAX_RESOURCE_INVENTORY_ITEMS = 40;
const MAX_RESOURCE_INVENTORY_DESCRIPTION_CHARS = 160;
const MAX_INLINE_SKILL_REFERENCE_CHARS = 40_000;
const SOURCE_SWEEP_TOOL_CALL_THRESHOLD = 12;
/**
 * Serialized-byte threshold at which a run reports how much tool schema
 * `expandActiveTools` has loaded on top of its starting set. Expansion is
 * monotonic — schemas added mid-turn are never released — and failing runs
 * carry ~3.4x the event payload of clean ones, but that is a correlation, not
 * a cause. Measure first; a cap or LRU eviction can only be sized safely once
 * the real distribution is known (dropping a tool the model is about to call
 * is worse than a large request).
 */
const EXPANDED_TOOL_SCHEMA_WARN_BYTES = 32_000;

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
  // The engine's structural verdict comes first: it was read off the provider's
  // own reply, which is not always the message delivered here — a
  // Builder-credits deployment answers every gateway rejection with one visitor
  // line, and the gateway reports an overflow as a plain `invalid_request_error`
  // whose prose was the only signal.
  if (err instanceof EngineError && err.contextOverflow === true) return true;
  if (isContextOverflowMessage(err.message)) return true;
  if (err instanceof EngineError && isContextOverflowCode(err.errorCode)) {
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
    // The gateway's unhandled-500 envelope arriving in-stream, where there is no
    // status to read. Same failure as `http_500` below, so same verdict.
    code === BUILDER_GATEWAY_INTERNAL_ERROR_CODE ||
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
    isProviderConnectionErrorMessage(msg) ||
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

/** Upper bound (jitter included) on what `retryDelay(attempt)` will sleep. */
function maxRetryDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * Math.pow(2, attempt) * 1.1;
}

/**
 * Wall-clock left in this invocation's soft-timeout budget, measured from
 * `startedAt`. `Infinity` off the hosted soft-timeout regime (local dev,
 * self-hosted), where runs are genuinely unbounded. Uses the same ceiling
 * `startRun` sizes the round to, so budget math here can't disagree with the
 * soft timeout that actually aborts the run.
 */
export function remainingRunBudgetMs(startedAt: number): number {
  const ceilingMs = resolveRunSoftTimeoutMs(undefined, {
    useHostedDefault: true,
    backgroundFunction: isInBackgroundFunctionRuntime(),
  });
  if (ceilingMs <= 0) return Number.POSITIVE_INFINITY;
  return ceilingMs - (Date.now() - startedAt);
}

/**
 * Whether one more engine retry — its backoff sleep, plus a minimal window for
 * the resume layer above — still fits in the run budget. Count-based retries
 * alone burn the entire hosted foreground budget on a deterministic failure
 * (observed: every failing run spent all 3 retries, ~14s of it asleep, and
 * left nothing for recovery).
 */
function hasBudgetForEngineRetry(startedAt: number, attempt: number): boolean {
  const remainingMs = remainingRunBudgetMs(startedAt);
  if (remainingMs === Number.POSITIVE_INFINITY) return true;
  return (
    remainingMs - maxRetryDelayMs(attempt) >=
    SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS
  );
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

function truncateTextAttachment(
  text: string,
  attachmentName?: string,
  maxChars = MAX_TEXT_ATTACHMENT_CHARS,
): string {
  if (text.length <= maxChars) return text;

  const omitted = text.length - maxChars;
  const readHint = attachmentName
    ? ` Use the \`read-attachment\` tool with name="${escapeAttachmentAttribute(attachmentName)}" to read the rest.`
    : "";
  if (maxChars === 0) {
    return `[Attachment content omitted from the initial request; ${omitted.toLocaleString()} characters available.${readHint}]`;
  }
  return `${text.slice(0, maxChars)}\n\n[Attachment truncated after ${maxChars.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted.${readHint}]`;
}

function formatTextAttachment(
  att: AgentChatAttachment,
  maxChars = MAX_TEXT_ATTACHMENT_CHARS,
): string | null {
  if (typeof att.text !== "string" || att.text.length === 0) return null;
  const text = truncateTextAttachment(
    unwrapTextAttachmentEnvelope(att.text),
    att.name,
    maxChars,
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
  let remainingTextAttachmentChars = MAX_TEXT_ATTACHMENTS_TOTAL_CHARS;

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
      if (
        match &&
        isSupportedImageMediaType(match[1]) &&
        match[2].length > MAX_INLINE_ATTACHMENT_BASE64_CHARS
      ) {
        // The upload already happened and `uploadedUrl` is the whole point of
        // it. Inlining the bytes anyway is what made the request unsendable.
        const label = att.name ? `"${att.name}"` : "An image";
        textAttachments.push(
          uploadedUrl
            ? `[${label} was uploaded to ${uploadedUrl}. It was too large to send inline for vision analysis, so use the URL for embedding/reference.]`
            : `[${label} was too large to send inline for vision analysis and no upload URL is available. Ask the user to attach a smaller image.]`,
        );
        continue;
      }
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
      if (filePart.data.length > MAX_INLINE_ATTACHMENT_BASE64_CHARS) {
        const label = att.name ? `"${att.name}"` : "A file";
        textAttachments.push(
          uploadedUrl
            ? `[${label} was uploaded to ${uploadedUrl}. It was too large to send inline, so read it from the URL if its contents are needed.]`
            : `[${label} was too large to send inline and no upload URL is available. Ask the user for a smaller file.]`,
        );
        continue;
      }
      userContent.push(filePart);
      continue;
    }

    const rawTextAttachment =
      typeof att.text === "string"
        ? unwrapTextAttachmentEnvelope(att.text)
        : "";
    const attachmentCharBudget = Math.min(
      MAX_TEXT_ATTACHMENT_CHARS,
      remainingTextAttachmentChars,
    );
    const textAttachment = formatTextAttachment(att, attachmentCharBudget);
    if (textAttachment) {
      textAttachments.push(textAttachment);
      remainingTextAttachmentChars -= Math.min(
        rawTextAttachment.length,
        attachmentCharBudget,
      );
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
  // Route through the shared normalizer so an unrecognized `scope:` stays
  // invisible here too. A local `!== "dev"` check silently readmits it.
  return isRuntimeVisibleScope(parseSkillFrontmatter(content).scope);
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

export function createConnectedAgentReferenceEventRelay(input: {
  agent: string;
  send: (event: AgentChatEvent) => void;
  agentCallId?: string;
  now?: () => number;
}) {
  const agentCallId = input.agentCallId ?? randomUUID();
  const now = input.now ?? Date.now;
  const startedAt = now();
  let lastActivitySequence = -1;
  let hasRichActivity = false;

  const emitResponseText = (text: string) => {
    if (text) {
      input.send({
        type: "agent_call_text",
        agent: input.agent,
        text,
        agentCallId,
      });
    }
  };
  const observeActivity = (task: Task) => {
    const parts = task.status?.message?.parts;
    const snapshot = Array.isArray(parts)
      ? parts.map(parseA2AAgentActivityPart).find((value) => value !== null)
      : undefined;
    if (snapshot) {
      hasRichActivity = true;
    }
    if (snapshot && snapshot.sequence > lastActivitySequence) {
      lastActivitySequence = snapshot.sequence;
      input.send({
        type: "agent_call_activity",
        agent: input.agent,
        agentCallId,
        snapshot,
      });
    }
  };
  const observePollUpdate = (task: Task) => {
    observeActivity(task);
    if (hasRichActivity) return;

    const state = task.status?.state;
    if (
      state !== "submitted" &&
      state !== "working" &&
      state !== "processing"
    ) {
      return;
    }
    const currentTime = now();
    const detail = extractConnectedAgentProgressDetail(task);
    input.send({
      type: "agent_call_progress",
      agent: input.agent,
      agentCallId,
      state,
      elapsedSeconds: Math.max(0, Math.round((currentTime - startedAt) / 1000)),
      ...(detail ? { detail } : {}),
    });
  };

  return {
    agentCallId,
    start() {
      input.send({
        type: "agent_call",
        agent: input.agent,
        status: "start",
        agentCallId,
      });
    },
    observeActivity,
    observePollUpdate,
    emitResponseText,
    finish(status: "done" | "error") {
      input.send({
        type: "agent_call",
        agent: input.agent,
        status,
        agentCallId,
        durationMs: Math.max(0, now() - startedAt),
      });
    },
  };
}

type ConnectedAgentCall = typeof import("../a2a/client.js").callAgent;
type ResolveConnectedAgentCallerAuth =
  typeof import("../a2a/caller-auth.js").resolveA2ACallerAuth;

export async function callConnectedAgentReference(input: {
  agent: string;
  path: string;
  message: string;
  send: (event: AgentChatEvent) => void;
  callAgent: ConnectedAgentCall;
  resolveCallerAuth: ResolveConnectedAgentCallerAuth;
  agentCallId?: string;
  now?: () => number;
}): Promise<string> {
  const relay = createConnectedAgentReferenceEventRelay({
    agent: input.agent,
    send: input.send,
    agentCallId: input.agentCallId,
    now: input.now,
  });
  relay.start();
  try {
    const callerAuth = await input.resolveCallerAuth({
      includeGoogleToken: true,
    });
    const response = await input.callAgent(input.path, input.message, {
      async: true,
      apiKey: callerAuth.apiKey,
      apiKeyFallbacks: callerAuth.apiKeyFallbacks,
      metadata: callerAuth.metadata,
      userEmail: callerAuth.userEmail,
      orgDomain: callerAuth.orgDomain,
      orgSecret: callerAuth.orgSecret,
      onUpdate: relay.observePollUpdate,
    });
    const responseText =
      userFacingLlmCredentialError(response, {
        agentName: input.agent,
        visitorFacing: isBuilderGatewayDeployConfigured(),
      }) ?? response;
    relay.emitResponseText(responseText);
    relay.finish("done");
    return responseText;
  } catch (error) {
    relay.finish("error");
    throw error;
  }
}

const MAX_CONNECTED_AGENT_PROGRESS_DETAIL_CHARS = 200;
function extractConnectedAgentProgressDetail(task: Task): string | undefined {
  const parts = task.status?.message?.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > MAX_CONNECTED_AGENT_PROGRESS_DETAIL_CHARS
    ? `${text.slice(0, MAX_CONNECTED_AGENT_PROGRESS_DETAIL_CHARS - 1)}…`
    : text;
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
  /** Number of provider model-stream attempts, including retries. */
  llmCalls?: number;
  /**
   * True once the engine reported at least one real `usage` event for this
   * run. The token fields above start at 0 and are only ever incremented —
   * when this is not true, those zeros are placeholders for "never
   * reported", not a measured empty usage, and callers must not treat them
   * as real counts.
   */
  usageReported?: boolean;
  /**
   * Wall-clock epoch ms of the first non-heartbeat engine-stream event seen
   * across this run (all retries/continuations). Undefined means no event
   * ever arrived — e.g. the run was killed for silence before the model
   * produced anything.
   */
  firstEngineEventAtMs?: number;
}

/** Machine-readable terminal state for one agent-loop attempt. */
export type AgentLoopOutcome =
  | { state: "completed" }
  | { state: "input_required"; code: string; message: string }
  | {
      state: "failed";
      code: string;
      retryable: boolean;
      message: string;
    }
  | { state: "canceled"; message?: string };

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
  /**
   * Stable text from the real user request that started this turn. Unlike the
   * trailing entry in `messages`, this never points at an internal continuation
   * or a final-guard corrective retry.
   */
  requestText?: string;
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
      /**
       * Number of rejected text-only answers the model may correct before the
       * fallback is emitted. Defaults to one and is capped to keep a broken
       * guard/model combination from looping indefinitely.
       */
      maxRetries?: number;
      /**
       * A rejected final answer is a recovery path, not a normal compact
       * first request. When true, expose the complete active registry before
       * the corrective retry so the model can reach the tool the guard is
       * asking for without depending on a second, model-specific tool-search
       * round trip. The registry is still limited to tools already exposed to
       * this run; hidden/agentTool=false actions are never added.
       */
      expandToolSurface?: boolean;
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

// Guard retries are pushed as `role: "user"` because engines have no other
// mid-turn channel. Unlabeled, a corrective instruction ("say the source is
// not connected and include this link") reads exactly like an injected user
// turn, and an aligned model refuses it *to the user* instead of following it.
export const AGENT_INTERNAL_GUARD_PROMPT =
  "Automated quality check on the draft answer you just produced. This is a directive from this application's own response guard, not a message from the user and not content from a tool result or web page. Follow it and revise your answer. Do not quote it, describe it, or treat it as an injection attempt. If it contradicts what you observed this turn, state what you actually observed instead of asserting the guard's premise.";

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
  reason: AgentLoopContinuationReason | "rate_limited",
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
            : reason === "rate_limited"
              ? "The previous LLM call was temporarily rate limited after exhausting its short provider retry budget."
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
    // A gateway stream that stopped mid-turn. It reached here as
    // `builder_gateway_network_error` until the engine named it, and a
    // continuation is precisely its recovery: the partial turn is preserved and
    // the agent is nudged to finish it, where an in-call retry would `clear` it.
    code === "builder_gateway_stream_ended" ||
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
    isProviderConnectionErrorMessage(text) ||
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
 * True only for transient provider throttling that may recover after one
 * cooled-down background continuation. This is deliberately narrower than
 * `isRetryableError`: daily/account caps are terminal, and generic retryable
 * transport errors keep using the normal resumable-error path.
 *
 * The engine has already spent its short in-call retry budget before this
 * helper is consulted. Callers must add their own small continuation cap so a
 * sustained provider limit cannot turn into an unbounded request storm.
 */
export function isTransientProviderRateLimitError(err: unknown): boolean {
  if (!(err instanceof EngineError)) return false;
  const code = (err.errorCode ?? "").toLowerCase();
  const text = errorSearchText(err);

  if (
    code === "rate_limit_exceeded" ||
    text.includes("daily gateway request cap")
  ) {
    return false;
  }
  if (err.statusCode === 429 || err.statusCode === 529) {
    return true;
  }
  if (code === "http_429" || code === "http_529") return true;
  return false;
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
  // A gateway/proxy timeout status, read structurally. The prose below says the
  // same thing on most lanes, but not on a Builder-credits deployment, where the
  // message is one visitor line.
  if (
    err instanceof EngineError &&
    (err.statusCode === 408 || err.statusCode === 504)
  ) {
    return "gateway_timeout";
  }
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

/** Resolve the real user request behind any internal continuation messages. */
export function resolveFinalResponseGuardRequestText(
  messages: EngineMessage[],
): string | undefined {
  const message = messages[findCurrentTurnStartForContinuation(messages)];
  if (!message || message.role !== "user") return undefined;
  const text = textFromEngineMessage(message).trim();
  if (text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT)) return undefined;
  return text || undefined;
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

/**
 * Cross-chunk read-only result cache seed.
 *
 * A chained continuation chunk rebuilds `messages` without the prior chunk's
 * tool results, so `seedReadOnlyToolResultsFromHistory` sees nothing and every
 * read-only tool (run-code, provider-api-request, tool-search, every research
 * tool) re-executes from scratch. Their only cross-chunk protection was the
 * prompt-level resume note, which truncates each result to 400 chars — a
 * 50,000-char run-code result came back as 400 chars, leaving the model no
 * option but to re-run it. Re-executed reads were the dominant term in
 * production spend.
 *
 * The full `tool_done` result IS in the durable run ledger, so seed the same
 * cache the in-run duplicate guard uses. The tool layer then serves the real
 * result while the prompt note keeps its short summary.
 *
 * Staleness is bounded to the CURRENT TURN: the journal is built from
 * `getCurrentTurnEventsForThread`, so nothing older than the user's current
 * request can be replayed, and a successful write inside the turn clears the
 * cache exactly as it does for in-chunk reads.
 */
function seedReadOnlyToolResultsFromJournal(
  journal: ToolCallJournal | null,
  actions: Record<string, ActionEntry>,
): Map<string, string> {
  const cache = new Map<string, string>();
  if (!journal) return cache;
  for (const entry of journal.completed) {
    const action = actions[entry.tool];
    if (action?.readOnly !== true) {
      // Mirror the live loop: a completed write invalidates every cached read.
      cache.clear();
      continue;
    }
    if (action.dedupe === false) continue;
    const result = entry.result ?? "";
    if (
      !isReusableReadOnlyToolResult({
        type: "tool-result",
        toolCallId: "",
        toolName: entry.tool,
        content: result,
      } as EngineToolResultPart)
    ) {
      continue;
    }
    cache.set(toolCallCacheKey(entry.tool, entry.input), result);
  }
  return cache;
}

function seedReadOnlyToolResultsFromHistory(
  messages: EngineMessage[],
  actions: Record<string, ActionEntry>,
  seed?: Map<string, string>,
): Map<string, string> {
  const cache = new Map<string, string>(seed);
  if (!isInternalContinuationTurn(messages)) return cache;

  // Scoped to the current turn only (same slice as
  // seedWriteToolInterruptionsFromHistory) — reads from a prior turn are no
  // longer relevant context and must not seed skip-as-duplicate behavior.
  const turnStart = findCurrentTurnStartForContinuation(messages);
  const turnMessages = messages.slice(turnStart);

  const pendingToolCalls = new Map<
    string,
    { name: string; input: unknown; readOnly: boolean; dedupe: boolean }
  >();
  for (const message of turnMessages) {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "tool-call") continue;
        const entry = actions[part.name];
        pendingToolCalls.set(part.id, {
          name: part.name,
          input: part.input,
          readOnly: entry?.readOnly === true,
          dedupe: entry?.dedupe !== false,
        });
      }
      continue;
    }

    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const call = pendingToolCalls.get(part.toolCallId);
      if (!call) continue;
      if (!call.readOnly) {
        // Mirror the live loop: a successful write invalidates all cached
        // reads (see the `readOnlyToolResultCache.clear()` call below), so a
        // read seeded from before an intervening write must not be replayed
        // as still-fresh.
        if (part.isError !== true) cache.clear();
        continue;
      }
      // dedupe:false read-only tools (volatile/polling reads) are never
      // cached — every call must execute fresh, seeded or not.
      if (!call.dedupe) continue;
      if (!isReusableReadOnlyToolResult(part)) continue;
      cache.set(toolCallCacheKey(call.name, call.input), part.content);
    }
  }

  return cache;
}

function visibleDuplicateReadOnlyToolResult(toolName: string): string {
  return (
    `Skipped duplicate read-only call to ${toolName}: identical input already ran in this turn. ` +
    `Use the previous result already in the conversation instead of calling this tool again.`
  );
}

function resurfacedDuplicateReadOnlyToolResultPrefix(toolName: string): string {
  return (
    `Skipped duplicate read-only call to ${toolName}: identical input already ran in this turn. ` +
    `Its earlier result is no longer in view, so here it is again:\n\n`
  );
}

function resurfacedDuplicateReadOnlyToolResult(
  toolName: string,
  cachedResult: string,
): string {
  return `${resurfacedDuplicateReadOnlyToolResultPrefix(toolName)}${cachedResult}`;
}

/** Restore visible-repeat strike counts for this continuation's active turn. */
function seedDuplicateReadOnlyToolCallsFromHistory(
  messages: EngineMessage[],
  actions: Record<string, ActionEntry>,
): Map<string, number> {
  const repeats = new Map<string, number>();
  if (!isInternalContinuationTurn(messages)) return repeats;

  const turnStart = findCurrentTurnStartForContinuation(messages);
  const pendingToolCalls = new Map<
    string,
    { name: string; input: unknown; readOnly: boolean; dedupe: boolean }
  >();
  const reusableReadKeys = new Set<string>();

  for (const message of messages.slice(turnStart)) {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "tool-call") continue;
        const entry = actions[part.name];
        pendingToolCalls.set(part.id, {
          name: part.name,
          input: part.input,
          readOnly: entry?.readOnly === true,
          dedupe: entry?.dedupe !== false,
        });
      }
      continue;
    }

    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const call = pendingToolCalls.get(part.toolCallId);
      if (!call) continue;
      if (!call.readOnly) {
        if (part.isError !== true) {
          repeats.clear();
          reusableReadKeys.clear();
        }
        continue;
      }
      if (!call.dedupe || part.isError === true) continue;

      const cacheKey = toolCallCacheKey(call.name, call.input);
      if (part.content === visibleDuplicateReadOnlyToolResult(call.name)) {
        if (reusableReadKeys.has(cacheKey)) {
          repeats.set(cacheKey, (repeats.get(cacheKey) ?? 0) + 1);
        }
        continue;
      }
      if (
        part.content.startsWith(
          resurfacedDuplicateReadOnlyToolResultPrefix(call.name),
        )
      ) {
        if (reusableReadKeys.has(cacheKey)) repeats.set(cacheKey, 0);
        continue;
      }
      if (isReusableReadOnlyToolResult(part)) {
        reusableReadKeys.add(cacheKey);
      }
    }
  }

  return repeats;
}

function isReusableReadOnlyToolResult(part: EngineToolResultPart): boolean {
  if (part.isError) return false;
  const lower = part.content.trim().toLowerCase();
  if (!lower) return false;
  return !(
    lower.startsWith("skipped duplicate read-only call to ") ||
    lower.startsWith("invalid action parameters for ") ||
    lower.startsWith("error running ") ||
    lower.includes("run aborted") ||
    lower.includes("tool call timed out") ||
    lower.includes("stale_run") ||
    lower.includes("connection_error")
  );
}

/**
 * Whether a cached read-only tool result is still something the model can
 * actually see in `contextMessages` — the trimmed/summarized view the engine
 * is streamed (NOT the raw, ever-growing `messages` array the cache is keyed
 * off of). Context-xray `evict` drops tool-result parts entirely, `summarize`
 * replaces their content with a placeholder, and observational-memory
 * trimming drops whole older messages once active. When the cached result
 * has fallen out of that view, re-serving "use the previous result" is not
 * actionable — the model has nothing to point back to.
 *
 * A visible result must belong to the same tool name + normalized input and
 * contain either the exact cached body or the exact wrapper used when that
 * body was re-served after trimming. Matching only by a content suffix is too
 * loose: short results such as "ok" can also end unrelated tool output.
 */
export function isCachedToolResultVisibleInContext(
  contextMessages: EngineMessage[],
  toolCall: { name: string; input: unknown },
  cachedResult: string,
): boolean {
  if (cachedResult.length === 0) return true;
  const cacheKey = toolCallCacheKey(toolCall.name, toolCall.input);
  const matchingToolCallIds = new Set<string>();
  for (const message of contextMessages) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool-call") continue;
      if (toolCallCacheKey(part.name, part.input) === cacheKey) {
        matchingToolCallIds.add(part.id);
      }
    }
  }

  const resurfacedResult = resurfacedDuplicateReadOnlyToolResult(
    toolCall.name,
    cachedResult,
  );
  for (const message of contextMessages) {
    if (message.role !== "user") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      if (!matchingToolCallIds.has(part.toolCallId)) continue;
      if (part.content === cachedResult || part.content === resurfacedResult) {
        return true;
      }
    }
  }
  return false;
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
/**
 * Same tool, same error, ANY arguments. `MAX_IDENTICAL_TOOL_ERRORS` keys on the
 * arguments too, so it only catches a model that repeats itself verbatim — and
 * a model that is genuinely lost does the opposite: it keeps changing the
 * arguments. Every variation mints a fresh key, the count never reaches three,
 * and nothing stops it. That is how a delegated turn burned five minutes
 * against an app that answers the same question in twenty-seven seconds.
 *
 * Higher than the exact-repeat limit on purpose: a capable model reads a schema
 * error and fixes its arguments within a try or two, so this must not cut off
 * honest correction. It only fires once a tool has rejected six attempts the
 * same way, which no amount of further guessing is going to fix.
 *
 * This is the floor that has to hold on ANY model. A stronger model recovering
 * on its own is not a substitute for it — it just hides its absence.
 */
export const MAX_SAME_ERROR_ACROSS_ARGUMENTS = 6;
/**
 * Identical (tool, arguments) invocations tolerated in one turn before the turn
 * is stopped, whether or not they errored.
 *
 * This is the guard that distinguishes a spiral from deep work. Volume ceilings
 * cannot: prod contains a legitimate 117-tool-call analysis alongside turns that
 * issued 39 identical `run-code` webFetches and 43 identical `docs-search`
 * calls. Repetition is what separates them, so repetition is what we bound —
 * leaving genuinely long analyses free to keep making NEW calls.
 *
 * Above `MAX_IDENTICAL_TOOL_ERRORS` (3) because a repeated SUCCESS is weaker
 * evidence of a loop than a repeated failure: a few identical reads can be a
 * legitimate re-check after a write.
 */
export const MAX_IDENTICAL_TOOL_CALLS = 8;

/**
 * A stop that ends the turn from inside the tool loop.
 *
 * `message` is the last thing the user reads, so it names the remedy in plain
 * words and does not quote a raw provider/tool error; the raw error goes in
 * `details`. Both retry sniffers now honour the `recoverable: false` these
 * stops are sent with, so a stop that happens to say "timeout" is no longer
 * auto-continued — but the prose still has one reader who cannot ignore it,
 * and a pasted stack trace is not a remedy.
 */
export interface TerminalActionStop {
  message: string;
  errorCode?: string;
  details?: string;
}

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

export type AgentToolCallExecutionResult =
  | {
      status: "completed";
      output: string;
      completedSideEffect?: boolean;
    }
  | {
      status: "approval_required";
      output: string;
      approvalKey: string;
    }
  | {
      status: "failed";
      output: string;
    };

export interface ExecuteAgentToolCallOptions {
  actions: Record<string, ActionEntry>;
  name: string;
  input?: unknown;
  callId: string;
  signal?: AbortSignal;
  ownerEmail?: string | null;
  orgId?: string | null;
  /** Audit/action attribution for this externally selected call. */
  caller?: ActionCaller;
  networkProtocol?: "a2a" | "mcp" | "provider-api";
  networkId?: string;
  networkPeer?: string;
  /** Bounded cross-app lineage used to prevent recursive delegation cycles. */
  delegationDepth?: number;
  visitedApps?: string[];
  threadId?: string;
  turnId?: string;
  approvedToolCalls?: string[];
  onApprovalRequired?: (
    binding: AgentApprovalBinding,
  ) => Promise<string | void>;
  consumeApproval?: (binding: AgentApprovalBinding) => Promise<boolean>;
  send?: (event: AgentChatEvent) => void;
}

export interface AgentApprovalBinding {
  toolName: string;
  input: unknown;
  callId: string;
  approvalKey: string;
}

/**
 * Execute one externally-selected tool through the exact same guarded runtime
 * as a normal model-selected tool call. Realtime voice and other duplex
 * transports use this instead of calling `ActionEntry.run` directly, which
 * would bypass approvals, schema validation, timeouts, the tool journal,
 * result redaction, mutation ordering, and refresh notifications.
 */
export async function executeAgentToolCall(
  options: ExecuteAgentToolCallOptions,
): Promise<AgentToolCallExecutionResult> {
  const entry = options.actions[options.name];
  if (!entry || entry.agentTool === false) {
    return {
      status: "failed",
      output: `Unknown or unavailable tool: ${options.name}`,
    };
  }

  let streamCalls = 0;
  const engine: AgentEngine = {
    name: "agent-native:single-tool",
    label: "Agent Native tool runtime",
    defaultModel: "agent-native:single-tool",
    supportedModels: ["agent-native:single-tool"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(): AsyncIterable<EngineEvent> {
      streamCalls += 1;
      if (streamCalls === 1) {
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call",
              id: options.callId,
              name: options.name,
              input: options.input ?? {},
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "Tool execution complete." }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };

  const events: AgentChatEvent[] = [];
  const send = (event: AgentChatEvent) => {
    events.push(event);
    options.send?.(event);
  };
  const controller = options.signal ? null : new AbortController();
  const signal = options.signal ?? controller!.signal;
  const tools = actionsToEngineTools(options.actions);

  try {
    await runAgentLoop({
      engine,
      model: engine.defaultModel,
      systemPrompt: "Execute the selected Agent Native tool call.",
      tools,
      availableTools: tools,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Execute the ${options.name} tool call.`,
            },
          ],
        },
      ],
      actions: options.actions,
      send,
      signal,
      ownerEmail: options.ownerEmail,
      orgId: options.orgId,
      actionCaller: options.caller,
      networkProtocol: options.networkProtocol,
      networkId: options.networkId,
      networkPeer: options.networkPeer,
      executionMode: "act",
      maxIterations: 2,
      threadId: options.threadId,
      turnId: options.turnId,
      approvedToolCalls: options.approvedToolCalls,
      onApprovalRequired: options.onApprovalRequired,
      consumeApproval: options.consumeApproval,
    });
  } catch (error) {
    return {
      status: "failed",
      output: sanitizeToolErrorValue(error),
    };
  }

  const approval = events.find(
    (event): event is Extract<AgentChatEvent, { type: "approval_required" }> =>
      event.type === "approval_required" && event.tool === options.name,
  );
  const completed = [...events]
    .reverse()
    .find(
      (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
        event.type === "tool_done" && event.tool === options.name,
    );

  if (approval) {
    return {
      status: "approval_required",
      approvalKey: approval.approvalKey,
      output:
        completed?.result ?? `Awaiting human approval to run ${options.name}.`,
    };
  }
  if (!completed) {
    return {
      status: "failed",
      output: `The ${options.name} tool did not return a result.`,
    };
  }
  if (completed.isError) {
    return { status: "failed", output: completed.result };
  }
  return {
    status: "completed",
    output: completed.result,
    ...(typeof completed.completedSideEffect === "boolean"
      ? { completedSideEffect: completed.completedSideEffect }
      : {}),
  };
}

export function filterInitialEngineTools(
  tools: EngineTool[],
  initialToolNames?: string[],
): EngineTool[] {
  if (!initialToolNames) return tools;
  const names = new Set(initialToolNames);
  names.add(TOOL_SEARCH_ACTION_NAME);
  for (const tool of tools) {
    if (isDefaultInitialToolName(tool.name)) {
      names.add(tool.name);
    }
  }
  return tools.filter((tool) => names.has(tool.name));
}

export function preloadPlanModeEngineTools(options: {
  request: string;
  registry: Record<string, ActionEntry>;
  initialTools: EngineTool[];
  availableTools: EngineTool[];
  limit?: number;
}): EngineTool[] {
  const query = options.request.trim();
  if (!query) return options.initialTools;

  const activeNames = new Set(options.initialTools.map((tool) => tool.name));
  const preloadLimit = Math.max(0, Math.min(options.limit ?? 3, 5));
  if (preloadLimit === 0) return options.initialTools;

  const ranked = searchToolRegistry(
    options.registry,
    { query, limit: 25, includeSchemas: true },
    { defaultLimit: 25, maxLimit: 25 },
  );
  const preloadNames = ranked.results
    .filter(
      (result) =>
        result.callable &&
        result.planAvailability !== "act-only" &&
        !activeNames.has(result.name),
    )
    .slice(0, preloadLimit)
    .map((result) => result.name);
  if (preloadNames.length === 0) return options.initialTools;

  for (const name of preloadNames) activeNames.add(name);
  return options.availableTools.filter((tool) => activeNames.has(tool.name));
}

export function buildFirstRequestPayloadDetail(input: {
  isFirstRequest: boolean;
  systemPrompt: string;
  messages: EngineMessage[];
  tools: EngineTool[];
  availableToolCount: number;
}): string {
  if (!input.isFirstRequest) return "";
  return (
    ` first_request_system_chars=${input.systemPrompt.length}` +
    ` first_request_message_chars=${JSON.stringify(input.messages).length}` +
    ` first_request_tool_count=${input.tools.length}` +
    ` first_request_tool_chars=${JSON.stringify(input.tools).length}` +
    ` first_request_available_tool_count=${input.availableToolCount}`
  );
}

const DEFAULT_INITIAL_TOOL_NAMES = new Set([
  // Keep only the small discovery/runtime surface universal. App actions are
  // supplied by the plugin's effective starter list, while provider, MCP,
  // extension, and other uncommon schemas stay reachable through tool-search.
  "resources",
  "framework-search",
  "docs-search",
  "get-framework-context",
  "read-attachment",
  // A pasted public URL is already a complete read target. Keep the generic
  // GET/HEAD tool on the first request so agents can inspect self-describing
  // pages without needing an app-specific connector or a tool-search turn.
  "web-request",
  // The `<available-apps>` prompt block names these two BY NAME on the same
  // request, and "which app should I use for this?" is answered on turn one or
  // not at all. Omitting them made the model read the instruction, find no
  // schema, and answer from its own assumptions instead of spending a
  // tool-search turn — so users were told a capability did not exist while a
  // sibling app owned it.
  "describe-workspace-apps",
  "call-agent",
]);

function isDefaultInitialToolName(name: string): boolean {
  return DEFAULT_INITIAL_TOOL_NAMES.has(name);
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
    const record = item as Record<string, unknown>;
    if (record.callable === false) continue;
    const name = record.name;
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

/**
 * Every tool the model is offered passes through here -- `defineAction`
 * schemas, the hand-written ones in extensions/mcp/context tools, and whatever
 * a third-party MCP server advertises. `defineAction` sanitizes at
 * construction; nothing else did, so `extension-data-set` shipped a `data`
 * property carrying a description and no `type`, and OpenAI 400'd the whole
 * request -- every tool in the payload, not just that one. Sanitizing here is
 * what makes that unrepresentable rather than a thing each definition site has
 * to remember.
 *
 * Cloned first: the hand-written schemas are module constants, so rewriting in
 * place would mutate shared state on first use.
 */
function normalizeToolInputSchema(
  schema: ActionTool["parameters"] | undefined,
): EngineTool["inputSchema"] | null {
  if (!schema) return { type: "object", properties: {} };
  if (schema.type !== "object") return null;
  type ToolParams = NonNullable<ActionTool["parameters"]>;
  let cloned: ToolParams;
  try {
    cloned = JSON.parse(JSON.stringify(schema)) as ToolParams;
  } catch {
    // A schema that will not round-trip cannot be safely rewritten, and
    // shipping it unsanitized is how this class of 400 reaches the provider.
    return null;
  }
  const safe = stripUnsupportedSchemaKeywords(cloned);
  return {
    ...safe,
    type: "object",
    properties:
      safe.properties && typeof safe.properties === "object"
        ? safe.properties
        : {},
    required: Array.isArray(safe.required) ? safe.required : [],
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

export function toolCallCacheKey(toolName: string, input: unknown): string {
  return `${toolName}:${stableStringify(normalizeToolCallInputForHistory(input))}`;
}

export function findApprovedStructuredToolCall(
  history: AgentChatStructuredMessage[] | undefined,
  approvedToolCalls: readonly string[] | undefined,
): { name: string; input: unknown; callId: string } | undefined {
  if (!Array.isArray(history) || !approvedToolCalls?.length) return undefined;
  const approved = new Set(approvedToolCalls);
  const calls = new Map<string, { name: string; input: unknown }>();
  let match: { name: string; input: unknown; callId: string } | undefined;

  for (const message of history) {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "tool-call") continue;
        const callId =
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
        if (!callId || !name) continue;
        calls.set(callId, { name, input: part.input ?? part.args ?? {} });
      }
      continue;
    }

    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const call = calls.get(part.toolCallId);
      if (!call || !approved.has(toolCallCacheKey(call.name, call.input))) {
        continue;
      }
      const result = part.content.toLowerCase();
      if (
        !result.includes("did not execute") &&
        !result.includes("awaiting human approval") &&
        !result.includes("waiting for your approval")
      ) {
        continue;
      }
      match = { ...call, callId: part.toolCallId };
    }
  }

  return match;
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

/**
 * Collapse an error to the part that identifies the FAULT, dropping the part
 * that merely echoes this attempt's arguments.
 *
 * `toolInputSchemaErrorResult` embeds `Received: {…the arguments…}` in every
 * schema rejection, so a model that keeps changing its arguments produces a new
 * error string every time. Any breaker keyed on the raw text then sees each
 * attempt as a first attempt and never counts — which is precisely the
 * keeps-guessing spiral the argument-independent breaker exists to stop. An
 * executed counterexample ran 61 turns without it firing.
 *
 * Dropping the echoed input costs nothing: the fault is already named by the
 * sentence before it, and two failures that differ ONLY in the arguments they
 * echo are the same failure.
 *
 * Digits stay. Collapsing them merges failures that are genuinely different:
 * "Record 41 not found" and "Record 42 not found" are two missing records, so a
 * seven-item sweep where every item legitimately 404s would trip the
 * across-arguments breaker at item six. A guard message that varies its own
 * running tally is fixed where that message is written, not by blinding every
 * breaker to numbers.
 */
function normalizeToolErrorForBreaker(error: string): string {
  return (
    error
      // The argument echo, up to the next sentence boundary.
      .replace(
        /Received:\s*[\s\S]*?\.\s(?=Expected:|The tool was not executed)/g,
        "",
      )
      // Bare JSON payloads some providers inline instead of a Received: span.
      .replace(/\{[\s\S]{0,2000}?\}/g, "{}")
      .replace(/\s+/g, " ")
      .trim()
  );
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

/**
 * Tool errors the model has no way to clear: the missing thing lives outside
 * the turn (a credential, a role grant, a connected account, a runtime, the
 * user's own approval). Every retry costs a full round-trip carrying the whole
 * transcript and lands on the identical error, so these stop on the FIRST
 * occurrence rather than after `MAX_SAME_ERROR_ACROSS_ARGUMENTS` of them.
 *
 * The distinction is the one `stopForBigQueryNotConfigured` draws in
 * templates/analytics: a *configuration* gap is permanent for this turn, a
 * *query* failure is not. Anything the model can act on — a stale read to
 * rebase, a bad argument, a full quota it can free, a wrong dataset name, a
 * statement timeout — must stay out of this list and keep its retries.
 * Precision over recall: a wrong match kills a turn that would have succeeded,
 * which is worse than one more retry.
 */
export function permanentPreconditionRemedy(message: string): string | null {
  const trimmed = message.replace(/\s+/g, " ").trim();
  for (const pattern of PERMANENT_PRECONDITION_PATTERNS) {
    if (pattern.test(trimmed)) return trimmed;
  }
  return null;
}

const PERMANENT_PRECONDITION_PATTERNS: readonly RegExp[] = [
  // "Requires editor role on deck ZJshjrXhjx (have viewer)". The trailing space
  // is load-bearing: it keeps "must have required property" out.
  /\brequires? (?:an? |the )?[\w-]+ role\b/i,
  // "Gemini API key not configured. Save GEMINI_API_KEY in settings." Only the
  // not-configured/not-set wordings — "not found" is how providers report a
  // missing dataset or record, which the model can and should correct.
  /\b(?:api[ -]?keys?|access tokens?|credentials?|secrets?)\b[^.]{0,60}\bnot (?:configured|set|connected|available)\b/i,
  /\bsave [A-Z][A-Z0-9_]{3,} in (?:the )?settings\b/i,
  // "Connect Builder.io before indexing a design system from Figma or code."
  // Case-sensitive, sentence-initial, and followed by a capitalized service
  // name, because that is the only shape that separates the imperative remedy
  // from the retryable network failure: "failed to connect to the warehouse
  // before the deadline" and "Connect timed out, retry first" both satisfy
  // every looser reading of the same words.
  /(?:^|[.:!?]\s+)Connect [A-Z][\w.-]*[^;]{0,40}?\b(?:before|first|in settings)\b/,
  // "Plan mode blocked `update-extension`. Switch to Act mode …" — cleared by
  // the user approving the plan, never by the model trying again.
  /\bplan mode blocked\b/i,
  // The templates' most-copied throw, and always `if (!getRequestUserEmail())`:
  // one synchronous AsyncLocalStorage read of a value fixed when the request
  // context was established. It cannot appear and disappear between tool calls
  // of the same chunk, so retrying inside this turn lands on it again.
  /\bno authenticated user\b/i,
  // "SSRF blocked: refusing to fetch private/internal address (…)"
  /\bssrf blocked\b/i,
  // Deliberately absent: "only available in …". Retention windows ("only
  // available from the last 90 days") share its wording and are fixed by
  // narrowing the range, so it stopped turns that were one argument away from
  // succeeding. The count-based breaker still ends a genuine runtime gate
  // after six.
];

const SOURCE_SWEEP_TOOL_NAME =
  /\b(?:api|calls?|deals?|docs?|events?|issues?|messages?|metrics?|provider|query|records?|request|search|source|tickets?|transcripts?)\b/i;

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

// The Docs app intentionally exposes several small read-only lookup actions
// rather than a bulk reader. Keep the per-tool guard for repeated lookups, but
// do not combine this family into the cross-tool convergence budget.
const SOURCE_SWEEP_AGGREGATE_EXCLUDED_TOOLS = new Set([
  "docs-search",
  "list-docs",
  "read-doc",
  "read-source-file",
  "search-docs",
  "search-source",
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

function isLikelyAggregateSourceSweepTool(
  name: string,
  entry: ActionEntry | undefined,
): boolean {
  return (
    !SOURCE_SWEEP_AGGREGATE_EXCLUDED_TOOLS.has(name.toLowerCase()) &&
    isLikelySourceSweepTool(name, entry)
  );
}

function hasExhaustedSourceSweepBudget(opts: {
  priorToolCalls: readonly AgentLoopToolCallSummary[];
  actions: Record<string, ActionEntry>;
  threshold?: number;
}): boolean {
  const threshold = opts.threshold ?? SOURCE_SWEEP_TOOL_CALL_THRESHOLD;
  return (
    opts.priorToolCalls.filter((call) =>
      isLikelyAggregateSourceSweepTool(call.name, opts.actions[call.name]),
    ).length >= threshold
  );
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

/**
 * Deliberately carries no running call count. This decline is recorded as a
 * tool error, and the breakers key on that text: a message that reports its own
 * tally ("already made 13 call(s)") mints a fresh key on every decline, so the
 * decline that exists to stop a spiral becomes the one thing nothing can count.
 * The fixed threshold below says the same thing without varying.
 */
export function repeatedSourceSweepGuardMessage(opts: {
  toolName: string;
  threshold?: number;
  scope?: "tool" | "aggregate";
}): string {
  const threshold = opts.threshold ?? SOURCE_SWEEP_TOOL_CALL_THRESHOLD;
  const target =
    opts.scope === "aggregate"
      ? "read-only source/search tools"
      : "the same read-only source/search tool";
  return (
    `Skipped ${opts.toolName}: this turn already exhausted its ` +
    `${threshold}-call convergence budget for ${target}. Stop calling ${opts.toolName} ` +
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
  actions?: Record<string, ActionEntry>;
  threshold?: number;
}): { toolName: string; priorCalls: number; message: string } | null {
  if (!isLikelySourceSweepTool(opts.toolName, opts.entry)) return null;
  const threshold = opts.threshold ?? SOURCE_SWEEP_TOOL_CALL_THRESHOLD;
  const priorCalls = opts.priorToolCalls.filter(
    (call) => call.name === opts.toolName,
  ).length;
  const priorSourceSweepCalls = opts.priorToolCalls.filter((call) =>
    isLikelyAggregateSourceSweepTool(
      call.name,
      opts.actions?.[call.name] ??
        (call.name === opts.toolName ? opts.entry : undefined),
    ),
  ).length;
  if (priorSourceSweepCalls >= threshold) {
    return {
      toolName: opts.toolName,
      priorCalls: priorSourceSweepCalls,
      message: repeatedSourceSweepGuardMessage({
        toolName: opts.toolName,
        threshold,
        scope: "aggregate",
      }),
    };
  }
  if (priorCalls < threshold) return null;
  return {
    toolName: opts.toolName,
    priorCalls,
    message: repeatedSourceSweepGuardMessage({
      toolName: opts.toolName,
      threshold,
      scope: "tool",
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

function dedupeAssistantToolCallsById(
  content: import("./engine/types.js").EngineContentPart[],
): import("./engine/types.js").EngineContentPart[] {
  const seenToolCallIds = new Set<string>();
  const deduped: import("./engine/types.js").EngineContentPart[] = [];
  for (const part of content) {
    if (part.type === "tool-call") {
      if (seenToolCallIds.has(part.id)) continue;
      seenToolCallIds.add(part.id);
    }
    deduped.push(part);
  }
  return deduped;
}

/**
 * Property names an Ajv `errorsText` line blames, e.g.
 * `input/operations must be array; input must have required property 'id'`.
 */
function schemaErrorPropertyNames(error: string): string[] {
  const names = new Set<string>();
  for (const match of error.matchAll(/\binput\/([A-Za-z0-9_$-]+)/g)) {
    names.add(match[1]);
  }
  for (const match of error.matchAll(
    /must have required property '([^']+)'/g,
  )) {
    names.add(match[1]);
  }
  return [...names];
}

/**
 * Raw-JSON-schema actions used to be told only that their arguments were wrong,
 * never what shape was expected — so a model re-sent the same guess until the
 * identical-error breaker ended the turn with the write never executed. Zod
 * actions have echoed the expected signature since `wrapWithValidation`; this
 * gives the raw path the same answer from the same helper.
 */
function toolInputSchemaErrorResult(
  toolName: string,
  input: unknown,
  error: string,
  parameters?: ActionTool["parameters"],
): string {
  const signature = describeToolParameterSignature(
    parameters,
    schemaErrorPropertyNames(error),
  );
  return (
    `Invalid action parameters for ${toolName}: ${sanitizeToolErrorText(error)}. ` +
    `Received: ${stringifyToolInput(input)}. ` +
    (signature
      ? `Expected: ${signature} (where * = required, ? = optional). `
      : "") +
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
  // `parentSchema`/`data` on each error are what let us drop the branches of a
  // `oneOf` the caller never meant to match.
  verbose: true,
});

const rawToolInputValidatorCache = new WeakMap<object, ValidateFunction>();

const optionalPlaceholderAjv = new Ajv({
  strict: false,
  allErrors: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});

const optionalPlaceholderValidatorCache = new WeakMap<
  object,
  ValidateFunction
>();

function isStructurallyEmptyToolValue(value: unknown): boolean {
  if (value === false) return true;
  if (value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) {
    return (
      value.length === 0 ||
      value.every(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          Object.keys(item).length === 0,
      )
    );
  }
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 0
  );
}

function compileToolValueValidator(schema: object): ValidateFunction | null {
  const cached = optionalPlaceholderValidatorCache.get(schema);
  if (cached) return cached;
  try {
    const validator = optionalPlaceholderAjv.compile(schema);
    optionalPlaceholderValidatorCache.set(schema, validator);
    return validator;
  } catch {
    return null;
  }
}

function schemaAcceptsToolValue(schema: object, value: unknown): boolean {
  const validator = compileToolValueValidator(schema);
  return validator ? Boolean(validator(value)) : false;
}

/**
 * True only when the sub-schema compiled AND rejected the value. A sub-schema
 * that cannot be compiled standalone — a `$ref` into the root `$defs`, say — is
 * unknown, not invalid; counting it as invalid would let one unreadable
 * sub-schema delete the caller's intentional empty values everywhere else in
 * the same object.
 */
function schemaRejectsToolValue(schema: object, value: unknown): boolean {
  const validator = compileToolValueValidator(schema);
  return validator ? !validator(value) : false;
}

/** The `const`/single-value-`enum` a discriminated-union branch pins a key to. */
function schemaDiscriminatorValue(
  schema: AgentNativeJsonSchema | undefined,
): unknown {
  if (!schema) return undefined;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length === 1) {
    return schema.enum[0];
  }
  return undefined;
}

/**
 * Index of the `oneOf`/`anyOf` branch whose discriminator constants all match
 * `value`, or -1 when the union is not discriminated or nothing matches.
 */
function discriminatedBranchIndex(
  branches: readonly AgentNativeJsonSchema[],
  value: unknown,
): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return -1;
  const record = value as Record<string, unknown>;
  return branches.findIndex((branch) => {
    const properties = branch.properties;
    if (!properties) return false;
    const discriminators = Object.entries(properties).filter(
      ([, spec]) => schemaDiscriminatorValue(spec) !== undefined,
    );
    if (discriminators.length === 0) return false;
    return discriminators.every(
      ([key, spec]) => record[key] === schemaDiscriminatorValue(spec),
    );
  });
}

/**
 * The object schema that actually governs `value` — the union branch its
 * discriminator selects, or the schema itself. Undefined when a union cannot be
 * resolved, since guessing a branch would strip the wrong keys.
 */
function resolveObjectSchemaBranch(
  schema: RawJsonSchema,
  value: unknown,
): RawJsonSchema | undefined {
  const branches = schema.oneOf ?? schema.anyOf;
  if (!branches?.length) return schema;
  const index = discriminatedBranchIndex(branches, value);
  return index >= 0 ? branches[index] : undefined;
}

/**
 * Some model gateways fill every optional tool field with an empty sentinel
 * instead of omitting it. One schema-invalid empty value proves that pattern;
 * only then strip the other optional empty/default sentinels from the call.
 * Calls whose empty values are all schema-valid keep their intentional clears.
 *
 * The proof is evaluated per object, and the walk descends through array items
 * and discriminated-union branches: gateways pre-fill the leaf object they are
 * building (`operations[0].fields`), which a top-level-only sweep never reaches.
 */
function stripOptionalToolPlaceholders(
  schema: RawJsonSchema | undefined,
  value: unknown,
): { value: unknown; changed: boolean } {
  if (!schema) return { value, changed: false };

  if (Array.isArray(value)) {
    const itemSchema = schema.items;
    if (!itemSchema) return { value, changed: false };
    let changed = false;
    const items = value.map((item) => {
      const result = stripOptionalToolPlaceholders(itemSchema, item);
      if (result.changed) changed = true;
      return result.value;
    });
    return changed
      ? { value: items, changed: true }
      : { value, changed: false };
  }

  if (!value || typeof value !== "object") return { value, changed: false };

  const objectSchema = resolveObjectSchemaBranch(schema, value);
  const properties = objectSchema?.properties;
  if (!properties) return { value, changed: false };

  const required = new Set(
    Array.isArray(objectSchema.required) ? objectSchema.required : [],
  );
  const record = value as Record<string, unknown>;
  const placeholders: string[] = [];
  let hasSchemaInvalidPlaceholder = false;
  let normalized: Record<string, unknown> | null = null;

  for (const [key, entry] of Object.entries(record)) {
    const propertySchema = properties[key];
    if (!propertySchema || typeof propertySchema !== "object") continue;
    if (!required.has(key) && isStructurallyEmptyToolValue(entry)) {
      placeholders.push(key);
      if (schemaRejectsToolValue(propertySchema, entry)) {
        hasSchemaInvalidPlaceholder = true;
      }
      continue;
    }
    const nested = stripOptionalToolPlaceholders(propertySchema, entry);
    if (nested.changed) {
      normalized ??= { ...record };
      normalized[key] = nested.value;
    }
  }

  if (hasSchemaInvalidPlaceholder) {
    normalized ??= { ...record };
    for (const key of placeholders) delete normalized[key];
  }

  return normalized
    ? { value: normalized, changed: true }
    : { value, changed: false };
}

function normalizeOptionalToolPlaceholders(
  schema: RawJsonSchema | undefined,
  input: unknown,
): { input: unknown; changed: boolean } {
  if (!schema?.properties || !input || typeof input !== "object") {
    return { input, changed: false };
  }
  if (Array.isArray(input)) return { input, changed: false };
  const result = stripOptionalToolPlaceholders(schema, input);
  return { input: result.value, changed: result.changed };
}

/**
 * Models routinely JSON-encode a field's value into a string when the tool
 * schema wants an object/array — e.g. `config: "{\"name\":...}"` instead of
 * `config: {name:...}`, or `operations: "[...]"` instead of `operations: [...]`.
 * Seen across every app profiled in the 2026-07-25 reliability sweep
 * (brain's `update-source` config, analytics' `mutate-dashboard`/
 * `update-dashboard` operations/ops/config) and the model does NOT
 * self-correct across repeated identical retries — it burns the full
 * `MAX_IDENTICAL_TOOL_ERRORS` retry budget on the same wrong shape every
 * time. Evidence-gated exactly like `normalizeOptionalToolPlaceholders`:
 * only coerce a field whose CURRENT value fails schema validation (so a
 * legitimate string value is never touched — a field schema-valid as a
 * string is never also schema-valid as object/array) and whose parsed form
 * passes. Never touches values that are already the right shape.
 */
function coerceStringifiedJsonToolValues(
  schema: RawJsonSchema | undefined,
  input: unknown,
): { input: unknown; changed: boolean } {
  if (!schema?.properties || !input || typeof input !== "object") {
    return { input, changed: false };
  }
  if (Array.isArray(input)) return { input, changed: false };

  let normalized: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const propertySchema = schema.properties[key];
    if (!propertySchema || typeof propertySchema !== "object") continue;
    const expectedType = (propertySchema as { type?: unknown }).type;
    const expectsObjectOrArray =
      expectedType === "object" ||
      expectedType === "array" ||
      (Array.isArray(expectedType) &&
        (expectedType.includes("object") || expectedType.includes("array")));
    if (!expectsObjectOrArray) continue;
    if (schemaAcceptsToolValue(propertySchema, value)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    if (!schemaAcceptsToolValue(propertySchema, parsed)) continue;
    normalized ??= { ...(input as Record<string, unknown>) };
    normalized[key] = parsed;
  }
  return normalized
    ? { input: normalized, changed: true }
    : { input, changed: false };
}

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

/**
 * With `allErrors`, a failing union reports every branch, so a five-branch
 * union answers "your `patch-deck-fields` op has a bad enum" with eight
 * complaints about `slideId`/`orderedIds` from the four branches the caller
 * never meant. The model reads the loudest, wrong advice and re-sends the same
 * arguments until the identical-error breaker ends the turn. When the
 * discriminator names a branch, report only that branch's errors.
 *
 * Both union keywords are load-bearing for the same Zod schema: Zod v4's own
 * `toJSONSchema` emits `oneOf` for a discriminated union, while the manual
 * fallback converter in `action.ts` emits `anyOf`.
 *
 * Scoped by `instancePath` as well as `schemaPath`: every element of an array
 * shares one `items` schema, so `operations[0]` and `operations[1]` produce
 * branch errors under the same `schemaPath` and only the instance path says
 * which element they belong to.
 */
function isWithinInstancePath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function narrowUnionBranchErrors(
  errors: ErrorObject[] | null | undefined,
): ErrorObject[] | null | undefined {
  if (!errors?.length) return errors;
  let kept = errors;
  for (const error of errors) {
    const keyword = error.keyword;
    if (keyword !== "oneOf" && keyword !== "anyOf") continue;
    const branches = (error.parentSchema as RawJsonSchema | undefined)?.[
      keyword
    ];
    if (!branches?.length) continue;
    const index = discriminatedBranchIndex(branches, error.data);
    if (index < 0) continue;
    const branchPrefix = `${error.schemaPath}/`;
    kept = kept.filter((candidate) => {
      if (candidate === error) return false;
      if (!isWithinInstancePath(candidate.instancePath, error.instancePath)) {
        return true;
      }
      if (!candidate.schemaPath.startsWith(branchPrefix)) return true;
      return candidate.schemaPath.startsWith(`${branchPrefix}${index}/`);
    });
  }
  return kept.length ? kept : errors;
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
  return rawToolInputAjv.errorsText(narrowUnionBranchErrors(validator.errors), {
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
  systemSections?: import("../shared/context-xray.js").ContextManifestSystemSection[];
  actions: Record<string, ActionEntry>;
  send: (event: AgentChatEvent) => void;
  signal: AbortSignal;
  /** Observe usage as each model response reports it, including aborted loops. */
  onUsage?: (usage: AgentLoopUsage) => void;
  /** Observe the attempt's typed terminal state separately from chat events. */
  onOutcome?: (outcome: AgentLoopOutcome) => void;
  ownerEmail?: string | null;
  orgId?: string | null;
  appId?: string;
  /** Action invocation attribution. Defaults to the normal agent tool loop. */
  actionCaller?: ActionCaller;
  /** Trusted trigger lineage for automation-dispatched action calls. */
  automation?: ActionAutomationContext;
  /** Concrete execution id used for cross-app trace correlation. */
  runId?: string;
  /**
   * Wall-clock anchor for run-budget math (engine-retry backoff, in-process
   * resume). Defaults to loop entry; a continuation wrapper passes the round's
   * start so later attempts don't each believe they have a fresh budget.
   */
  budgetStartedAt?: number;
  /** Verified/telemetry-only delegated lineage supplied by the transport. */
  networkProtocol?: "a2a" | "mcp" | "provider-api";
  networkId?: string;
  networkPeer?: string;
  /** Bounded cross-app lineage used to prevent recursive delegation cycles. */
  delegationDepth?: number;
  visitedApps?: string[];
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
  /**
   * Per-TURN input-token ceiling. Iteration count and wall clock do not bound
   * spend — retained tool results are re-sent every iteration, so cost is
   * quadratic in tool-call count. Crossing this stops the turn outright
   * (unlike `maxIterations`, which hands off to the next chunk).
   */
  maxRunInputTokens?: number;
  /**
   * Input tokens already consumed by EARLIER chunks of this same logical turn.
   * Without it every chained chunk would get a fresh allowance and 25 chunks
   * would multiply the ceiling by 25.
   */
  priorTurnInputTokens?: number;
  finalResponseGuard?: AgentLoopFinalResponseGuard;
  /**
   * Stable real-user request text preserved across internal continuation
   * attempts. Callers normally omit this; continuation wrappers freeze it
   * before appending their synthetic user messages.
   */
  finalResponseGuardRequestText?: string;
  threadId?: string;
  turnId?: string;
  /**
   * App-level default limits applied to every tool call unless the individual
   * ActionEntry overrides them with its own timeoutMs / maxResultChars.
   */
  toolLimits?: {
    timeoutMs?: number;
    maxResultChars?: number;
    /** Absolute cap applied after action-level overrides. */
    hardMaxResultChars?: number;
  };
  /**
   * Stable approval keys granted by a human for actions declared
   * `needsApproval`. A call whose key is present here runs even though the
   * action requires approval; otherwise the loop pauses with
   * `approval_required`. See `AgentChatRequest.approvedToolCalls`.
   */
  approvedToolCalls?: string[];
  /**
   * Server-side approval persistence hooks. The HTTP transport supplies these
   * so client-supplied history is never the authorization source; direct loop
   * callers may omit them when they own the surrounding approval boundary.
   */
  onApprovalRequired?: (
    binding: AgentApprovalBinding,
  ) => Promise<string | void>;
  consumeApproval?: (binding: AgentApprovalBinding) => Promise<boolean>;
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
  let outcomeReported = false;
  const reportOutcome = (outcome: AgentLoopOutcome) => {
    if (outcomeReported) return;
    outcomeReported = true;
    try {
      opts.onOutcome?.(outcome);
    } catch {
      // Outcome observers are telemetry/protocol adapters and cannot alter the run.
    }
  };
  const budgetStartedAt = opts.budgetStartedAt ?? Date.now();
  const finalResponseGuardRequestText =
    opts.finalResponseGuardRequestText ??
    resolveFinalResponseGuardRequestText(messages);
  const availableToolMap = new Map(
    (availableTools ?? tools).map((tool) => [tool.name, tool]),
  );
  const activeToolNames = new Set(tools.map((tool) => tool.name));
  let activeTools = tools;

  let expandedToolSchemaBytes = 0;
  let reportedExpandedToolSchemaBytes = false;
  const expandActiveTools = (names: string[]): string[] => {
    const added: string[] = [];
    for (const name of names) {
      if (activeToolNames.has(name)) continue;
      const tool = availableToolMap.get(name);
      if (!tool) continue;
      activeToolNames.add(name);
      expandedToolSchemaBytes += JSON.stringify(tool).length;
      added.push(name);
    }
    if (added.length > 0) {
      activeTools = (availableTools ?? tools).filter((tool) =>
        activeToolNames.has(tool.name),
      );
    }
    if (
      !reportedExpandedToolSchemaBytes &&
      expandedToolSchemaBytes > EXPANDED_TOOL_SCHEMA_WARN_BYTES
    ) {
      reportedExpandedToolSchemaBytes = true;
      console.warn(
        `[agent-loop] expanded tool schemas reached ${expandedToolSchemaBytes} bytes across ${activeToolNames.size} active tools (runId=${opts.runId ?? "none"})`,
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
  const maxRunInputTokens = normalizeMaxRunInputTokens(
    opts.maxRunInputTokens,
    getDefaultMaxRunInputTokens(),
  );
  const priorTurnInputTokens =
    typeof opts.priorTurnInputTokens === "number" &&
    Number.isFinite(opts.priorTurnInputTokens)
      ? Math.max(0, opts.priorTurnInputTokens)
      : 0;
  // A per-tool timeout above the chunk's own soft timeout can never fire — the
  // chunk boundary always wins — so the 12-minute default is dead code on a
  // ~40s hosted foreground chunk. Background-function runs resolve to a ~13min
  // ceiling and keep the default unchanged.
  const runToolTimeoutCeilingMs = resolveRunToolTimeoutCeilingMs(
    resolveRunSoftTimeoutMs(undefined, {
      useHostedDefault: true,
      backgroundFunction: isInBackgroundFunctionRuntime(),
    }),
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
  // Tool-call journal hard-block (resume safety). See
  // `loadPriorTurnToolCallJournal` for the full rationale — snapshotted ONCE
  // here, before any tool runs in this chunk, and its prior-chunk tool
  // calls/results are folded into `toolCallHistory` / `toolResultHistory` so
  // final response guards see evidence from earlier chunks of this turn.
  const consumedJournalKeys = new Set<string>();
  const journalRead = await loadPriorTurnToolCallJournal(
    opts.threadId,
    opts.turnId,
  );
  const toolCallJournal =
    journalRead.status === "read" ? journalRead.toolCallJournal : null;
  const journaledPriorToolCalls =
    journalRead.status === "read" ? journalRead.priorToolCalls : [];
  const journaledPriorToolResults =
    journalRead.status === "read" ? journalRead.priorToolResults : [];
  toolCallHistory.push(...journaledPriorToolCalls);
  toolResultHistory.push(...journaledPriorToolResults);
  // Every per-turn ceiling below is seeded from that read, and the write-replay
  // hard block is enforced from it. On a continuation we cannot tell an
  // already-completed side effect from a fresh one without it, so a failed read
  // stops the turn instead of quietly resuming with a blank ledger.
  const unreadableJournalStop: TerminalActionStop | null =
    journalRead.status === "unreadable" && isInternalContinuationTurn(messages)
      ? {
          message:
            "I stopped because I could not read this turn's run ledger, so I could not tell which steps had already finished. " +
            "Retrying would risk repeating a step that already completed. Please send the request again.",
          errorCode: "tool_call_journal_unreadable",
          details: journalRead.error,
        }
      : null;

  const readOnlyToolResultCache = seedReadOnlyToolResultsFromHistory(
    messages,
    actions,
    seedReadOnlyToolResultsFromJournal(toolCallJournal, actions),
  );
  const duplicateReadOnlyToolCalls = seedDuplicateReadOnlyToolCallsFromHistory(
    messages,
    actions,
  );
  const writeToolInterruptions = seedWriteToolInterruptionsFromHistory(
    messages,
    actions,
  );
  // All three repetition ledgers are SEEDED from earlier chunks of this turn,
  // like `toolCallHistory` and `toolResultHistory` above. A fresh Map makes the
  // limit per-CHUNK rather than per-turn, and a turn may chain up to
  // MAX_RUN_LOOP_CONTINUATIONS (6) or MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS
  // (20) of them — so the real ceiling becomes 20x the constant, and a spiral
  // resumes with a clean slate at every chunk boundary.
  const repeatedToolErrors = new Map<string, number>();
  /** Keyed WITHOUT the arguments — see MAX_SAME_ERROR_ACROSS_ARGUMENTS. */
  const repeatedToolErrorsAnyArgs = new Map<string, number>();
  const repeatedToolCalls = new Map<string, number>();
  for (const prior of journaledPriorToolCalls) {
    const key = toolCallCacheKey(prior.name, prior.input);
    repeatedToolCalls.set(key, (repeatedToolCalls.get(key) ?? 0) + 1);
  }
  for (const prior of journaledPriorToolResults) {
    if (!prior.isError) continue;
    const normalized = normalizeToolErrorForBreaker(prior.content);
    const anyArgsKey = `${prior.name}:${normalized}`;
    repeatedToolErrorsAnyArgs.set(
      anyArgsKey,
      (repeatedToolErrorsAnyArgs.get(anyArgsKey) ?? 0) + 1,
    );
    const errorKey = `${toolCallCacheKey(prior.name, prior.input)}:${normalized}`;
    repeatedToolErrors.set(
      errorKey,
      (repeatedToolErrors.get(errorKey) ?? 0) + 1,
    );
  }

  let finalGuardRetries = 0;
  let emptyFinalResponseRetries = 0;
  let iterations = 0;
  // `loop_limit` and `done` share one terminal-event slot in run-manager, so a
  // trailing `done` would overwrite the boundary the continuation logic reads.
  let endedAtLoopLimit = false;
  let terminalActionStop: TerminalActionStop | null = null;
  /**
   * A stop is either a hand-off to the user (the two `input_required` codes) or
   * a failed run. Failed runs MUST leave a terminal `error` event behind: the
   * run row's status, `error_code`, `listErroredRuns`, the outcome counters and
   * the client's retry affordance all key off that event, and a stop that only
   * streams text is recorded as `status='completed', terminal_reason='done'` —
   * a guard trip counted as a success.
   */
  const sendTerminalActionStop = (stop: TerminalActionStop) => {
    if (
      stop.errorCode === "needs-approval" ||
      stop.errorCode === "awaiting-user-input"
    ) {
      send({ type: "text", text: stop.message });
      return;
    }
    // Sent ONLY as an error: both the live client and the thread rebuild render
    // an error event's message as assistant text themselves, so also sending it
    // as `text` prints the same sentence twice.
    send({
      type: "error",
      error: stop.message,
      errorCode: stop.errorCode ?? "tool_failed",
      ...(stop.details ? { details: stop.details } : {}),
      recoverable: false,
    });
  };
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
    if (unreadableJournalStop) {
      terminalActionStop = unreadableJournalStop;
      sendTerminalActionStop(unreadableJournalStop);
      break;
    }
    const turnInputTokens = priorTurnInputTokens + usage.inputTokens;
    if (turnInputTokens > maxRunInputTokens) {
      // Terminal for the whole TURN, not a chunk boundary: emitting
      // `loop_limit` here would hand off to a successor chunk that inherits the
      // same exhausted total and immediately re-terminate, burning the run
      // ledger 25 times over.
      emitTripwire(
        new TripWire(
          `I stopped because this request consumed ${turnInputTokens.toLocaleString()} input tokens, past the ${maxRunInputTokens.toLocaleString()} budget for a single turn. ` +
            `Anything already completed above is saved. Please retry as a smaller, more specific follow-up.`,
          { processor: "run-input-token-budget" },
        ),
      );
      break;
    }
    // Terminal, NOT a nudge-and-reset: the run ends at `loop_limit` and the
    // durable per-turn ledger (or the client's own continuation) decides
    // whether the turn gets another chunk. Resetting the counter in-process
    // made the budget unenforceable and meant this event was never emitted,
    // even though run-manager, thread-data-builder and the client all handle it.
    if (++iterations > maxIterations) {
      send({ type: "loop_limit", maxIterations });
      endedAtLoopLimit = true;
      break;
    }

    let assistantContent: EngineContentPart[] | undefined;
    let streamedAssistantText = "";
    const streamedAssistantToolCalls: import("./engine/types.js").EngineToolCallPart[] =
      [];
    let terminalStopReason:
      | Extract<EngineEvent, { type: "stop" }>["reason"]
      | undefined;
    const toolCallErrors = new Map<
      string,
      { name: string; input: unknown; error: string }
    >();
    let contextMessages = messages;

    if (opts.threadId) {
      contextMessages = await applyContextXrayTransformForIteration({
        threadId: opts.threadId,
        ownerEmail: opts.ownerEmail,
        turnId: opts.turnId,
        model,
        messages,
        systemSections: opts.systemSections,
      });

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
      const attemptStartedAt = Date.now();
      assistantContent = undefined;
      streamedAssistantText = "";
      streamedAssistantToolCalls.length = 0;
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

        usage.llmCalls = (usage.llmCalls ?? 0) + 1;
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
        // FIX 2: true once a real (non-heartbeat) engine-stream event has been
        // retrieved for THIS model call — gates
        // `FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS` below to the window before
        // the model has produced anything, never subsequent gaps.
        let hasReceivedFirstEngineEvent = false;
        // Resolved once per model-call attempt (not per event) so a single
        // call's deadline math can't observe the runtime predicates changing
        // mid-flight. Requires BOTH a hosted runtime (where the 40s clamp and
        // the platform wall behind it exist — local dev/self-hosted resolve
        // the soft timeout to 0 and legitimately tolerate slow first tokens)
        // AND not being a proven background-function worker. See
        // `FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS`.
        const isClampedForegroundRuntimeForThisCall =
          isHostedRuntime() && !isInBackgroundFunctionRuntime();
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
        const modelStreamNoProgressDeadlineAt = () => {
          const baseDeadlineAt =
            lastModelStreamProgressAt + MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS;
          // FIX 2: cap the FIRST event's deadline tighter on the clamped
          // foreground runtime — see FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS
          // for the ordering invariant this protects.
          if (
            hasReceivedFirstEngineEvent ||
            !isClampedForegroundRuntimeForThisCall
          ) {
            return baseDeadlineAt;
          }
          return Math.min(
            baseDeadlineAt,
            lastModelStreamProgressAt + FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS,
          );
        };
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
            // A gateway keepalive proves the transport is up, not that the
            // model started: it must not release the 25s first-model-event cap
            // any more than it counts as stream progress, or an endless
            // keepalive stream rides the unreachable 90s watchdog instead.
            if (event.type !== "gateway-heartbeat") {
              hasReceivedFirstEngineEvent = true;
              lastModelStreamProgressAt = Date.now();
              usage.firstEngineEventAtMs ??= lastModelStreamProgressAt;
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
              send({
                type: "tool_input_start",
                ...(event.name ? { tool: event.name } : {}),
                ...(event.id ? { id: event.id } : {}),
              });
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
              if (event.text) {
                send({
                  type: "tool_input_delta",
                  ...(toolName ? { tool: toolName } : {}),
                  ...(event.id ? { id: event.id } : {}),
                  text: event.text,
                });
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
              // Most engines repeat the authoritative call in assistant-content,
              // but delegated/custom engines can expose only the stream event.
              // Keep it so the loop can still execute the requested action when
              // the normalized terminal event is missing.
              streamedAssistantToolCalls.push({
                type: "tool-call",
                id: event.id,
                name: event.name,
                input: event.input,
              });
            } else if (event.type === "tool-call-error") {
              toolCallErrors.set(event.id, {
                name: event.name,
                input: event.input,
                error: event.error,
              });
            } else if (event.type === "assistant-content") {
              assistantContent = event.parts;
            } else if (event.type === "usage") {
              const eventUsage = {
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                cacheReadTokens: event.cacheReadTokens ?? 0,
                cacheWriteTokens: event.cacheWriteTokens ?? 0,
                model,
              };
              usage.inputTokens += eventUsage.inputTokens;
              usage.outputTokens += eventUsage.outputTokens;
              usage.cacheReadTokens += eventUsage.cacheReadTokens;
              usage.cacheWriteTokens += eventUsage.cacheWriteTokens;
              usage.usageReported = true;
              opts.onUsage?.(eventUsage);
            } else if (event.type === "stop") {
              terminalStopReason = event.reason;
              if (event.reason === "error") {
                throw new EngineError(event.error ?? "Engine stream error", {
                  errorCode: event.errorCode,
                  upgradeUrl: event.upgradeUrl,
                  statusCode: event.statusCode,
                  providerRetryable: event.providerRetryable,
                  contextOverflow: event.contextOverflow,
                  requestId: event.requestId,
                  requestShape: event.requestShape,
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

        // A provider can close cleanly after streaming only a partial tool
        // input. Do not treat that as a completed turn or execute guessed args.
        const hasEmptyAssistantContent =
          assistantContent === undefined || assistantContent.length === 0;
        const hasUnfinishedToolInput =
          activeToolInputs.size > 0 &&
          hasEmptyAssistantContent &&
          streamedAssistantToolCalls.length === 0 &&
          toolCallErrors.size === 0;
        if (hasUnfinishedToolInput) {
          send({ type: "auto_continue", reason: "stream_ended" });
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
        if (
          retry < maxRetriesForError(err) &&
          isRetryableError(err) &&
          hasBudgetForEngineRetry(budgetStartedAt, retry)
        ) {
          // Clear partial text from the failed attempt so the retry
          // doesn't produce garbled duplicate output. A fast provider blip
          // stays silent — it must not leak into the assistant's answer.
          //
          // A retry the user WAITED THROUGH is a different event. A 90s model
          // stall retried three times wiped the visible output at 92s, 182s,
          // and 272s with no explanation; the screen simply went blank and
          // stayed blank for four and a half minutes, which is what people
          // report as "the chat froze". Say what is happening, but only once
          // the silence is long enough that someone noticed it.
          const stalledMs = Date.now() - attemptStartedAt;
          if (stalledMs >= VISIBLE_RETRY_THRESHOLD_MS) {
            send({
              type: "activity",
              label: `Model did not respond — retrying (${retry + 2}/${maxRetriesForError(err) + 1})`,
            });
          }
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

    if (
      (!assistantContent || assistantContent.length === 0) &&
      (streamedAssistantText.trim() || streamedAssistantToolCalls.length > 0)
    ) {
      // Some delegated/custom engine streams emit text deltas and/or tool-call
      // events followed by a terminal stop without the normalized
      // assistant-content event. Preserve both so final-response guards still
      // run and requested actions are not silently dropped.
      assistantContent = [
        ...(streamedAssistantText.trim()
          ? [{ type: "text" as const, text: streamedAssistantText }]
          : []),
        ...streamedAssistantToolCalls,
      ];
    } else if (assistantContent && streamedAssistantToolCalls.length > 0) {
      const existingToolCallIds = new Set(
        assistantContent
          .filter(
            (part): part is import("./engine/types.js").EngineToolCallPart =>
              part.type === "tool-call",
          )
          .map((part) => part.id),
      );
      for (const toolCall of streamedAssistantToolCalls) {
        if (!existingToolCallIds.has(toolCall.id)) {
          assistantContent.push(toolCall);
        }
      }
    }
    if (!assistantContent) {
      if (!terminalStopReason) {
        // A stream that disappears without a terminal stop is an interrupted
        // chunk, not a successful empty answer. Let the continuation path
        // recover it instead of persisting a tool-only completed turn.
        send({ type: "auto_continue", reason: "stream_ended" });
        return usage;
      }
      // Route a clean terminal stop with no normalized content through the
      // empty-final retry/fallback below.
      assistantContent = [];
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

    assistantContent = dedupeAssistantToolCallsById(assistantContent);

    const assistantContentForHistory = assistantContent.map((part) =>
      part.type === "tool-call"
        ? {
            ...part,
            input: normalizeToolCallInputForHistory(part.input),
          }
        : part,
    );

    if (assistantContentForHistory.length > 0) {
      messages.push({ role: "assistant", content: assistantContentForHistory });
    }

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

      // Some providers (notably OpenAI Responses for gpt-5+) can complete a
      // successful turn with reasoning content but no text or tool call. App
      // final-answer guards validate an actual draft; letting them see this
      // contentless turn can misclassify our synthetic recovery message and
      // replace the shared retry with an unrelated app fallback.
      const hasEmptyFinalResponse =
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
          send({ type: "clear" });
          appendAgentLoopContinuation(messages, "max_tokens");
          continue;
        }
        send({ type: "clear" });
        send({
          type: "text",
          text: "The model returned an empty response. This usually means reasoning used the full output-token budget. Try again, or pick a different model from the model menu.",
        });
        break;
      }

      let guard: Awaited<ReturnType<AgentLoopFinalResponseGuard>> | null = null;
      if (opts.finalResponseGuard) {
        try {
          guard = await opts.finalResponseGuard({
            messages,
            requestText: finalResponseGuardRequestText,
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
      if (guard) {
        const retryMessage =
          typeof guard === "string" ? guard : guard.retryMessage;
        const fallbackMessage =
          typeof guard === "string" ? guard : guard.fallbackMessage;
        const maxGuardRetries =
          typeof guard === "string"
            ? 1
            : Math.max(0, Math.min(3, Math.trunc(guard.maxRetries ?? 1)));
        if (finalGuardRetries < maxGuardRetries) {
          // Compact starter catalogs are an optimization for the first model
          // request. Once a guard rejects a final answer, preserving that
          // compact surface can make the corrective instruction impossible to
          // satisfy: the requested data action may still be behind
          // tool-search, and some models spend the entire retry narrating the
          // discovery step instead of calling it. Let guards opt into the
          // full *already-authorized* run registry for the retry. This is
          // intentionally handled in the shared loop so A2A/MCP and every
          // model family get the same recovery behavior.
          if (typeof guard !== "string" && guard.expandToolSurface) {
            expandActiveTools([...availableToolMap.keys()]);
          }
          finalGuardRetries += 1;
          send({ type: "clear" });
          messages.push({
            role: "user",
            content: [
              {
                type: "text",
                text: `${AGENT_INTERNAL_GUARD_PROMPT}\n\n<response-guard>\n${retryMessage}\n</response-guard>`,
              },
            ],
          });
          continue;
        }
        send({ type: "clear" });
        send({ type: "text", text: fallbackMessage ?? retryMessage });
      } else {
        flushUnstreamedAssistantText();
      }
      emptyFinalResponseRetries = 0;
      effectiveMaxOutputTokens = opts.maxOutputTokens;
      effectiveReasoningEffort = opts.reasoningEffort;
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

    let requestedActionStop: TerminalActionStop | null = null;
    // An `endsTurn` action ran and handed control to the user. Distinct from
    // `requestedActionStop`, which also covers failure stops that must not
    // suppress the remaining tool calls.
    let turnYieldedToUser = false;

    // Called by every path that completes a tool call successfully — a fresh
    // invocation, a journal replay, a ledger recovery. A replayed
    // `ask-question` that skipped this would let the resumed run ask a second
    // time over the card the user is already looking at.
    const noteToolCallSucceeded = (actionEntry: ActionEntry) => {
      if (actionEntry.endsTurn !== true) return;
      turnYieldedToUser = true;
      requestedActionStop ??= {
        message: "Waiting for your answer before continuing.",
        errorCode: "awaiting-user-input",
      };
    };

    const noteRepeatedToolCall = (toolName: string, input: unknown) => {
      const key = toolCallCacheKey(toolName, input);
      const count = (repeatedToolCalls.get(key) ?? 0) + 1;
      repeatedToolCalls.set(key, count);
      if (count < MAX_IDENTICAL_TOOL_CALLS) return;
      requestedActionStop ??= {
        message:
          `Stopped because ${toolName} was called ${count} times with identical arguments in one turn, ` +
          `which means the same step is repeating rather than making progress. ` +
          `Everything completed before this point is preserved above.`,
        errorCode: "repeated_tool_call",
      };
    };

    // Human-in-the-loop approvals granted by the user for this turn (opt-in;
    // empty for the overwhelming majority of turns). Keyed by the stable
    // tool-call approval key so a re-issued continuation can let an approved
    // call run. The model cannot populate this — it comes from the request.
    const approvedToolCallKeys = new Set<string>(opts.approvedToolCalls ?? []);

    const runToolCall = async (
      toolCall: import("./engine/types.js").EngineToolCallPart,
    ): Promise<EngineContentPart> => {
      const actionEntry = actions[toolCall.name];
      const placeholderNormalization = actionEntry
        ? normalizeOptionalToolPlaceholders(
            actionEntry.tool.parameters,
            toolCall.input,
          )
        : { input: toolCall.input, changed: false };
      if (placeholderNormalization.changed) {
        toolCall = { ...toolCall, input: placeholderNormalization.input };
      }
      const jsonStringCoercion = actionEntry
        ? coerceStringifiedJsonToolValues(
            actionEntry.tool.parameters,
            toolCall.input,
          )
        : { input: toolCall.input, changed: false };
      if (jsonStringCoercion.changed) {
        toolCall = { ...toolCall, input: jsonStringCoercion.input };
      }
      // Count after the same normalization that is persisted in the journal:
      // a model can send a JSON-encoded object/array, while the action and
      // ledger both see the coerced value. Serving a repeat from cache still
      // counts as asking the same question again.
      noteRepeatedToolCall(toolCall.name, toolCall.input);
      const toolInputNormalized =
        placeholderNormalization.changed || jsonStringCoercion.changed;
      const wireToolInput = JSON.stringify(toolCall.input ?? {});
      const normalizedToolInput = normalizeToolCallInputForHistory(
        toolCall.input,
      );
      const sourceSweepGuard = shouldGuardRepeatedSourceSweep({
        toolName: toolCall.name,
        entry: actionEntry,
        priorToolCalls: sourceSweepToolCallHistory,
        actions,
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
        // Counting is the wrong instrument for a precondition the turn cannot
        // satisfy: six identical round-trips through a missing API key cost the
        // user minutes and end where the first one did. Classified first so the
        // remedy reaches them on attempt one.
        const permanentRemedy = permanentPreconditionRemedy(sanitizedResult);
        if (permanentRemedy) {
          requestedActionStop ??= {
            message:
              `I stopped because ${toolCall.name} needs a setup step outside this turn — a credential, a role, a connected account, or an approval — before it can run. ` +
              "Retrying would not have changed it, and anything completed before this is saved.",
            errorCode: "permanent_precondition",
            details: sanitizedResult,
          };
          return (
            `Stopped: ${toolCall.name} cannot run until a setup step outside this turn is fixed. ` +
            `Do not retry it with different arguments. ${sanitizedResult}`
          );
        }
        const errorKey = `${toolCallCacheKey(
          toolCall.name,
          toolCall.input,
        )}:${normalizeToolErrorForBreaker(sanitizedResult)}`;
        const count = (repeatedToolErrors.get(errorKey) ?? 0) + 1;
        repeatedToolErrors.set(errorKey, count);

        // Same tool, same error, arguments ignored. Catches the lost-model
        // shape the exact-match counter above cannot: new arguments every
        // attempt, so every attempt looks like a first attempt.
        const anyArgsKey = `${toolCall.name}:${normalizeToolErrorForBreaker(
          sanitizedResult,
        )}`;
        const anyArgsCount =
          (repeatedToolErrorsAnyArgs.get(anyArgsKey) ?? 0) + 1;
        repeatedToolErrorsAnyArgs.set(anyArgsKey, anyArgsCount);
        if (
          count < MAX_IDENTICAL_TOOL_ERRORS &&
          anyArgsCount >= MAX_SAME_ERROR_ACROSS_ARGUMENTS
        ) {
          const result =
            `Stopped after ${anyArgsCount} attempts at ${toolCall.name} that all failed the same way ` +
            `with different arguments. Last error: ${sanitizedResult}`;
          requestedActionStop ??= {
            message:
              `I stopped because the ${toolCall.name} action rejected ${anyArgsCount} different attempts the same way, ` +
              "so changing the arguments again would not have worked. Anything completed before this is saved.",
            errorCode: "repeated_tool_error_across_arguments",
            details: sanitizedResult,
          };
          return result;
        }

        if (count < MAX_IDENTICAL_TOOL_ERRORS) return sanitizedResult;
        const result =
          `Stopped after ${count} identical errors from ${toolCall.name} with the same arguments. ` +
          `Last error: ${sanitizedResult}`;
        // This message is streamed to the USER, not back to the model — the
        // model's copy is `result` above. Describe the failure and what they
        // can do; never instruct them to "fix the arguments".
        requestedActionStop ??= {
          message:
            `I stopped because the ${toolCall.name} action failed ${count} times in a row the same way, ` +
            "so retrying it again would not have worked. Anything completed before this is saved.",
          errorCode: "repeated_identical_tool_error",
          details: sanitizedResult,
        };
        return result;
      };
      /**
       * A guard refused to run the tool. Recorded as an ERROR, not as a plain
       * result: a decline costs a full model round-trip carrying the whole
       * transcript, and `noteRepeatedToolCall` keys on name+args, so a model
       * iterating ids mints a fresh key every time and declines forever until
       * `maxIterations`. Routing through `finalizeToolErrorResult` gives the
       * existing breakers something to count — no new counter — while the text
       * the model reads is still the guard's own guidance.
       */
      const declineToolCall = (guidance: string): EngineContentPart => {
        const result = finalizeToolErrorResult(guidance);
        send({
          type: "tool_start",
          id: toolCall.id,
          tool: toolCall.name,
          input: toolCall.input as Record<string, string>,
        });
        send({
          type: "tool_done",
          id: toolCall.id,
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
        };
      };

      if (sourceSweepGuard) {
        sourceSweepDelegationGuardActive = true;
        return declineToolCall(sourceSweepGuard.message);
      }

      if (sourceSweepDelegationGuard) {
        return declineToolCall(sourceSweepDelegationGuard);
      }

      if (!actionEntry) {
        const result = finalizeToolErrorResult(
          `Error: Unknown tool "${toolCall.name}"`,
        );
        send({
          type: "tool_start",
          id: toolCall.id,
          tool: toolCall.name,
          input: toolCall.input as Record<string, string>,
        });
        send({
          type: "tool_done",
          id: toolCall.id,
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
      // Consume a grant on its first exact match. A second identical call in
      // the same continuation must request its own human approval.
      const approvalBinding: AgentApprovalBinding = {
        toolName: toolCall.name,
        input: toolCall.input,
        callId: toolCall.id,
        approvalKey,
      };
      const requestedApproval = approvedToolCallKeys.delete(approvalKey);
      const wasApproved =
        requestedApproval && opts.consumeApproval
          ? await opts.consumeApproval(approvalBinding)
          : requestedApproval;
      if (actionEntry.needsApproval && !wasApproved) {
        let mustApprove = false;
        try {
          mustApprove =
            typeof actionEntry.needsApproval === "function"
              ? Boolean(
                  await actionEntry.needsApproval(toolCall.input, {
                    userEmail: getRequestUserEmail(),
                    orgId: getRequestOrgId() ?? null,
                    appId: opts.appId,
                    caller: opts.actionCaller ?? "tool",
                    automation: opts.automation,
                    networkProtocol: opts.networkProtocol,
                    networkId: opts.networkId,
                    networkPeer: opts.networkPeer,
                  }),
                )
              : actionEntry.needsApproval === true;
        } catch {
          // Fail closed: a throwing predicate means we require approval rather
          // than silently running a high-consequence action.
          mustApprove = true;
        }
        if (mustApprove) {
          // `askId` identifies THIS gate hit, distinct from any earlier ask
          // for the same approvalKey/toolCallId. A failed resume (expired
          // grant, turn-id mismatch) re-enters this branch and mints a new
          // askId, which is how the client tells "an already-approved card
          // re-rendered" apart from "a fresh ask after the grant didn't land"
          // — without it, a stale client-side "approved" mark permanently
          // hides Approve/Deny with no way to retry.
          const askId =
            (await opts.onApprovalRequired?.(approvalBinding)) || undefined;
          send({
            type: "tool_start",
            id: toolCall.id,
            tool: toolCall.name,
            input: toolCall.input as Record<string, string>,
          });
          send({
            type: "approval_required",
            tool: toolCall.name,
            input: toolCall.input as Record<string, string>,
            approvalKey,
            ...(askId ? { askId } : {}),
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
                caller: opts.actionCaller ?? "tool",
                networkProtocol: opts.networkProtocol,
                networkId: opts.networkId,
                networkPeer: opts.networkPeer,
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
            id: toolCall.id,
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
      const requestedToolTimeoutMs =
        actionEntry.timeoutMs ??
        opts.toolLimits?.timeoutMs ??
        DEFAULT_TOOL_TIMEOUT_MS;
      const toolTimeoutMs =
        runToolTimeoutCeilingMs > 0
          ? Math.min(requestedToolTimeoutMs, runToolTimeoutCeilingMs)
          : requestedToolTimeoutMs;
      const configuredToolMaxResultChars =
        actionEntry.maxResultChars ??
        opts.toolLimits?.maxResultChars ??
        DEFAULT_TOOL_RESULT_CHARS;
      const toolMaxResultChars =
        typeof opts.toolLimits?.hardMaxResultChars === "number"
          ? Math.min(
              configuredToolMaxResultChars,
              opts.toolLimits.hardMaxResultChars,
            )
          : configuredToolMaxResultChars;

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
      //
      // Read-only tools take the OTHER half of this protection:
      // `seedReadOnlyToolResultsFromJournal` puts their journaled results into
      // `readOnlyToolResultCache`, so the duplicate-read guard below serves them
      // as a cache hit (respecting `dedupe: false` and write invalidation)
      // instead of re-executing.
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
            id: toolCall.id,
            tool: toolCall.name,
            input: toolCall.input as Record<string, string>,
          });
          send({
            type: "tool_done",
            id: toolCall.id,
            tool: toolCall.name,
            input: toolCall.input as Record<string, unknown>,
            result,
            completedSideEffect: true,
          });
          recordToolResult(result, false);
          noteToolCallSucceeded(actionEntry);
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
              id: toolCall.id,
              tool: toolCall.name,
              input: toolCall.input as Record<string, string>,
            });
            send({
              type: "tool_done",
              id: toolCall.id,
              tool: toolCall.name,
              input: toolCall.input as Record<string, unknown>,
              result,
              completedSideEffect: true,
              ...(actionEntry.chatUI ? { chatUI: actionEntry.chatUI } : {}),
            });
            recordToolResult(result, false);
            noteToolCallSucceeded(actionEntry);
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
            id: toolCall.id,
            tool: toolCall.name,
            input: toolCall.input as Record<string, string>,
          });
          send({
            type: "tool_done",
            id: toolCall.id,
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
        id: toolCall.id,
        tool: toolCall.name,
        input: toolCall.input as Record<string, string>,
      });

      let toolDoneEmitted = false;
      const emitToolDone = (
        event: Extract<AgentChatEvent, { type: "tool_done" }>,
      ) => {
        send(event);
        toolDoneEmitted = true;
      };

      // Every tool_start must have exactly one matching tool_done. Keeping the
      // whole post-start path inside this finally block turns unexpected
      // synchronous failures in validation, cache handling, or future branches
      // into an explicit tool error instead of leaving run-manager's in-flight
      // counter latched forever.
      try {
        const toolCallSchemaError = toolCallErrors.get(toolCall.id);
        if (toolCallSchemaError && !toolInputNormalized) {
          const result = finalizeToolErrorResult(
            toolInputSchemaErrorResult(
              toolCall.name,
              toolCallSchemaError.input,
              toolCallSchemaError.error,
              actionEntry?.tool.parameters,
            ),
          );
          emitToolDone({
            type: "tool_done",
            id: toolCall.id,
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
              actionEntry.tool.parameters,
            ),
          );
          emitToolDone({
            type: "tool_done",
            id: toolCall.id,
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

        // dedupe: false opts a read-only tool out of the guard entirely — the
        // cacheKey stays null so it never gets skipped-as-duplicate and never
        // populates the cache (see the success handler below, which also
        // leaves dedupe:false results uncached and un-cleared).
        const cacheKey =
          actionEntry.readOnly === true && actionEntry.dedupe !== false
            ? toolCallCacheKey(toolCall.name, toolCall.input)
            : null;
        if (cacheKey && readOnlyToolResultCache.has(cacheKey)) {
          const previousResult = readOnlyToolResultCache.get(cacheKey) ?? "";
          // `contextMessages` (not `messages`) is what the model actually sees
          // this iteration — context-xray eviction/summarization and
          // observational-memory trimming can drop the earlier result from
          // view even though it's still cached here. Only strike-count the
          // repeat when the model could have looked back and found it itself.
          const visible = isCachedToolResultVisibleInContext(
            contextMessages,
            toolCall,
            previousResult,
          );
          let result: string;
          if (visible) {
            const repeats = (duplicateReadOnlyToolCalls.get(cacheKey) ?? 0) + 1;
            duplicateReadOnlyToolCalls.set(cacheKey, repeats);
            result = visibleDuplicateReadOnlyToolResult(toolCall.name);
            if (repeats >= 3) {
              requestedActionStop ??= {
                message:
                  "I stopped because the agent kept asking for the same read-only context it already had. Please send the request again if you want me to retry from a fresh turn.",
                errorCode: "duplicate_read_only_tool",
              };
            }
          } else {
            // The earlier result was trimmed out of the model's visible
            // context — this isn't a repetitive loop, the model legitimately
            // can't see the answer anymore. Re-serve it in full and don't
            // count a strike.
            duplicateReadOnlyToolCalls.set(cacheKey, 0);
            result = resurfacedDuplicateReadOnlyToolResult(
              toolCall.name,
              previousResult,
            );
          }
          emitToolDone({
            type: "tool_done",
            id: toolCall.id,
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

        if (
          opts.executionMode === "plan" &&
          !isPlanModeToolCallAllowed(toolCall.name, toolCall.input, actionEntry)
        ) {
          const result = planModeBlockedMessage(toolCall.name);
          emitToolDone({
            type: "tool_done",
            id: toolCall.id,
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
            appId: opts.appId,
            caller: opts.actionCaller ?? "tool",
            automation: opts.automation,
            networkProtocol: opts.networkProtocol,
            networkId: opts.networkId,
            networkPeer: opts.networkPeer,
            delegationDepth: opts.delegationDepth,
            visitedApps: opts.visitedApps,
            attachments: opts.attachments,
            signal,
            // Audit attribution: the action name + the agent thread/turn that
            // triggered this call, so a mutation can be traced to its run.
            actionName: toolCall.name,
            ...(wasApproved ? { approvedToolCallKey: approvalKey } : {}),
            ...(opts.threadId ? { threadId: opts.threadId } : {}),
            ...(opts.runId ? { runId: opts.runId } : {}),
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
            const ledgerToolKey = toolCallCacheKey(
              toolCall.name,
              toolCall.input,
            );
            actionPromise
              .then((zombieRaw: unknown) => {
                const zombieMcp = isMcpActionResult(zombieRaw)
                  ? zombieRaw
                  : null;
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
          // Demo mode is browser-local presentation state. The agent and MCP
          // layers always receive the real, access-scoped tool result.
          let resultForAgent: unknown = rawForAgent;
          // Vision images for the model: MCP tools return standard `image`
          // content parts; first-party actions opt in via the well-known
          // `_agentImages` result field (stripped from the JSON the model
          // reads). The images array
          // never touches the ledger — only the compact text notes appended
          // below are persisted.
          let imageNotes: string[] = [];
          if (mcpResult) {
            const mcpImages = extractMcpToolResultImages(mcpResult.raw);
            if (mcpImages.length > 0) toolResultImages = mcpImages;
          } else {
            const extracted =
              extractAgentImagesFromActionResult(resultForAgent);
            resultForAgent = extracted.value;
            imageNotes = extracted.notes;
            if (extracted.images.length > 0) {
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
            typeof resultForAgent === "string"
              ? resultForAgent
              : JSON.stringify(resultForAgent, null, 2);
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

        // Side-channel warnings raised anywhere inside the action's call stack
        // (see `action-warnings.ts`). Drained here rather than in the success
        // branch so an action that warns and then throws still surfaces it, and
        // so nothing stays pending to bleed into a later tool's result.
        const agentWarnings = drainAgentWarnings();
        if (agentWarnings.length > 0) {
          result = `${result}\n\n${formatAgentWarningsForToolResult(agentWarnings)}`;
        }

        // Auto-refresh the UI after a successful mutating tool call. Any call
        // that isn't read-only — by its own per-call Plan-mode effect, else the
        // action's readOnly flag — is assumed to mutate. The client's useDbSync
        // listener sees a change event with source:"action" and invalidates
        // ["action"] queries so list-* / get-* refetch. This makes refresh after
        // agent writes reliable without the model needing to remember to call
        // `refresh-screen` itself.
        if (!isError) {
          try {
            const { actionCallIsReadOnly, notifyActionChangeInBackground } =
              await import("../server/action-change.js");
            if (!actionCallIsReadOnly(actionEntry, toolCall.input, false)) {
              const owner =
                opts.ownerEmail ?? getRequestUserEmail() ?? undefined;
              const orgId = opts.orgId ?? getRequestOrgId() ?? undefined;
              notifyActionChangeInBackground({
                actionName: toolCall.name,
                ...(owner ? { owner } : {}),
                ...(orgId ? { orgId } : {}),
              });
            }
          } catch (error) {
            // poll module may be unavailable in non-server contexts — keep the
            // tool result, but make the failed background refresh observable.
            console.warn(
              "Could not notify the action-change poller after a tool call",
              error,
            );
          }
        }

        emitToolDone({
          type: "tool_done",
          id: toolCall.id,
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
          noteToolCallSucceeded(actionEntry);
          if (cacheKey) {
            readOnlyToolResultCache.set(cacheKey, result);
          } else if (actionEntry.readOnly !== true) {
            // A genuine write invalidates all cached reads. A dedupe:false
            // read-only tool also has a null cacheKey (see above) but must NOT
            // clear the cache — it isn't a write and other tools' cached reads
            // are still valid.
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
      } finally {
        if (!toolDoneEmitted) {
          const result = `Error running ${toolCall.name}: tool execution ended before returning a result.`;
          emitToolDone({
            type: "tool_done",
            id: toolCall.id,
            tool: toolCall.name,
            input: toolCall.input as Record<string, unknown>,
            result,
            isError: true,
            completedSideEffect: false,
          });
          recordToolResult(result, true);
        }
      }
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

    // An `endsTurn` action already handed control to the user, so the rest of
    // this assistant message belongs to a turn that is over. Report those calls
    // as not executed rather than running them: a second `ask-question` would
    // overwrite the first one's card before anyone could answer it.
    const skipToolCallAfterYield = (
      toolCall: import("./engine/types.js").EngineToolCallPart,
    ): EngineContentPart => {
      const result =
        `Not executed: ${toolCall.name} was called after an action that ends the turn. ` +
        `The turn is paused for the user's answer — call it again on a later turn if still needed.`;
      send({
        type: "tool_start",
        id: toolCall.id,
        tool: toolCall.name,
        input: toolCall.input as Record<string, string>,
      });
      send({
        type: "tool_done",
        id: toolCall.id,
        tool: toolCall.name,
        input: toolCall.input as Record<string, unknown>,
        result,
        completedSideEffect: false,
      });
      toolResultHistory.push({
        name: toolCall.name,
        content: result,
        isError: false,
      });
      return {
        type: "tool-result" as const,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolInput: JSON.stringify(toolCall.input ?? {}),
        content: result,
      };
    };

    for (const toolCall of toolCallParts) {
      if (turnYieldedToUser) {
        await flushParallelBatch();
        toolResultParts.push(skipToolCallAfterYield(toolCall));
        continue;
      }
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
      const stop = requestedActionStop as TerminalActionStop;
      terminalActionStop = stop;
      sendTerminalActionStop(stop);
      break;
    }
  }

  // A processor halted the run: the `tripwire` event and final message were
  // already emitted at the abort site. Do NOT send the normal `done` — the run
  // ended on a guardrail, not a clean turn. The result hook still fires below
  // so processors can observe the (halted) final text.
  if (tripwire) {
    // TypeScript cannot see assignments performed by the processor callback
    // inside the loop, so preserve the runtime narrowing explicitly here.
    const terminalTripwire = tripwire as TripWire;
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
    reportOutcome({
      state: "failed",
      code:
        terminalTripwire.processor === "run-input-token-budget"
          ? "budget_exhausted"
          : terminalTripwire.processor
            ? `guardrail:${terminalTripwire.processor}`
            : "guardrail",
      // Re-running the same request with the same deterministic guardrail
      // would reproduce the stop. A caller can issue a smaller follow-up, but
      // must not automatically replay this turn.
      retryable: false,
      message: terminalTripwire.message,
    });
    return usage;
  }

  if (!signal.aborted && !endedAtLoopLimit && !terminalActionStop) {
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
        const compaction = maybeCompactThread({
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
        // This pass has to finish a streaming model call before it writes, and
        // it starts after the turn's `done` event — on a host that freezes the
        // isolate once the response settles, an unregistered promise is simply
        // killed, so the thread never accrues the memory that would spare the
        // next turn. Hand it to the platform keep-alive where there is one;
        // long-lived hosts keep the existing fire-and-forget behavior.
        const waitUntil = getRequestRunContext()?.waitUntil;
        if (waitUntil) waitUntil(compaction);
        else void compaction;
      }
    }
  }

  // Assignments happen inside async tool-loop closures, which TypeScript cannot
  // use for narrowing at this point. Snapshot the runtime value before the
  // outcome branches so a stop is still represented as a possible value.
  const finalTerminalActionStop =
    terminalActionStop as TerminalActionStop | null;
  if (signal.aborted) {
    reportOutcome({ state: "canceled", message: "Agent run was aborted." });
  } else if (endedAtLoopLimit) {
    reportOutcome({
      state: "failed",
      code: "loop_limit",
      retryable: false,
      message: `Agent stopped after ${maxIterations} iterations.`,
    });
  } else if (finalTerminalActionStop?.errorCode === "needs-approval") {
    reportOutcome({
      state: "input_required",
      code: "needs_approval",
      message: finalTerminalActionStop.message,
    });
  } else if (finalTerminalActionStop?.errorCode === "awaiting-user-input") {
    reportOutcome({
      state: "input_required",
      code: "awaiting_user_input",
      message: finalTerminalActionStop.message,
    });
  } else if (finalTerminalActionStop) {
    reportOutcome({
      state: "failed",
      code: finalTerminalActionStop.errorCode ?? "tool_failed",
      retryable: false,
      message: finalTerminalActionStop.message,
    });
  } else {
    reportOutcome({ state: "completed" });
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

/** @internal exported for unit tests only */
export function isRecoverableContinuationError(event: {
  type: "error";
  error: string;
  errorCode?: string;
  recoverable?: boolean;
}): boolean {
  const code = String(event.errorCode ?? "").toLowerCase();
  const message = event.error.toLowerCase();
  if (code === "builder_gateway_error") return false;
  // An explicit flag outranks the message sniff below, which exists for events
  // that carry no flag at all. Every guard stop sets `recoverable: false`, and
  // sniffing its prose is how a stop that merely NAMES a connection or a
  // timeout gets continued into the spiral it was raised to end. The client
  // applies the same precedence in `isAutoRecoverableError`.
  if (event.recoverable === false) return false;
  return (
    event.recoverable === true ||
    code === "builder_gateway_timeout" ||
    code === "builder_gateway_network_error" ||
    // Server-driven background continuation for a truncated stream. The message
    // used to carry this ("stream ended without a stop event", classified into
    // `builder_gateway_network_error` above); the code carries it now, and on a
    // Builder-credits deployment the code is all that is left.
    code === "builder_gateway_stream_ended" ||
    code === "provider_network_error" ||
    code === "stale_run" ||
    code === "timeout" ||
    code === "timeout_error" ||
    code === "http_408" ||
    code === "http_429" ||
    // The 5xx family the message clauses below used to reach by prose alone
    // ("temporarily unavailable", "gateway timeout"). The client's own
    // continuation list (sse-event-processor) has always carried these codes;
    // the server read the sentence instead, which a Builder-credits deployment
    // replaces with one visitor line.
    code === "http_500" ||
    // The same 500, delivered in-stream with no status attached.
    code === BUILDER_GATEWAY_INTERNAL_ERROR_CODE ||
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "http_529" ||
    code === "run_timeout" ||
    message.includes("timeout") ||
    isProviderConnectionErrorMessage(message) ||
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
  opts: Parameters<typeof runAgentLoop>[0] & {
    /**
     * Resume a thrown `isResumableEngineError` (gateway drop / transport
     * interruption surviving engine retries) in-process UNCONDITIONALLY — the
     * same "continue from where you left off" treatment applied to in-loop
     * `auto_continue` events below.
     *
     * Set it only for a proven durable-background worker
     * (`isInBackgroundFunctionRuntime()`), which has minutes of budget left on
     * this invocation AND cannot fall back to `chainServerDrivenContinuation`
     * (a background function cannot invoke its own public URL from inside a
     * live invocation — that self-dispatch 404s).
     *
     * When omitted, the resume still happens but only while enough wall-clock
     * remains (`SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS`); below that the error
     * propagates to `startRun`'s outer catch and the cross-invocation recovery
     * paths (foreground self-chain, client `auto_continue` re-POST) as before.
     */
    resumeResumableErrorsInProcess?: boolean;
    /**
     * Override for the per-invocation continuation attempt cap. Defaults to
     * `MAIN_CHAT_INTERNAL_CONTINUATION_LIMIT` (6) when omitted — unchanged for
     * every existing caller. A proven background-function worker (15-min
     * budget) can pass a higher cap (e.g. `MAX_BACKGROUND_RUN_CONTINUATIONS`)
     * so a run that needs several resumable-error recoveries within one
     * 13-minute chunk isn't cut off at the foreground-sized limit.
     */
    maxContinuations?: number;
  },
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const finalResponseGuardRequestText =
    opts.finalResponseGuardRequestText ??
    resolveFinalResponseGuardRequestText(opts.messages);
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
    if (typeof next.llmCalls === "number") {
      usage.llmCalls = (usage.llmCalls ?? 0) + next.llmCalls;
    }
    if (next.usageReported) usage.usageReported = true;
    // Keep the earliest attempt's first event — a later continuation
    // attempt starting fresh must not overwrite genuine first-token timing.
    usage.firstEngineEventAtMs ??= next.firstEngineEventAtMs;
  };

  const budgetStartedAt = opts.budgetStartedAt ?? Date.now();
  const resumeResumableErrorsInProcess =
    opts.resumeResumableErrorsInProcess === true;
  const maxContinuations =
    typeof opts.maxContinuations === "number" && opts.maxContinuations > 0
      ? opts.maxContinuations
      : MAIN_CHAT_INTERNAL_CONTINUATION_LIMIT;

  const localTurnEvents: AgentChatEvent[] = [];
  let lastAttemptWasUnfinishedContinuation = false;
  for (
    let attempt = 0;
    !opts.signal.aborted && attempt < maxContinuations;
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

    try {
      const nextUsage = await runAgentLoop({
        ...opts,
        budgetStartedAt,
        send,
        finalResponseGuardRequestText,
      });
      addUsage(nextUsage);
    } catch (err) {
      // An aborted signal (real soft-timeout / user stop) or a non-resumable
      // error is always rethrown.
      if (opts.signal.aborted || !isResumableEngineError(err)) throw err;
      // A caller with a proven long budget (`resumeResumableErrorsInProcess`)
      // always resumes here. Everyone else — notably the foreground chat turn,
      // where a resumable transport error previously ALWAYS propagated and in
      // practice was never resumed by any other layer — resumes too, but only
      // while enough wall-clock remains to attempt it without being cut off
      // mid-stream by the platform wall.
      if (
        !resumeResumableErrorsInProcess &&
        remainingRunBudgetMs(budgetStartedAt) <
          SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS
      ) {
        throw err;
      }
      continuationReason = continuationReasonForResumableError(err);
    }

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
      recoverable: false,
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
 * Consecutive chunks allowed to end on the SAME terminal error code having
 * produced nothing before the chain stops.
 *
 * Two, because two independent recovery layers multiply here and neither can
 * see the other: the engine already retried this identical request 3x with
 * backoff before the error was ever emitted, and a recoverable error is also a
 * continuation boundary, so every chunk that fails costs 4 gateway attempts
 * and dispatches a fresh one. A production turn spent 27 background runs and
 * 15 minutes on one message this way. The first repeat is the retry this path
 * exists for; a second identical failure that moved nothing is evidence the
 * retrying itself is what is broken, not the request.
 */
export const MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS = 2;

/**
 * Forward progress inside ONE chunk, read from the events it actually emitted:
 * assistant text or tool activity. Same evidence the agent-teams no-progress
 * budget counts (`agent-teams.ts`), and the same events
 * `endsAfterCompletedToolWithoutAssistantFinal` reads to tell an unfinished
 * turn from a finished one.
 */
function chunkMadeForwardProgress(run: ActiveRun): boolean {
  return run.events.some(
    ({ event }) =>
      (event.type === "text" && event.text.trim().length > 0) ||
      event.type === "tool_start" ||
      event.type === "tool_done",
  );
}

/** Consecutive-identical-failure state for one chunk of a background chain. */
export interface BackgroundNoProgressRepeat {
  /** This chunk's terminal error code, when it ended having produced nothing. */
  errorCode?: string;
  /** Chunks in a row that ended on that code with no forward progress. */
  count: number;
  /** True once the streak reaches `MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS`. */
  tripped: boolean;
}

/**
 * Advance the no-progress streak across a chunk boundary. A chunk that emitted
 * any text or tool activity resets it even when it still ended in an error —
 * that turn IS moving, and cutting it off is what would weaken recovery for
 * truncated streams. So does a different error code, and so does a boundary
 * with no error at all (a soft-timeout `auto_continue` is the run-manager's
 * no-progress backstop to bound, not this one).
 */
export function resolveBackgroundNoProgressRepeat(opts: {
  run: ActiveRun;
  priorErrorCode?: string;
  priorCount?: number;
}): BackgroundNoProgressRepeat {
  const last = opts.run.events.at(-1)?.event;
  const errorCode = last?.type === "error" ? (last.errorCode ?? "").trim() : "";
  if (!errorCode || chunkMadeForwardProgress(opts.run)) {
    return { count: 0, tripped: false };
  }
  const prior =
    opts.priorErrorCode === errorCode &&
    typeof opts.priorCount === "number" &&
    Number.isFinite(opts.priorCount)
      ? Math.max(0, Math.floor(opts.priorCount))
      : 0;
  const count = prior + 1;
  return {
    errorCode,
    count,
    tripped: count >= MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS,
  };
}

/**
 * The single honest failure the breaker leaves behind. Keeps the underlying
 * code and the gateway's own message (which carries its `ERROR ID:` reference)
 * so the failure stays diagnosable, and marks it non-recoverable so neither
 * this chain nor the client's continuation path re-enters it.
 */
export function backgroundNoProgressTerminalEvent(
  run: ActiveRun,
  repeat: BackgroundNoProgressRepeat,
): Extract<AgentChatEvent, { type: "error" }> | null {
  const last = run.events.at(-1)?.event;
  if (last?.type !== "error") return null;
  return {
    ...last,
    error:
      `${last.error}\n\nThis failed ${repeat.count} times in a row without ` +
      `making any progress, so I stopped instead of retrying again.`,
    recoverable: false,
  };
}

export function installBackgroundNoProgressTerminalEvent(
  run: ActiveRun,
  repeat: BackgroundNoProgressRepeat,
): boolean {
  const terminalEvent = backgroundNoProgressTerminalEvent(run, repeat);
  const lastRunEvent = run.events.at(-1);
  if (!terminalEvent || lastRunEvent?.event.type !== "error") return false;
  run.events = [
    ...run.events.slice(0, -1),
    { ...lastRunEvent, event: terminalEvent },
  ];
  run.continuationTerminalEvent = terminalEvent;
  return true;
}

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
 * Aborted / user-stopped runs do NOT chain either way, and neither does a run
 * whose no-progress streak has tripped
 * (`MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS`).
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
  /** Streak state carried on the continuation marker — see
   *  `resolveBackgroundNoProgressRepeat`. Absent on the first chunk. */
  priorNoProgressErrorCode?: string;
  priorNoProgressCount?: number;
}): boolean {
  const eligible =
    opts.isBackgroundWorker ||
    (opts.foregroundSelfChainEligible === true &&
      opts.dispatchedToBackground !== true);
  return (
    eligible &&
    opts.run.status !== "aborted" &&
    endsAtContinuationBoundary(opts.run) &&
    opts.continuationCount < MAX_BACKGROUND_RUN_CONTINUATIONS &&
    !resolveBackgroundNoProgressRepeat({
      run: opts.run,
      priorErrorCode: opts.priorNoProgressErrorCode,
      priorCount: opts.priorNoProgressCount,
    }).tripped
  );
}

/**
 * Minimum remaining budget (ms) a synchronous self-chain continuation chunk
 * must have left — after subtracting the wall-clock this invocation has
 * ALREADY spent on its own pre-`startRun` setup (auth, DB reads, marker
 * validation) — before it is safe to let it start real agent-loop work at
 * all. Below this, even a reduced soft-timeout risks the run making an LLM
 * call that then gets cut off by Netlify's ~60s synchronous-function hard
 * kill mid-stream instead of checkpointing cleanly — exactly the "run wedged
 * until stale-run recovery" failure `resolveSelfChainContinuationBudget`
 * hardens against. 8s leaves enough runway for a small model round trip (or
 * the soft-timeout timer itself) to still land cleanly before the hard wall.
 */
export const SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS = 8_000;

/** Result of `resolveSelfChainContinuationBudget`. */
export interface SelfChainContinuationBudget {
  /**
   * True when there isn't enough wall-clock left in THIS invocation to
   * safely start real agent-loop work. The caller should skip straight to a
   * synthetic `run_timeout` boundary (the same one a normal soft-timeout
   * produces) instead of invoking the loop, so the existing continuation
   * machinery (`chainServerDrivenContinuation` / the client's `auto_continue`
   * re-POST fallback) hands off to a fresh invocation instead of risking a
   * mid-stream kill.
   */
  skipToBoundary: boolean;
  /**
   * The soft-timeout budget to pass into `startRun` when NOT skipping — the
   * chunk's normal ceiling minus wall-clock already spent on setup. Always
   * `<= chunkCeilingMs` and `>= minContinuationBudgetMs` when `skipToBoundary`
   * is false.
   */
  softTimeoutMs: number;
}

/**
 * Budgets a synchronous (non-`-background`-function) self-chain continuation
 * chunk against the wall-clock ALREADY spent on this invocation's own setup
 * before `startRun` is ever called, instead of handing it a fresh
 * `chunkCeilingMs` window that ignores that setup cost entirely.
 *
 * Root cause this hardens against: when `AGENT_CHAT_FOREGROUND_SELF_CHAIN` is
 * enabled, a continuation is dispatched to the `_process-run` route running as
 * a REGULAR synchronous serverless function (hard ~60s wall on Netlify). The
 * handler burns setup time (DB reads, auth, marker validation) before ever
 * calling `startRun()`, which — unaware of that elapsed time — grants a fresh
 * ~40s run ceiling. Total handler time (setup + a fresh 40s) can then exceed
 * the 60s wall, so the function is killed mid-stream instead of checkpointing,
 * and the run sits "active" until stale-run recovery (~90s later) instead of
 * cleanly handing off.
 *
 * Pure function — no I/O, unit-testable in isolation.
 */
export function resolveSelfChainContinuationBudget(
  elapsedSinceHandlerEntryMs: number,
  chunkCeilingMs: number,
  minContinuationBudgetMs: number = SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS,
): SelfChainContinuationBudget {
  const remaining = chunkCeilingMs - Math.max(0, elapsedSinceHandlerEntryMs);
  if (remaining < minContinuationBudgetMs) {
    return { skipToBoundary: true, softTimeoutMs: 0 };
  }
  return { skipToBoundary: false, softTimeoutMs: remaining };
}

export async function markBackgroundContinuationChunkTerminal(opts: {
  runId: string;
  continuationReason: AgentLoopContinuationReason;
  terminalEvent?: AgentChatEvent;
  deps?: {
    updateRunStatusIfRunning?: typeof updateRunStatusIfRunning;
    setRunError?: typeof setRunError;
    setRunTerminalReason?: typeof setRunTerminalReason;
  };
}): Promise<boolean> {
  const updateStatus =
    opts.deps?.updateRunStatusIfRunning ?? updateRunStatusIfRunning;
  const persistError = opts.deps?.setRunError ?? setRunError;
  const setTerminalReason =
    opts.deps?.setRunTerminalReason ?? setRunTerminalReason;
  const terminalEvent = opts.terminalEvent;
  const isTerminalFailure =
    terminalEvent?.type === "error" ||
    terminalEvent?.type === "missing_api_key";
  const terminalReason =
    terminalEvent?.type === "error"
      ? `error:${terminalEvent.errorCode || "unknown"}`
      : terminalEvent?.type === "missing_api_key"
        ? "missing_api_key"
        : opts.continuationReason;
  const updated = await updateStatus(
    opts.runId,
    isTerminalFailure ? "errored" : "completed",
  );
  if (updated) {
    await setTerminalReason(opts.runId, terminalReason);
    if (terminalEvent?.type === "error") {
      await persistError(
        opts.runId,
        terminalEvent.errorCode,
        terminalEvent.details || terminalEvent.error,
      );
    } else if (terminalEvent?.type === "missing_api_key") {
      await persistError(
        opts.runId,
        LLM_MISSING_CREDENTIALS_ERROR_CODE,
        LLM_MISSING_CREDENTIALS_MESSAGE,
      );
    }
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
    isTurnAborted?: typeof isTurnAborted;
    markRunAborted?: typeof markRunAborted;
  };
}): Promise<{ claimed: true } | { claimed: false; skipped: string }> {
  const record = opts.deps?.recordRunDiagnostic ?? recordRunDiagnostic;
  const insert = opts.deps?.insertRun ?? insertRun;
  const claim = opts.deps?.claimBackgroundRun ?? claimBackgroundRun;
  const heartbeat = opts.deps?.updateRunHeartbeat ?? updateRunHeartbeat;
  const turnAborted = opts.deps?.isTurnAborted ?? isTurnAborted;
  const abortRun = opts.deps?.markRunAborted ?? markRunAborted;
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

  // A failed durable abort read must surface as infrastructure failure. It is
  // not evidence that the user stopped the turn.
  if (await turnAborted(threadId, turnId)) {
    await abortRun(opts.runId, "user").catch(() => {});
    return { claimed: false, skipped: "turn-aborted" };
  }

  if (opts.continuationCount > 0) {
    await insert(opts.runId, threadId, turnId, {
      dispatchMode: "background",
    }).catch(() => {});
  }

  if (await turnAborted(threadId, turnId)) {
    await abortRun(opts.runId, "user").catch(() => {});
    return { claimed: false, skipped: "turn-aborted" };
  }

  const won = await claim(opts.runId);
  if (!won) {
    await record(opts.runId, RUN_DIAG_STAGE.workerClaimLost).catch(() => {});
    return { claimed: false, skipped: "already-claimed" };
  }

  await record(opts.runId, RUN_DIAG_STAGE.workerClaimed).catch(() => {});
  await heartbeat(opts.runId).catch(() => {});
  if (await turnAborted(threadId, turnId)) {
    await abortRun(opts.runId, "user").catch(() => {});
    return { claimed: false, skipped: "turn-aborted" };
  }
  return { claimed: true };
}

/**
 * Wall-clock ceiling on a single logical turn. The run-count ledger alone is
 * not a time bound: in durable mode each of the ~25 permitted chunks may burn
 * ~780s, so the ledger's real worst case is over five hours (production has an
 * observed 2h34m turn). Nobody is waiting that long, and every minute past
 * this point is spend on a request the user has abandoned.
 */
export const MAX_TURN_WALL_CLOCK_MS = 90 * 60_000;

/**
 * Request-body field carrying the turn's running input-token total across
 * chunks. It rides the BODY (not the background-run marker) because the marker
 * is stripped from `continuationBody` on every handoff while the body is the
 * successor's persisted rehydration payload.
 */
export const AGENT_CHAT_TURN_INPUT_TOKENS_FIELD =
  "__agentNativeTurnInputTokens";

/**
 * First `started_at` for a logical turn — the turn's true wall-clock origin
 * (`agent_runs.started_at` is never bumped by heartbeats). Returns null when
 * the turn has no rows or the read fails, in which case the deadline simply
 * does not apply and the run-count ledger remains the only bound.
 *
 * Costs one extra round trip per chain. Folding `MIN(started_at)` into
 * `countRunsForTurn`'s existing SELECT in run-store.ts would remove it.
 */
async function readTurnStartedAt(
  threadId: string,
  turnId: string,
): Promise<number | null> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT MIN(started_at) AS turn_started_at FROM agent_runs WHERE thread_id = ? AND turn_id = ?`,
    args: [threadId, turnId],
  });
  const raw = (rows?.[0] as { turn_started_at?: unknown } | undefined)
    ?.turn_started_at;
  const startedAt = Number(raw);
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null;
}

/**
 * Append a user-visible assistant text event to a live run from outside the
 * agent loop. The budget-exhaustion paths below terminate a turn that has
 * already done real work; without this the user sees only a bare
 * `turn_continuation_budget_exhausted` error string and every completed tool
 * result looks discarded. Best-effort — a failed ledger write must not turn a
 * budget stop into a thrown error.
 */
async function emitRunText(run: ActiveRun, text: string): Promise<void> {
  const runEvent: RunEvent = {
    seq: run.events.length,
    event: { type: "text", text },
  };
  run.events.push(runEvent);
  for (const subscriber of run.subscribers) {
    try {
      subscriber(runEvent);
    } catch {}
  }
  await insertRunEvent(
    run.runId,
    runEvent.seq,
    JSON.stringify(runEvent.event),
  ).catch(() => {});
}

/**
 * One sentence naming what the turn actually finished, derived from the same
 * per-turn journal the resume note uses (no new ledger read shape).
 */
async function describeTurnProgress(
  threadId: string,
  turnId?: string,
): Promise<string> {
  const journalRead = await loadPriorTurnToolCallJournal(threadId, turnId);
  if (journalRead.status === "unreadable") {
    return "I could not read the run ledger, so I cannot say which steps completed.";
  }
  const completed = journalRead.toolCallJournal?.completed ?? [];
  if (completed.length === 0) return "No steps had completed yet.";
  const names = [...new Set(completed.map((entry) => entry.tool))];
  const shown = names.slice(0, 8).join(", ");
  return (
    `${completed.length} step(s) completed before I stopped (${shown}` +
    `${names.length > 8 ? ", …" : ""}). Their results are in the messages above.`
  );
}

/** Injectable dependencies for `chainServerDrivenContinuation` (unit tests). */
export interface ChainServerDrivenContinuationDeps {
  countRunsForTurn?: typeof countRunsForTurn;
  readTurnStartedAt?: typeof readTurnStartedAt;
  isTurnAborted?: typeof isTurnAborted;
  emitRunText?: typeof emitRunText;
  insertRun?: typeof insertRun;
  fireInternalDispatch?: typeof fireInternalDispatch;
  readBackgroundRunClaim?: typeof readBackgroundRunClaim;
  updateRunHeartbeat?: typeof updateRunHeartbeat;
  updateRunStatusIfRunning?: typeof updateRunStatusIfRunning;
  markRunAborted?: typeof markRunAborted;
  setRunTerminalReason?: typeof setRunTerminalReason;
  setRunError?: typeof setRunError;
  recordRunDiagnostic?: typeof recordRunDiagnostic;
  markBackgroundContinuationChunkTerminal?: typeof markBackgroundContinuationChunkTerminal;
  generateRunId?: typeof generateRunId;
  sleep?: (ms: number) => Promise<void>;
}

/** Retry-budget sizing for one `chainServerDrivenContinuation` dispatch. */
export interface ContinuationDispatchBudget {
  maxDispatchAttempts: number;
  dispatchResponseTimeoutMs: number;
  /** Cap (ms) on the per-gap exponential backoff. `Infinity` preserves the
   *  original uncapped `500 * 2 ** attempt` schedule for the two budgets
   *  that predate this cap (their attempt counts are low enough it never
   *  mattered); only the larger proven-in-background-function budget uses a
   *  real cap so its extra attempts don't add unbounded backoff. */
  backoffCapMs: number;
}

/**
 * Sizes the dispatch retry budget by *remaining wall-clock capacity*, not by
 * dispatch TARGET — the two are independent concerns. `chainViaDurableBackground`
 * only picks where the dispatch goes (see `continuationDispatchPath` above);
 * this picks how hard to retry getting it there.
 *
 * Three cases:
 *   - `chainViaDurableBackground === true`: the durable worker chain dispatching
 *     to the Netlify background function url. Unchanged: 3 attempts / 15s.
 *   - `chainViaDurableBackground === false` and
 *     `workerProvenInBackgroundFunction === true`: a worker PROVEN (by runtime
 *     function name, see `shouldUseBackgroundFunctionTimeoutForWorker`) to
 *     already be executing inside a real `-background` function — it was
 *     forced onto the regular-function dispatch target only because a
 *     background function cannot invoke its own URL from within a live
 *     invocation (see the caller's `&& !runsInBackgroundFunction` comment),
 *     NOT because it lacks time or a connected-client fallback. This worker
 *     has up to `BACKGROUND_SOFT_TIMEOUT_CEILING_MS` (13min) of soft-timeout
 *     budget behind it and up to Netlify's ~15min hard function limit ahead —
 *     roughly 2 minutes of remaining wall clock — and, being a background
 *     worker, NO connected client to fall back on if the handoff is dropped.
 *     Demoting it to the foreground's 2-attempt/10s budget is exactly the bug
 *     this type documents: 5 attempts / 15s response timeout, with backoff
 *     capped at 4s/gap (500ms, 1s, 2s, 4s across the 4 gaps ≈ 7.5s total).
 *     Worst case: 5 × 15s dispatch + ~7.5s backoff ≈ 82.5s, safely inside the
 *     ~2min of remaining budget before the function's hard kill.
 *   - Otherwise: a true foreground caller not proven in a background
 *     function. Unchanged: 2 attempts / 10s — it has a live connected client
 *     as a fallback (the terminal `auto_continue` event still reaches it).
 */
export function resolveContinuationDispatchBudget(opts: {
  chainViaDurableBackground: boolean;
  workerProvenInBackgroundFunction: boolean;
}): ContinuationDispatchBudget {
  if (opts.chainViaDurableBackground) {
    return {
      maxDispatchAttempts: 3,
      dispatchResponseTimeoutMs: 15_000,
      backoffCapMs: Infinity,
    };
  }
  if (opts.workerProvenInBackgroundFunction) {
    return {
      maxDispatchAttempts: 5,
      dispatchResponseTimeoutMs: 15_000,
      backoffCapMs: 4_000,
    };
  }
  return {
    maxDispatchAttempts: 2,
    dispatchResponseTimeoutMs: 10_000,
    backoffCapMs: Infinity,
  };
}

/**
 * True when a `fireInternalDispatch` failure is Netlify's Functions platform
 * loop-protection response (`HTTP 508 Loop Detected`), matched against the
 * exact message `self-dispatch.ts`'s `dispatchResponseError` constructs
 * (`Self-dispatch to ${path} returned HTTP ${res.status} ${res.statusText}...`).
 * Matches on the status code alone (not the reason phrase text) so it is
 * robust to any wording Netlify's edge puts in `statusText`.
 *
 * VERIFIED: production `agent_runs` diagnostics show exactly this failure mode
 * — 8 successful `chain_dispatch_sent` self-dispatches followed by a 9th/10th
 * that dies with `HTTP 508 Loop Detected`, terminal reason
 * `background_continuation_dispatch_failed`. UNVERIFIED (Netlify does not
 * document the mechanism — checked the Functions overview, Functions API
 * reference, Background Functions overview, Status Codes reference, and
 * Request Chain troubleshooting docs, none mention it): the ONLY public
 * confirmation is a Netlify staff forum reply — "we prevent multiple
 * executions after one-another as that's a 'loop' ... I believe we enforce
 * this after 9 or 10 self-invocations"
 * (https://answers.netlify.com/t/self-invoke-background-function-via-post-requests/146012)
 * — which also confirms Background Functions do NOT escape the limit (the
 * reporter's case was already a `-background` function self-invoking). See
 * `MAX_NESTED_SELF_DISPATCH_DEPTH` for how this classification is used.
 */
export function isLoopProtectionDispatchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\bHTTP\s*508\b/i.test(err.message);
}

/**
 * Conservative safety margin on NESTED self-dispatch chaining — a
 * continuation dispatched directly from within the live invocation that is
 * about to finish, as opposed to being picked up later by the
 * unclaimed-background-run sweep (`agent-chat-plugin.ts`), which fires its
 * redispatch from an unrelated, timer-driven invocation rather than from
 * inside the chain's own execution.
 *
 * Netlify's loop-protection ceiling is undocumented and platform-reported
 * only approximately ("I believe... 9 or 10" — see
 * `isLoopProtectionDispatchError`), so hard-coding that exact number here
 * would be pinning behavior to a number Netlify itself won't commit to, and
 * production evidence shows it can trigger by the 9th self-dispatch. Rather
 * than only reacting after triggering that undocumented limit,
 * `chainServerDrivenContinuation` proactively hands a chunk to the sweep once
 * `backgroundContinuationCount` (nested hops since the last chain break)
 * reaches this value — comfortably below the observed ~9-10 failure point —
 * instead of attempting another nested dispatch. This is the SAME deferred-
 * recovery path already used when a dispatch fails outright: the row is left
 * `status='running', dispatch_mode='background'` for the sweep to redispatch,
 * never silently dropped.
 *
 * The sweep's redispatch marker intentionally omits `continuationCount` (see
 * the "Unclaimed background-run sweep" in `agent-chat-plugin.ts`), so a
 * sweep-recovered chunk's own `backgroundContinuationCount` resets to 0 —
 * this constant therefore bounds each NESTED segment between chain breaks,
 * not the whole turn. The TRUE ceiling on total turn length is unaffected by
 * that reset: it is the durable per-turn SQL ledger (`countRunsForTurn`,
 * checked above in this function) plus `MAX_BACKGROUND_RUN_CONTINUATIONS` —
 * both counted independently of this in-marker value — so a legitimately
 * long turn keeps making progress in bounded nested segments, each recovered
 * by the sweep, until it genuinely exhausts the intentional overall budget
 * and fails loud with `turn_continuation_budget_exhausted`.
 */
export const MAX_NESTED_SELF_DISPATCH_DEPTH = 6;

/**
 * Server-driven continuation handoff for a chunk that hit its soft-timeout
 * boundary still unfinished: mint the next chunk's runId, PRE-INSERT its run
 * row (so `/runs/active` never shows an idle gap and a lost dispatch is
 * reaped loudly instead of hanging silently), fire the HMAC-signed
 * `_process-run` self-dispatch carrying ids only (the body is persisted on
 * the row as `dispatch_payload`), fully AWAIT the dispatch acknowledgment
 * with retries, and mark this chunk terminal only after the handoff landed.
 * On failure this chunk always goes terminal loudly (diag stage + terminal
 * reason recorded — never a silent loss), but the successor row's fate
 * depends on WHY the dispatch failed:
 *   - the pre-insert itself failed (no successor row exists) — nothing for a
 *     sweep to find, so this is unrecoverable: fail loud immediately with
 *     `background_continuation_dispatch_failed`.
 *   - every dispatch attempt failed but the successor row DOES exist with its
 *     `dispatch_payload` intact — this is RECOVERABLE: the row is left alone
 *     (`status='running', dispatch_mode='background'`) instead of being
 *     errored, so the unclaimed-background-run sweep in `agent-chat-plugin.ts`
 *     can redispatch it once `UNCLAIMED_BACKGROUND_RUN_GRACE_MS` has passed.
 *     This chunk is flipped to errored with the distinct, honest
 *     `background_continuation_dispatch_deferred` reason — the TURN is
 *     deferred, not dead. The sweep still bounds this by
 *     `UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS`: past that it falls back
 *     to the existing loud reap, so a genuinely dead handoff never hangs
 *     silently forever. (For a FOREGROUND self-chain the client additionally
 *     still receives the terminal `auto_continue` event — run-manager emits
 *     it after this callback — so the existing client re-POST path is a
 *     second, faster fallback alongside the sweep.)
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
 *     the handoff landed, so no retry is fired.
 *
 * `chainViaDurableBackground` does NOT alone determine the retry BUDGET —
 * see `resolveContinuationDispatchBudget` and `workerProvenInBackgroundFunction`
 * below: a worker forced onto this same `false` target because it is proven
 * to already be inside a real background function gets a materially larger
 * budget than a true foreground caller, since it has no connected-client
 * fallback and minutes of remaining wall clock instead of seconds.
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
  /** This chunk's no-progress streak, carried to the successor so the breaker
   *  can see a repeat across the invocation boundary. */
  noProgressRepeat?: BackgroundNoProgressRepeat;
  /**
   * Input tokens this logical turn has consumed across every chunk so far,
   * carried on the successor's body so the per-turn token ceiling is a real
   * turn budget instead of a fresh allowance per chunk.
   */
  turnInputTokens?: number;
  chainViaDurableBackground: boolean;
  /** True only when this worker is PROVEN (by runtime function name) to
   *  already be executing inside a real Netlify `-background` function —
   *  distinct from `chainViaDurableBackground`, which is forced `false` for
   *  this exact worker (it cannot dispatch to its own function URL from a
   *  live invocation). Widens the retry budget; does NOT change the dispatch
   *  target. See `resolveContinuationDispatchBudget`. Defaults to `false`. */
  workerProvenInBackgroundFunction?: boolean;
  deps?: ChainServerDrivenContinuationDeps;
}): Promise<void> {
  const d = {
    countRunsForTurn: opts.deps?.countRunsForTurn ?? countRunsForTurn,
    readTurnStartedAt: opts.deps?.readTurnStartedAt ?? readTurnStartedAt,
    isTurnAborted: opts.deps?.isTurnAborted ?? isTurnAborted,
    emitRunText: opts.deps?.emitRunText ?? emitRunText,
    insertRun: opts.deps?.insertRun ?? insertRun,
    fireInternalDispatch:
      opts.deps?.fireInternalDispatch ?? fireInternalDispatch,
    readBackgroundRunClaim:
      opts.deps?.readBackgroundRunClaim ?? readBackgroundRunClaim,
    updateRunHeartbeat: opts.deps?.updateRunHeartbeat ?? updateRunHeartbeat,
    updateRunStatusIfRunning:
      opts.deps?.updateRunStatusIfRunning ?? updateRunStatusIfRunning,
    markRunAborted: opts.deps?.markRunAborted ?? markRunAborted,
    setRunTerminalReason:
      opts.deps?.setRunTerminalReason ?? setRunTerminalReason,
    setRunError: opts.deps?.setRunError ?? setRunError,
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
  const stopTurn = async (
    terminalReason: string,
    logLine: string,
    userMessage: string,
  ) => {
    console.error(`[agent-chat] ${logLine}`, runId);
    const progress = await describeTurnProgress(
      effectiveThreadId,
      effectiveTurnId,
    ).catch(() => "");
    await d
      .emitRunText(
        run,
        progress ? `${userMessage}\n\n${progress}` : userMessage,
      )
      .catch(() => {});
    const statusUpdated = await d
      .updateRunStatusIfRunning(runId, "errored")
      .catch(() => false);
    if (statusUpdated) {
      await d.setRunTerminalReason(runId, terminalReason).catch(() => {});
    }
  };

  if (
    turnRunCount !== null &&
    turnRunCount > MAX_BACKGROUND_RUN_CONTINUATIONS + 5
  ) {
    await stopTurn(
      "turn_continuation_budget_exhausted",
      `turn ${effectiveTurnId} consumed ${turnRunCount} runs — refusing to chain further`,
      `I stopped after ${turnRunCount} internal continuations without finishing this request.`,
    );
    return;
  }

  // WALL-CLOCK CEILING. The run-count ledger above bounds chunks, not time: in
  // durable mode 25 chunks x ~780s is over five hours, and prod has an observed
  // 2h34m turn. Measured from the turn's FIRST run row, so it survives every
  // recovery path exactly like the run count does.
  const turnStartedAt = await d
    .readTurnStartedAt(effectiveThreadId, effectiveTurnId)
    .catch(() => null);
  const turnElapsedMs = turnStartedAt === null ? 0 : Date.now() - turnStartedAt;
  if (turnElapsedMs > MAX_TURN_WALL_CLOCK_MS) {
    const elapsedMinutes = Math.round(turnElapsedMs / 60_000);
    await stopTurn(
      "turn_wall_clock_budget_exhausted",
      `turn ${effectiveTurnId} ran ${elapsedMinutes}min (limit ${Math.round(
        MAX_TURN_WALL_CLOCK_MS / 60_000,
      )}min) — refusing to chain further`,
      `I stopped after ${elapsedMinutes} minutes without finishing this request.`,
    );
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
  const dispatchBudget = resolveContinuationDispatchBudget({
    chainViaDurableBackground: opts.chainViaDurableBackground,
    workerProvenInBackgroundFunction:
      opts.workerProvenInBackgroundFunction === true,
  });
  const maxDispatchAttempts = dispatchBudget.maxDispatchAttempts;
  const continuationMarker = {
    runId: nextRunId,
    turnId: effectiveTurnId,
    continuationCount: opts.backgroundContinuationCount + 1,
    continuationReason,
    ...(actionPreparationTool ? { actionPreparationTool } : {}),
    ...(opts.noProgressRepeat?.errorCode
      ? {
          noProgressErrorCode: opts.noProgressRepeat.errorCode,
          noProgressCount: opts.noProgressRepeat.count,
        }
      : {}),
    backgroundFunctionRuntimeExpected:
      continuationExpectsNetlifyBackgroundFunction,
  };
  // Strip this chunk's own marker before persisting/forwarding — the next
  // chunk gets the fresh marker above.
  const continuationBody: Record<string, unknown> = {
    ...opts.requestBody,
    internalContinuation: true,
    ...(typeof opts.turnInputTokens === "number"
      ? { [AGENT_CHAT_TURN_INPUT_TOKENS_FIELD]: opts.turnInputTokens }
      : {}),
  };
  delete continuationBody[AGENT_CHAT_BACKGROUND_RUN_FIELD];
  try {
    if (await d.isTurnAborted(effectiveThreadId, effectiveTurnId)) {
      await d.markRunAborted(runId, "user").catch(() => {});
      return;
    }
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
    if (await d.isTurnAborted(effectiveThreadId, effectiveTurnId)) {
      if (nextRowInserted)
        await d.markRunAborted(nextRunId, "user").catch(() => {});
      await d.markRunAborted(runId, "user").catch(() => {});
      return;
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
    // Attempts to deliver the dispatch, retrying with backoff up to the
    // resolved budget. See `attemptContinuationDispatch` for the full
    // per-attempt rationale (nested-depth cap, claim-check on failure,
    // Netlify loop-protection short-circuit) — moved verbatim, unchanged.
    const { dispatched, lastDispatchErr, nestedDepthExceeded } =
      await attemptContinuationDispatch({
        event: opts.event,
        chainViaDurableBackground: opts.chainViaDurableBackground,
        backgroundContinuationCount: opts.backgroundContinuationCount,
        nextRunId,
        nextRowInserted,
        continuationDispatchPath,
        dispatchBody,
        dispatchBudget,
        isLoopProtectionDispatchError,
        maxNestedSelfDispatchDepth: MAX_NESTED_SELF_DISPATCH_DEPTH,
        deps: {
          sleep: d.sleep,
          updateRunHeartbeat: d.updateRunHeartbeat,
          fireInternalDispatch: d.fireInternalDispatch,
          readBackgroundRunClaim: d.readBackgroundRunClaim,
        },
      });
    if (!dispatched) {
      if (nextRowInserted) {
        // Classify WHY this handoff is being deferred — distinct, greppable
        // tags so production diagnostics (which is all that is readable from
        // a background worker) can tell "we proactively avoided Netlify loop
        // protection", "we hit loop protection and stopped retrying", and "a
        // generic transient dispatch failure exhausted its retry budget"
        // apart, instead of lumping every deferred handoff into one bucket.
        const deferralClassification = nestedDepthExceeded
          ? "proactive_depth_cap"
          : isLoopProtectionDispatchError(lastDispatchErr)
            ? "netlify_loop_protection"
            : "dispatch_budget_exhausted";
        // RECOVERABLE: the successor row already exists in SQL with its
        // rehydration payload (`dispatch_payload`) intact and is still
        // `status='running', dispatch_mode='background'` — exactly the state
        // the unclaimed-background-run sweep (`agent-chat-plugin.ts`) already
        // scans for. Do NOT error it here: leave it alone so the sweep can
        // redispatch it once `UNCLAIMED_BACKGROUND_RUN_GRACE_MS` has passed,
        // bounded by `UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS` before it
        // falls back to the existing loud reap
        // (`background_worker_never_started`) — so this is deferred, never a
        // silent hang. This chunk still goes terminal (its own soft-timeout
        // budget is genuinely spent), but with an honest reason: the TURN is
        // not dead, only this handoff attempt was.
        //
        // THREE-SITE INVARIANT (keep in lockstep — a future reader must not
        // "fix" one without the others): this deferral only survives because
        // the ~1s client poll in `getActiveRunForThreadAsync`
        // (run-manager.ts) ALSO skips `reapUnclaimedBackgroundRun` while the
        // successor is within `UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS`
        // (via `shouldRedispatchUnclaimedBackgroundRun`). Without that guard a
        // connected client would reap this row at the 25s grace, before the
        // sweep(s) get a chance, defeating the deferral. That same client
        // poll also surfaces `awaitingRedispatch: true` on `/runs/active`
        // for exactly this state so the client's background follow loop
        // (`agent-chat-adapter.ts`) does not count the quiet gap against its
        // own `BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS` and report a fatal error
        // for a turn the server is silently recovering. agent-chat-plugin.ts
        // runs the actual recovery actors: a FAST redispatch-only sweep
        // (`UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS`, ~20s ticks) that puts the
        // first redispatch attempt well inside the client's idle timeout, and
        // the original SLOW sweep (2 min) that also falls back to the loud
        // reap once `UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS` is
        // exceeded. run-manager.ts is the guard + wire-signal source; this is
        // the producer.
        await d
          .recordRunDiagnostic(
            nextRunId,
            RUN_DIAG_STAGE.workerThrew,
            `chain_dispatch_deferred[${deferralClassification}]: dispatch budget exhausted (${maxDispatchAttempts} attempts) awaiting unclaimed-run sweep redispatch; ${
              lastDispatchErr instanceof Error
                ? lastDispatchErr.message
                : String(lastDispatchErr)
            }`,
          )
          .catch(() => {});
        await d
          .recordRunDiagnostic(
            runId,
            RUN_DIAG_STAGE.workerThrew,
            `chain_dispatch_deferred[${deferralClassification}] nextRunId=${nextRunId} ${
              lastDispatchErr instanceof Error
                ? lastDispatchErr.message
                : String(lastDispatchErr)
            }`,
          )
          .catch(() => {});
        console.error(
          `[agent-chat] background continuation dispatch deferred (${deferralClassification}); leaving the pre-inserted successor for the unclaimed-run sweep to redispatch:`,
          lastDispatchErr instanceof Error
            ? lastDispatchErr.message
            : lastDispatchErr,
        );
        // `completed`, not `errored`: this chunk's work IS durably persisted
        // and a successor row exists for the sweep to redispatch. Only the
        // handoff attempt failed, and the terminal reason already says so —
        // recording the chunk as errored made a recoverable deferral look like
        // a failed turn everywhere run status is read.
        const statusUpdated = await d
          .updateRunStatusIfRunning(runId, "completed")
          .catch(() => false);
        if (statusUpdated) {
          await d
            .setRunTerminalReason(
              runId,
              "background_continuation_dispatch_deferred",
            )
            .catch(() => {});
        }
        return;
      }
      // No successor row exists at all (the pre-insert itself failed) — there
      // is nothing for the sweep to find and recover, so this really is
      // fatal. Fail loud immediately via the shared catch block below.
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
        terminalEvent: run.events.at(-1)?.event,
      })
      .catch(() => {});
    run.continuationTerminalEvent = {
      type: "auto_continue",
      reason: continuationReason,
    };
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
      // Record the cause on the row itself, not only inside diag_stage's JSON.
      // Without this the run goes terminal with error_code and error_detail
      // both NULL, so every dashboard and query reads it as a failure with no
      // known cause and the real message is only findable by parsing a blob.
      await d
        .setRunError(
          runId,
          "background_continuation_dispatch_failed",
          chainErr instanceof Error ? chainErr.message : String(chainErr),
        )
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
          : event.status === "pending"
            ? `${event.agent} is still working.`
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

export function resolveAgentRequestReasoningEffort({
  model,
  requestEffort,
  configuredEffort,
}: {
  model: string;
  requestEffort?: unknown;
  configuredEffort?: ReasoningEffort;
}): ReasoningEffort | undefined {
  return normalizeReasoningEffortForRequest(
    model,
    isReasoningEffort(requestEffort) ? requestEffort : configuredEffort,
  );
}

export type AgentModelSelectionSource =
  | "request"
  | "configured"
  | "stored"
  | "default";

function isConcreteModelSelection(
  model: string | null | undefined,
): model is string {
  const normalized = typeof model === "string" ? model.trim() : "";
  return normalized.length > 0 && normalized !== "auto";
}

/**
 * Resolve the model before the engine boundary. `auto` is a UI sentinel, not
 * a model to forward to the gateway, so it gives way to an AN org/user
 * default, then the configured global engine default.
 */
export function resolveAgentModelSelection(options: {
  requestModel?: string | null;
  configuredModel?: string | null;
  storedModel?: string | null;
  defaultModel: string;
}): { model: string; source: AgentModelSelectionSource } {
  if (isConcreteModelSelection(options.requestModel)) {
    return { model: options.requestModel, source: "request" };
  }
  if (isConcreteModelSelection(options.configuredModel)) {
    return { model: options.configuredModel, source: "configured" };
  }
  if (isConcreteModelSelection(options.storedModel)) {
    return { model: options.storedModel, source: "stored" };
  }
  return { model: options.defaultModel, source: "default" };
}

export function createProductionAgentHandler(
  options: ProductionAgentOptions,
): H3EventHandler {
  if (options.resolveActionSurface) {
    assertRequestActionSurfaceIsolation();
  }
  // Undefined = let each engine pick its own defaultModel at request time.
  const configuredModel = options.model;

  // Resolve actions — prefer `actions`, fall back to deprecated `scripts`
  const resolvedActions = options.actions ?? options.scripts ?? {};

  // Engine tools are derived from the action registry at request time so that
  // registries which mutate after handler creation (e.g. MCP servers added via
  // the settings UI) show up to the LLM without a process restart. MCP tools
  // are also scope-filtered per request — a user-scope server added by Alice
  // must not appear in Bob's tool list in a shared-process deployment.
  const getRequestActions = (
    actions: Record<string, ActionEntry> = resolvedActions,
  ) => {
    const filtered: Record<string, ActionEntry> = {};
    for (const [name, entry] of Object.entries(actions)) {
      if (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name)) {
        continue;
      }
      filtered[name] = entry;
    }
    return filtered;
  };
  const getEngineTools = (actions: Record<string, ActionEntry>) =>
    actionsToEngineTools(getRequestActions(actions));

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
      queuedMessageId,
      internalContinuation,
      turnId: requestTurnId,
      model: requestModel,
      engine: requestEngine,
      effort: requestEffort,
      browserTabId,
      scope,
      harness: requestHarness,
      trackInRunsTray,
    } = body;
    setupMark("bodyParsed");

    // Durable-background marker. Present ONLY when this handler was re-entered
    // as the Netlify background worker via the `_process-run` self-dispatch
    // (the route HMAC-verifies the dispatch before invoking us). When set, we
    // run the loop inline with the background soft-timeout, reusing the
    // pre-claimed runId/turnId — we must NOT re-claim the slot or re-dispatch.
    const backgroundRunMarker =
      preInjectedBody &&
      body[AGENT_CHAT_BACKGROUND_RUN_FIELD] &&
      typeof body[AGENT_CHAT_BACKGROUND_RUN_FIELD] === "object" &&
      typeof body[AGENT_CHAT_BACKGROUND_RUN_FIELD]!.runId === "string"
        ? body[AGENT_CHAT_BACKGROUND_RUN_FIELD]!
        : null;
    const isBackgroundWorker = backgroundRunMarker !== null;
    // Both fields are internal durable-dispatch artifacts, never client input.
    // A body marker alone is not proof of worker identity: only the verified
    // `_process-run` route can install `preInjectedBody` on the event context.
    if (!isBackgroundWorker) {
      delete body[AGENT_CHAT_BACKGROUND_RUN_FIELD];
      delete body.__resolvedActionSurface;
    }
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
    // No-progress streak so far, carried on the marker: this invocation has no
    // other memory of what the previous chunk failed with.
    const priorNoProgressErrorCode =
      typeof backgroundRunMarker?.noProgressErrorCode === "string"
        ? backgroundRunMarker.noProgressErrorCode
        : undefined;
    const priorNoProgressCount =
      typeof backgroundRunMarker?.noProgressCount === "number" &&
      Number.isFinite(backgroundRunMarker.noProgressCount)
        ? Math.max(0, Math.floor(backgroundRunMarker.noProgressCount))
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
        appOptIn: options.durableBackgroundRuns,
      });
    const mutableBody = body as unknown as Record<string, unknown>;
    if (!isBackgroundWorker) {
      delete mutableBody[ANALYTICS_CLIENT_PLATFORM_BODY_FIELD];
    }
    if (dispatchToBackground) {
      const clientPlatform = getRequestContext()?.clientPlatform;
      if (clientPlatform) {
        mutableBody[ANALYTICS_CLIENT_PLATFORM_BODY_FIELD] = clientPlatform;
      }
    }
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
    const requestedHostedHarness = normalizeHostedHarnessRuntime(
      requestHarness?.runtime,
    );
    if (requestHarness !== undefined && !requestedHostedHarness) {
      setResponseStatus(event, 400);
      return { error: "Unsupported hosted harness runtime" };
    }
    const hostedHarnessPolicy = requestedHostedHarness
      ? await resolveHostedHarnessPolicy({
          config: options.hostedHarnessConfig,
          orgId: getRequestOrgId() ?? null,
          userEmail: ownerEmail,
        })
      : null;
    if (
      requestedHostedHarness &&
      (!hostedHarnessPolicy?.enabled ||
        !hostedHarnessPolicy.runtimes.includes(requestedHostedHarness))
    ) {
      setResponseStatus(event, hostedHarnessPolicy?.configEnabled ? 403 : 404);
      return {
        error: hostedHarnessPolicy?.configEnabled
          ? "Hosted harness is not enabled for this organization"
          : "Hosted harness is not configured for this app",
      };
    }
    const runContext = ensureRequestRunContext();
    if (runContext && requestedHostedHarness) {
      runContext.hostedHarnessRuntime = requestedHostedHarness;
    }
    let availableRequestActions = getRequestActions();
    if (requestedHostedHarness) {
      availableRequestActions = filterActionsByAllowedNames(
        availableRequestActions,
        filterHostedHarnessToolNames(Object.keys(availableRequestActions)),
      );
    }
    let surfacedRequestActions = availableRequestActions;
    let useDefaultRequestActionSurface = !options.resolveActionSurface;
    if (options.resolveActionSurface) {
      const persistedSurface = isBackgroundWorker
        ? readPersistedActionSurface(body, "__resolvedActionSurface")
        : undefined;
      const surface =
        persistedSurface !== undefined
          ? persistedSurface
          : await options.resolveActionSurface({
              event,
              ownerEmail,
              orgId: getRequestOrgId() ?? null,
              threadId,
              mode: requestMode,
              internalContinuation: Boolean(internalContinuation),
              availableActionNames: Object.keys(availableRequestActions),
            });
      const normalizedSurface = normalizeAgentActionSurfaceResolution(surface);
      const runCtx = ensureRequestRunContext();
      if (normalizedSurface.mode === "default") {
        useDefaultRequestActionSurface = true;
        if (runCtx) delete runCtx.allowedActionNames;
        if (!isBackgroundWorker) {
          body.__resolvedActionSurface = {
            orgId: getRequestOrgId() ?? null,
            mode: "default",
          };
        }
      } else {
        surfacedRequestActions = filterActionsByAllowedNames(
          availableRequestActions,
          normalizedSurface.allowedActionNames,
        );
        if (requestedHostedHarness) {
          surfacedRequestActions = filterActionsByAllowedNames(
            surfacedRequestActions,
            filterHostedHarnessToolNames(Object.keys(surfacedRequestActions)),
          );
        }
        const allowedNames = Object.keys(surfacedRequestActions);
        if (runCtx) runCtx.allowedActionNames = allowedNames;
        if (!isBackgroundWorker) {
          body.__resolvedActionSurface = {
            orgId: getRequestOrgId() ?? null,
            allowedActionNames: allowedNames,
          };
        }
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

    // Resolve the key for the engine this request will actually select — the
    // per-request override when there is one, otherwise the plugin's own
    // engine — instead of the global active engine's provider.
    // `options.apiKey` is the value the template constructed the plugin with
    // (often wired from a deployment env var). Honor it as host-provided
    // read-only configuration after scoped keys.
    // DIAGNOSTIC-ONLY: bracket per-owner API-key resolution (settings/app_secrets reads).
    workerStep("apikey_start");
    const engineOption = requestEngine ?? options.engine;
    const { apiKey: effectiveApiKey, apiKeyEnvVar: effectiveApiKeyEnvVar } =
      await resolveOwnerEngineApiKey({
        engineOption,
        ownerEmail,
        anthropicFallback:
          options.apiKey ?? readDeployCredentialEnv("ANTHROPIC_API_KEY"),
      });
    // DIAGNOSTIC-ONLY: API-key resolution finished.
    workerStep("apikey_done");

    // Resolve engine — per-request engine override takes priority
    // DIAGNOSTIC-ONLY: bracket engine resolution (Builder credential / app-default
    // settings reads inside resolveEngine).
    workerStep("engine_start");
    const credentialIdentity = {
      userEmail: ownerEmail,
      orgId: getRequestOrgId(),
    };
    let engine: AgentEngine;
    try {
      engine = await resolveEngine({
        engineOption,
        apiKey: effectiveApiKey,
        apiKeyEnvVar: effectiveApiKeyEnvVar,
        model: configuredModel,
        appId: options.appId,
        credentialIdentity,
      });
    } catch {
      engine = await resolveEngine({
        apiKey: effectiveApiKey,
        apiKeyEnvVar: effectiveApiKeyEnvVar,
        appId: options.appId,
        credentialIdentity,
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
    const requestModelIsExplicit = isConcreteModelSelection(requestModel);
    const configuredModelIsExplicit = isConcreteModelSelection(configuredModel);
    const storedModel =
      !requestModelIsExplicit && !configuredModelIsExplicit
        ? await getStoredModelForEngine(engine, { appId: options.appId })
        : undefined;
    const modelSelection = resolveAgentModelSelection({
      requestModel,
      configuredModel,
      storedModel,
      defaultModel: engine.defaultModel,
    });
    const modelCandidate = modelSelection.model;
    // DIAGNOSTIC-ONLY: stored-model resolution finished.
    workerStep("model_done");
    const model = normalizeModelForEngine(engine, modelCandidate);
    let effectiveModel = model;
    let modelSelectionSource: AgentModelSelectionSource | "experiment" =
      modelSelection.source;
    let experimentAssignments: Array<{
      experimentId: string;
      variantId: string;
    }> = [];

    // Database-backed experiments remain available to app operators.
    try {
      if (ownerEmail) {
        const { resolveActiveExperimentConfig } =
          await import("../observability/experiments.js");
        const expConfig = await resolveActiveExperimentConfig(ownerEmail);
        if (expConfig) {
          experimentAssignments = [...expConfig.assignments];
          if (typeof expConfig.configs.model === "string") {
            effectiveModel = normalizeModelForEngine(
              engine,
              expConfig.configs.model,
            );
            modelSelectionSource = "experiment";
          }
        }
      }
    } catch {
      // Experiments are best-effort. Model resolution must keep working if the
      // observability tables are unavailable during startup or migration.
    }

    const reasoningEffort = resolveAgentRequestReasoningEffort({
      model: effectiveModel,
      requestEffort,
      configuredEffort: options.reasoningEffort,
    });

    options.onEngineResolved?.(engine, effectiveModel);

    // One-line per-turn resolution log so it's obvious in dev which engine
    // is actually handling the request. `requestEngine` is what the client
    // sent from the model picker; `engine.name` is what resolveEngine picked.
    // Divergence between them is the usual cause of "status says builder but
    // no [builder-engine] log lines appear" confusion.
    // `requestModel` differing from `model` means normalizeModelForEngine
    // substituted the engine default — otherwise indistinguishable from the
    // client never asking for one.
    console.log(
      `[agent-chat] resolved engine=${engine.name} model=${effectiveModel} requestModel=${requestModel ?? "(none)"} requestEngine=${requestEngine ?? "(none)"} modelSource=${modelSelectionSource} turnId=${requestTurnId ?? "(none)"}`,
    );

    if (
      !(await isResolvedEngineUsableForRequest(engine, {
        apiKey: effectiveApiKey,
        credentialIdentity,
      }))
    ) {
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      setResponseHeader(event, "Connection", "keep-alive");
      const encoder = new TextEncoder();
      // A Builder-credits deployment serves this chat to visitors with no
      // account, so the owner-facing "connect a provider" copy is unactionable
      // for them. It is also what they see most of the time once a gateway auth
      // failure arms the 15-minute marker: the credits lane stops resolving,
      // engine selection falls back to the anthropic default, and this branch —
      // not the engine's own error — is what answers the turn.
      const missingCredentialsError = formatLlmCredentialErrorMessage({
        visitorFacing: isBuilderGatewayDeployConfigured(),
      });
      return new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                error: missingCredentialsError,
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
          const viewScreenAction = surfacedRequestActions["view-screen"];
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
            `\n\nThe user has selected the following text and pressed Cmd I to focus the agent. ` +
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
        if (options.skipFilesContext || requestedHostedHarness) {
          return filesContext;
        }
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
      maxRunInputTokens: getDefaultMaxRunInputTokens(),
      defaultMaxRunInputTokens: getDefaultMaxRunInputTokens(),
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
        ? createPlanModeActionRegistry(surfacedRequestActions)
        : surfacedRequestActions;
    const availableRequestTools = getEngineTools(requestActions);
    const initialRequestTools = useDefaultRequestActionSurface
      ? filterInitialEngineTools(
          availableRequestTools,
          options.initialToolNames,
        )
      : availableRequestTools;
    const requestTools =
      requestMode === "plan"
        ? preloadPlanModeEngineTools({
            request: requestMessage,
            registry: requestActions,
            initialTools: initialRequestTools,
            availableTools: availableRequestTools,
          })
        : initialRequestTools;
    // System sections are emitted by the prompt builder once per request. Tool
    // schemas become known just after prompt setup, so append their measured
    // contribution here and reuse the immutable result for every loop pass.
    const contextXraySystemSections = [
      ...readContextXraySystemSections(event),
      ...(requestTools.length > 0
        ? await buildSystemManifestSections([
            {
              label: "Action and MCP tool schemas",
              provenance: "tools",
              governance: "required",
              content: requestTools
                .map((tool) =>
                  JSON.stringify({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  }),
                )
                .join("\n"),
              sourceRef: { scope: "tools" },
            },
          ])
        : []),
    ];
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
    const requestedApprovedToolCalls =
      Array.isArray(body.approvedToolCalls) && body.approvedToolCalls.length > 0
        ? body.approvedToolCalls
            .filter((key: unknown): key is string => typeof key === "string")
            .slice(0, 200)
        : undefined;
    // The durable approval row is the authorization boundary. Do not require
    // the client to reproduce the original structured history exactly: the UI
    // may truncate tool arguments and intentionally assigns fresh replay ids.
    // The loop still consumes only a matching server-created grant for the
    // current owner/org/thread/turn/tool/input tuple.
    const exactApprovedToolCall = findApprovedStructuredToolCall(
      structuredHistory,
      requestedApprovedToolCalls,
    );
    const firstRequestPayloadDetail = buildFirstRequestPayloadDetail({
      isFirstRequest: history.length === 0,
      systemPrompt: requestSystemPrompt,
      messages,
      tools: requestTools,
      availableToolCount: availableRequestTools.length,
    });

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
      if (
        typeof requestTurnId === "string" &&
        requestTurnId &&
        (await isTurnAborted(threadId, requestTurnId))
      ) {
        return { ok: true, stopped: true };
      }
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
    const resolvedApprovalTurnId =
      !isBackgroundWorker &&
      ownerEmail &&
      threadId &&
      requestedApprovedToolCalls?.length
        ? await resolveAgentToolApprovalTurnId({
            ownerEmail,
            orgId: getRequestOrgId() ?? null,
            threadId,
            requestedTurnId: requestTurnId,
            approvalKeys: requestedApprovedToolCalls,
          })
        : null;
    const effectiveTurnId =
      typeof backgroundRunMarker?.turnId === "string" &&
      backgroundRunMarker.turnId.trim()
        ? backgroundRunMarker.turnId.trim()
        : (resolvedApprovalTurnId ??
          (typeof requestTurnId === "string" && requestTurnId.trim()
            ? requestTurnId.trim()
            : runId));
    const approvalStoreBinding = (
      binding: AgentApprovalBinding,
    ): AgentToolApprovalBinding => {
      if (!ownerEmail) {
        throw new Error(
          "Cannot create or consume an approval without an authenticated owner",
        );
      }
      return {
        ownerEmail,
        orgId: getRequestOrgId() ?? null,
        threadId: effectiveThreadId,
        turnId: effectiveTurnId,
        toolName: binding.toolName,
        callId: binding.callId,
        approvalKey: binding.approvalKey,
      };
    };
    const approvalHooks = {
      onApprovalRequired: async (binding: AgentApprovalBinding) => {
        return createAgentToolApproval(approvalStoreBinding(binding));
      },
      consumeApproval: async (binding: AgentApprovalBinding) => {
        if (!ownerEmail) return false;
        return consumeAgentToolApproval(approvalStoreBinding(binding));
      },
    };
    const approvedToolCallsForExecution = requestedApprovedToolCalls;
    if (
      isBackgroundWorker &&
      (await isTurnAborted(effectiveThreadId, effectiveTurnId))
    ) {
      await markRunAborted(runId, "user").catch(() => {});
      return { ok: true, stopped: true };
    }
    const messageToPersist =
      typeof requestDisplayMessage === "string" &&
      requestDisplayMessage.trim().length > 0
        ? requestDisplayMessage
        : requestMessage;
    // Running per-turn input-token total. Seeded from the predecessor chunk's
    // body, advanced by this chunk's own usage, and handed to the successor so
    // the token ceiling bounds the TURN rather than resetting every chunk.
    const priorTurnInputTokensFromBody = Number(
      (body as unknown as Record<string, unknown>)[
        AGENT_CHAT_TURN_INPUT_TOKENS_FIELD
      ],
    );
    let turnInputTokens = Number.isFinite(priorTurnInputTokensFromBody)
      ? Math.max(0, priorTurnInputTokensFromBody)
      : 0;

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
        // Replay what earlier chunks DID, not just what they said: the default
        // text-only rebuild drops every tool call and result, so the next chunk
        // re-runs work already committed and cannot see its output.
        const resumed = threadDataToEngineMessages(priorThreadData, {
          includeToolCalls: true,
        });
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
    // A foreground turn on an existing thread that arrives with NO history is
    // amnesia, not a new conversation — the client trims history against a size
    // budget and one tool-heavy turn could zero it out, which reads downstream
    // as an ordinary first message. Recover what was said from the stored
    // thread. Runs only on the foreground path, before `onRunPrepared` persists
    // this turn, so the recovered window cannot contain the current message.
    if (
      !isBackgroundWorker &&
      !internalContinuation &&
      threadId &&
      historyMessages.length === 0
    ) {
      try {
        const { getThread } = await import("../chat-threads/store.js");
        const { recoverThreadHistoryForRequest } =
          await import("./thread-data-builder.js");
        const recovered = recoverThreadHistoryForRequest(
          (await getThread(threadId))?.threadData,
        );
        if (recovered.length > 0) messages.unshift(...recovered);
      } catch (err) {
        // Never drop the run over this — but never let it pass for "the thread
        // had nothing to recover" either. That silence is the same failure this
        // block exists to fix, one layer down.
        console.warn(
          `[agent-chat] history recovery failed for thread ${threadId}; continuing with no prior context:`,
          err,
        );
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
        ...(typeof queuedMessageId === "string" && queuedMessageId.trim()
          ? { queuedMessageId: queuedMessageId.trim() }
          : {}),
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

      // Stop may land after the pre-claim check but before the durable row was
      // inserted. Terminalize that row before it can be handed to a worker.
      if (
        backgroundRowInserted &&
        (await isTurnAborted(effectiveThreadId, effectiveTurnId))
      ) {
        await markRunAborted(runId, "user");
        return { ok: true, stopped: true };
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
          // A Netlify background function 202s on enqueue in well under a
          // second, so a 404/401/508 from it is an IMMEDIATE, knowable failure.
          // Fire-and-forget recorded those as `dispatched = true` and the user
          // waited out the claim grace for a worker that never existed. Only
          // for a real background-function target: a regular-function target
          // replies only after the successor chunk finishes, so awaiting it
          // would time out on every healthy dispatch.
          ...(expectsNetlifyBackgroundFunction
            ? { awaitResponse: true, responseTimeoutMs: 5_000 }
            : {}),
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
    // Foreground self-chain: opt-in only — requires the app/deploy to
    // explicitly set AGENT_CHAT_FOREGROUND_SELF_CHAIN truthy (unset/false
    // means disabled), on top of the hosted runtime + A2A_SECRET gates, AND
    // this specific run never having been routed to the durable background
    // worker. A run that WAS dispatched to background
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
    const noProgressRepeatForRun = (run: ActiveRun) =>
      resolveBackgroundNoProgressRepeat({
        run,
        priorErrorCode: priorNoProgressErrorCode,
        priorCount: priorNoProgressCount,
      });
    const willChainBackgroundContinuation = (run: ActiveRun) =>
      shouldChainBackgroundContinuation({
        isBackgroundWorker,
        run,
        continuationCount: backgroundContinuationCount,
        foregroundSelfChainEligible,
        dispatchedToBackground: dispatchToBackground,
        priorNoProgressErrorCode,
        priorNoProgressCount,
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

    const baseHandleRunComplete =
      options.onRunComplete || trackedProgressRunId
        ? async (run: ActiveRun) => {
            try {
              await runCompletionCallbackWithDatabaseRetry(() =>
                options.onRunComplete?.(run, threadId),
              );
            } catch (err) {
              await completeTrackedProgressRun(run, err);
              throw err;
            }
            await completeTrackedProgressRun(run);
          }
        : undefined;

    // Install the completion callback for background continuation even when
    // there is no app onRunComplete / tracked-progress callback configured.
    // The foreground self-chain path uses the same continuation dispatch.
    const handleRunComplete =
      isBackgroundWorker || foregroundSelfChainEligible || baseHandleRunComplete
        ? async (run: ActiveRun) => {
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
            const noProgressRepeat = noProgressRepeatForRun(run);
            if (noProgressRepeat.tripped) {
              // Install the replacement before the thread writer runs. The
              // writer builds durable thread_data from events, so changing
              // only continuationTerminalEvent afterwards leaves the original
              // recoverable error persisted and eligible for another retry.
              installBackgroundNoProgressTerminalEvent(run, noProgressRepeat);
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
            if (noProgressRepeat.tripped) {
              if (run.continuationTerminalEvent?.type === "error") {
                console.error(
                  `[agent-chat] stopping background chain: ${noProgressRepeat.errorCode} ` +
                    `failed ${noProgressRepeat.count}x with no progress`,
                  run.runId,
                );
                await recordRunDiagnostic(
                  run.runId,
                  RUN_DIAG_STAGE.workerThrew,
                  `chain_stopped_no_progress code=${noProgressRepeat.errorCode} count=${noProgressRepeat.count}`,
                ).catch(() => {});
              }
            } else if (willChainBackgroundContinuation(run)) {
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
                noProgressRepeat,
                turnInputTokens,
                // Re-evaluate the durable gate rather than keying off
                // isBackgroundWorker: a successor chunk of a FOREGROUND
                // self-chain re-enters as a worker too, and must keep
                // chaining via the regular function — the Netlify
                // `-background` function is only emitted into the deploy
                // output when the durable flag is on.
                //
                // `&& !runsInBackgroundFunction`: a worker PROVEN to already
                // be executing inside the real `-background` function must
                // never dispatch back to that same function's own URL — a
                // background function invoking itself by URL from inside a
                // live invocation is a documented Netlify platform
                // limitation (404), unlike the initial foreground→background
                // dispatch or a worker that landed on the regular function
                // (a genuinely different function calling the background
                // one, which works). This only changes the dispatch TARGET
                // for that one proven-in-bg-function case — by this point
                // (with the in-process resumable-error resume above) it is
                // reached only when the chunk genuinely exhausted its
                // budget, so falling back to the regular `_process-run`
                // function (40s clamp) here is the correct, safe target.
                chainViaDurableBackground:
                  isAgentChatDurableBackgroundEnabled({
                    appOptIn: options.durableBackgroundRuns,
                  }) && !runsInBackgroundFunction,
                // Only changes the retry BUDGET, never the dispatch target
                // above: a worker proven in a real background function has
                // minutes of remaining wall clock and no connected-client
                // fallback, so it must not be demoted to the foreground's
                // 2-attempt budget just because it was forced onto the
                // regular-function dispatch target. See
                // `resolveContinuationDispatchBudget`.
                workerProvenInBackgroundFunction: runsInBackgroundFunction,
              });
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
      (backgroundRuntimeDetail ? ` ${backgroundRuntimeDetail}` : "") +
      firstRequestPayloadDetail;

    // Synchronous self-chain budgeting: this is a `_process-run` re-entry
    // that landed on the regular ~60s function (not a proven `-background`
    // function), AND it got here WITHOUT the durable-background path being
    // active for this app — the only other way to reach `isBackgroundWorker`
    // is `AGENT_CHAT_FOREGROUND_SELF_CHAIN` chaining onto the framework route
    // (see `chainServerDrivenContinuation`'s `chainViaDurableBackground`
    // choice). That chunk must budget its soft-timeout against the wall-clock
    // THIS invocation already spent on setup above, not a fresh ceiling — see
    // `resolveSelfChainContinuationBudget`. Deliberately excludes a durable
    // worker that merely landed on the wrong runtime (handled unchanged by
    // the existing `runsInBackgroundFunction` clamp below).
    const isSynchronousSelfChainContinuation =
      isBackgroundWorker &&
      !runsInBackgroundFunction &&
      !isAgentChatDurableBackgroundEnabled({
        appOptIn: options.durableBackgroundRuns,
      });
    const selfChainBudget = isSynchronousSelfChainContinuation
      ? resolveSelfChainContinuationBudget(
          Date.now() - setupT0,
          resolveRunSoftTimeoutMs(options.runSoftTimeoutMs, {
            useHostedDefault: true,
            backgroundFunction: false,
          }),
        )
      : null;

    const startedRun = startRun(
      runId,
      effectiveThreadId,
      async (rawSend, signal) => {
        const send = (event: AgentChatEvent) => {
          rawSend(event);
          updateTrackedProgressFromEvent(event);
        };

        if (selfChainBudget?.skipToBoundary) {
          // Not enough wall-clock left in this synchronous function
          // invocation to safely start real agent-loop work — doing so
          // anyway risks Netlify's ~60s hard kill cutting it off mid-stream
          // (the exact incident `resolveSelfChainContinuationBudget` hardens
          // against). Skip straight to the same `run_timeout` boundary a
          // normal soft-timeout produces so the existing continuation
          // machinery (`chainServerDrivenContinuation` below, plus the
          // client's `auto_continue` re-POST fallback) hands the turn off to
          // a fresh invocation instead.
          await recordRunDiagnostic(
            runId,
            RUN_DIAG_STAGE.workerSetupStep,
            `self_chain_budget_exhausted elapsed=${Date.now() - setupT0}ms`,
          ).catch(() => {});
          send({ type: "auto_continue", reason: "run_timeout" });
          return;
        }

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
          await options.onRunStart(send, threadId ?? runId, runId);
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
                  `${profile.instructions}` +
                  (profile.workspace?.resources.length
                    ? `\n\nAgent pack resources (read these with the resources tools when relevant):\n${profile.workspace.resources.map((resource) => `- ${resource.path}${resource.name ? ` (${resource.name})` : ""}`).join("\n")}`
                    : "") +
                  `\n</custom-agent-profile>`;

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
                    runId,
                    threadId: effectiveThreadId,
                    taskId: effectiveTurnId,
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
                    visitorFacing: isBuilderGatewayDeployConfigured(),
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
          const [{ callAgent }, { resolveA2ACallerAuth }] = await Promise.all([
            import("../a2a/client.js"),
            import("../a2a/caller-auth.js"),
          ]);
          const results = await Promise.allSettled(
            agentRefs.map(async (ref) => {
              try {
                const responseText = await callConnectedAgentReference({
                  agent: ref.name,
                  path: ref.path,
                  message: enrichedMessage + screenContext,
                  send,
                  callAgent,
                  resolveCallerAuth: resolveA2ACallerAuth,
                });
                return `<agent-response name="${ref.name}" id="${ref.refId}">\n${responseText}\n</agent-response>`;
              } catch (err: any) {
                const message =
                  userFacingLlmCredentialError(err, {
                    agentName: ref.name,
                    visitorFacing: isBuilderGatewayDeployConfigured(),
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

        // TODO(processor-seam): thread `processors` from ProductionAgentOptions
        // through to runAgentLoop here once the handler exposes a way to
        // configure them (e.g. a `processors` field on ProductionAgentOptions
        // or a per-request resolver). The loop-level seam (runAgentLoop's
        // `processors` opt + ProcessorChain/TripWire) is the deliverable and is
        // already callable directly by sub-agents, A2A, MCP, and tests; this is
        // only the HTTP-handler convenience plumbing.
        const userVisibleSentimentInput =
          typeof displayMessage === "string" && displayMessage.trim().length > 0
            ? displayMessage
            : typeof message === "string" && message.trim().length > 0
              ? message
              : undefined;
        const turnUsage: AgentLoopUsage = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: effectiveModel,
        };
        const agentLoopOpts = {
          engine,
          model: effectiveModel,
          runId,
          systemPrompt: requestSystemPrompt,
          tools: requestTools,
          availableTools: availableRequestTools,
          messages,
          systemSections: contextXraySystemSections,
          actions: requestActions,
          send,
          signal,
          onUsage: (usage: AgentLoopUsage) => {
            turnUsage.inputTokens += usage.inputTokens;
            turnUsage.outputTokens += usage.outputTokens;
            turnUsage.cacheReadTokens += usage.cacheReadTokens;
            turnUsage.cacheWriteTokens += usage.cacheWriteTokens;
            turnUsage.model = usage.model;
          },
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
          maxRunInputTokens: loopSettings.maxRunInputTokens,
          priorTurnInputTokens: turnInputTokens,
          finalResponseGuard: options.finalResponseGuard,
          finalResponseGuardRequestText: messageToPersist,
          ...(options.toolLimits ? { toolLimits: options.toolLimits } : {}),
          ...(threadId
            ? { threadId: effectiveThreadId, turnId: effectiveTurnId }
            : {}),
          // Human-in-the-loop approval grants for this turn. The request is
          // untrusted; the durable approval consumer below validates every key
          // against the authenticated owner/org/thread/turn and consumes it
          // atomically for the exact tool/input tuple.
          ...(approvedToolCallsForExecution
            ? { approvedToolCalls: approvedToolCallsForExecution }
            : {}),
          onApprovalRequired: approvalHooks.onApprovalRequired,
          consumeApproval: approvalHooks.consumeApproval,
          // A worker PROVEN to be running inside the real 15-min Netlify
          // `-background` function (`runsInBackgroundFunction`) has minutes of
          // budget left on THIS invocation. Let it catch a recoverable
          // transport/gateway error (isResumableEngineError) and resume the
          // agent loop in-process instead of unwinding out to `startRun`'s
          // outer catch, which would otherwise hand off to
          // `chainServerDrivenContinuation` — and for a worker already inside
          // the background function, that hand-off is a same-function
          // self-dispatch that 404s on Netlify (a background function cannot
          // invoke its own public URL from inside a live invocation). A
          // foreground turn or a worker that landed on the regular ~60s
          // function (runsInBackgroundFunction false) must NOT set this — it
          // keeps depending on the existing cross-invocation recovery
          // (foreground self-chain / client auto_continue re-POST), unchanged.
          ...(runsInBackgroundFunction
            ? {
                resumeResumableErrorsInProcess: true,
                maxContinuations: MAX_BACKGROUND_RUN_CONTINUATIONS,
              }
            : {}),
        };

        send({ type: "activity", label: "Contacting model" });

        let instrumented = false;
        try {
          if (
            exactApprovedToolCall &&
            approvedToolCallsForExecution &&
            requestActions[exactApprovedToolCall.name]
          ) {
            send({
              type: "activity",
              label: `Running approved ${exactApprovedToolCall.name} action`,
              tool: exactApprovedToolCall.name,
            });
            await executeAgentToolCall({
              actions: requestActions,
              name: exactApprovedToolCall.name,
              input: exactApprovedToolCall.input,
              callId: exactApprovedToolCall.callId,
              signal: agentLoopOpts.signal,
              ownerEmail,
              orgId: getRequestOrgId() ?? null,
              threadId: effectiveThreadId,
              turnId: effectiveTurnId,
              approvedToolCalls: approvedToolCallsForExecution,
              onApprovalRequired: approvalHooks.onApprovalRequired,
              consumeApproval: approvalHooks.consumeApproval,
              send,
            });
            return;
          }
          try {
            const { getObservabilityConfig, instrumentAgentLoop } =
              await import("../observability/traces.js");
            const obsConfig = await getObservabilityConfig();
            if (obsConfig.enabled) {
              instrumented = true;
              await instrumentAgentLoop({
                runAgentLoop: runAgentLoopWithMainChatInternalContinuations,
                loopOpts: agentLoopOpts,
                runId,
                threadId: threadId ?? null,
                userId: ownerEmail,
                config: obsConfig,
                metadata: {
                  modelSelectionSource,
                  ...(experimentAssignments.length > 0
                    ? { experimentAssignments }
                    : {}),
                },
                experimentAssignments,
                modelSelectionSource,
                sentimentInput: shouldInferSentimentForTurn({
                  internalContinuation: Boolean(internalContinuation),
                  isBackgroundWorker,
                  backgroundContinuationCount,
                  hasUserText: Boolean(userVisibleSentimentInput),
                })
                  ? userVisibleSentimentInput
                  : undefined,
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
            // If the agent loop itself failed, re-throw after the outer finally
            // records any usage events that arrived before the failure.
            if (instrumented) throw err;
          }
          if (!instrumented) {
            await runAgentLoopWithMainChatInternalContinuations(agentLoopOpts);
          }
        } finally {
          // Advance and persist usage even when the provider aborts the loop
          // before its promise resolves; the per-event accumulator is the only
          // durable view of those partial model calls.
          turnInputTokens += turnUsage.inputTokens;
          try {
            const resolvedOwnerEmail = options.resolveOwnerEmail
              ? await options.resolveOwnerEmail(event)
              : getRequestUserEmail();
            if (
              resolvedOwnerEmail &&
              (turnUsage.inputTokens > 0 ||
                turnUsage.outputTokens > 0 ||
                turnUsage.cacheReadTokens > 0 ||
                turnUsage.cacheWriteTokens > 0)
            ) {
              const { recordUsage } = await import("../usage/store.js");
              await recordUsage({
                ownerEmail: resolvedOwnerEmail,
                inputTokens: turnUsage.inputTokens,
                outputTokens: turnUsage.outputTokens,
                cacheReadTokens: turnUsage.cacheReadTokens,
                cacheWriteTokens: turnUsage.cacheWriteTokens,
                model: turnUsage.model,
                label: body.usageLabel || "chat",
                // token_usage has had run_id/thread_id/task_id since it was
                // created and every row was NULL on all three, so no spend could
                // be tied back to a run, thread, or outcome.
                runId,
                threadId: effectiveThreadId,
                taskId: effectiveTurnId,
              });
            }
          } catch {
            // Usage recording failed — don't break the run
          }
        }
      },
      handleRunComplete,
      {
        // A synchronous self-chain chunk with enough remaining budget gets
        // that REDUCED budget (ceiling minus setup already spent) instead of
        // a fresh `options.runSoftTimeoutMs`/hosted-default window — see
        // `resolveSelfChainContinuationBudget`. Every other caller
        // (durable-background worker, plain foreground POST) is unaffected:
        // `selfChainBudget` is `null` for them and this falls through to the
        // exact prior value.
        softTimeoutMs:
          selfChainBudget && !selfChainBudget.skipToBoundary
            ? selfChainBudget.softTimeoutMs
            : options.runSoftTimeoutMs,
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
        waitUntil: getRequestRunContext()?.waitUntil,
        dispatchMode: foregroundSelfChainEligible
          ? "foreground-self-chain"
          : "foreground",
        // Resolved AFTER stored-model/experiment overrides — the same value
        // actually sent to the engine, not the raw client-requested model.
        // No userId here: `ownerEmail` is the only identity known at this
        // scope and is PII (email), which the terminal event must not carry.
        model: effectiveModel,
        engineName: engine.name,
        attemptCount: backgroundContinuationCount,
      },
    );

    // Background worker: await the run to completion so Netlify keeps the
    // background function alive for the whole turn (the client is streaming the
    // same events via the foreground POST's cross-isolate SQL subscription).
    if (isBackgroundWorker) {
      await startedRun.finalized;
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
  abortRunDurably,
  abortTurnDurably,
  subscribeToRun,
};
