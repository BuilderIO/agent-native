import crypto from "node:crypto";

import { setResponseHeader, setResponseStatus } from "h3";

import {
  AGENT_BACKGROUND_PROCESSOR_A2A,
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  isAgentChatDurableBackgroundEnabled,
  resolveAgentChatProcessRunDispatchPath,
} from "../agent/durable-background.js";
import { uploadFile } from "../file-upload/registry.js";
import { trackingIdentityProperties } from "../observability/tracking-identity.js";
import { parseServiceIdentityEmail } from "../org/service-identity.js";
import {
  assertServicePrincipalMayRun,
  recordServicePrincipalDenial,
  ServicePrincipalRefusedError,
} from "../org/service-principal-guard.js";
import { findWorkspaceDispatchAgent } from "../server/agent-discovery.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { getOrigin, isConfiguredAppOrigin } from "../server/google-oauth.js";
import {
  DEFAULT_UPLOAD_MAX_FILE_BYTES,
  isAllowedUploadMimeType,
} from "../server/h3-helpers.js";
import { markExplicitPersonalOrgScope } from "../server/request-context.js";
import { fireInternalDispatch } from "../server/self-dispatch.js";
import { agentChat } from "../shared/agent-chat.js";
import { track } from "../tracking/registry.js";
import {
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
} from "./auth-policy.js";
import { callAction } from "./client.js";
import { sanitizeA2ACorrelationMetadata } from "./correlation.js";
import { assertA2APersistablePayload } from "./persistence-safety.js";
import {
  createTask,
  createOrReuseTask,
  getTask,
  getTaskOwnership,
  updateTask,
  claimA2ATaskForProcessing,
  getA2ATaskDispatchState,
  failStuckA2ATask,
  failStuckQueuedA2ATask,
  settleProcessingA2ATask,
  resetStuckA2ATaskForRetry,
  touchQueuedA2ATaskDispatch,
  touchProcessingA2ATask,
  pauseProcessingA2ATask,
  MAX_A2A_IDEMPOTENCY_KEY_CHARS,
  A2A_PERSONAL_OWNER_SCOPE,
  A2A_ORG_ID_OWNER_SCOPE_PREFIX,
} from "./task-store.js";
import type {
  A2ASourceContext,
  A2ASourceContextReference,
  A2AConfig,
  A2AHandler,
  A2AHandlerContext,
  A2AHandlerResult,
  JsonRpcResponse,
  Message,
  Artifact,
} from "./types.js";

const A2A_PROCESS_TASK_PATH = "/_agent-native/a2a/_process-task";
const PORTABLE_FALLBACK_HANDOFF_TIMEOUT_MS = 1_000;
const A2A_QUEUED_DISPATCH_STUCK_AFTER_MS = 10_000;
const A2A_PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;
const A2A_PROCESSING_HEARTBEAT_MS = 30_000;
const MAX_A2A_DIRECT_ACTION_NAME_CHARS = 200;
const MAX_A2A_DIRECT_ACTION_INPUT_BYTES = 64 * 1024;
const A2A_READ_INVOKE_EVENT = "$a2a_read_invoke";

function sourceContextReference(
  value: unknown,
): A2ASourceContextReference | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.platform !== "slack" ||
    typeof candidate.integrationTaskId !== "string"
  ) {
    return undefined;
  }
  const integrationTaskId = candidate.integrationTaskId;
  if (
    !integrationTaskId ||
    integrationTaskId !== integrationTaskId.trim() ||
    integrationTaskId.length > 200
  ) {
    return undefined;
  }
  return { platform: "slack", integrationTaskId };
}

function resolvedSlackSourceContext(
  value: unknown,
): A2ASourceContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.platform !== "slack" ||
    typeof candidate.sourceUrl !== "string"
  ) {
    return undefined;
  }
  const sourceUrl = candidate.sourceUrl;
  if (!sourceUrl || sourceUrl !== sourceUrl.trim()) return undefined;
  try {
    const parsed = new URL(sourceUrl);
    const isSlackHost =
      parsed.hostname === "slack.com" || parsed.hostname.endsWith(".slack.com");
    if (
      parsed.protocol !== "https:" ||
      !isSlackHost ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return undefined;
    }
    return { platform: "slack", sourceUrl };
  } catch {
    return undefined;
  }
}

async function trustedSourceContext(
  value: unknown,
  event: any,
): Promise<A2ASourceContext | undefined> {
  const verifiedEmail = event?.context?.__a2aVerifiedEmail as
    | string
    | undefined;
  const reference = sourceContextReference(value);
  if (
    !verifiedEmail ||
    event?.context?.__a2aAudienceVerified !== true ||
    !reference
  ) {
    return undefined;
  }

  const dispatch = await findWorkspaceDispatchAgent();
  if (!dispatch) return undefined;
  const orgDomain = event?.context?.__a2aOrgDomain as string | undefined;
  const verifiedOrgId = event?.context?.__a2aVerifiedOrgId as
    | string
    | undefined;
  let orgSecret: string | undefined;
  if (orgDomain) {
    const { resolveA2AOrganizationCredentialsByDomain } =
      await import("../org/context.js");
    const organization =
      await resolveA2AOrganizationCredentialsByDomain(orgDomain);
    if (!verifiedOrgId || organization?.orgId !== verifiedOrgId) {
      return undefined;
    }
    orgSecret = organization.secret;
  }

  try {
    const result = await callAction(
      dispatch.url,
      "resolve-integration-source-context",
      { integrationTaskId: reference.integrationTaskId },
      {
        userEmail: verifiedEmail,
        orgDomain,
        orgSecret,
        requestTimeoutMs: 5_000,
      },
    );
    if (result.status !== "completed") return undefined;
    return resolvedSlackSourceContext(JSON.parse(result.output));
  } catch {
    return undefined;
  }
}

function requestOriginFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const raw = metadata?.requestOrigin;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function requestOriginFromEvent(event: any): string | undefined {
  if (!event) return undefined;
  try {
    return requestOriginFromMetadata({
      requestOrigin: getOrigin(event as any),
    });
  } catch {
    return undefined;
  }
}

/**
 * Prefer the origin resolved from the receiving request. A distinct public
 * browser origin is allowed only when the receiver configured it explicitly;
 * arbitrary caller metadata must not steer links or service-token URLs.
 */
