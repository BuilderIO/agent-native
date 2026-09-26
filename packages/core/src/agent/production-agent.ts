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

import "../authorization/check-action.js";
import { parseA2AAgentActivityPart } from "../a2a/activity.js";
import type { A2AConnectionRequestMetadata, Task } from "../a2a/types.js";
import {
  AgentConnectionRequiredError,
  describeToolParameterSignature,
  isActionContractError,
  isActionHiddenFromEveryAgentSurface,
  isAgentActionStopError,
  isAgentConnectionRequiredError,
  type ActionAutomationContext,
  type ActionCaller,
  stripUnsupportedSchemaKeywords,
} from "../action.js";
import { getAppConfig } from "../app-config/index.js";
import {
  MAX_BACKGROUND_RUN_CONTINUATIONS,
  MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS,
  MAX_TURN_WALL_CLOCK_MS,
} from "../app-config/run-lifecycle-invariants.js";
import { readAppState } from "../application-state/script-helpers.js";
import {
  detectArtifactReceipts,
  type ArtifactReceipt,
} from "../artifacts/detect.js";
import { isReadOnlyShellCommand } from "../coding-tools/index.js";
import type { AgentNativeHarnessSetting } from "../config.js";
import {
  CredentialEndpointMismatchError,
  type CredentialProvenance,
} from "../credentials/index.js";
import { getDbExec, isTransientDatabaseError } from "../db/client.js";
import { extensionIdFromPathname } from "../extensions/path.js";
import {
  describeAttachmentBytesVerdict,
  reconcileImageBytes,
  reconcilePdfBytes,
} from "../file-upload/attachment-bytes.js";
import {
  formatBase64CharBudget,
  MAX_INLINE_FILE_BASE64_CHARS,
  MAX_INLINE_IMAGE_BASE64_CHARS,
} from "../file-upload/inline-attachment-limits.js";
import { preUploadAttachments } from "../file-upload/pre-upload-attachments.js";
import { isMcpActionResult } from "../mcp-client/app-result.js";
import { extractMcpToolResultImages } from "../mcp-client/index.js";
import { isMcpToolAllowedForRequest } from "../mcp-client/visibility.js";
import { isObjectOnly } from "../mcp/tool-input-schema.js";
import { shouldInferSentimentForTurn } from "../observability/sentiment.js";
import {
  completeRun as completeProgressRun,
  startRun as startProgressRun,
  updateRunProgress,
} from "../progress/registry.js";
import {
  readOptionalKeyCache,
  writeOptionalKeyCache,
} from "../secrets/optional-key-cache.js";
import {
  COMPACT_PROMPT_RESOURCES_TOTAL_MAX_CHARS,
  preloadJevContextForPrompt,
  type JevPromptContextCandidate,
} from "../server/agent-chat/prompt-resources.js";
import {
  isRuntimeVisibleScope,
  parseSkillFrontmatter,
} from "../server/agent-chat/skill-frontmatter.js";
import {
  canUseDeployCredentialFallbackForRequest,
  getProviderCredentialAuthFailure,
  isBuilderGatewayDeployConfigured,
  readDeployCredentialEnv,
  resolveBuilderGatewayAuth,
  type BuilderGatewayAuth,
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
import { stripDiagnosticSnippets } from "../shared/diagnostic-snippet.js";
import {
  isReasoningEffort,
  normalizeReasoningEffortForRequest,
  stepDownReasoningEffort,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import {
  SYNTHETIC_TRAFFIC_BETA_E2E,
  SYNTHETIC_TRAFFIC_HEADER,
} from "../shared/test-traffic.js";
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
  PROVIDER_RATE_LIMITED_ERROR_CODE,
  PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
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
  buildRecentUserRequestContext,
  buildJevRequestContext,
  preloadJevTools,
} from "./jev-tool-prefetch.js";
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
  getContextWindowForModel,
  resolveFallbackModel,
} from "./model-config.js";
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
  replayCompletedTurn,
  getActiveRunForThread,
  getActiveRunForThreadAsync,
  getRun,
  abortRun,
  abortRunDurably,
  abortTurnByRefDurably,
  abortTurnDurably,
  tryClaimRunSlot,
  isHostedRuntime,
  resolveRunSoftTimeoutMs,
  resolveRunToolTimeoutCeilingMs,
  endsAfterToolResultWithoutAssistantFinal,
  endsDuringActionPreparation,
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
  turnRunLedgerExhausted,
} from "./run-store.js";
import { buildCurrentTimeUserContext } from "./runtime-context.js";
import {
  consumeAgentToolApproval,
  createAgentToolApproval,
  isAgentToolAlwaysAllowed,
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
import {
  normalizeAgentActionScope,
  type AgentActionScope,
  ActionTool,
  AgentNativeJsonSchema,
  AgentChatAttachment,
  AgentChatRequest,
  AgentChatEvent,
  AgentFileMutationProof,
  AgentChatReference,
  AgentChatStructuredMessage,
  RunEvent,
} from "./types.js";

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
export const BACKGROUND_PRECLAIM_HEARTBEAT_MS = 1_500;
export const BACKGROUND_PRECLAIM_HEARTBEAT_MAX_MS = 15_000;

export type BackgroundDispatchOutcome =
  | { action: "stream" }
  | { action: "subscribe" }
  | {
      action: "inline";
      reason: "dispatch-failed" | "worker-never-claimed" | "no-row";
    };

function parseRunDiagnostic(raw: string | null | undefined): {
  stage: string | null;
  at: number | null;
} {
  if (!raw) return { stage: null, at: null };
  try {
    const parsed = JSON.parse(raw) as { stage?: unknown; at?: unknown };
    return {
      stage: typeof parsed.stage === "string" ? parsed.stage : null,
      at:
        typeof parsed.at === "number" && Number.isFinite(parsed.at)
          ? parsed.at
          : null,
    };
  } catch {
    // Not JSON — treat the raw value as the stage name.
  }
  return { stage: raw, at: null };
}

export async function resolveBackgroundDispatchOutcome(opts: {
  dispatched: boolean;
  backgroundRowInserted: boolean;
  runId: string;
  graceMs: number;
  reaperGraceMs?: number;
  reaperSafetyMarginMs?: number;
  streamWhenWorkerAlive?: boolean;
  pollIntervalMs: number;
  readClaim: (runId: string) => Promise<{
    dispatchMode: string | null;
    status: string | null;
    diagStage?: string | null;
    lastLivenessAt?: number | null;
  } | null>;
  claim: (runId: string) => Promise<boolean>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<BackgroundDispatchOutcome> {
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const ALIVE_IN_SETUP: ReadonlySet<string> = new Set([
    RUN_DIAG_STAGE.authPassed,
    RUN_DIAG_STAGE.workerEntered,
  ]);
  const DIED_BEFORE_CLAIM: ReadonlySet<string> = new Set([
    RUN_DIAG_STAGE.authFailed,
    RUN_DIAG_STAGE.routeThrew,
    RUN_DIAG_STAGE.workerThrew,
  ]);

  if (opts.dispatched) {
    const startedAt = now();
    const baseDeadline = startedAt + opts.graceMs;
    const reaperGraceMs = opts.reaperGraceMs;
    const reaperMargin =
      opts.reaperSafetyMarginMs ?? BACKGROUND_REAPER_SAFETY_MARGIN_MS;
    let preclaimDeadlineAt: number | null = null;
    for (;;) {
      const claim = await opts.readClaim(opts.runId).catch(() => null);
      if (
        claim &&
        ((claim.dispatchMode && claim.dispatchMode !== "background") ||
          (claim.status && claim.status !== "running"))
      ) {
        return { action: "stream" };
      }
      const diagnostic = parseRunDiagnostic(claim?.diagStage);
      const stage = diagnostic.stage;
      if (
        preclaimDeadlineAt == null &&
        diagnostic.at != null &&
        ALIVE_IN_SETUP.has(stage ?? "")
      ) {
        const diagnosticDeadline =
          diagnostic.at + BACKGROUND_PRECLAIM_HEARTBEAT_MAX_MS;
        preclaimDeadlineAt = diagnosticDeadline;
      }
      if (stage && DIED_BEFORE_CLAIM.has(stage)) break;
      const elapsedNow = now();
      if (preclaimDeadlineAt != null && elapsedNow >= preclaimDeadlineAt) {
        break;
      }
      const reaperWillFireSoon =
        reaperGraceMs != null &&
        claim?.lastLivenessAt != null &&
        elapsedNow - claim.lastLivenessAt >= reaperGraceMs - reaperMargin;
      if (reaperWillFireSoon) break;
      const aliveInSetup =
        reaperGraceMs != null &&
        claim?.status === "running" &&
        !!stage &&
        ALIVE_IN_SETUP.has(stage);
      if (aliveInSetup && opts.streamWhenWorkerAlive) {
        return { action: "stream" };
      }
      if (elapsedNow >= baseDeadline && !aliveInSetup) break;
      await sleep(opts.pollIntervalMs);
    }
  }

  if (!opts.backgroundRowInserted) {
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
  return { action: "subscribe" };
}

const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

function normalizeBrowserTabId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return SAFE_BROWSER_TAB_ID_RE.test(trimmed) ? trimmed : undefined;
}

function normalizeUsageLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
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
  if (!browserTabId) return (await readAppState(key)) as T | null;
  const tabKey = appStateKeyForBrowserTab(key, browserTabId);
  return (await readAppState(tabKey)) as T | null;
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
async function getOwnerApiKeyDetailed(
  provider: string,
  ownerEmail: string | null | undefined,
  options?: { onLookupFailure?: () => void },
): Promise<
  { apiKey: string; credentialProvenance: CredentialProvenance } | undefined
> {
  if (!ownerEmail) return undefined;
  let lookupFailed = false;
  const reportLookupFailure = (): void => {
    if (!lookupFailed) return;
    options?.onLookupFailure?.();
    lookupFailed = false;
  };
  const secretKey =
    PROVIDER_TO_ENV[provider] ?? `${provider.toUpperCase()}_API_KEY`;
  const syntheticTraffic = getRequestContext()?.isSyntheticTraffic === true;
  try {
    const { readAppSecret } = await import("../secrets/storage.js");
    const refs: Array<{
      scope: "user" | "org" | "workspace";
      scopeId: string;
    }> = [{ scope: "user", scopeId: ownerEmail }];
    const orgId = getRequestOrgId();
    if (orgId && !syntheticTraffic) {
      refs.push(
        { scope: "org", scopeId: orgId },
        { scope: "workspace", scopeId: orgId },
      );
    } else if (!syntheticTraffic) {
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
        return {
          apiKey: fromSecrets.value,
          credentialProvenance: ref,
        };
      }
    }
  } catch {
    lookupFailed = true;
    if (syntheticTraffic) {
      reportLookupFailure();
      return undefined;
    }
  }
  if (syntheticTraffic) {
    reportLookupFailure();
    return undefined;
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
      return {
        apiKey: key,
        credentialProvenance: { scope: "user", scopeId: ownerEmail },
      };
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
        return {
          apiKey: legacyKey,
          credentialProvenance: { scope: "user", scopeId: ownerEmail },
        };
      }
      reportLookupFailure();
      return undefined;
    }
    reportLookupFailure();
    return undefined;
  } catch {
    lookupFailed = true;
    reportLookupFailure();
    return undefined;
  }
}

export async function getOwnerApiKey(
  provider: string,
  ownerEmail: string | null | undefined,
  options?: { onLookupFailure?: () => void },
): Promise<string | undefined> {
  return (await getOwnerApiKeyDetailed(provider, ownerEmail, options))?.apiKey;
}

export async function getOwnerJevApiKey(
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  return (await getOwnerJevApiKeyCredential(ownerEmail)).credential?.apiKey;
}

async function getOwnerJevApiKeyCredential(
  ownerEmail: string | null | undefined,
): Promise<{
  credential: { apiKey: string; source: "user" | "deployment" } | null;
  lookupFailed: boolean;
}> {
  if (!ownerEmail) return { credential: null, lookupFailed: false };
  const cacheKey = [
    "jev-source-v1",
    ownerEmail,
    getRequestOrgId() ?? `solo:${ownerEmail}`,
    getRequestContext()?.isSyntheticTraffic === true ? "synthetic" : "normal",
  ].join("\u0000");
  const cached = readOptionalKeyCache(cacheKey);
  if (cached.hit) {
    if (!cached.value) return { credential: null, lookupFailed: false };
    const separator = cached.value.indexOf(":");
    const source = cached.value.slice(0, separator);
    const apiKey = cached.value.slice(separator + 1);
    return {
      credential:
        (source === "user" || source === "deployment") && apiKey
          ? { apiKey, source }
          : null,
      lookupFailed: false,
    };
  }
  let lookupFailed = false;
  const value = await getOwnerApiKey("jev", ownerEmail, {
    onLookupFailure: () => {
      lookupFailed = true;
    },
  });
  if (value) {
    if (!lookupFailed) writeOptionalKeyCache(cacheKey, `user:${value}`);
    return {
      credential: { apiKey: value, source: "user" },
      lookupFailed,
    };
  }
  if (lookupFailed) return { credential: null, lookupFailed: true };

  const deployKey = canUseDeployCredentialFallbackForRequest("JEV_API_KEY")
    ? readDeployCredentialEnv("JEV_API_KEY")?.trim()
    : undefined;
  if (
    deployKey &&
    !(await getProviderCredentialAuthFailure({
      key: "JEV_API_KEY",
      value: deployKey,
    }))
  ) {
    if (!lookupFailed) {
      writeOptionalKeyCache(cacheKey, `deployment:${deployKey}`);
    }
    return {
      credential: { apiKey: deployKey, source: "deployment" },
      lookupFailed: false,
    };
  }

  if (!lookupFailed) writeOptionalKeyCache(cacheKey, undefined);
  return { credential: null, lookupFailed: false };
}

export interface JevContextCredentials {
  apiKey: string | undefined;
  personalApiKey: string | undefined;
  builderAuth: BuilderGatewayAuth | null;
  apiKeyLookupFailed?: boolean;
  builderAuthLookupFailed?: boolean;
}

export async function getJevContextCredentials(
  ownerEmail: string | null | undefined,
): Promise<JevContextCredentials> {
  const requestContext = getRequestContext();
  const [lookup, builderAuthLookup] = await Promise.all([
    getOwnerJevApiKeyCredential(ownerEmail),
    resolveBuilderGatewayAuth({
      userEmail: ownerEmail,
      orgId: requestContext?.orgScope === "personal" ? null : getRequestOrgId(),
    }).then(
      (builderAuth) => ({ builderAuth, lookupFailed: false }),
      () => ({ builderAuth: null, lookupFailed: true }),
    ),
  ]);
  const credential = lookup.credential;
  return {
    apiKey: credential?.apiKey,
    personalApiKey:
      credential?.source === "user" ? credential.apiKey : undefined,
    builderAuth: builderAuthLookup.builderAuth,
    ...(lookup.lookupFailed ? { apiKeyLookupFailed: true } : {}),
    ...(builderAuthLookup.lookupFailed
      ? { builderAuthLookupFailed: true }
      : {}),
  };
}

export function engineToProvider(engineName: string): string {
  return engineName.startsWith("ai-sdk:") ? engineName.slice(7) : engineName;
}

export interface ResolvedOwnerApiKey {
  apiKey: string | undefined;
  apiKeyEnvVar: string | undefined;
  credentialProvenance?: CredentialProvenance;
}

const NO_OWNER_API_KEY: ResolvedOwnerApiKey = {
  apiKey: undefined,
  apiKeyEnvVar: undefined,
};

export async function getOwnerApiKeyForEngine(
  engineName: string,
  ownerEmail: string | null | undefined,
): Promise<ResolvedOwnerApiKey> {
  try {
    const provider = engineToProvider(engineName);
    const envVar = PROVIDER_TO_ENV[provider];
    const ownerKey = await getOwnerApiKeyDetailed(provider, ownerEmail);
    if (ownerKey) {
      return {
        apiKey: ownerKey.apiKey,
        apiKeyEnvVar: envVar,
        credentialProvenance: ownerKey.credentialProvenance,
      };
    }
    if (!envVar || !canUseDeployCredentialFallbackForRequest(envVar)) {
      return NO_OWNER_API_KEY;
    }
    const envKey = readDeployCredentialEnv(envVar);
    if (
      envKey &&
      !(await getProviderCredentialAuthFailure({ key: envVar, value: envKey }))
    ) {
      return {
        apiKey: envKey,
        apiKeyEnvVar: envVar,
        credentialProvenance: { scope: "deployment" },
      };
    }
    return NO_OWNER_API_KEY;
  } catch {
    return NO_OWNER_API_KEY;
  }
}

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
  if (
    input.engineOption &&
    typeof input.engineOption === "object" &&
    "stream" in input.engineOption
  ) {
    return NO_OWNER_API_KEY;
  }

  const engineName = explicitEngineName(input.engineOption);
  let activeEngineSetting:
    | { status: "available"; engine: string }
    | { status: "unavailable"; error: unknown }
    | undefined;
  if (engineName) {
    const resolved = await getOwnerApiKeyForEngine(
      engineName,
      input.ownerEmail,
    );
    if (resolved.apiKey) return resolved;
  } else {
    try {
      const { getSetting } = await import("../settings/store.js");
      const engineSetting = await getSetting("agent-engine");
      activeEngineSetting = {
        status: "available",
        engine: (engineSetting?.engine as string | undefined) ?? "anthropic",
      };
    } catch (error) {
      activeEngineSetting = { status: "unavailable", error };
    }
    if (activeEngineSetting.status === "available") {
      const activeKey = await getOwnerApiKeyForEngine(
        activeEngineSetting.engine,
        input.ownerEmail,
      );
      if (activeKey.apiKey) return { ...activeKey, apiKeyEnvVar: undefined };
    }
  }
  const fallback = input.anthropicFallback?.trim();
  const canUseFallback =
    fallback && canUseDeployCredentialFallbackForRequest("ANTHROPIC_API_KEY");
  if (activeEngineSetting?.status === "unavailable" && !canUseFallback) {
    throw activeEngineSetting.error;
  }
  return fallback && canUseFallback
    ? {
        apiKey: fallback,
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
        credentialProvenance: { scope: "deployment" },
      }
    : NO_OWNER_API_KEY;
}

/** @deprecated Use getOwnerApiKey("anthropic", ownerEmail) instead */
export async function getOwnerAnthropicApiKey(
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  return getOwnerApiKey("anthropic", ownerEmail);
}

export type { ActionRunContext, ActionCaller } from "../action.js";

export interface ActionEntry {
  tool: ActionTool;
  run: (args: any, context?: import("../action.js").ActionRunContext) => any;
  access?: import("../authorization/check-action.js").ActionAccessConfig;
  fileMutationProof?: (args: unknown) => AgentFileMutationProof | undefined;
  schema?: unknown;
  http?: import("../action.js").ActionHttpConfig | false;
  requiresAuth?: boolean;
  maxBodyBytes?: number;
  uiOnly?: boolean;
  agentTool?: boolean;
  mcpTool?: boolean;
  deferLoading?: boolean;
  publicAgent?: import("../action.js").PublicAgentActionConfig;
  readOnly?: boolean;
  grounding?: boolean;
  allowInPlanMode?: boolean;
  planMode?: import("../action.js").ActionPlanModeConfig<any>;
  parallelSafe?: boolean;
  dedupe?: boolean;
  /** Whether this action may be invoked from the tools-iframe bridge.
   *  **Default-allow opt-out**: only an explicit `false` returns 403.
   *  - `true` / `undefined` — allow.
   *  - `false` — explicit deny; the tools bridge returns 403.
   *  See `defineAction` (`packages/core/src/action.ts`) and audit H5 in
   *  `security-audit/05-tools-sandbox.md`. */
  toolCallable?: boolean;
  capabilityScopes?: readonly string[];
  cliWrapper?: boolean;
  link?: import("../action.js").ActionLinkBuilder;
  mcpApp?: import("../action.js").ActionMcpAppConfig;
  chatUI?: import("../action-ui.js").ActionChatUIConfig;
  timeoutMs?: number;
  maxResultChars?: number;
  needsApproval?:
    | boolean
    | ((
        args: any,
        ctx?: import("../action.js").ActionRunContext,
      ) => boolean | Promise<boolean>);
  allowPersistentApproval?: boolean;
  endsTurn?: boolean;
  frameworkGroup?: import("../framework-tools.js").FrameworkToolGroup;
}

/** @deprecated Use `ActionEntry` instead */
export type ScriptEntry = ActionEntry;

export type AgentExecutionMode = "act" | "plan";

export interface AgentActionSurface {
  allowedActionNames: readonly string[];
  actionScope?: AgentActionScope;
}

export interface DefaultAgentActionSurface {
  mode: "default";
}

export type AgentActionSurfaceResolution =
  | AgentActionSurface
  | DefaultAgentActionSurface;

type NormalizedAgentActionSurface =
  | DefaultAgentActionSurface
  | {
      mode: "allowlist";
      allowedActionNames: string[];
      actionScope?: AgentActionScope;
    };

export interface AgentActionSurfaceDetails {
  event: any;
  ownerEmail: string | null;
  orgId: string | null;
  threadId?: string;
  mode: AgentExecutionMode;
  internalContinuation: boolean;
  requestedTurnId?: string;
  queuedMessageId?: string;
  actionScope?: Readonly<AgentActionScope>;
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
    ...(hasOwn(value, "actionScope")
      ? { actionScope: normalizeAgentActionScope(value.actionScope) }
      : {}),
  };
}