function requestOriginForContext(
  metadata: Record<string, unknown> | undefined,
  event: any,
): string | undefined {
  if (!event) return undefined;
  const receiverOrigin = requestOriginFromEvent(event);
  const metadataOrigin = requestOriginFromMetadata(metadata);
  if (
    metadataOrigin &&
    (metadataOrigin === receiverOrigin || isConfiguredAppOrigin(metadataOrigin))
  ) {
    return metadataOrigin;
  }
  return receiverOrigin;
}

function trustedA2AMetadata(
  metadata: Record<string, unknown> | undefined,
  event: any,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const trusted = { ...metadata };
  delete trusted.sourceContext;
  const requestOrigin = requestOriginForContext(metadata, event);
  if (requestOrigin) trusted.requestOrigin = requestOrigin;
  else delete trusted.requestOrigin;
  return trusted;
}

/**
 * Hard cap on how long a task may sit in submitted/working (never reaching
 * `processing`) before the dispatch-retry loop in
 * `refireStuckAsyncTaskIfNeeded` gives up and fails it. Without this, a
 * persistently failing dispatch (missing background function, bad A2A
 * secret, 404) throttles-and-retries forever — the queued bucket otherwise
 * has no terminal state. Override with A2A_QUEUED_LIFETIME_MAX_MS.
 */