export type PersistedActionSurface =
  | {
      orgId: string | null;
      allowedActionNames: string[];
      actionScope?: AgentActionScope;
    }
  | {
      orgId: string | null;
      mode: "default";
    };

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
  if (!hasOwn(surface, "actionScope")) return { orgId, allowedActionNames };
  try {
    return {
      orgId,
      allowedActionNames,
      actionScope: normalizeAgentActionScope(
        (surface as Record<string, unknown>).actionScope,
      ),
    };
  } catch {
    return { orgId: null, allowedActionNames: [] };
  }
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
  actions?: Record<string, ActionEntry>;
  /** @deprecated Use `actions` instead */
  scripts?: Record<string, ActionEntry>;
  systemPrompt: string | ((event: any) => string | Promise<string>);
  apiKey?: string;
  engine?:
    | AgentEngine
    | string
    | { name: string; config: Record<string, unknown> };
  model?: string;
  appId?: string;
  hostedHarnessConfig?: AgentNativeHarnessSetting;
  reasoningEffort?: ReasoningEffort;
  providerOptions?: EngineMessage extends never ? never : any;
  onRunComplete?: (run: ActiveRun, threadId: string | undefined) => void;
  onRunPrepared?: (details: {
    runId: string;
    threadId: string | undefined;
    message: string;
    attachments?: AgentChatAttachment[];
    queuedMessageId?: string;
  }) => void | Promise<void>;
  prepareRequest?: (details: {
    event: any;
    ownerEmail: string | null;
    message: string;
    displayMessage?: string;
    attachments: AgentChatAttachment[];
    references: AgentChatReference[];
    threadId?: string;
    requestContext: string;
    contextPrefetchDeadlineAt: number;
    internalContinuation?: boolean;
    dispatchToBackground: boolean;
    isBackgroundWorker?: boolean;
    mode: AgentExecutionMode;
  }) =>
    | void
    | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
        jevPromptCandidates?: JevPromptContextCandidate[];
        jevFallbackCandidateIds?: string[];
      }
    | Promise<void | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
        jevPromptCandidates?: JevPromptContextCandidate[];
        jevFallbackCandidateIds?: string[];
      }>;
  resolveActionSurface?: (
    details: AgentActionSurfaceDetails,
  ) => AgentActionSurfaceResolution | Promise<AgentActionSurfaceResolution>;
  runSoftTimeoutMs?: number;
  runNoProgressTimeoutMs?: number;
  durableBackgroundRuns?: boolean;
  onRunStart?: (
    send: (event: AgentChatEvent) => void,
    threadId: string,
    runId: string,
  ) => void | Promise<void>;
  onEngineResolved?: (engine: AgentEngine, model: string) => void;
  resolveOwnerEmail?: (event: any) => string | Promise<string>;
  finalResponseGuard?: AgentLoopFinalResponseGuard;
  skipFilesContext?: boolean;
  jevContextCompact?: boolean;
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
  toolLimits?: {
    timeoutMs?: number;
    maxResultChars?: number;
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
 * Ordering alone is NOT sufficient between the last two, because they do not
 * measure the same events: the bounds above watch engine-stream frames, while
 * the run-manager backstop watches events this loop FORWARDS. Extended
 * thinking produces the first without the second, so the 150s bound sat inside
 * the working distribution and killed live runs. What keeps them consistent is
 * the `model_stream` start/end bracket around the engine call, which suspends
 * the outer backstop while these inner bounds are the ones on duty.
 *
 * Background-function runs (proven 15-min budget, no ~40s wall) are likewise
 * unaffected — they keep the full 90s window for every event, first or not.
 */
const FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS = 25_000;
const EMPTY_FINAL_RESPONSE_RETRY_LIMIT = 2;
const TRUNCATED_TOOL_CALL_RETRY_LIMIT = 2;
const MAIN_CHAT_INTERNAL_CONTINUATION_LIMIT = 6;
const RUN_BUDGET_EXHAUSTED_ERROR_CODE = "run_budget_exhausted";
const RUN_BUDGET_EXHAUSTED_MESSAGE =
  "I ran out of time before finishing this step. " +
  "I stopped rather than keep retrying silently. " +
  "Check any completed tool cards above before retrying, ideally as one smaller follow-up.";
const MAX_INLINE_ATTACHMENT_BASE64_CHARS = MAX_INLINE_FILE_BASE64_CHARS;
const MAX_TEXT_ATTACHMENT_CHARS = 60_000;
const MAX_TEXT_ATTACHMENTS_TOTAL_CHARS = 80_000;
const MAX_SELECTION_CONTEXT_CHARS = 8_000;
const MAX_RESOURCE_INVENTORY_ITEMS = 40;
const MAX_RESOURCE_INVENTORY_DESCRIPTION_CHARS = 160;
const MAX_INLINE_SKILL_REFERENCE_CHARS = 40_000;
export function resolveSourceSweepToolCallThreshold(): number {
  return getAppConfig().agent.sourceSweepToolCallThreshold;
}
const EXPANDED_TOOL_SCHEMA_WARN_BYTES = 32_000;

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

  if (code === "builder_gateway_timeout") return false;
  if (
    code === "rate_limit_exceeded" ||
    msg.includes("daily gateway request cap")
  )
    return false;

  if (engineErr) {
    if (engineErr.providerRetryable === true) return true;
    const sc = engineErr.statusCode;
    if (sc === 429 || sc === 500 || sc === 502 || sc === 503 || sc === 529)
      return true;
  }

  return (
    code === "builder_gateway_error" ||
    code === BUILDER_GATEWAY_INTERNAL_ERROR_CODE ||
    code === "builder_gateway_network_error" ||
    code === "provider_network_error" ||
    code === "http_429" ||
    code === "http_500" ||
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "timeout" ||
    msg.includes("overloaded") ||
    msg.includes("rate_limit") ||
    /\b429\b/.test(msg) ||
    msg.includes("529") ||
    msg.includes("rate limit reached") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota exceeded") ||
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


const CONTEXT_TRIM_KEEP_TAIL = 10;
const CONTEXT_TRIM_STUB =
  "[result trimmed to save context — re-run the tool if needed]";

export function trimOldToolResults(
  messages: EngineMessage[],
  keepTail = CONTEXT_TRIM_KEEP_TAIL,
): EngineMessage[] | null {
  const cutoff = Math.max(0, messages.length - keepTail);
  let trimmed = false;

  const result = messages.map((msg, idx): EngineMessage => {
    if (idx >= cutoff) return msg;

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

function maxRetryDelayMs(attempt: number, retryAfterMs?: number): number {
  return Math.max(
    RETRY_BASE_DELAY_MS * Math.pow(2, attempt) * 1.1,
    retryAfterMs ?? 0,
  );
}

export function remainingRunBudgetMs(startedAt: number): number {
  const ceilingMs = resolveRunSoftTimeoutMs(undefined, {
    useHostedDefault: true,
    backgroundFunction: isInBackgroundFunctionRuntime(),
  });
  if (ceilingMs <= 0) return Number.POSITIVE_INFINITY;
  return ceilingMs - (Date.now() - startedAt);
}

function hasBudgetForEngineRetry(
  startedAt: number,
  attempt: number,
  retryAfterMs?: number,
): boolean {
  const remainingMs = remainingRunBudgetMs(startedAt);
  if (remainingMs === Number.POSITIVE_INFINITY) return true;
  return (
    remainingMs - maxRetryDelayMs(attempt, retryAfterMs) >=
    SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS
  );
}

function retryDelay(
  attempt: number,
  signal: AbortSignal,
  retryAfterMs?: number,
): Promise<void> {
  const baseMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = baseMs * 0.1;
  const computedMs = Math.max(0, baseMs + (Math.random() * 2 - 1) * jitter);
  const ms = Math.max(computedMs, retryAfterMs ?? 0);
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
    if (att.displayOnly === true) continue;
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
        match[2].length > MAX_INLINE_IMAGE_BASE64_CHARS
      ) {
        const label = att.name ? `"${att.name}"` : "An image";
        const limit = formatBase64CharBudget(MAX_INLINE_IMAGE_BASE64_CHARS);
        textAttachments.push(
          uploadedUrl
            ? `[${label} exceeds the ${limit} per-image limit for inline vision analysis, so it was not sent as an image. It was uploaded to ${uploadedUrl}; use that URL for embedding/reference.]`
            : `[${label} exceeds the ${limit} per-image limit for inline vision analysis, so you cannot see it. This is a size limit, not a storage-configuration problem: connecting file storage would not make this image readable. Tell the user the image is over the ${limit} limit and ask for a smaller or more compressed version.]`,
        );
        continue;
      }
      if (match && isSupportedImageMediaType(match[1])) {
        const verdict = reconcileImageBytes({
          base64: match[2],
          declared: match[1],
        });
        if (verdict.kind === "ok") {
          userContent.push({
            type: "image",
            data: match[2],
            mediaType: verdict.mediaType,
          });
        } else {
          const label = att.name ? `"${att.name}"` : "An image";
          const uploadedHint = uploadedUrl
            ? ` It is available at ${uploadedUrl}; use that URL for embedding/reference if the task does not require vision analysis.`
            : "";
          const logName = att.name ?? "(unnamed)";
          console.warn(
            `[attachments] dropped image block name=${logName} declared=${match[1]} verdict=${verdict.kind} base64Chars=${match[2].length}`,
          );
          textAttachments.push(
            `[${label} could not be sent for vision analysis because ${describeAttachmentBytesVerdict(verdict)}.` +
              uploadedHint +
              ` Tell the user which file it was and what is wrong with it; do not describe its contents, and do not blame file storage or a size limit.]`,
          );
        }
      } else {
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
        const limit = formatBase64CharBudget(
          MAX_INLINE_ATTACHMENT_BASE64_CHARS,
        );
        textAttachments.push(
          uploadedUrl
            ? `[${label} exceeds the ${limit} per-file limit for inline reading. It was uploaded to ${uploadedUrl}; read it from that URL if its contents are needed.]`
            : `[${label} exceeds the ${limit} per-file limit for inline reading, so you cannot read its contents. This is a size limit, not a storage-configuration problem. Tell the user the file is over the ${limit} limit and ask for a smaller one.]`,
        );
        continue;
      }
      if (filePart.mediaType === "application/pdf") {
        const verdict = reconcilePdfBytes({
          base64: filePart.data,
          declared: filePart.mediaType,
        });
        if (verdict.kind !== "ok") {
          const label = att.name ? `"${att.name}"` : "A file";
          const logName = att.name ?? "(unnamed)";
          console.warn(
            `[attachments] dropped document block name=${logName} verdict=${verdict.kind} base64Chars=${filePart.data.length}`,
          );
          const why = describeAttachmentBytesVerdict(verdict);
          textAttachments.push(
            uploadedUrl
              ? `[${label} could not be read as a PDF because ${why}. It was uploaded to ${uploadedUrl}; use that URL for reference. Tell the user the file is not a readable PDF.]`
              : `[${label} could not be read as a PDF because ${why}. Tell the user which file it was and what is wrong with it; do not describe its contents.]`,
          );
          continue;
        }
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
    finish(status: "done" | "pending" | "error") {
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
      ...(getRequestContext()?.isSyntheticTraffic === true
        ? {
            transportHeaders: {
              [SYNTHETIC_TRAFFIC_HEADER]: SYNTHETIC_TRAFFIC_BETA_E2E,
            },
          }
        : {}),
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
    const connectionRequest = parseA2AConnectionRequest(error);
    if (connectionRequest) {
      relay.finish("pending");
      throw new AgentConnectionRequiredError(
        connectionRequest.detail ??
          `Connect ${connectionRequest.provider} to continue.`,
        {
          provider: connectionRequest.provider,
          reason: connectionRequest.reason,
          ...(connectionRequest.appId
            ? { appId: connectionRequest.appId }
            : {}),
          source: { id: input.agent, kind: "agent", label: input.agent },
        },
      );
    }
    relay.finish("error");
    throw error;
  }
}

function parseA2AConnectionRequest(
  error: unknown,
): A2AConnectionRequestMetadata | null {
  if (!error || typeof error !== "object" || !("task" in error)) return null;
  const task = (error as { task?: Task }).task;
  const value = task?.status.message?.metadata?.agentNativeConnectionRequest;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  const provider =
    typeof request.provider === "string" ? request.provider.trim() : "";
  const reason = request.reason;
  if (
    request.version !== 1 ||
    !provider ||
    provider.length > 120 ||
    (reason !== "connect" &&
      reason !== "grant" &&
      reason !== "reauthorize" &&
      reason !== "admin_required")
  ) {
    return null;
  }
  const appId = typeof request.appId === "string" ? request.appId.trim() : "";
  const detail =
    typeof request.detail === "string" ? request.detail.trim() : "";
  return {
    version: 1,
    provider,
    reason,
    ...(appId && appId.length <= 120 ? { appId } : {}),
    ...(detail && detail.length <= 1_000 ? { detail } : {}),
  };
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

export interface AgentLoopUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  builderCreditsUsed?: number;
  engineName?: string;
  model: string;
  llmCalls?: number;
  /**
   * True once the engine reported at least one real `usage` event for this
   * run. The token fields above start at 0 and are only ever incremented —
   * when this is not true, those zeros are placeholders for "never
   * reported", not a measured empty usage, and callers must not treat them
   * as real counts.
   */
  usageReported?: boolean;
  firstEngineEventAtMs?: number;
}

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
  artifacts?: ArtifactReceipt[];
}

export interface AgentLoopFinalResponseGuardContext {
  messages: EngineMessage[];
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
      exhaustedDraftPrefix?: string;
      maxRetries?: number;
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
  | "no_progress"
  | "rate_limited";

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
    reason === "no_progress" ||
    reason === "rate_limited"
  );
}

export function isResumableEngineError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code =
    err instanceof EngineError ? (err.errorCode ?? "").toLowerCase() : "";
  if (
    code === "builder_gateway_timeout" ||
    code === "builder_gateway_network_error" ||
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
  if (code === PROVIDER_TRANSIENT_REJECTION_ERROR_CODE) return true;
  if (code === "rate_limited" && err.providerRetryable === true) return true;
  return false;
}

export function continuationReasonForResumableError(
  err: unknown,
): "gateway_timeout" | "network_interrupted" | "rate_limited" {
  const code =
    err instanceof EngineError ? (err.errorCode ?? "").toLowerCase() : "";
  if (code === "builder_gateway_timeout") return "gateway_timeout";
  if (
    err instanceof EngineError &&
    (err.statusCode === 408 || err.statusCode === 504)
  ) {
    return "gateway_timeout";
  }
  // `providerRetryable` 403) — a real credential rejection must stay terminal.
  if (
    code === "http_429" ||
    code === "http_529" ||
    code === "rate_limited" ||
    code === PROVIDER_TRANSIENT_REJECTION_ERROR_CODE ||
    (err instanceof EngineError &&
      (err.statusCode === 429 ||
        err.statusCode === 529 ||
        (err.statusCode === 403 && err.providerRetryable === true)))
  ) {
    return "rate_limited";
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

export function resolveFinalResponseGuardRequestText(
  messages: EngineMessage[],
): string | undefined {
  const message = messages[findCurrentTurnStartForContinuation(messages)];
  if (!message || message.role !== "user") return undefined;
  const text = textFromEngineMessage(message).trim();
  if (text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT)) return undefined;
  return text || undefined;
}

function findSafeWindowStart(
  messages: EngineMessage[],
  desiredStart: number,
): number {
  for (let i = Math.max(0, desiredStart); i < messages.length; i++) {
    if (!isToolResultOnlyUserMessage(messages[i])) return i;
  }
  return -1;
}

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

    if (!hasObservationalMemory(context)) return messages;

    const block = serializeObservationalMemoryBlock(context);
    if (!block.trim()) return messages;

    const omMessage: EngineMessage = {
      role: "user",
      content: [{ type: "text", text: block }],
    };

    const recentCount = context.recentMessages.length;
    if (recentCount === 0 || recentCount >= messages.length) {
      return [omMessage, ...messages];
    }
    const desiredStart = messages.length - recentCount;
    const safeStart = findSafeWindowStart(messages, desiredStart);
    if (safeStart < 0) {
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

type CachedReadOnlyToolResult = {
  content: string;
  images?: EngineToolResultPart["images"];
};

function seedReadOnlyToolResultsFromJournal(
  journal: ToolCallJournal | null,
  actions: Record<string, ActionEntry>,
): Map<string, CachedReadOnlyToolResult> {
  const cache = new Map<string, CachedReadOnlyToolResult>();
  if (!journal) return cache;
  for (const entry of journal.completed) {
    const action = actions[entry.tool];
    if (action?.readOnly !== true) {
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
    cache.set(toolCallCacheKey(entry.tool, entry.input), { content: result });
  }
  return cache;
}

function seedReadOnlyToolResultsFromHistory(
  messages: EngineMessage[],
  actions: Record<string, ActionEntry>,
  seed?: Map<string, CachedReadOnlyToolResult>,
): Map<string, CachedReadOnlyToolResult> {
  const cache = new Map<string, CachedReadOnlyToolResult>(seed);
  if (!isInternalContinuationTurn(messages)) return cache;

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
        if (part.isError !== true) cache.clear();
        continue;
      }
      if (!call.dedupe) continue;
      if (!isReusableReadOnlyToolResult(part)) continue;
      cache.set(toolCallCacheKey(call.name, call.input), {
        content: part.content,
        ...(part.images?.length ? { images: part.images } : {}),
      });
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
  if (
    !part.images?.length &&
    /\[image(?:\s+#\d+|\s*:)[^\n\]]*\battached(?:\s+#\d+|:)[^\n\]]*\]/i.test(
      part.content,
    )
  ) {
    return false;
  }
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

const INTERRUPTED_TOOL_RESULT_MARKER =
  "Interrupted before this tool returned a result.";
const MAX_WRITE_TOOL_INTERRUPTIONS = 2;
const MAX_IDENTICAL_TOOL_ERRORS = 3;
export const MAX_SAME_ERROR_ACROSS_ARGUMENTS = 3;
export const MAX_IDENTICAL_TOOL_CALLS = 8;

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

export function actionsToEngineTools(
  actions: Record<string, ActionEntry>,
): EngineTool[] {
  const tools: EngineTool[] = [];
  for (const [name, entry] of Object.entries(actions)) {
    if (entry.agentTool === false || entry.uiOnly === true) continue;
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
  appId?: string;
  caller?: ActionCaller;
  networkProtocol?: "a2a" | "mcp" | "provider-api";
  networkId?: string;
  networkPeer?: string;
  delegationDepth?: number;
  visitedApps?: string[];
  threadId?: string;
  turnId?: string;
  approvedToolCalls?: string[];
  onApprovalRequired?: (
    binding: AgentApprovalBinding,
  ) => Promise<string | void>;
  consumeApproval?: (binding: AgentApprovalBinding) => Promise<boolean>;
  isToolAlwaysAllowed?: (binding: AgentApprovalBinding) => Promise<boolean>;
  send?: (event: AgentChatEvent) => void;
}

export interface AgentApprovalBinding {
  toolName: string;
  input: unknown;
  callId: string;
  approvalKey: string;
}

export async function executeAgentToolCall(
  options: ExecuteAgentToolCallOptions,
): Promise<AgentToolCallExecutionResult> {
  const entry = options.actions[options.name];
  if (!entry || isActionHiddenFromEveryAgentSurface(entry)) {
    return {
      status: "failed",
      output: `Unknown or unavailable tool: ${options.name}`,
    };
  }

  let streamCalls = 0;
  const engine: AgentEngine = {
    name: "agent-native:single-tool",
    label: "Agent-Native tool runtime",
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
      systemPrompt: "Execute the selected Agent-Native tool call.",
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
      appId: options.appId,
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
      isToolAlwaysAllowed: options.isToolAlwaysAllowed,
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
  "resources",
  "framework-search",
  "docs-search",
  "get-framework-context",
  "read-attachment",
  "web-request",
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

function normalizeToolInputSchema(
  schema: ActionTool["parameters"] | undefined,
): EngineTool["inputSchema"] | null {
  if (!schema) return { type: "object", properties: {} };
  if (!isObjectOnly(schema)) return null;
  type ToolParams = NonNullable<ActionTool["parameters"]>;
  let cloned: ToolParams;
  try {
    cloned = JSON.parse(JSON.stringify(schema)) as ToolParams;
  } catch {
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
  return `${toolName}:${stableStringify(normalizeToolCallInputForHistory(input, toolName))}`;
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
}): Promise<{ result: string; artifacts: ArtifactReceipt[] } | null> {
  const pollMs = INTERRUPTED_TOOL_LEDGER_POLL_MS;
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

export function normalizeToolErrorForBreaker(error: string): string {
  return (
    stripDiagnosticSnippets(error)
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
  const unfenced = stripDiagnosticSnippets(message);
  const trimmed = unfenced.replace(/\s+/g, " ").trim();
  for (const pattern of PERMANENT_PRECONDITION_PATTERNS) {
    if (pattern.test(trimmed)) return trimmed;
  }
  for (const pattern of PERMANENT_PRECONDITION_LINE_PATTERNS) {
    if (pattern.test(unfenced)) return trimmed;
  }
  return null;
}

const PERMANENT_PRECONDITION_PATTERNS: readonly RegExp[] = [
  /\brequires? (?:an? |the )?[\w-]+ role\b/i,
  /\b(?:api[ -]?keys?|access tokens?|credentials?|secrets?)\b[^.]{0,60}\bnot (?:configured|set|connected|available)\b/i,
  /\bsave [A-Z][A-Z0-9_]{3,} in (?:the )?settings\b/i,
  /(?:^|[.:!?]\s+)Connect [A-Z][\w.-]*[^;]{0,40}?\b(?:before|first|in settings)\b/,
  /\bplan mode blocked\b/i,
  /\bno authenticated user\b/i,
  /\bssrf blocked\b/i,
  // Deliberately absent: "only available in …". Retention windows ("only
  // available from the last 90 days") share its wording and are fixed by
  // narrowing the range, so it stopped turns that were one argument away from
  // succeeding. The count-based breaker still ends a genuine runtime gate
  // after six.
];

const PERMANENT_PRECONDITION_LINE_PATTERNS: readonly RegExp[] = [
  /^code:\s*permanent_precondition\s*$/m,
  /^(?!\s)[^\n]*\(errorCode:\s*permanent_precondition\)\s*$/m,
];

const PERMANENT_PRECONDITION_REASON_MAX_CHARS = 240;

export function permanentPreconditionReason(
  toolName: string,
  message: string,
): string | null {
  const escapedName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reason = message
    .replace(new RegExp(`^Error running ${escapedName}:\\s*`), "")
    .replace(new RegExp(`^${escapedName}:\\s*`), "")
    // `runToolCall` suffixes a contract error's own code; it is the marker
    // that classified this stop, not part of the reason.
    .replace(/\s*\(errorCode: permanent_precondition\)\s*$/i, "")
    .trim()
    // The headline appends its own sentence punctuation.
    .replace(/[.。]+$/, "");
  if (!reason) return null;
  if (
    /\bI stopped because\b/i.test(reason) ||
    /permanent_precondition/i.test(reason)
  ) {
    return null;
  }
  return reason.length > PERMANENT_PRECONDITION_REASON_MAX_CHARS
    ? `${reason.slice(0, PERMANENT_PRECONDITION_REASON_MAX_CHARS).trim()}…`
    : reason;
}

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
  const threshold = opts.threshold ?? resolveSourceSweepToolCallThreshold();
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

export function repeatedSourceSweepGuardMessage(opts: {
  toolName: string;
  threshold?: number;
  scope?: "tool" | "aggregate";
}): string {
  const threshold = opts.threshold ?? resolveSourceSweepToolCallThreshold();
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
  const threshold = opts.threshold ?? resolveSourceSweepToolCallThreshold();
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
        input: normalizeToolCallInputForHistory(part.input, part.name),
      });
    }
  }
  return seeded;
}

function normalizeToolCallInputForHistory(
  input: unknown,
  toolName?: string,
): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if (toolName !== "docs-search" || typeof record.query !== "string") {
      return record;
    }
    return {
      ...record,
      query: record.query.trim().replace(/\s+/g, " ").toLowerCase(),
    };
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

function toolInputSchemaErrorResult(
  toolName: string,
  input: unknown,
  error: string,
  parameters?: ActionTool["parameters"],
  /**
   * The model response carrying this call stopped at the output-token cap, so
   * the arguments are truncated rather than wrong. Telling the model to match
   * the schema here is what makes it re-send the same oversized payload.
   */
  outputCapTruncated = false,
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
    (outputCapTruncated
      ? "The tool was not executed: the response hit the model output-token cap before these arguments finished, so they are truncated, not wrong. Retry with a smaller payload — split the work across several calls, or shorten the longest field."
      : "The tool was not executed; retry with arguments that match the tool schema.")
  );
}

type RawJsonSchema = AgentNativeJsonSchema;

const rawToolInputAjv = new Ajv({
  strict: false,
  allErrors: true,
  coerceTypes: true,
  useDefaults: false,
  removeAdditional: false,
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

function schemaRejectsToolValue(schema: object, value: unknown): boolean {
  const validator = compileToolValueValidator(schema);
  return validator ? !validator(value) : false;
}

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

function resolveObjectSchemaBranch(
  schema: RawJsonSchema,
  value: unknown,
): RawJsonSchema | undefined {
  const branches = schema.oneOf ?? schema.anyOf;
  if (!branches?.length) return schema;
  const index = discriminatedBranchIndex(branches, value);
  return index >= 0 ? branches[index] : undefined;
}

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
    const parsedContainer = Array.isArray(parsed) ? "array" : "object";
    const containerMatches = Array.isArray(expectedType)
      ? expectedType.includes(parsedContainer)
      : expectedType === parsedContainer;
    if (!containerMatches) continue;
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
  onUsage?: (usage: AgentLoopUsage) => void;
  onOutcome?: (outcome: AgentLoopOutcome) => void;
  ownerEmail?: string | null;
  orgId?: string | null;
  appId?: string;
  appAuthorization?:
    | import("../org/app-roles.js").AppAuthorizationContext
    | null;
  actionCaller?: ActionCaller;
  automation?: ActionAutomationContext;
  runId?: string;
  budgetStartedAt?: number;
  networkProtocol?: "a2a" | "mcp" | "provider-api";
  networkId?: string;
  networkPeer?: string;
  delegationDepth?: number;
  visitedApps?: string[];
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
  priorTurnInputTokens?: number;
  finalResponseGuard?: AgentLoopFinalResponseGuard;
  finalResponseGuardRequestText?: string;
  threadId?: string;
  turnId?: string;
  runSoftTimeoutMs?: number;
  toolLimits?: {
    timeoutMs?: number;
    maxResultChars?: number;
    hardMaxResultChars?: number;
  };
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
  isToolAlwaysAllowed?: (binding: AgentApprovalBinding) => Promise<boolean>;
  processors?: Processor[];
}): Promise<AgentLoopUsage> {
  const {
    engine,
    systemPrompt,
    tools,
    availableTools,
    messages,
    actions,
    send,
    signal,
  } = opts;
  let model = opts.model;
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
  let appAuthorizationPromise:
    | Promise<import("../org/app-roles.js").AppAuthorizationContext | null>
    | undefined;
  const resolveTurnAppAuthorization = (
    userEmail: string | undefined,
    orgId: string | null,
  ) => {
    if (!appAuthorizationPromise) {
      appAuthorizationPromise =
        opts.appAuthorization !== undefined
          ? Promise.resolve(opts.appAuthorization)
          : opts.appId && userEmail && orgId
            ? import("../org/app-roles.js").then(
                ({ resolveAppAuthorizationContext }) =>
                  resolveAppAuthorizationContext(opts.appId!, {
                    userEmail,
                    orgId,
                  }),
              )
            : Promise.resolve(null);
    }
    return appAuthorizationPromise;
  };

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
      const expandedTools = (availableTools ?? tools).filter((tool) =>
        activeToolNames.has(tool.name),
      );
      const prioritizedNames = new Set(names);
      activeTools = [
        ...expandedTools.filter((tool) => prioritizedNames.has(tool.name)),
        ...expandedTools.filter((tool) => !prioritizedNames.has(tool.name)),
      ];
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

  const processorChain =
    opts.processors && opts.processors.length > 0
      ? new ProcessorChain(opts.processors)
      : null;

  const usage: AgentLoopUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    engineName: opts.engine.name,
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
  const runToolTimeoutCeilingMs = resolveRunToolTimeoutCeilingMs(
    opts.runSoftTimeoutMs ??
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
  const repeatedToolErrors = new Map<string, number>();
  const repeatedToolErrorsAnyArgs = new Map<string, number>();
  const repeatedToolCalls = new Map<string, number>();
  const journaledCallCountByKey = new Map<string, number>();
  for (const prior of journaledPriorToolCalls) {
    const key = toolCallCacheKey(prior.name, prior.input);
    journaledCallCountByKey.set(
      key,
      (journaledCallCountByKey.get(key) ?? 0) + 1,
    );
  }
  const resurfacedResultCountByKey = new Map<string, number>();
  for (const result of journaledPriorToolResults) {
    if (
      !result.content.startsWith(
        resurfacedDuplicateReadOnlyToolResultPrefix(result.name),
      )
    )
      continue;
    const key = toolCallCacheKey(result.name, result.input);
    resurfacedResultCountByKey.set(
      key,
      (resurfacedResultCountByKey.get(key) ?? 0) + 1,
    );
  }
  for (const [key, callCount] of journaledCallCountByKey) {
    const genuine = Math.max(
      callCount - (resurfacedResultCountByKey.get(key) ?? 0),
      0,
    );
    if (genuine > 0) repeatedToolCalls.set(key, genuine);
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
  let truncatedToolCallRetries = 0;
  let iterations = 0;
  let endedAtLoopLimit = false;
  let terminalActionStop: TerminalActionStop | null = null;
  const sendTerminalActionStop = (stop: TerminalActionStop) => {
    if (
      stop.errorCode === "needs-approval" ||
      stop.errorCode === "awaiting-user-input"
    ) {
      send({ type: "text", text: stop.message });
      return;
    }
    send({
      type: "error",
      error: stop.message,
      errorCode: stop.errorCode ?? "tool_failed",
      ...(stop.details ? { details: stop.details } : {}),
      recoverable: false,
    });
  };
  let effectiveMaxOutputTokens = opts.maxOutputTokens;
  let effectiveReasoningEffort = opts.reasoningEffort;
  let fallbackModelAttempted = false;

  let tripwire: TripWire | null = null;
  const emitTripwire = (err: TripWire) => {
    tripwire = err;
    send({
      type: "tripwire",
      reason: err.message,
      ...(err.processor ? { processor: err.processor } : {}),
    });
    const errorCode =
      err.processor === "run-input-token-budget"
        ? "budget_exhausted"
        : err.processor
          ? `guardrail:${err.processor}`
          : "guardrail";
    terminalActionStop = {
      message: err.message,
      errorCode,
    };
    sendTerminalActionStop(terminalActionStop);
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
      emitTripwire(
        new TripWire(
          `I stopped because this request consumed ${turnInputTokens.toLocaleString()} input tokens, past the ${maxRunInputTokens.toLocaleString()} budget for a single turn. ` +
            `Anything already completed above is saved. Please retry as a smaller, more specific follow-up.`,
          { processor: "run-input-token-budget" },
        ),
      );
      break;
    }
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
        const activeToolInputs = new Map<string, ActiveToolInputPreparation>();
        let endedForNoProgress = false;
        let modelStreamBracketOpen = false;
        const openModelStreamBracket = () => {
          if (modelStreamBracketOpen) return;
          modelStreamBracketOpen = true;
          send({ type: "model_stream", status: "start" });
        };
        const closeModelStreamBracket = () => {
          if (!modelStreamBracketOpen) return;
          modelStreamBracketOpen = false;
          send({
            type: "model_stream",
            status: "end",
            ...(terminalStopReason ? { reason: terminalStopReason } : {}),
          });
        };
        let lastModelStreamProgressAt = Date.now();
        let hasReceivedFirstEngineEvent = false;
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
        const noProgressDeadlineAt = () => {
          if (
            hasReceivedFirstEngineEvent ||
            !isClampedForegroundRuntimeForThisCall
          ) {
            return Number.POSITIVE_INFINITY;
          }
          return (
            lastModelStreamProgressAt + FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS
          );
        };
        const hasNoProgressStalled = () => Date.now() >= noProgressDeadlineAt();
        const checkpointNoProgress = () => {
          if (endedForNoProgress) return;
          closeModelStreamBracket();
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
          if (!Number.isFinite(deadlineAt)) return iterator.next();
          const timeoutMs = Math.max(0, deadlineAt - Date.now());
          if (timeoutMs <= 0) {
            checkpointNoProgress();
            void requestEventIteratorReturn(iterator, false);
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
              void requestEventIteratorReturn(iterator, false);
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
        const eventIterator = eventStream[Symbol.asyncIterator]();
        let eventIteratorDone = false;
        openModelStreamBracket();
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
              hasReceivedFirstEngineEvent = true;
              lastModelStreamProgressAt = Date.now();
              usage.firstEngineEventAtMs ??= lastModelStreamProgressAt;
            }
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
              streamedAssistantText += event.text;
              send({ type: "text", text: event.text });
            } else if (event.type === "thinking-delta") {
              thinkingBuffer += event.text;
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
            } else if (event.type === "tool-input-delta") {
              const key = event.id ?? event.name;
              const toolName =
                event.name ??
                (event.id ? toolInputNames.get(event.id) : undefined);
              let progressBytes: number | undefined;
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
            } else if (event.type === "gateway-heartbeat") {
              send({ type: "stream_keepalive" });
            } else if (event.type === "tool-call") {
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
                engineName: opts.engine.name,
                model,
                ...(event.builderCreditsUsed !== undefined
                  ? { builderCreditsUsed: event.builderCreditsUsed }
                  : {}),
              };
              usage.inputTokens += eventUsage.inputTokens;
              usage.outputTokens += eventUsage.outputTokens;
              usage.cacheReadTokens += eventUsage.cacheReadTokens;
              usage.cacheWriteTokens += eventUsage.cacheWriteTokens;
              if (eventUsage.builderCreditsUsed !== undefined) {
                usage.builderCreditsUsed =
                  (usage.builderCreditsUsed ?? 0) +
                  eventUsage.builderCreditsUsed;
              }
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
                  retryAfterMs: event.retryAfterMs,
                });
              }
            }
            if (hasNoProgressStalled()) {
              checkpointNoProgress();
              break;
            }
          }
        } finally {
          closeModelStreamBracket();
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

        const hasCompleteToolCall =
          streamedAssistantToolCalls.length > 0 ||
          toolCallErrors.size > 0 ||
          assistantContent?.some((part) => part.type === "tool-call") === true;
        const hasUnfinishedToolInput =
          activeToolInputs.size > 0 && !hasCompleteToolCall;
        if (hasUnfinishedToolInput) {
          send({ type: "auto_continue", reason: "stream_ended" });
          return usage;
        }

        break;
      } catch (err: unknown) {
        if (signal.aborted) throw err;
        if (isContextTooLongError(err)) {
          if (retry === 0) {
            const trimmed = trimOldToolResults(contextMessages);
            if (trimmed !== null) {
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
        const retryAfterMs =
          err instanceof EngineError ? err.retryAfterMs : undefined;
        if (
          retry < maxRetriesForError(err) &&
          isRetryableError(err) &&
          hasBudgetForEngineRetry(budgetStartedAt, retry, retryAfterMs)
        ) {
          const stalledMs = Date.now() - attemptStartedAt;
          if (stalledMs >= VISIBLE_RETRY_THRESHOLD_MS) {
            send({
              type: "activity",
              label: `Model did not respond — retrying (${retry + 2}/${maxRetriesForError(err) + 1})`,
            });
          }
          send({ type: "clear" });
          await retryDelay(retry, signal, retryAfterMs);
          continue;
        }
        if (
          !fallbackModelAttempted &&
          isTransientProviderRateLimitError(err) &&
          hasBudgetForEngineRetry(budgetStartedAt, 0)
        ) {
          const fallbackModel = resolveFallbackModel(
            model,
            engine.supportedModels,
          );
          // ponytail: chars/4 is a coarse token estimate; swap in the engine's
          const fallbackFits =
            fallbackModel !== undefined &&
            JSON.stringify(contextMessages).length / 4 <=
              getContextWindowForModel(fallbackModel) * 0.8;
          if (fallbackModel && fallbackFits) {
            fallbackModelAttempted = true;
            send({
              type: "activity",
              label: `${model} is rate limited — switching to ${fallbackModel}`,
            });
            send({ type: "clear" });
            model = fallbackModel;
            usage.inputTokens = 0;
            usage.outputTokens = 0;
            usage.cacheReadTokens = 0;
            usage.cacheWriteTokens = 0;
            usage.model = fallbackModel;
            retry = -1;
            continue;
          }
        }
        throw err;
      }
    }

    if (tripwire) break;

    if (!assistantContent && toolCallErrors.size > 0) {
      assistantContent = [];
    }

    if (
      (!assistantContent || assistantContent.length === 0) &&
      (streamedAssistantText.trim() || streamedAssistantToolCalls.length > 0)
    ) {
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
        send({ type: "auto_continue", reason: "stream_ended" });
        return usage;
      }
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
            input: normalizeToolCallInputForHistory(part.input, part.name),
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
        terminalActionStop = {
          message:
            "The model returned an empty response. This usually means reasoning used the full output-token budget. Try again, or pick a different model from the model menu.",
          errorCode: "empty_final_response",
        };
        sendTerminalActionStop(terminalActionStop);
        break;
      }

      let guard: Awaited<ReturnType<AgentLoopFinalResponseGuard>> | null = null;
      const finalResponseDraftText = collectTextParts(
        assistantContentForHistory,
      );
      if (opts.finalResponseGuard) {
        try {
          guard = await opts.finalResponseGuard({
            messages,
            requestText: finalResponseGuardRequestText,
            assistantContent: assistantContentForHistory,
            text: finalResponseDraftText,
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
        const exhaustedDraftPrefix =
          typeof guard === "string" ? undefined : guard.exhaustedDraftPrefix;
        send({
          type: "text",
          text:
            exhaustedDraftPrefix && finalResponseDraftText.trim()
              ? `${exhaustedDraftPrefix}\n\n${finalResponseDraftText}`
              : (fallbackMessage ?? retryMessage),
        });
      } else {
        flushUnstreamedAssistantText();
      }
      emptyFinalResponseRetries = 0;
      effectiveMaxOutputTokens = opts.maxOutputTokens;
      effectiveReasoningEffort = opts.reasoningEffort;
      break;
    }

    finalGuardRetries = 0;
    emptyFinalResponseRetries = 0;

    const toolCallTruncatedByOutputCap = terminalStopReason === "max_tokens";
    if (toolCallTruncatedByOutputCap) {
      if (truncatedToolCallRetries < TRUNCATED_TOOL_CALL_RETRY_LIMIT) {
        truncatedToolCallRetries += 1;
        effectiveMaxOutputTokens =
          resolveEmptyResponseRetryMaxOutputTokens(model);
      } else {
        effectiveMaxOutputTokens = opts.maxOutputTokens;
      }
    } else {
      truncatedToolCallRetries = 0;
      effectiveMaxOutputTokens = opts.maxOutputTokens;
    }

    flushUnstreamedAssistantText();

    let requestedActionStop: TerminalActionStop | null = null;
    let requestedConnection:
      | {
          requestId: string;
          provider: string;
          reason: "connect" | "grant" | "reauthorize" | "admin_required";
          appId?: string;
          detail: string;
          source?: { id: string; kind?: string; label?: string };
        }
      | undefined;
    let turnYieldedToUser = false;

    const noteToolCallSucceeded = (actionEntry: ActionEntry) => {
      if (actionEntry.endsTurn !== true) return;
      turnYieldedToUser = true;
      requestedActionStop ??= {
        message: "Waiting for your answer before continuing.",
        errorCode: "awaiting-user-input",
      };
    };

    const noteRepeatedToolCall = (
      toolName: string,
      input: unknown,
    ): TerminalActionStop | null => {
      const key = toolCallCacheKey(toolName, input);
      const count = (repeatedToolCalls.get(key) ?? 0) + 1;
      repeatedToolCalls.set(key, count);
      if (count < MAX_IDENTICAL_TOOL_CALLS) return null;
      const stop: TerminalActionStop = {
        message:
          `Stopped because ${toolName} was called ${count} times with identical arguments in one turn, ` +
          `which means the same step is repeating rather than making progress. ` +
          `Everything completed before this point is preserved above.`,
        errorCode: "repeated_tool_call",
      };
      requestedActionStop ??= stop;
      return requestedActionStop === stop ? stop : null;
    };

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
      const repeatGuardStopFromThisCall = noteRepeatedToolCall(
        toolCall.name,
        toolCall.input,
      );
      const toolInputNormalized =
        placeholderNormalization.changed || jsonStringCoercion.changed;
      const wireToolInput = JSON.stringify(toolCall.input ?? {});
      const normalizedToolInput = normalizeToolCallInputForHistory(
        toolCall.input,
        toolCall.name,
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
      const recordToolResult = (
        content: string,
        isError: boolean,
        artifacts?: ArtifactReceipt[],
      ) => {
        toolResultHistory.push({
          name: toolCall.name,
          content,
          isError,
          ...(artifacts?.length ? { artifacts } : {}),
        });
      };
      let directStop: { message: string; explicit: boolean } | null = null;
      const finalizeToolErrorResult = (rawResult: string): string => {
        const sanitizedResult = sanitizeToolErrorText(rawResult);
        const permanentRemedy = directStop?.explicit
          ? directStop.message
          : permanentPreconditionRemedy(directStop?.message ?? sanitizedResult);
        if (permanentRemedy) {
          const reason = permanentPreconditionReason(
            toolCall.name,
            permanentRemedy,
          );
          requestedActionStop ??= {
            message: reason
              ? `I stopped because ${toolCall.name} can't run yet: ${reason}. ` +
                "That needs to be fixed outside this chat (a credential, a role, a connected account, or an approval), then you can retry."
              : `I stopped because ${toolCall.name} needs a setup step outside this turn — a credential, a role, a connected account, or an approval — before it can run. ` +
                "Retrying would not have changed it, and anything completed before this is saved.",
            errorCode: "permanent_precondition",
            details: sanitizedResult,
          };
          return reason
            ? `Stopped: ${toolCall.name} can't run yet: ${reason}. ` +
                `Do not retry it with different arguments. ${sanitizedResult}`
            : `Stopped: ${toolCall.name} cannot run until a setup step outside this turn is fixed. ` +
                `Do not retry it with different arguments. ${sanitizedResult}`;
        }
        const errorKey = `${toolCallCacheKey(
          toolCall.name,
          toolCall.input,
        )}:${normalizeToolErrorForBreaker(sanitizedResult)}`;
        const count = (repeatedToolErrors.get(errorKey) ?? 0) + 1;
        repeatedToolErrors.set(errorKey, count);

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
        requestedActionStop ??= {
          message:
            `I stopped because the ${toolCall.name} action failed ${count} times in a row the same way, ` +
            "so retrying it again would not have worked. Anything completed before this is saved.",
          errorCode: "repeated_identical_tool_error",
          details: sanitizedResult,
        };
        return result;
      };
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

      const approvalKey = toolCallCacheKey(toolCall.name, toolCall.input);
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
          mustApprove = true;
        }
        if (
          mustApprove &&
          actionEntry.allowPersistentApproval !== false &&
          opts.isToolAlwaysAllowed
        ) {
          try {
            mustApprove = !(await opts.isToolAlwaysAllowed(approvalBinding));
          } catch {
            // place instead of turning a storage outage into authorization.
            mustApprove = true;
          }
        }
        if (mustApprove) {
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
            ...(actionEntry.allowPersistentApproval === false
              ? { allowPersistentApproval: false }
              : {}),
            ...(askId ? { askId } : {}),
            ...(toolCall.id ? { toolCallId: toolCall.id } : {}),
          });
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
          turnYieldedToUser = true;
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
            ...(journaled.artifacts?.length
              ? { artifacts: journaled.artifacts }
              : {}),
          });
          recordToolResult(result, false, journaled.artifacts);
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
            const result =
              `(Recovered from prior interrupted chunk — action already completed.)\n\n` +
              ledgerResult.result;
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
              ...(ledgerResult.artifacts.length > 0
                ? { artifacts: ledgerResult.artifacts }
                : {}),
              ...(actionEntry.chatUI ? { chatUI: actionEntry.chatUI } : {}),
            });
            recordToolResult(result, false, ledgerResult.artifacts);
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

      try {
        const toolCallSchemaError = toolCallErrors.get(toolCall.id);
        if (toolCallSchemaError && !toolInputNormalized) {
          const result = finalizeToolErrorResult(
            toolInputSchemaErrorResult(
              toolCall.name,
              toolCallSchemaError.input,
              toolCallSchemaError.error,
              actionEntry?.tool.parameters,
              toolCallTruncatedByOutputCap,
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
              toolCallTruncatedByOutputCap,
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

        const cacheKey =
          actionEntry.readOnly === true && actionEntry.dedupe !== false
            ? toolCallCacheKey(toolCall.name, toolCall.input)
            : null;
        const cachedResult = cacheKey
          ? readOnlyToolResultCache.get(cacheKey)
          : undefined;
        if (cacheKey && cachedResult) {
          const previousResult = cachedResult.content;
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
            duplicateReadOnlyToolCalls.set(cacheKey, 0);
            const repeatKey = toolCallCacheKey(toolCall.name, toolCall.input);
            const repeatCount = repeatedToolCalls.get(repeatKey);
            const repeatCountAfterRollback =
              typeof repeatCount === "number" && repeatCount > 0
                ? repeatCount - 1
                : 0;
            repeatedToolCalls.set(repeatKey, repeatCountAfterRollback);
            if (
              repeatGuardStopFromThisCall &&
              requestedActionStop === repeatGuardStopFromThisCall &&
              repeatCountAfterRollback < MAX_IDENTICAL_TOOL_CALLS
            ) {
              requestedActionStop = null;
            }
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
            ...(cachedResult.images?.length
              ? { images: cachedResult.images }
              : {}),
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
        let toolArtifacts: ArtifactReceipt[] = [];
        let fileMutation: AgentFileMutationProof | undefined;
        try {
          if (signal.aborted) {
            throw new Error("Run aborted");
          }
          const timeoutSignal = AbortSignal.timeout(toolTimeoutMs);
          const actionUserEmail = opts.ownerEmail ?? getRequestUserEmail();
          const actionOrgId = opts.orgId ?? getRequestOrgId() ?? null;
          const appAuthorization = await resolveTurnAppAuthorization(
            actionUserEmail ?? undefined,
            actionOrgId,
          );
          const actionContext = {
            send,
            userEmail: actionUserEmail ?? undefined,
            orgId: actionOrgId,
            appId: opts.appId,
            ...(appAuthorization
              ? {
                  appRoles: appAuthorization.roles,
                  appPermissions: Object.entries(appAuthorization.permissions)
                    .filter(([, roles]) =>
                      roles.some((role) =>
                        appAuthorization.roles.includes(role),
                      ),
                    )
                    .map(([permission]) => permission),
                }
              : {}),
            caller: opts.actionCaller ?? "tool",
            automation: opts.automation,
            networkProtocol: opts.networkProtocol,
            networkId: opts.networkId,
            networkPeer: opts.networkPeer,
            delegationDepth: opts.delegationDepth,
            visitedApps: opts.visitedApps,
            attachments: opts.attachments,
            signal,
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
                const zombieResultForAgent = zombieMcp
                  ? zombieMcp.text
                  : extractAgentImagesFromActionResult(zombieRaw).value;
                const zombieStr =
                  typeof zombieResultForAgent === "string"
                    ? zombieResultForAgent
                    : JSON.stringify(zombieResultForAgent, null, 2);
                const zombieArtifacts = detectArtifactReceipts(
                  zombieResultForAgent,
                  toolCall.name,
                );
                void writeLedgerEntry(
                  ledgerThreadId,
                  ledgerToolKey,
                  zombieStr,
                  zombieArtifacts,
                );
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
          let resultForAgent: unknown = rawForAgent;
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
          toolArtifacts = detectArtifactReceipts(resultForAgent, toolCall.name);
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
          if (signal.aborted) {
            result = INTERRUPTED_TOOL_RESULT_MARKER;
          } else if (isAgentConnectionRequiredError(err)) {
            const message =
              sanitizeToolErrorValue(err.message) ||
              `Connect ${err.provider} to continue.`;
            result = sanitizeToolErrorValue(err.toolResult || message);
            requestedConnection ??= {
              requestId: randomUUID(),
              provider: err.provider,
              reason: err.reason,
              appId: err.appId,
              detail: message,
              source: err.source,
            };
            turnYieldedToUser = true;
            requestedActionStop ??= {
              message,
              errorCode: "connection-required",
            };
          } else if (isAgentActionStopError(err)) {
            const message =
              sanitizeToolErrorValue(err.message) ||
              `Stopped after ${toolCall.name} failed.`;
            result = sanitizeToolErrorValue(err.toolResult || message);
            directStop = {
              message,
              explicit: err.errorCode === "permanent_precondition",
            };
            if (!directStop.explicit && !permanentPreconditionRemedy(message)) {
              requestedActionStop ??= {
                message,
                ...(err.errorCode ? { errorCode: err.errorCode } : {}),
              };
            }
          } else {
            const message = sanitizeToolErrorValue(err);
            const errorCode =
              isActionContractError(err) && err.errorCode !== "action_failed"
                ? ` (errorCode: ${err.errorCode})`
                : "";
            result = `Error running ${toolCall.name}: ${message}${errorCode}${rateLimitRecoveryHint(message)}`;
          }
          isError = true;
        }
        if (isError) {
          if (result !== INTERRUPTED_TOOL_RESULT_MARKER) {
            result = finalizeToolErrorResult(result);
          }
        } else {
          fileMutation = actionEntry.fileMutationProof?.(toolCall.input);
        }

        const agentWarnings = drainAgentWarnings();
        if (agentWarnings.length > 0) {
          result = `${result}\n\n${formatAgentWarningsForToolResult(agentWarnings)}`;
        }

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
          ...(fileMutation ? { fileMutation } : {}),
          ...(toolArtifacts.length > 0 ? { artifacts: toolArtifacts } : {}),
        });
        recordToolResult(result, isError, toolArtifacts);
        if (!isError) {
          noteToolCallSucceeded(actionEntry);
          if (cacheKey) {
            readOnlyToolResultCache.set(cacheKey, {
              content: result,
              ...(toolResultImages?.length ? { images: toolResultImages } : {}),
            });
          } else if (actionEntry.readOnly !== true) {
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
      if (!entry) return null;
      if (entry.needsApproval !== undefined || entry.endsTurn === true) {
        return null;
      }
      if (entry.readOnly === true) return "read";
      if (entry.parallelSafe === true) return "parallel-write";
      return null;
    };

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

    const skipToolCallAfterYield = (
      toolCall: import("./engine/types.js").EngineToolCallPart,
    ): EngineContentPart => {
      const result =
        `Not executed: ${toolCall.name} was called after an action that paused the turn ` +
        `(an action that ends the turn, or one waiting on the user's approval). ` +
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
      const stop = requestedActionStop as TerminalActionStop;
      terminalActionStop = stop;
      if (requestedConnection) {
        send({ type: "connection_required", ...requestedConnection });
      } else {
        sendTerminalActionStop(stop);
      }
      break;
    }
  }

  if (tripwire) {
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
      code: terminalActionStop?.errorCode ?? "guardrail",
      retryable: false,
      message: terminalTripwire.message,
    });
    return usage;
  }

  if (!signal.aborted && !endedAtLoopLimit && !terminalActionStop) {
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
    if (opts.threadId) {
      void clearLedgerForThread(opts.threadId).catch(() => {});

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
        const waitUntil = getRequestRunContext()?.waitUntil;
        if (waitUntil) waitUntil(compaction);
        else void compaction;
      }
    }
  }

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
  } else if (finalTerminalActionStop?.errorCode === "connection-required") {
    reportOutcome({
      state: "input_required",
      code: "connection_required",
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
  if (event.recoverable === false) return false;
  return (
    event.recoverable === true ||
    code === "builder_gateway_timeout" ||
    code === "builder_gateway_network_error" ||
    code === "builder_gateway_stream_ended" ||
    code === "provider_network_error" ||
    code === "stale_run" ||
    code === "timeout" ||
    code === "timeout_error" ||
    code === "http_408" ||
    code === "http_429" ||
    code === "rate_limited" ||
    code === PROVIDER_TRANSIENT_REJECTION_ERROR_CODE ||
    code === "http_500" ||
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
      new EngineError(last.error, {
        errorCode: last.errorCode,
        providerRetryable: last.providerRetryable,
      }),
    );
  }
  if (
    endsAfterToolResultWithoutAssistantFinal(run) ||
    endsDuringActionPreparation(run)
  ) {
    return "stream_ended";
  }
  return "run_timeout";
}

export async function runAgentLoopWithMainChatInternalContinuations(
  opts: Parameters<typeof runAgentLoop>[0] & {
    resumeResumableErrorsInProcess?: boolean;
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
    engineName: opts.engine.name,
    model: opts.model,
  };
  const addUsage = (next: Awaited<ReturnType<typeof runAgentLoop>>) => {
    usage.inputTokens += next.inputTokens;
    usage.outputTokens += next.outputTokens;
    usage.cacheReadTokens += next.cacheReadTokens;
    usage.cacheWriteTokens += next.cacheWriteTokens;
    if (next.builderCreditsUsed !== undefined) {
      usage.builderCreditsUsed =
        (usage.builderCreditsUsed ?? 0) + next.builderCreditsUsed;
    }
    usage.engineName = next.engineName ?? usage.engineName;
    usage.model = next.model;
    if (typeof next.llmCalls === "number") {
      usage.llmCalls = (usage.llmCalls ?? 0) + next.llmCalls;
    }
    if (next.usageReported) usage.usageReported = true;
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
      if (opts.signal.aborted || !isResumableEngineError(err)) throw err;
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
    endsAfterToolResultWithoutAssistantFinal(run) ||
    endsDuringActionPreparation(run)
  );
}

function chunkMadeForwardProgress(run: ActiveRun): boolean {
  return run.events.some(
    ({ event }) =>
      (event.type === "text" && event.text.trim().length > 0) ||
      event.type === "tool_start" ||
      event.type === "tool_done",
  );
}

export interface BackgroundNoProgressRepeat {
  errorCode?: string;
  count: number;
  tripped: boolean;
}

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

export function rateLimitChainCapTripped(opts: {
  run: ActiveRun;
  priorContinuationReason?: string;
}): boolean {
  return (
    opts.priorContinuationReason === "rate_limited" &&
    backgroundContinuationReasonForRun(opts.run) === "rate_limited"
  );
}

export const PROVIDER_RATE_LIMITED_TERMINAL_MESSAGE =
  "The AI provider is rate limiting requests right now. Wait a minute and try again.";

export function rateLimitChainCapTerminalEvent(
  run: ActiveRun,
): Extract<AgentChatEvent, { type: "error" }> | null {
  const last = run.events.at(-1)?.event;
  if (last?.type !== "error") return null;
  return {
    ...last,
    error: PROVIDER_RATE_LIMITED_TERMINAL_MESSAGE,
    errorCode: PROVIDER_RATE_LIMITED_ERROR_CODE,
    recoverable: false,
  };
}

export function installRateLimitChainCapTerminalEvent(run: ActiveRun): boolean {
  const terminalEvent = rateLimitChainCapTerminalEvent(run);
  const lastRunEvent = run.events.at(-1);
  if (!terminalEvent || lastRunEvent?.event.type !== "error") return false;
  run.events = [
    ...run.events.slice(0, -1),
    { ...lastRunEvent, event: terminalEvent },
  ];
  run.continuationTerminalEvent = terminalEvent;
  return true;
}

export function shouldChainBackgroundContinuation(opts: {
  isBackgroundWorker: boolean;
  run: ActiveRun;
  continuationCount: number;
  foregroundSelfChainEligible?: boolean;
  dispatchedToBackground?: boolean;
  priorNoProgressErrorCode?: string;
  priorNoProgressCount?: number;
  priorContinuationReason?: string;
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
    }).tripped &&
    !rateLimitChainCapTripped({
      run: opts.run,
      priorContinuationReason: opts.priorContinuationReason,
    })
  );
}

export const SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS = 8_000;

export interface SelfChainContinuationBudget {
  skipToBoundary: boolean;
  softTimeoutMs: number;
}

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

export function resolvePresendWithCap<T>(opts: {
  enabled: boolean;
  thunk: () => Promise<T>;
  fallback: T;
  timeoutMs: number;
  onTimeout?: () => void;
}): Promise<T> {
  if (!opts.enabled) return opts.thunk();
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      opts.onTimeout?.();
      resolve(opts.fallback);
    }, opts.timeoutMs);
    void Promise.resolve()
      .then(opts.thunk)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          resolve(opts.fallback);
        },
      );
  });
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

  let preclaimHeartbeatInFlight = false;
  let preclaimHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const preclaimHeartbeatStartedAt = Date.now();
  const heartbeatWhileUnclaimed = () => {
    if (
      Date.now() - preclaimHeartbeatStartedAt >=
      BACKGROUND_PRECLAIM_HEARTBEAT_MAX_MS
    ) {
      stopPreclaimHeartbeat();
      return;
    }
    if (preclaimHeartbeatInFlight) return;
    preclaimHeartbeatInFlight = true;
    void heartbeat(opts.runId)
      .catch(() => {})
      .finally(() => {
        preclaimHeartbeatInFlight = false;
      });
  };
  const stopPreclaimHeartbeat = () => {
    if (preclaimHeartbeatTimer !== undefined) {
      clearInterval(preclaimHeartbeatTimer);
      preclaimHeartbeatTimer = undefined;
    }
  };

  preclaimHeartbeatTimer = setInterval(
    heartbeatWhileUnclaimed,
    BACKGROUND_PRECLAIM_HEARTBEAT_MS,
  );
  heartbeatWhileUnclaimed();
  try {
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
    stopPreclaimHeartbeat();
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
  } finally {
    stopPreclaimHeartbeat();
  }
}

/**
 * Request-body field carrying the turn's running input-token total across
 * chunks. It rides the BODY (not the background-run marker) because the marker
 * is stripped from `continuationBody` on every handoff while the body is the
 * successor's persisted rehydration payload.
 */
export const AGENT_CHAT_TURN_INPUT_TOKENS_FIELD =
  "__agentNativeTurnInputTokens";

export const AGENT_CHAT_PRIOR_CONTINUATION_REASON_FIELD =
  "__agentNativePriorContinuationReason";

export const AGENT_CHAT_PRIOR_NO_PROGRESS_ERROR_CODE_FIELD =
  "__agentNativePriorNoProgressErrorCode";
export const AGENT_CHAT_PRIOR_NO_PROGRESS_COUNT_FIELD =
  "__agentNativePriorNoProgressCount";

export function resolvePriorContinuationState(
  backgroundRunMarker: Record<string, unknown> | null | undefined,
  body: Record<string, unknown>,
): {
  continuationReason: string | undefined;
  noProgressErrorCode: string | undefined;
  noProgressCount: number;
} {
  const continuationReason =
    typeof backgroundRunMarker?.continuationReason === "string"
      ? backgroundRunMarker.continuationReason
      : typeof body[AGENT_CHAT_PRIOR_CONTINUATION_REASON_FIELD] === "string"
        ? (body[AGENT_CHAT_PRIOR_CONTINUATION_REASON_FIELD] as string)
        : undefined;
  const noProgressErrorCode =
    typeof backgroundRunMarker?.noProgressErrorCode === "string"
      ? backgroundRunMarker.noProgressErrorCode
      : typeof body[AGENT_CHAT_PRIOR_NO_PROGRESS_ERROR_CODE_FIELD] === "string"
        ? (body[AGENT_CHAT_PRIOR_NO_PROGRESS_ERROR_CODE_FIELD] as string)
        : undefined;
  const noProgressCountSource =
    typeof backgroundRunMarker?.noProgressCount === "number" &&
    Number.isFinite(backgroundRunMarker.noProgressCount)
      ? backgroundRunMarker.noProgressCount
      : body[AGENT_CHAT_PRIOR_NO_PROGRESS_COUNT_FIELD];
  const noProgressCount =
    typeof noProgressCountSource === "number" &&
    Number.isFinite(noProgressCountSource)
      ? Math.max(0, Math.floor(noProgressCountSource))
      : 0;
  return { continuationReason, noProgressErrorCode, noProgressCount };
}