function a2aQueuedLifetimeMaxMs(): number {
  const raw = Number(process.env.A2A_QUEUED_LIFETIME_MAX_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 3 * 60 * 1000;
}

function a2aProcessingLifetimeMaxMs(): number {
  const raw = Number(process.env.A2A_PROCESSING_LIFETIME_MAX_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 30 * 60 * 1000;
}

export function getA2ATaskRecoveryLimits() {
  return {
    queuedLifetimeMaxMs: a2aQueuedLifetimeMaxMs(),
    processingStuckAfterMs: A2A_PROCESSING_STUCK_AFTER_MS,
    processingLifetimeMaxMs: a2aProcessingLifetimeMaxMs(),
  };
}

async function fireProcessTaskDispatch(
  event: any,
  taskId: string,
  config: A2AConfig,
): Promise<void> {
  const backgroundPath = resolveAgentChatProcessRunDispatchPath();
  const useBackgroundWorker =
    isAgentChatDurableBackgroundEnabled({
      appOptIn: config.durableBackgroundRuns,
    }) && dispatchPathTargetsNetlifyBackgroundFunction(backgroundPath);

  if (!useBackgroundWorker) {
    await fireInternalDispatch({
      event,
      path: A2A_PROCESS_TASK_PATH,
      taskId,
    });
    return;
  }

  try {
    await fireInternalDispatch({
      event,
      path: backgroundPath,
      taskId,
      body: {
        [AGENT_BACKGROUND_PROCESSOR_FIELD]: AGENT_BACKGROUND_PROCESSOR_A2A,
      },
      awaitResponse: true,
    });
  } catch (backgroundError) {
    console.error(
      "[a2a] Durable background dispatch failed; falling back to portable processor:",
      backgroundError,
    );
    await fireInternalDispatch({
      event,
      path: A2A_PROCESS_TASK_PATH,
      taskId,
      awaitResponse: true,
      responseTimeoutMs: PORTABLE_FALLBACK_HANDOFF_TIMEOUT_MS,
    });
  }
}

export async function processA2ATaskFromQueue(
  taskId: string,
  config: A2AConfig,
  event?: any,
): Promise<void> {
  const claimed = await claimA2ATaskForProcessing(taskId);
  if (!claimed) {
    return;
  }

  const message = claimed.history?.[0];
  if (!message) {
    await settleProcessingA2ATask(taskId, {
      state: "failed",
      message: {
        role: "agent",
        parts: [{ type: "text", text: "Task is missing its inbound message" }],
      },
    });
    return;
  }

  const meta = (claimed.metadata ?? {}) as Record<string, unknown>;
  const processorMeta = (meta.__a2a_processor ?? {}) as Record<string, unknown>;
  const verifiedEmail = processorMeta.verifiedEmail as string | undefined;
  const identityAssurance =
    processorMeta.identityAssurance === "organization"
      ? "organization"
      : processorMeta.identityAssurance === "user"
        ? "user"
        : undefined;
  const orgDomainHint = processorMeta.orgDomainHint as string | undefined;
  const verifiedOrgId =
    typeof processorMeta.verifiedOrgId === "string"
      ? processorMeta.verifiedOrgId.trim()
      : undefined;
  let servicePrincipalAllowedActions: string[] | null | undefined;
  try {
    const admission = await assertServicePrincipalMayRun(
      verifiedEmail,
      verifiedOrgId,
    );
    if (parseServiceIdentityEmail(verifiedEmail)) {
      servicePrincipalAllowedActions = admission.allowedActions;
    }
  } catch (error) {
    if (!(error instanceof ServicePrincipalRefusedError)) throw error;
    if (error.statusCode === 503) {
      await resetStuckA2ATaskForRetry(taskId, Date.now());
      throw error;
    }
    if (error.statusCode !== 403) throw error;
    await recordServicePrincipalDenial({
      email: verifiedEmail,
      orgId: verifiedOrgId,
      actionName: "a2a:process-task",
      caller: "a2a",
      error,
    });
    await settleProcessingA2ATask(taskId, {
      state: "failed",
      message: {
        role: "agent",
        parts: [{ type: "text", text: error.message }],
      },
    });
    return;
  }
  const requestOrigin =
    requestOriginFromMetadata(processorMeta) ?? requestOriginFromEvent(event);
  const contextId =
    (processorMeta.contextId as string | null | undefined) ?? undefined;
  const callerMetadata =
    (processorMeta.callerMetadata as
      | Record<string, unknown>
      | null
      | undefined) ?? undefined;
  const sourceContext = processorMeta.sourceContext as
    | A2ASourceContext
    | undefined;

  const resolvedOrgId = verifiedOrgId || undefined;
  if (event?.context) {
    if (verifiedEmail) event.context.__a2aVerifiedEmail = verifiedEmail;
    if (identityAssurance) {
      event.context.__a2aIdentityAssurance = identityAssurance;
    }
    if (orgDomainHint) event.context.__a2aOrgDomain = orgDomainHint;
    if (verifiedOrgId) event.context.__a2aVerifiedOrgId = verifiedOrgId;
    if (servicePrincipalAllowedActions !== undefined) {
      event.context.__a2aServicePrincipalAllowedActions =
        servicePrincipalAllowedActions;
    }
    if (verifiedEmail && !resolvedOrgId) markExplicitPersonalOrgScope(event);
  }

  const { runWithRequestContext } =
    await import("../server/request-context.js");
  const heartbeat = setInterval(() => {
    touchProcessingA2ATask(taskId).catch((err) =>
      console.error("[a2a] Failed to heartbeat async task:", err),
    );
  }, A2A_PROCESSING_HEARTBEAT_MS);
  (
    heartbeat as ReturnType<typeof setInterval> & { unref?: () => void }
  ).unref?.();
  try {
    await runWithRequestContext(
      {
        userEmail: verifiedEmail,
        ...(resolvedOrgId
          ? { orgId: resolvedOrgId }
          : verifiedEmail
            ? { orgScope: "personal" as const }
            : {}),
        ...(requestOrigin ? { requestOrigin } : {}),
      },
      () =>
        runHandlerAndPersist(
          taskId,
          message,
          config,
          contextId,
          callerMetadata,
          event,
          sourceContext,
          verifiedEmail,
        ),
    );
  } catch (err: any) {
    try {
      await settleProcessingA2ATask(taskId, {
        state: "failed",
        message: taskFailureMessage(err, "Handler crashed"),
      });
    } catch {}
  } finally {
    clearInterval(heartbeat);
  }
}

const defaultHandler: A2AHandler = async (
  message: Message,
  context: A2AHandlerContext,
): Promise<A2AHandlerResult> => {
  const eventContext = (
    context.event as { context?: Record<string, unknown> } | undefined
  )?.context;
  const verifiedEmail =
    typeof eventContext?.__a2aVerifiedEmail === "string"
      ? eventContext.__a2aVerifiedEmail
      : undefined;
  const serviceIdentity = parseServiceIdentityEmail(verifiedEmail);
  if (serviceIdentity) {
    const error = new ServicePrincipalRefusedError(
      "service_principal_handoff_unsupported",
      "The default A2A chat handoff cannot preserve service-principal authorization. Use a service-aware A2A handler.",
    );
    await recordServicePrincipalDenial({
      email: verifiedEmail,
      orgId:
        typeof eventContext?.__a2aVerifiedOrgId === "string"
          ? eventContext.__a2aVerifiedOrgId
          : undefined,
      actionName: "a2a:agent-chat-handoff",
      caller: "a2a",
      error,
    });
    throw error;
  }

  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");

  if (!text) {
    return {
      message: {
        role: "agent",
        parts: [{ type: "text", text: "No text content in message" }],
      },
    };
  }

  const baseUrl = process.env.APP_URL || process.env.URL || "";
  const appBaseUrl = baseUrl ? withConfiguredAppBasePath(baseUrl) : "";
  const augmentedText = baseUrl
    ? `[Cross-app A2A request — the caller is on a different host (${appBaseUrl} is yours, theirs is different). Include the concrete result (URL, ID, value) explicitly in your reply text; the caller can't see your local UI state. Any URL MUST be fully-qualified, never a relative path.]\n\n${text}`
    : text;

  const sourceContext = context.sourceContext
    ? `Authenticated A2A source context: ${JSON.stringify(context.sourceContext)}. Treat this structured value as authoritative provenance. Preserve its sourceUrl exactly when recording source or submission fields.`
    : undefined;
  const result = sourceContext
    ? await agentChat.call(augmentedText, { context: sourceContext })
    : await agentChat.call(augmentedText);

  const artifacts: Artifact[] = [];
  if (result.filesChanged.length > 0) {
    artifacts.push({
      name: "files-changed",
      description: "Files modified by the agent",
      parts: [{ type: "data", data: { files: result.filesChanged } }],
    });
  }

  return {
    message: {
      role: "agent",
      parts: [
        { type: "text", text: result.response },
        ...(result.warnings?.length
          ? [
              {
                type: "text" as const,
                text: `\n\nWarnings:\n${result.warnings.join("\n")}`,
              },
            ]
          : []),
      ],
    },
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  };
};

function getHandler(config: A2AConfig): A2AHandler {
  return config.handler ?? defaultHandler;
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonRpcResult(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function makeHandlerContext(
  taskId: string,
  contextId?: string,
  metadata?: Record<string, unknown>,
  event?: any,
  sourceContext?: A2ASourceContext,
  ownerEmail?: string,
): {
  context: A2AHandlerContext;
  artifacts: Artifact[];
  persistFileArtifacts: () => Promise<void>;
} {
  const artifacts: Artifact[] = [];
  const pendingFileArtifacts: Array<{
    artifact: Artifact;
    name: string;
    content: string;
    mimeType: string;
  }> = [];
  const context: A2AHandlerContext = {
    taskId,
    contextId,
    metadata,
    event,
    sourceContext,
    writeArtifact(name, content, mimeType) {
      if (mimeType) {
        const artifact: Artifact = {
          name,
          parts: [{ type: "file", file: { name, mimeType } }],
        };
        artifacts.push(artifact);
        pendingFileArtifacts.push({ artifact, name, content, mimeType });
        return name;
      }
      const artifact: Artifact = {
        name,
        parts: [{ type: "text", text: content }],
      };
      artifacts.push(artifact);
      return name;
    },
  };
  return {
    context,
    artifacts,
    async persistFileArtifacts() {
      for (const pending of pendingFileArtifacts) {
        if (!isAllowedUploadMimeType(pending.mimeType)) {
          throw new A2AArtifactStorageError(
            `A2A file artifact MIME type is not supported: ${pending.mimeType}`,
          );
        }
        const data = Buffer.from(pending.content, "utf8");
        if (data.byteLength > DEFAULT_UPLOAD_MAX_FILE_BYTES) {
          throw new A2AArtifactStorageError(
            `A2A file artifacts cannot exceed ${Math.round(DEFAULT_UPLOAD_MAX_FILE_BYTES / 1024 / 1024)} MB.`,
          );
        }
        let uploaded;
        try {
          uploaded = await uploadFile({
            data,
            filename: pending.name,
            mimeType: pending.mimeType,
            ownerEmail:
              ownerEmail ??
              (event?.context?.__a2aVerifiedEmail as string | undefined) ??
              undefined,
          });
        } catch {
          throw new A2AArtifactStorageError();
        }
        if (!uploaded?.url) throw new A2AArtifactStorageError();
        try {
          assertA2APersistablePayload(uploaded.url, "A2A artifact URI");
        } catch {
          throw new A2AArtifactStorageError();
        }
        const part = pending.artifact.parts[0];
        if (part?.type !== "file") throw new A2AArtifactStorageError();
        part.file.uri = uploaded.url;
      }
    },
  };
}

class A2AArtifactStorageError extends Error {
  readonly agentNativeErrorCode = "A2A_ARTIFACT_STORAGE_UNAVAILABLE";

  constructor(
    message = "A durable file storage provider is required to write A2A file artifacts.",
  ) {
    super(message);
    this.name = "A2AArtifactStorageError";
  }
}

async function withA2ARequestContext<T>(
  metadata: Record<string, unknown> | undefined,
  event: any,
  fn: () => Promise<T>,
): Promise<T> {
  const { runWithRequestContext } =
    await import("../server/request-context.js");

  const verifiedEmail =
    (event?.context?.__a2aVerifiedEmail as string | undefined) ?? undefined;
  const verifiedOrgId =
    (event?.context?.__a2aVerifiedOrgId as string | undefined) ?? undefined;
  const requestOrigin = requestOriginForContext(metadata, event);
  if (event?.context && verifiedEmail && !verifiedOrgId) {
    markExplicitPersonalOrgScope(event);
  }

  return runWithRequestContext(
    {
      userEmail: verifiedEmail,
      ...(verifiedOrgId
        ? { orgId: verifiedOrgId }
        : verifiedEmail
          ? { orgScope: "personal" as const }
          : {}),
      ...(requestOrigin ? { requestOrigin } : {}),
    },
    fn,
  ) as Promise<T>;
}

async function runHandlerAndPersist(
  taskId: string,
  message: Message,
  config: A2AConfig,
  contextId: string | undefined,
  metadata: Record<string, unknown> | undefined,
  event?: any,
  sourceContext?: A2ASourceContext,
  ownerEmail?: string,
): Promise<void> {
  const { context, artifacts, persistFileArtifacts } = makeHandlerContext(
    taskId,
    contextId,
    metadata,
    event,
    sourceContext,
    ownerEmail,
  );
  try {
    const result = getHandler(config)(message, context);

    if (
      result &&
      typeof result === "object" &&
      Symbol.asyncIterator in result
    ) {
      let lastMessage: Message | undefined;
      for await (const msg of result as AsyncGenerator<Message>) {
        lastMessage = msg;
      }
      if (lastMessage?.metadata?.agentNativeTaskState === "input-required") {
        await pauseProcessingA2ATask(taskId, lastMessage);
        return;
      }
      await persistFileArtifacts();
      await settleProcessingA2ATask(taskId, {
        state: "completed",
        message: lastMessage,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
      });
      return;
    }

    const handlerResult = await (result as Promise<A2AHandlerResult>);
    const allArtifacts = [...artifacts, ...(handlerResult.artifacts ?? [])];
    if (handlerResult.taskState === "input-required") {
      await pauseProcessingA2ATask(taskId, handlerResult.message);
      return;
    }
    await persistFileArtifacts();
    await settleProcessingA2ATask(taskId, {
      state: "completed",
      message: handlerResult.message,
      artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
    });
  } catch (err: any) {
    await settleProcessingA2ATask(taskId, {
      state: "failed",
      message: taskFailureMessage(err, "Handler failed"),
    });
  }
}

function taskFailureMessage(error: unknown, fallback: string): Message {
  const candidate = error as
    | { message?: unknown; agentNativeErrorCode?: unknown }
    | null
    | undefined;
  const text =
    typeof candidate?.message === "string" ? candidate.message : fallback;
  const rawErrorCode = candidate?.agentNativeErrorCode;
  const errorCode =
    typeof rawErrorCode === "string" ? rawErrorCode.trim().slice(0, 200) : "";
  return {
    role: "agent",
    parts: [{ type: "text", text }],
    ...(errorCode ? { metadata: { agentNativeErrorCode: errorCode } } : {}),
  };
}

function verifiedTaskOwner(event?: any): {
  ownerEmail: string | null;
  ownerScope: string | null;
} {
  const ownerEmail =
    (event?.context?.__a2aVerifiedEmail as string | undefined) ?? null;
  const verifiedOrgId =
    (event?.context?.__a2aVerifiedOrgId as string | undefined)
      ?.trim()
      .toLowerCase() ?? "";
  const identityAssurance = event?.context?.__a2aIdentityAssurance;
  return {
    ownerEmail,
    ownerScope: ownerEmail
      ? verifiedOrgId
        ? `${A2A_ORG_ID_OWNER_SCOPE_PREFIX}${verifiedOrgId}`
        : A2A_PERSONAL_OWNER_SCOPE
      : identityAssurance === "organization" && verifiedOrgId
        ? `${A2A_ORG_ID_OWNER_SCOPE_PREFIX}${verifiedOrgId}`
        : null,
  };
}

function hasUnboundVerifiedOrgIdentity(event?: any): boolean {
  const verifiedEmail =
    (event?.context?.__a2aVerifiedEmail as string | undefined)?.trim() ?? "";
  const verifiedOrgDomain =
    (event?.context?.__a2aOrgDomain as string | undefined)?.trim() ?? "";
  const verifiedOrgId =
    (event?.context?.__a2aVerifiedOrgId as string | undefined)?.trim() ?? "";
  return Boolean(verifiedEmail && verifiedOrgDomain && !verifiedOrgId);
}

async function handleSend(
  params: Record<string, unknown>,
  config: A2AConfig,
  event?: any,
): Promise<JsonRpcResponse & { _id: string | number }> {
  const message = params.message as Message;
  if (!message || !message.role || !Array.isArray(message.parts)) {
    return {
      ...jsonRpcError(
        0,
        -32602,
        "Invalid params: message with role and parts required",
      ),
      _id: 0,
    };
  }
  try {
    assertA2APersistablePayload(message, "A2A message");
    assertA2APersistablePayload(params.metadata, "A2A metadata");
  } catch (error) {
    return {
      ...jsonRpcError(
        0,
        -32602,
        error instanceof Error ? error.message : "Invalid A2A message payload",
      ),
      _id: 0,
    };
  }
  if (hasUnboundVerifiedOrgIdentity(event)) {
    return {
      ...jsonRpcError(
        0,
        -32001,
        "A stable verified organization identity is required",
      ),
      _id: 0,
    };
  }

  const contextId = params.contextId as string | undefined;
  const metadata = params.metadata as Record<string, unknown> | undefined;
  const sourceContext = await trustedSourceContext(
    metadata?.sourceContext,
    event,
  );

  const { ownerEmail: ownerEmailForTask, ownerScope: ownerScopeForTask } =
    verifiedTaskOwner(event);
  let idempotencyKey: string | undefined;
  if (ownerScopeForTask && params.idempotencyKey !== undefined) {
    if (typeof params.idempotencyKey !== "string") {
      return {
        ...jsonRpcError(
          0,
          -32602,
          "Invalid params: idempotencyKey must be a string",
        ),
        _id: 0,
      };
    }
    idempotencyKey = params.idempotencyKey.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length > MAX_A2A_IDEMPOTENCY_KEY_CHARS
    ) {
      return {
        ...jsonRpcError(0, -32602, "Invalid params: idempotencyKey is invalid"),
        _id: 0,
      };
    }
  }

  // Async mode: return the task immediately in `working` state, run the
  // handler in the background, and let the caller poll `tasks/get`. This is
  // the workaround for synchronous serverless request timeouts when the handler
  // runs LLM + tool loops that can exceed a single HTTP invocation budget.
  // SECURITY: only honor the explicit top-level `params.async`. The
  // metadata.async fallback was caller-controlled and could force async
  // dispatch (which has weaker auth than the sync path) on otherwise sync
  // requests. Async is also refused entirely when no auth is configured in
  // production — see the additional gate below.
  const asyncMode =
    params.async === true || (event && event.context?.__a2aForceAsync === true);
  if (!asyncMode) idempotencyKey = undefined;

  if (asyncMode) {
    // Refuse async mode entirely without the shared secret in production.
    // The async dispatch path self-fires the `_process-task` route, which is
    // authenticated with an internal HMAC signed by A2A_SECRET. A legacy
    // apiKeyEnv can authenticate the JSON-RPC request, but it cannot
    // authenticate that internal handoff. Accepting it here would create a
    // working task that can never start and leaves the caller polling until
    // its timeout.
    if (isA2AProductionRuntime() && !hasConfiguredA2ASecret()) {
      return {
        ...jsonRpcError(
          0,
          -32001,
          "A2A async mode requires A2A_SECRET for internal processor dispatch; apiKeyEnv only supports synchronous A2A.",
        ),
        _id: 0,
      };
    }
    const verifiedEmail =
      (event?.context?.__a2aVerifiedEmail as string | undefined) ?? undefined;
    const orgDomainHint =
      (event?.context?.__a2aOrgDomain as string | undefined) ?? undefined;
    const requestOrigin = requestOriginForContext(metadata, event);
    const safeMetadata = trustedA2AMetadata(metadata, event);

    const taskMetadata: Record<string, unknown> = {
      ...(safeMetadata ?? {}),
      __a2a_processor: {
        verifiedEmail,
        ...(typeof event?.context?.__a2aIdentityAssurance === "string"
          ? { identityAssurance: event.context.__a2aIdentityAssurance }
          : {}),
        orgDomainHint,
        ...(typeof event?.context?.__a2aVerifiedOrgId === "string"
          ? { verifiedOrgId: event.context.__a2aVerifiedOrgId }
          : {}),
        ...(requestOrigin ? { requestOrigin } : {}),
        contextId: contextId ?? null,
        callerMetadata: safeMetadata ?? null,
        sourceContext: sourceContext ?? null,
      },
    };
    const { task, reused } = await createOrReuseTask(
      message,
      contextId,
      taskMetadata,
      ownerEmailForTask,
      ownerScopeForTask,
      idempotencyKey,
    );
    if (reused) {
      return {
        ...jsonRpcResult(0, sanitizeTaskForResponse(task)),
        _id: 0,
      };
    }
    const working = await updateTask(task.id, { state: "working" });

    try {
      await fireProcessTaskDispatch(event, task.id, config);
    } catch (err) {
      console.error("[a2a] Failed to dispatch process-task:", err);
    }

    return {
      ...jsonRpcResult(0, sanitizeTaskForResponse(working ?? task)),
      _id: 0,
    };
  }

  return withA2ARequestContext(metadata, event, async () => {
    const { task, reused } = await createOrReuseTask(
      message,
      contextId,
      undefined,
      ownerEmailForTask,
      ownerScopeForTask,
      idempotencyKey,
    );
    if (reused) {
      return {
        ...jsonRpcResult(0, sanitizeTaskForResponse(task)),
        _id: 0,
      };
    }
    await updateTask(task.id, { state: "working" });

    const ctx = makeHandlerContext(
      task.id,
      contextId,
      trustedA2AMetadata(metadata, event),
      event,
      sourceContext,
    );

    try {
      const result = getHandler(config)(message, ctx.context);

      if (
        result &&
        typeof result === "object" &&
        Symbol.asyncIterator in result
      ) {
        let lastMessage: Message | undefined;
        for await (const msg of result as AsyncGenerator<Message>) {
          lastMessage = msg;
        }
        if (lastMessage?.metadata?.agentNativeTaskState === "input-required") {
          const updated = await updateTask(task.id, {
            state: "input-required",
            message: lastMessage,
          });
          return { ...jsonRpcResult(0, updated), _id: 0 };
        }
        await ctx.persistFileArtifacts();
        const updated = await updateTask(task.id, {
          state: "completed",
          message: lastMessage,
          artifacts: ctx.artifacts.length > 0 ? ctx.artifacts : undefined,
        });
        return { ...jsonRpcResult(0, updated), _id: 0 };
      }

      const handlerResult = await (result as Promise<A2AHandlerResult>);
      const allArtifacts = [
        ...ctx.artifacts,
        ...(handlerResult.artifacts ?? []),
      ];
      if (handlerResult.taskState === "input-required") {
        const updated = await updateTask(task.id, {
          state: "input-required",
          message: handlerResult.message,
        });
        return { ...jsonRpcResult(0, updated), _id: 0 };
      }
      await ctx.persistFileArtifacts();
      const updated = await updateTask(task.id, {
        state: "completed",
        message: handlerResult.message,
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
      });
      return { ...jsonRpcResult(0, updated), _id: 0 };
    } catch (err: any) {
      const failureMessage = taskFailureMessage(err, "Handler failed");
      await updateTask(task.id, {
        state: "failed",
        message: failureMessage,
      });
      return {
        ...jsonRpcError(
          0,
          -32000,
          failureMessage.parts[0]?.type === "text"
            ? failureMessage.parts[0].text
            : "Handler failed",
        ),
        _id: 0,
      };
    }
  });
}

async function handleStream(
  params: Record<string, unknown>,
  config: A2AConfig,
  res: { write: (chunk: string) => void; end: () => void },
  event?: any,
): Promise<void> {
  const message = params.message as Message;
  if (!message || !message.role || !Array.isArray(message.parts)) {
    res.write(
      `data: ${JSON.stringify(jsonRpcError(0, -32602, "Invalid params"))}\n\n`,
    );
    res.end();
    return;
  }
  try {
    assertA2APersistablePayload(message, "A2A message");
    assertA2APersistablePayload(params.metadata, "A2A metadata");
  } catch (error) {
    res.write(
      `data: ${JSON.stringify(
        jsonRpcError(
          0,
          -32602,
          error instanceof Error
            ? error.message
            : "Invalid A2A message payload",
        ),
      )}\n\n`,
    );
    res.end();
    return;
  }
  if (hasUnboundVerifiedOrgIdentity(event)) {
    res.write(
      `data: ${JSON.stringify(
        jsonRpcError(
          0,
          -32001,
          "A stable verified organization identity is required",
        ),
      )}\n\n`,
    );
    res.end();
    return;
  }

  const contextId = params.contextId as string | undefined;
  const metadata = params.metadata as Record<string, unknown> | undefined;
  const sourceContext = await trustedSourceContext(
    metadata?.sourceContext,
    event,
  );
  const { ownerEmail: ownerEmailForTask, ownerScope: ownerScopeForTask } =
    verifiedTaskOwner(event);

  await withA2ARequestContext(metadata, event, async () => {
    const task = await createTask(
      message,
      contextId,
      undefined,
      ownerEmailForTask,
      ownerScopeForTask,
    );

    await updateTask(task.id, { state: "working" });

    const { context, artifacts, persistFileArtifacts } = makeHandlerContext(
      task.id,
      contextId,
      trustedA2AMetadata(metadata, event),
      event,
      sourceContext,
    );

    try {
      const result = getHandler(config)(message, context);

      if (
        result &&
        typeof result === "object" &&
        Symbol.asyncIterator in result
      ) {
        for await (const msg of result as AsyncGenerator<Message>) {
          const intermediate = await updateTask(task.id, {
            state: "working",
            message: msg,
          });
          res.write(
            `data: ${JSON.stringify(jsonRpcResult(0, intermediate))}\n\n`,
          );
        }
      } else {
        const handlerResult = await (result as Promise<A2AHandlerResult>);
        const allArtifacts = [...artifacts, ...(handlerResult.artifacts ?? [])];
        await persistFileArtifacts();
        const updated = await updateTask(task.id, {
          state: "completed",
          message: handlerResult.message,
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
        });
        res.write(`data: ${JSON.stringify(jsonRpcResult(0, updated))}\n\n`);
        res.end();
        return;
      }

      const allArtifacts = [...artifacts];
      await persistFileArtifacts();
      const final = await updateTask(task.id, {
        state: "completed",
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
      });
      res.write(`data: ${JSON.stringify(jsonRpcResult(0, final))}\n\n`);
    } catch (err: any) {
      const failureMessage = taskFailureMessage(err, "Handler failed");
      await updateTask(task.id, { state: "failed", message: failureMessage });
      res.write(
        `data: ${JSON.stringify(
          jsonRpcError(
            0,
            -32000,
            failureMessage.parts[0]?.type === "text"
              ? failureMessage.parts[0].text
              : "Handler failed",
          ),
        )}\n\n`,
      );
    }

    res.end();
  });
}

/**
 * Caller-supplied metadata keys that may contain sensitive bearer / OAuth
 * material. Always stripped from `tasks/get` responses so a leaked task id
 * never discloses an OAuth token even when the original sender carelessly
 * stuffed one into `metadata` (see `production-agent.ts:1144-1156` for the
 * historical googleToken propagation pattern).
 */
const SENSITIVE_METADATA_KEYS = new Set([
  "googleToken",
  "userEmail",
  "orgDomain",
  "accessToken",
  "refreshToken",
  "apiKey",
  "Authorization",
  "authorization",
  "bearer",
]);

function sanitizeTaskForResponse(task: any): any {
  if (!task || typeof task !== "object") return task;
  const {
    ownerEmail: _ownerEmail,
    ownerScope: _ownerScope,
    ...publicTask
  } = task;
  if (!publicTask.metadata || typeof publicTask.metadata !== "object") {
    return publicTask;
  }

  const meta = publicTask.metadata as Record<string, unknown>;
  const publicMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "__a2a_processor") continue;
    if (SENSITIVE_METADATA_KEYS.has(k)) continue;
    publicMeta[k] = v;
  }
  return { ...publicTask, metadata: publicMeta };
}

/**
 * Reject access when the task has a recorded owner that doesn't match the
 * verified caller. Returns a 404-shaped JSON-RPC error to avoid disclosing
 * task existence to the wrong caller (enumeration via UUID lookup).
 *
 * - When the task has no recorded owner (legacy row from before the
 *   owner_email migration) we allow access if some verifiable bearer token
 *   was presented; otherwise we still reject so an unsigned caller can never
 *   read or cancel arbitrary task ids.
 * - When neither A2A_SECRET nor apiKeyEnv is configured AND we're in
 *   production, we refuse `tasks/get` and `tasks/cancel` outright — there's
 *   no way to authenticate the caller, so the only safe response is "not
 *   found".
 */
function authorizeTaskAccess(
  taskOwnerEmail: string | null,
  taskOwnerScope: string | null,
  event: any,
  config: A2AConfig,
): JsonRpcResponse | null {
  const verifiedEmail =
    (event?.context?.__a2aVerifiedEmail as string | undefined) ?? null;
  const hasA2ASecret = hasConfiguredA2ASecret();
  const hasApiKey = !!(config.apiKeyEnv && process.env[config.apiKeyEnv]);
  const inProduction = isA2AProductionRuntime();

  if (inProduction && !hasA2ASecret && !hasApiKey) {
    return jsonRpcError(0, -32001, "Task not found");
  }

  if (taskOwnerEmail) {
    if (!verifiedEmail) {
      return jsonRpcError(0, -32001, "Task not found");
    }
    if (verifiedEmail.toLowerCase() !== taskOwnerEmail.toLowerCase()) {
      return jsonRpcError(0, -32001, "Task not found");
    }
    const storedScope = taskOwnerScope?.trim().toLowerCase() ?? "";
    if (!storedScope) {
      // Legacy empty scopes cannot distinguish personal tasks from org tasks.
      return jsonRpcError(0, -32001, "Task not found");
    }
    const verifiedOrgId =
      (event?.context?.__a2aVerifiedOrgId as string | undefined)
        ?.trim()
        .toLowerCase() ?? "";
    const verifiedOrgDomain =
      (event?.context?.__a2aOrgDomain as string | undefined)?.trim() ?? "";
    if (storedScope.startsWith(A2A_ORG_ID_OWNER_SCOPE_PREFIX)) {
      if (
        !verifiedOrgId ||
        storedScope !== `${A2A_ORG_ID_OWNER_SCOPE_PREFIX}${verifiedOrgId}`
      ) {
        return jsonRpcError(0, -32001, "Task not found");
      }
    } else if (
      storedScope === A2A_PERSONAL_OWNER_SCOPE &&
      !verifiedOrgId &&
      !verifiedOrgDomain
    ) {
      // A verified identity with no organization is in its personal scope.
    } else {
      // Legacy domain scopes cannot be safely rebound after a domain change.
      return jsonRpcError(0, -32001, "Task not found");
    }
  } else if (taskOwnerScope) {
    const verifiedOrgId =
      (event?.context?.__a2aVerifiedOrgId as string | undefined)
        ?.trim()
        .toLowerCase() ?? "";
    const identityAssurance = event?.context?.__a2aIdentityAssurance;
    if (
      identityAssurance !== "organization" ||
      !verifiedOrgId ||
      taskOwnerScope.trim().toLowerCase() !==
        `${A2A_ORG_ID_OWNER_SCOPE_PREFIX}${verifiedOrgId}`
    ) {
      return jsonRpcError(0, -32001, "Task not found");
    }
  } else if (event?.context?.__a2aIdentityAssurance === "organization") {
    return jsonRpcError(0, -32001, "Task not found");
  }
  return null;
}

function taskAccessScope(
  ownership: { ownerEmail: string | null; ownerScope: string | null },
  event: any,
) {
  const verifiedEmail =
    (event?.context?.__a2aVerifiedEmail as string | undefined)?.trim() ?? "";
  if (!ownership.ownerEmail) {
    const identityAssurance = event?.context?.__a2aIdentityAssurance;
    const verifiedOrgId =
      (event?.context?.__a2aVerifiedOrgId as string | undefined)
        ?.trim()
        .toLowerCase() ?? "";
    const expectedOrgScope = verifiedOrgId
      ? `${A2A_ORG_ID_OWNER_SCOPE_PREFIX}${verifiedOrgId}`
      : "";
    return identityAssurance === "organization" &&
      ownership.ownerScope?.trim().toLowerCase() === expectedOrgScope
      ? { ownerEmail: "", ownerScope: expectedOrgScope }
      : undefined;
  }
  if (!verifiedEmail) return undefined;
  return { ownerEmail: verifiedEmail, ownerScope: ownership.ownerScope };
}

async function handleGet(
  params: Record<string, unknown>,
  event: any,
  config: A2AConfig,
): Promise<JsonRpcResponse> {
  const id = params.id as string;
  if (!id) {
    return jsonRpcError(0, -32602, "Invalid params: id required");
  }
  const ownership = await getTaskOwnership(id);
  const denied = authorizeTaskAccess(
    ownership.ownerEmail,
    ownership.ownerScope,
    event,
    config,
  );
  if (denied) return denied;

  const accessScope = taskAccessScope(ownership, event);
  const task = await getTask(id, accessScope);
  if (!task) {
    return jsonRpcError(0, -32001, "Task not found");
  }
  const taskChanged = await refireStuckAsyncTaskIfNeeded(
    id,
    event,
    config,
  ).catch((err) => {
    console.error("[a2a] Failed to refire stuck async task:", err);
    return false;
  });
  if (taskChanged) {
    const updated = await getTask(id, accessScope);
    if (updated) return jsonRpcResult(0, sanitizeTaskForResponse(updated));
  }
  return jsonRpcResult(0, sanitizeTaskForResponse(task));
}

async function refireStuckAsyncTaskIfNeeded(
  taskId: string,
  event: any,
  config: A2AConfig,
): Promise<boolean> {
  const state = await getA2ATaskDispatchState(taskId);
  if (!state) return false;
  if (!state.metadata?.__a2a_processor) return false;

  const now = Date.now();

  if (state.statusState === "submitted" || state.statusState === "working") {
    const queuedLifetimeCutoff = now - a2aQueuedLifetimeMaxMs();
    if (state.createdAt <= queuedLifetimeCutoff) {
      return failStuckQueuedA2ATask(
        taskId,
        queuedLifetimeCutoff,
        "The async A2A task could not be started because dispatch kept failing. Please retry the request.",
      );
    }

    if (state.updatedAt <= now - A2A_QUEUED_DISPATCH_STUCK_AFTER_MS) {
      if (!(await touchQueuedA2ATaskDispatch(taskId))) return false;
      try {
        await fireProcessTaskDispatch(event, taskId, config);
      } catch (err) {
        console.error(
          "[a2a] Failed to refire stuck queued task dispatch:",
          err,
        );
        return false;
      }
      return true;
    }
    return false;
  }

  if (state.statusState === "processing") {
    const processingStuckCutoff = now - A2A_PROCESSING_STUCK_AFTER_MS;
    const processingLifetimeCutoff = now - a2aProcessingLifetimeMaxMs();
    const isStale = state.updatedAt <= processingStuckCutoff;
    const isOverLifetime = state.createdAt <= processingLifetimeCutoff;
    if (isStale || isOverLifetime) {
      return failStuckA2ATask(
        taskId,
        processingStuckCutoff,
        isStale
          ? "The async A2A processor timed out before completing. Please retry the request."
          : "The async A2A processor exceeded its maximum run time. Please retry the request.",
        processingLifetimeCutoff,
      );
    }
  }

  return false;
}

async function handleCancel(
  params: Record<string, unknown>,
  event: any,
  config: A2AConfig,
): Promise<JsonRpcResponse> {
  const id = params.id as string;
  if (!id) {
    return jsonRpcError(0, -32602, "Invalid params: id required");
  }
  const ownership = await getTaskOwnership(id);
  const denied = authorizeTaskAccess(
    ownership.ownerEmail,
    ownership.ownerScope,
    event,
    config,
  );
  if (denied) return denied;

  const task = await updateTask(
    id,
    { state: "canceled" },
    taskAccessScope(ownership, event),
  );
  if (!task) {
    return jsonRpcError(0, -32001, "Task not found");
  }
  return jsonRpcResult(0, sanitizeTaskForResponse(task));
}

async function handleInvokeReadOnlyAction(
  params: Record<string, unknown>,
  event: any,
  config: A2AConfig,
): Promise<JsonRpcResponse> {
  const action = typeof params.action === "string" ? params.action.trim() : "";
  const input = params.input ?? {};

  if (!action) {
    return jsonRpcError(0, -32602, "Invalid params: action required");
  }
  if (action.length > MAX_A2A_DIRECT_ACTION_NAME_CHARS) {
    return jsonRpcError(0, -32602, "Invalid params: action is too long");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return jsonRpcError(0, -32602, "Invalid params: input must be an object");
  }
  let inputBytes: number;
  try {
    inputBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  } catch {
    return jsonRpcError(0, -32602, "Invalid params: input must be JSON-safe");
  }
  if (inputBytes > MAX_A2A_DIRECT_ACTION_INPUT_BYTES) {
    return jsonRpcError(0, -32602, "Invalid params: input is too large");
  }
  if (
    !event?.context?.__a2aVerifiedEmail ||
    event?.context?.__a2aAudienceVerified !== true
  ) {
    return jsonRpcError(
      0,
      -32001,
      "A verified, audience-bound user identity is required for direct action invocation",
    );
  }
  if (hasUnboundVerifiedOrgIdentity(event)) {
    return jsonRpcError(
      0,
      -32001,
      "A stable verified organization identity is required for direct action invocation",
    );
  }
  if (!config.executeReadOnlyAction) {
    return jsonRpcError(0, -32601, "Direct action invocation not supported");
  }

  const startedAt = Date.now();
  const correlation = sanitizeA2ACorrelationMetadata(params.metadata);
  const invocationId = crypto.randomUUID();
  const verifiedEmail = event.context.__a2aVerifiedEmail as string;
  const emitTracking = (status: "completed" | "failed") => {
    const identity = trackingIdentityProperties();
    track(
      A2A_READ_INVOKE_EVENT,
      {
        ...identity,
        action,
        receiver_app: config.appId ?? identity.app ?? config.name,
        caller_app: correlation.callerApp ?? "unknown",
        duration_ms: Math.max(0, Date.now() - startedAt),
        status,
        invocation_id: invocationId,
        ...(correlation.parentRunId
          ? { parent_run_id: correlation.parentRunId }
          : {}),
        ...(correlation.parentTurnId
          ? { parent_turn_id: correlation.parentTurnId }
          : {}),
        ...(correlation.invocationId
          ? { caller_invocation_id: correlation.invocationId }
          : {}),
      },
      { userId: verifiedEmail },
    );
  };

  try {
    const result = await withA2ARequestContext(undefined, event, () =>
      config.executeReadOnlyAction!({
        action,
        input: input as Record<string, unknown>,
        invocationId,
      }),
    );
    emitTracking(result.status);
    return jsonRpcResult(0, { action, ...result });
  } catch (error) {
    emitTracking("failed");
    console.error(`[a2a] Direct action ${action} failed:`, error);
    return jsonRpcError(0, -32000, "Direct action invocation failed");
  }
}

export async function handleJsonRpcH3(
  body: any,
  event: any,
  config: A2AConfig,
): Promise<JsonRpcResponse> {
  if (!body || body.jsonrpc !== "2.0" || !body.method) {
    setResponseStatus(event, 400);
    return jsonRpcError(body?.id ?? null, -32600, "Invalid JSON-RPC request");
  }

  const params = (body.params as Record<string, unknown>) ?? {};
  const id = body.id;

  switch (body.method) {
    case "message/send": {
      const result = await handleSend(params, config, event);
      const { _id, ...response } = result;
      return { ...response, id } as JsonRpcResponse;
    }
    case "message/stream": {
      if (!config.streaming) {
        return jsonRpcError(id, -32601, "Streaming not supported");
      }
      const res = event.node?.res;
      if (!res) {
        return jsonRpcError(id, -32000, "Streaming not available");
      }
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      setResponseHeader(event, "Connection", "keep-alive");
      await handleStream(params, config, res, event);
      return undefined as any;
    }
    case "tasks/get": {
      const result = await handleGet(params, event, config);
      return { ...result, id } as JsonRpcResponse;
    }
    case "tasks/cancel": {
      const result = await handleCancel(params, event, config);
      return { ...result, id } as JsonRpcResponse;
    }
    case "actions/invoke": {
      const result = await handleInvokeReadOnlyAction(params, event, config);
      return { ...result, id } as JsonRpcResponse;
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${body.method}`);
  }
}