export function resolvePriorContinuationReason(
  backgroundRunMarker: Record<string, unknown> | null | undefined,
  body: Record<string, unknown>,
): string | undefined {
  return resolvePriorContinuationState(backgroundRunMarker, body)
    .continuationReason;
}

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

export interface ContinuationDispatchBudget {
  maxDispatchAttempts: number;
  dispatchResponseTimeoutMs: number;
  backoffCapMs: number;
}

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

export function isLoopProtectionDispatchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\bHTTP\s*508\b/i.test(err.message);
}

export const MAX_NESTED_SELF_DISPATCH_DEPTH = 6;

export async function chainServerDrivenContinuation(opts: {
  event: unknown;
  run: ActiveRun;
  effectiveThreadId: string;
  effectiveTurnId: string;
  requestBody: Record<string, unknown>;
  backgroundContinuationCount: number;
  noProgressRepeat?: BackgroundNoProgressRepeat;
  /**
   * Input tokens this logical turn has consumed across every chunk so far,
   * carried on the successor's body so the per-turn token ceiling is a real
   * turn budget instead of a fresh allowance per chunk.
   */
  turnInputTokens?: number;
  chainViaDurableBackground: boolean;
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

  if (turnRunCount === null) {
    await stopTurn(
      "turn_budget_unreadable",
      `turn ${effectiveTurnId} run-count ledger unreadable — refusing to chain further`,
      `I stopped because I could not verify this request's continuation budget.`,
    );
    return;
  }
  if (turnRunLedgerExhausted(turnRunCount)) {
    await stopTurn(
      "turn_continuation_budget_exhausted",
      `turn ${effectiveTurnId} consumed ${turnRunCount} runs — refusing to chain further`,
      `I stopped after ${turnRunCount} internal continuations without finishing this request.`,
    );
    return;
  }

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
  const continuationBody: Record<string, unknown> = {
    ...opts.requestBody,
    internalContinuation: true,
    ...(typeof opts.turnInputTokens === "number"
      ? { [AGENT_CHAT_TURN_INPUT_TOKENS_FIELD]: opts.turnInputTokens }
      : {}),
    [AGENT_CHAT_PRIOR_CONTINUATION_REASON_FIELD]: continuationReason,
    ...(opts.noProgressRepeat?.errorCode
      ? {
          [AGENT_CHAT_PRIOR_NO_PROGRESS_ERROR_CODE_FIELD]:
            opts.noProgressRepeat.errorCode,
          [AGENT_CHAT_PRIOR_NO_PROGRESS_COUNT_FIELD]:
            opts.noProgressRepeat.count,
        }
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
        const deferralClassification = nestedDepthExceeded
          ? "proactive_depth_cap"
          : isLoopProtectionDispatchError(lastDispatchErr)
            ? "netlify_loop_protection"
            : "dispatch_budget_exhausted";
        // THREE-SITE INVARIANT (keep in lockstep — a future reader must not
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
  const configuredModel = options.model;

  const resolvedActions = options.actions ?? options.scripts ?? {};

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
      parentId,
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
    if (requestEngine !== undefined && typeof requestEngine !== "string") {
      setResponseStatus(event, 400);
      return { error: "engine must be a string" };
    }
    const requestParentId =
      parentId === null
        ? null
        : typeof parentId === "string" && parentId.trim()
          ? parentId.trim()
          : undefined;
    setupMark("bodyParsed");

    const backgroundRunMarker =
      preInjectedBody &&
      body[AGENT_CHAT_BACKGROUND_RUN_FIELD] &&
      typeof body[AGENT_CHAT_BACKGROUND_RUN_FIELD] === "object" &&
      typeof body[AGENT_CHAT_BACKGROUND_RUN_FIELD]!.runId === "string"
        ? body[AGENT_CHAT_BACKGROUND_RUN_FIELD]!
        : null;
    const isBackgroundWorker = backgroundRunMarker !== null;
    if (!isBackgroundWorker) {
      delete body[AGENT_CHAT_BACKGROUND_RUN_FIELD];
      delete body.__resolvedActionSurface;
    }
    let requestedActionScope: AgentActionScope | undefined;
    if (hasOwn(body, "actionScope")) {
      try {
        requestedActionScope = normalizeAgentActionScope(body.actionScope);
        body.actionScope = requestedActionScope;
      } catch (error) {
        setResponseStatus(event, 400);
        return {
          error: error instanceof Error ? error.message : "Invalid actionScope",
        };
      }
    }
    if (requestedActionScope && !options.resolveActionSurface) {
      setResponseStatus(event, 400);
      return { error: "actionScope requires resolveActionSurface" };
    }
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
    const runsInBackgroundFunction =
      isBackgroundWorker &&
      shouldUseBackgroundFunctionTimeoutForWorker(backgroundRunMarker);
    const backgroundRuntimeDetail = isBackgroundWorker
      ? backgroundRuntimeDiagnosticDetail(backgroundRunMarker)
      : "";
    const backgroundContinuationCount =
      isBackgroundWorker &&
      typeof backgroundRunMarker?.continuationCount === "number" &&
      Number.isFinite(backgroundRunMarker.continuationCount)
        ? Math.max(0, Math.floor(backgroundRunMarker.continuationCount))
        : 0;
    const priorContinuationState = resolvePriorContinuationState(
      backgroundRunMarker,
      body as unknown as Record<string, unknown>,
    );
    const priorNoProgressErrorCode = priorContinuationState.noProgressErrorCode;
    const priorNoProgressCount = priorContinuationState.noProgressCount;
    const priorContinuationReason = priorContinuationState.continuationReason;
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
    const requestBrowserTabId =
      normalizeBrowserTabId(browserTabId) ??
      normalizeBrowserTabId(getRequestRunContext()?.browserTabId);
    const requestChatScope = normalizeChatScope(scope);
    const requestRunCtx = ensureRequestRunContext();
    if (requestRunCtx) {
      requestRunCtx.browserTabId = requestBrowserTabId;
      requestRunCtx.chatScope = requestChatScope;
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
    const requestContext = buildRecentUserRequestContext({
      request: requestMessage,
      history,
      structuredHistory,
    });

    const ownerEmail = await resolveAgentOwnerEmail(options, event);
    const contextPrefetchDeadlineAt = Date.now() + 1_300;
    const preparedRequest = await options.prepareRequest?.({
      event,
      ownerEmail,
      message: requestMessage,
      displayMessage: requestDisplayMessage,
      attachments: requestAttachments,
      references,
      threadId,
      requestContext,
      contextPrefetchDeadlineAt,
      internalContinuation: Boolean(internalContinuation),
      dispatchToBackground,
      isBackgroundWorker,
      mode: requestMode,
    });
    let jevPromptCandidates: JevPromptContextCandidate[] = [];
    let jevFallbackCandidateIds: string[] = [];
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
      if (Array.isArray(preparedRequest.jevPromptCandidates)) {
        jevPromptCandidates = preparedRequest.jevPromptCandidates;
      }
      if (Array.isArray(preparedRequest.jevFallbackCandidateIds)) {
        jevFallbackCandidateIds = preparedRequest.jevFallbackCandidateIds;
      }
    }
    const jevRequestContext = buildJevRequestContext({
      request: requestMessage,
      history,
      structuredHistory,
    });
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
    let shouldFilterInitialRequestTools = !options.resolveActionSurface;
    if (options.resolveActionSurface) {
      const persistedSurface = isBackgroundWorker
        ? readPersistedActionSurface(body, "__resolvedActionSurface")
        : undefined;
      if (
        isBackgroundWorker &&
        requestedActionScope &&
        (!persistedSurface || !("actionScope" in persistedSurface))
      ) {
        setResponseStatus(event, 400);
        return { error: "Resolved actionScope is required for continuation" };
      }
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
              ...(typeof requestTurnId === "string" && requestTurnId.trim()
                ? { requestedTurnId: requestTurnId.trim() }
                : {}),
              ...(typeof queuedMessageId === "string" && queuedMessageId.trim()
                ? { queuedMessageId: queuedMessageId.trim() }
                : {}),
              ...(requestedActionScope
                ? { actionScope: requestedActionScope }
                : {}),
              availableActionNames: Object.keys(availableRequestActions),
            });
      const normalizedSurface = normalizeAgentActionSurfaceResolution(surface);
      shouldFilterInitialRequestTools =
        normalizedSurface.mode === "default" || !normalizedSurface.actionScope;
      if (
        requestedActionScope &&
        (normalizedSurface.mode === "default" || !normalizedSurface.actionScope)
      ) {
        throw new Error(
          "resolveActionSurface must return actionScope for a scoped request",
        );
      }
      const runCtx = ensureRequestRunContext();
      if (normalizedSurface.mode === "default") {
        if (runCtx) {
          delete runCtx.allowedActionNames;
          delete runCtx.actionScope;
        }
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
        if (runCtx) {
          runCtx.allowedActionNames = allowedNames;
          if (normalizedSurface.actionScope) {
            runCtx.actionScope = normalizedSurface.actionScope;
          } else {
            delete runCtx.actionScope;
          }
        }
        if (!isBackgroundWorker) {
          body.__resolvedActionSurface = {
            orgId: getRequestOrgId() ?? null,
            allowedActionNames: allowedNames,
            ...(normalizedSurface.actionScope
              ? { actionScope: normalizedSurface.actionScope }
              : {}),
          };
        }
      }
    }
    workerStep("db_request_ctx");

    workerStep("attach_start");
    if (
      hasAttachments &&
      requestAttachments.some(
        (a) =>
          a.displayOnly !== true &&
          (a.type === "image" || a.type === "file" || a.type === "document"),
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
    workerStep("attach_done");

    workerStep("apikey_start");
    const engineOption = requestEngine ?? options.engine;
    const {
      apiKey: effectiveApiKey,
      apiKeyEnvVar: effectiveApiKeyEnvVar,
      credentialProvenance: apiKeyProvenance,
    } = await resolveOwnerEngineApiKey({
      engineOption,
      ownerEmail,
      anthropicFallback:
        options.apiKey ?? readDeployCredentialEnv("ANTHROPIC_API_KEY"),
    });
    workerStep("apikey_done");

    // DIAGNOSTIC-ONLY: bracket engine resolution (Builder credential / app-default
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
        apiKeyProvenance,
        model: configuredModel,
        appId: options.appId,
        credentialIdentity,
      });
    } catch (error) {
      if (error instanceof CredentialEndpointMismatchError) throw error;
      engine = await resolveEngine({
        apiKey: effectiveApiKey,
        apiKeyEnvVar: effectiveApiKeyEnvVar,
        apiKeyProvenance,
        appId: options.appId,
        credentialIdentity,
      });
    }
    workerStep("engine_done");

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
    workerStep("model_done");
    const model = normalizeModelForEngine(engine, modelCandidate);
    let effectiveModel = model;
    let modelSelectionSource: AgentModelSelectionSource | "experiment" =
      modelSelection.source;
    const turnUsageLabel = normalizeUsageLabel(body.usageLabel);
    let experimentAssignments: Array<{
      experimentId: string;
      variantId: string;
    }> = [];

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
    workerStep("env_config");
    const enrichedMessageThunk = () =>
      enrichMessage(requestMessage, references);
    const loopSettingsThunk = () =>
      readAgentLoopSettings({
        userEmail: ownerEmail ?? getRequestUserEmail() ?? null,
        orgId: getRequestOrgId() ?? null,
      }).catch(() => readAgentLoopSettings({}));

    let systemPromptError: Error | null = null;
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
          systemPromptError =
            error instanceof Error
              ? error
              : new Error(
                  typeof error === "string" && error.trim()
                    ? error
                    : "system prompt preparation failed",
                );
          return "";
        } finally {
          setupMarks.sysPromptMs = Date.now() - sysPromptStart;
        }
      })();

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
              isWorkspaceResourceOwner,
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
                const scope = isWorkspaceResourceOwner(r.owner)
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

    const presendCap = <T>(
      label: string,
      thunk: () => Promise<T>,
      fallback: T,
      ms: number,
      onTimeout?: () => void,
    ): Promise<T> => {
      return resolvePresendWithCap({
        enabled: isBackgroundWorker,
        thunk,
        fallback,
        timeoutMs: ms,
        onTimeout: () => {
          onTimeout?.();
          workerStep(`presend_timeout:${label}`);
        },
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
    const systemPromptTimeoutError = new Error(
      "system prompt preparation timed out before the agent could start",
    );
    let [
      systemPrompt,
      timeBlock,
      screenBlock,
      urlBlock,
      selectionBlock,
      filesContext,
      loopSettings,
      enrichedMessage,
      jevContextCredentials,
    ] = await Promise.all([
      presendCap("systemPrompt", systemPromptThunk, "", 13000, () => {
        // late rejection/success cannot race the check below.
        systemPromptError ??= systemPromptTimeoutError;
      }),
      presendCap("time", timeContextThunk, "", 9000),
      presendCap("screen", screenContextThunk, "", 9000),
      presendCap("url", urlContextThunk, "", 9000),
      presendCap("selection", selectionContextThunk, "", 9000),
      presendCap("files", filesContextThunk, "", 12000),
      presendCap("loopSettings", loopSettingsThunk, fallbackLoopSettings, 9000),
      presendCap("enrichedMessage", enrichedMessageThunk, requestMessage, 9000),
      presendCap(
        "jevContextCredentials",
        () => getJevContextCredentials(ownerEmail ?? getRequestUserEmail()),
        { apiKey: undefined, personalApiKey: undefined, builderAuth: null },
        9000,
      ),
    ]);
    setupMark("ctxAll");
    workerStep("context_all");

    if (systemPromptError) {
      if (isBackgroundWorker) throw systemPromptError;
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      const encoder = new TextEncoder();
      const err = systemPromptError as Error;
      return new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: `Failed to load system prompt: ${err.message}` })}\n\n`,
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
    const initialRequestTools = shouldFilterInitialRequestTools
      ? filterInitialEngineTools(
          availableRequestTools,
          options.initialToolNames,
        )
      : availableRequestTools;
    const curatedRequestTools =
      requestMode === "plan"
        ? preloadPlanModeEngineTools({
            request: requestMessage,
            registry: requestActions,
            initialTools: initialRequestTools,
            availableTools: availableRequestTools,
          })
        : initialRequestTools;
    const jevContextMaxChars = options.jevContextCompact
      ? Math.max(
          0,
          COMPACT_PROMPT_RESOURCES_TOTAL_MAX_CHARS - systemPrompt.length - 2,
        )
      : undefined;
    const [requestTools, jevContext] = await Promise.all([
      preloadJevTools({
        request: jevRequestContext,
        skip: Boolean(internalContinuation || dispatchToBackground),
        deadlineAt: contextPrefetchDeadlineAt,
        apiKey: jevContextCredentials.apiKey,
        personalApiKey: jevContextCredentials.personalApiKey,
        builderAuth: jevContextCredentials.builderAuth,
        registry: requestActions,
        initialTools: curatedRequestTools,
        availableTools: availableRequestTools,
        readOnlyOnly: requestMode === "plan",
      }),
      preloadJevContextForPrompt({
        request: jevRequestContext,
        appId: options.appId,
        owner: ownerEmail ?? undefined,
        orgId: getRequestOrgId() ?? null,
        apiKey: jevContextCredentials.apiKey,
        personalApiKey: jevContextCredentials.personalApiKey,
        builderAuth: jevContextCredentials.builderAuth,
        compact: options.jevContextCompact,
        maxChars: jevContextMaxChars,
        contextPrefetchDeadlineAt,
        dispatchToBackground,
        internalContinuation: Boolean(internalContinuation),
        candidates: jevPromptCandidates,
        fallbackCandidateIds: jevFallbackCandidateIds,
      }),
    ]);
    if (jevContext) systemPrompt = `${systemPrompt}\n\n${jevContext}`;
    const contextXraySystemSections = [
      ...readContextXraySystemSections(event),
      ...(jevContext
        ? await buildSystemManifestSections([
            {
              label: "Jev-prefetched context",
              provenance: "runtime-context",
              governance: "inherited",
              content: jevContext,
              sourceRef: { scope: "jev" },
            },
          ])
        : []),
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
    workerStep("action_tool_setup");
    const requestSystemPrompt =
      requestMode === "plan"
        ? `${systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`
        : systemPrompt;

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
    const foregroundSelfChainEligible =
      !isBackgroundWorker &&
      !dispatchToBackground &&
      typeof threadId === "string" &&
      threadId.trim().length > 0 &&
      isAgentChatForegroundSelfChainEnabled();
    let foregroundRunRowInserted = false;

    if (threadId && !isBackgroundWorker) {
      if (
        typeof requestTurnId === "string" &&
        requestTurnId &&
        (await isTurnAborted(threadId, requestTurnId))
      ) {
        return { ok: true, stopped: true };
      }
      const slot = await tryClaimRunSlot(threadId, runId, undefined, {
        turnId: effectiveTurnId,
        replayCompletedTurn:
          typeof requestTurnId === "string" &&
          Boolean(requestTurnId.trim()) &&
          !requestedApprovedToolCalls,
        dispatchMode: dispatchToBackground
          ? "background"
          : foregroundSelfChainEligible
            ? "foreground-self-chain"
            : "foreground",
        ...(dispatchToBackground
          ? { dispatchPayload: JSON.stringify(body) }
          : {}),
      });
      if (slot.turnAborted) {
        return { ok: true, stopped: true };
      }
      if (slot.completedRunId) {
        const stream = await replayCompletedTurn(threadId, effectiveTurnId);
        if (!stream) {
          setResponseStatus(event, 500);
          return { error: "Failed to replay completed agent run" };
        }
        setResponseHeader(event, "Content-Type", "text/event-stream");
        setResponseHeader(event, "Cache-Control", "no-cache");
        setResponseHeader(event, "Connection", "keep-alive");
        setResponseHeader(event, "X-Run-Id", slot.completedRunId);
        setResponseHeader(event, "X-Dispatch-Mode", "replay");
        return stream;
      }
      if (!slot.claimed) {
        setResponseStatus(event, 409);
        return {
          error: "Run already in progress for this thread",
          activeRunId: slot.activeRunId,
        };
      }
      foregroundRunRowInserted = true;
    }

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
      isToolAlwaysAllowed: async (binding: AgentApprovalBinding) => {
        if (!ownerEmail) return false;
        return isAgentToolAlwaysAllowed({
          ownerEmail,
          orgId: getRequestOrgId() ?? null,
          toolName: binding.toolName,
        });
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
    // the token ceiling bounds the TURN rather than resetting every chunk.
    const priorTurnInputTokensFromBody = Number(
      (body as unknown as Record<string, unknown>)[
        AGENT_CHAT_TURN_INPUT_TOKENS_FIELD
      ],
    );
    let turnInputTokens = Number.isFinite(priorTurnInputTokensFromBody)
      ? Math.max(0, priorTurnInputTokensFromBody)
      : 0;

    if (isChainedBackgroundContinuation && effectiveThreadId) {
      try {
        const { getThread } = await import("../chat-threads/store.js");
        const { threadDataToEngineMessages } =
          await import("./thread-data-builder.js");
        const priorThreadData = (await getThread(effectiveThreadId))
          ?.threadData;
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
        console.warn(
          `[agent-chat] history recovery failed for thread ${threadId}; continuing with no prior context:`,
          err,
        );
      }
    }
    setupMark("depsThread");
    workerStep("owner_thread");

    if (options.onRunPrepared && !internalContinuation && !isBackgroundWorker) {
      try {
        await options.onRunPrepared({
          runId,
          threadId,
          message: messageToPersist,
          attachments: requestAttachments,
          ...(typeof queuedMessageId === "string" && queuedMessageId.trim()
            ? { queuedMessageId: queuedMessageId.trim() }
            : {}),
        });
      } catch (error) {
        if (foregroundRunRowInserted) {
          const terminalized = await updateRunStatusIfRunning(runId, "errored");
          if (terminalized) {
            await setRunTerminalReason(runId, "run_preparation_failed");
          }
        }
        throw error;
      }
    }

    if (dispatchToBackground) {
      let backgroundRowInserted = foregroundRunRowInserted;
      if (!backgroundRowInserted) {
        try {
          await insertRun(runId, effectiveThreadId, effectiveTurnId, {
            dispatchMode: "background",
            dispatchPayload: JSON.stringify(body),
          });
          backgroundRowInserted = true;
        } catch (err) {
          console.error(
            "[agent-chat] background insertRun failed; falling back to inline:",
            err instanceof Error ? err.message : err,
          );
        }
      }

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
          path: backgroundDispatchPath,
          taskId: runId,
          ...(expectsNetlifyBackgroundFunction
            ? { awaitResponse: true, responseTimeoutMs: 5_000 }
            : {}),
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

      const backgroundOutcome = await resolveBackgroundDispatchOutcome({
        dispatched,
        backgroundRowInserted,
        runId,
        graceMs: BACKGROUND_CLAIM_GRACE_MS,
        reaperGraceMs: UNCLAIMED_BACKGROUND_RUN_GRACE_MS,
        pollIntervalMs: BACKGROUND_CLAIM_POLL_MS,
        readClaim: readBackgroundRunClaim,
        claim: claimBackgroundRun,
        streamWhenWorkerAlive: true,
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

      if (backgroundOutcome.reason === "worker-never-claimed") {
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
        priorContinuationReason,
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

    const handleRunComplete =
      isBackgroundWorker || foregroundSelfChainEligible || baseHandleRunComplete
        ? async (run: ActiveRun) => {
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
            if (rateLimitChainCapTripped({ run, priorContinuationReason })) {
              installRateLimitChainCapTerminalEvent(run);
            } else if (noProgressRepeat.tripped) {
              installBackgroundNoProgressTerminalEvent(run, noProgressRepeat);
            }

            await baseHandleRunComplete?.(run);

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
            } else if (
              rateLimitChainCapTripped({ run, priorContinuationReason })
            ) {
              if (run.continuationTerminalEvent?.type === "error") {
                console.error(
                  `[agent-chat] stopping background chain: rate-limit cap reached ` +
                    `(second consecutive rate-limited chunk)`,
                  run.runId,
                );
                await recordRunDiagnostic(
                  run.runId,
                  RUN_DIAG_STAGE.workerThrew,
                  `chain_stopped_rate_limited`,
                ).catch(() => {});
              }
            } else if (willChainBackgroundContinuation(run)) {
              await chainServerDrivenContinuation({
                event,
                run,
                effectiveThreadId,
                effectiveTurnId,
                requestBody: body as unknown as Record<string, unknown>,
                backgroundContinuationCount,
                noProgressRepeat,
                turnInputTokens,
                chainViaDurableBackground:
                  isAgentChatDurableBackgroundEnabled({
                    appOptIn: options.durableBackgroundRuns,
                  }) && !runsInBackgroundFunction,
                workerProvenInBackgroundFunction: runsInBackgroundFunction,
              });
            }
          }
        : undefined;

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

    setupMark("preStart");
    workerStep("prestart");
    const setupDetail =
      Object.entries(setupMarks)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ") +
      ` total=${Date.now() - setupT0}` +
      (backgroundRuntimeDetail ? ` ${backgroundRuntimeDetail}` : "") +
      firstRequestPayloadDetail;

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

    const resolvedRunSoftTimeoutMs = resolveRunSoftTimeoutMs(
      selfChainBudget && !selfChainBudget.skipToBoundary
        ? selfChainBudget.softTimeoutMs
        : options.runSoftTimeoutMs,
      {
        useHostedDefault: true,
        backgroundFunction: runsInBackgroundFunction,
      },
    );

    const startedRun = startRun(
      runId,
      effectiveThreadId,
      async (rawSend, signal) => {
        const send = (event: AgentChatEvent) => {
          rawSend(event);
          updateTrackedProgressFromEvent(event);
        };

        if (selfChainBudget?.skipToBoundary) {
          await recordRunDiagnostic(
            runId,
            RUN_DIAG_STAGE.workerSetupStep,
            `self_chain_budget_exhausted elapsed=${Date.now() - setupT0}ms`,
          ).catch(() => {});
          send({ type: "auto_continue", reason: "run_timeout" });
          return;
        }

        send({ type: "activity", label: "Starting agent" });

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

        if (options.onRunStart) {
          await options.onRunStart(send, threadId ?? runId, runId);
        }

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
                  ...(resolvedRunSoftTimeoutMs > 0
                    ? { runSoftTimeoutMs: resolvedRunSoftTimeoutMs }
                    : {}),
                });

                try {
                  const ownerEmail = options.resolveOwnerEmail
                    ? await options.resolveOwnerEmail(event)
                    : getRequestUserEmail();
                  if (!ownerEmail) {
                    return;
                  }
                  const { recordUsage } = await import("../usage/store.js");
                  await recordUsage({
                    ownerEmail,
                    inputTokens: subUsage.inputTokens,
                    outputTokens: subUsage.outputTokens,
                    cacheReadTokens: subUsage.cacheReadTokens,
                    cacheWriteTokens: subUsage.cacheWriteTokens,
                    builderCreditsUsed: subUsage.builderCreditsUsed,
                    engineName: engine.name,
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
          engineName: engine.name,
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
            if (usage.builderCreditsUsed !== undefined) {
              turnUsage.builderCreditsUsed =
                (turnUsage.builderCreditsUsed ?? 0) + usage.builderCreditsUsed;
            }
            turnUsage.engineName = usage.engineName ?? turnUsage.engineName;
            turnUsage.model = usage.model;
          },
          ownerEmail,
          orgId: getRequestOrgId() ?? null,
          ...(options.appId && getRequestOrgId()
            ? { appAuthorization: getRequestRunContext()?.appAuthorization }
            : {}),
          attachments: requestAttachments,
          reasoningEffort,
          maxOutputTokens: resolveMainChatMaxOutputTokens(effectiveModel),
          providerOptions: options.providerOptions,
          executionMode: requestMode,
          maxIterations: loopSettings.maxIterations,
          maxRunInputTokens: loopSettings.maxRunInputTokens,
          priorTurnInputTokens: turnInputTokens,
          finalResponseGuard: options.finalResponseGuard,
          finalResponseGuardRequestText: messageToPersist,
          ...(resolvedRunSoftTimeoutMs > 0
            ? { runSoftTimeoutMs: resolvedRunSoftTimeoutMs }
            : {}),
          ...(options.toolLimits ? { toolLimits: options.toolLimits } : {}),
          ...(threadId
            ? { threadId: effectiveThreadId, turnId: effectiveTurnId }
            : {}),
          ...(approvedToolCallsForExecution
            ? { approvedToolCalls: approvedToolCallsForExecution }
            : {}),
          onApprovalRequired: approvalHooks.onApprovalRequired,
          consumeApproval: approvalHooks.consumeApproval,
          isToolAlwaysAllowed: approvalHooks.isToolAlwaysAllowed,
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
              appId: options.appId,
              threadId: effectiveThreadId,
              turnId: effectiveTurnId,
              approvedToolCalls: approvedToolCallsForExecution,
              onApprovalRequired: approvalHooks.onApprovalRequired,
              consumeApproval: approvalHooks.consumeApproval,
              isToolAlwaysAllowed: approvalHooks.isToolAlwaysAllowed,
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
                spanName:
                  turnUsageLabel && turnUsageLabel !== "chat"
                    ? `agent_run:${turnUsageLabel}`
                    : undefined,
                metadata: {
                  modelSelectionSource,
                  ...(turnUsageLabel ? { label: turnUsageLabel } : {}),
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
            if (instrumented) throw err;
          }
          if (!instrumented) {
            await runAgentLoopWithMainChatInternalContinuations(agentLoopOpts);
          }
        } finally {
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
                turnUsage.cacheWriteTokens > 0 ||
                turnUsage.builderCreditsUsed != null)
            ) {
              const { recordUsage } = await import("../usage/store.js");
              await recordUsage({
                ownerEmail: resolvedOwnerEmail,
                inputTokens: turnUsage.inputTokens,
                outputTokens: turnUsage.outputTokens,
                cacheReadTokens: turnUsage.cacheReadTokens,
                cacheWriteTokens: turnUsage.cacheWriteTokens,
                builderCreditsUsed: turnUsage.builderCreditsUsed,
                engineName: engine.name,
                model: turnUsage.model,
                label: turnUsageLabel || "chat",
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
        softTimeoutMs: resolvedRunSoftTimeoutMs,
        useHostedSoftTimeoutDefault: true,
        backgroundFunction: runsInBackgroundFunction,
        noProgressTimeoutMs: options.runNoProgressTimeoutMs,
        turnId: effectiveTurnId,
        parentId: requestParentId,
        waitUntil: getRequestRunContext()?.waitUntil,
        dispatchMode: isBackgroundWorker
          ? "background"
          : foregroundSelfChainEligible
            ? "foreground-self-chain"
            : "foreground",
        runRowAlreadyInserted: foregroundRunRowInserted,
        // scope and is PII (email), which the terminal event must not carry.
        model: effectiveModel,
        engineName: engine.name,
        attemptCount: backgroundContinuationCount,
      },
    );

    if (isBackgroundWorker) {
      await startedRun.finalized;
      return { ok: true, runId };
    }

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
  abortTurnByRefDurably,
  abortTurnDurably,
  subscribeToRun,
};
