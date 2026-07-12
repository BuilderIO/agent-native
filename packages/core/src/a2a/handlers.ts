import { setResponseHeader, setResponseStatus } from "h3";

import {
  AGENT_BACKGROUND_PROCESSOR_A2A,
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  isAgentChatDurableBackgroundEnabled,
  resolveAgentChatProcessRunDispatchPath,
} from "../agent/durable-background.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { fireInternalDispatch } from "../server/self-dispatch.js";
import { agentChat } from "../shared/agent-chat.js";
import {
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
} from "./auth-policy.js";
import {
  createTask,
  getTask,
  getTaskOwner,
  updateTask,
  claimA2ATaskForProcessing,
  getA2ATaskDispatchState,
  failStuckA2ATask,
  failStuckQueuedA2ATask,
  touchQueuedA2ATaskDispatch,
  touchProcessingA2ATask,
} from "./task-store.js";
import type {
  A2AConfig,
  A2AHandler,
  A2AHandlerContext,
  A2AHandlerResult,
  JsonRpcResponse,
  Message,
  Artifact,
} from "./types.js";

// Inlined to avoid pulling the entire core-routes-plugin (and its h3
// transitive deps) into the a2a/handlers test boundary. Must stay in sync
// with FRAMEWORK_ROUTE_PREFIX in `server/core-routes-plugin.ts`.
const A2A_PROCESS_TASK_PATH = "/_agent-native/a2a/_process-task";
const A2A_QUEUED_DISPATCH_STUCK_AFTER_MS = 10_000;
const A2A_PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;
const A2A_PROCESSING_HEARTBEAT_MS = 30_000;

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

/**
 * Hard cap on total time a task may spend in `processing`, independent of
 * the liveness heartbeat. `A2A_PROCESSING_STUCK_AFTER_MS` alone only catches
 * a dead process — a hung await inside a still-alive process keeps
 * `updated_at` fresh via the heartbeat forever. This bounds that case
 * without cutting off legitimately long runs under it. Override with
 * A2A_PROCESSING_LIFETIME_MAX_MS.
 */
function a2aProcessingLifetimeMaxMs(): number {
  const raw = Number(process.env.A2A_PROCESSING_LIFETIME_MAX_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 30 * 60 * 1000;
}

/**
 * Dispatch an async A2A task to a fresh function execution. Apps that opted
 * into durable background runs reuse the emitted Netlify 15-minute worker;
 * other hosts and apps retain the normal portable self-webhook route.
 */
async function fireProcessTaskDispatch(
  event: any,
  taskId: string,
  config: A2AConfig,
  options?: { awaitResponse?: boolean },
): Promise<void> {
  const backgroundPath = resolveAgentChatProcessRunDispatchPath();
  const useBackgroundWorker =
    isAgentChatDurableBackgroundEnabled({
      appOptIn: config.durableBackgroundRuns === true,
    }) && dispatchPathTargetsNetlifyBackgroundFunction(backgroundPath);

  await fireInternalDispatch({
    event,
    path: useBackgroundWorker ? backgroundPath : A2A_PROCESS_TASK_PATH,
    taskId,
    ...(useBackgroundWorker
      ? {
          body: {
            [AGENT_BACKGROUND_PROCESSOR_FIELD]: AGENT_BACKGROUND_PROCESSOR_A2A,
          },
        }
      : {}),
    // Only Netlify's background-function URL acknowledges enqueue with 202.
    // The portable framework route keeps its HTTP response open until the
    // processor completes, so awaiting that response would turn async
    // message/send into a long synchronous request (or a 15s timeout).
    ...(options?.awaitResponse && useBackgroundWorker
      ? { awaitResponse: true }
      : {}),
  });
}

/**
 * Process a previously-enqueued A2A task. Called by the `_process-task`
 * route in `server.ts`, in a fresh function execution. Atomically claims the
 * task, reconstructs the caller's request context from the task's metadata,
 * runs the handler, and persists the outcome.
 *
 * Idempotent on duplicate dispatches: the atomic claim returns null if some
 * other invocation already picked the task up, in which case we no-op.
 */
export async function processA2ATaskFromQueue(
  taskId: string,
  config: A2AConfig,
  event?: any,
): Promise<void> {
  const claimed = await claimA2ATaskForProcessing(taskId);
  if (!claimed) {
    // Already in flight, terminal, or missing. Nothing to do.
    return;
  }

  const message = claimed.history?.[0];
  if (!message) {
    await updateTask(taskId, {
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
  const orgDomainHint = processorMeta.orgDomainHint as string | undefined;
  const contextId =
    (processorMeta.contextId as string | null | undefined) ?? undefined;
  const callerMetadata =
    (processorMeta.callerMetadata as
      | Record<string, unknown>
      | null
      | undefined) ?? undefined;

  const resolvedOrgId = await resolveVerifiedA2AOrgId(
    verifiedEmail,
    orgDomainHint,
  );

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
      { userEmail: verifiedEmail, orgId: resolvedOrgId },
      () =>
        runHandlerAndPersist(
          taskId,
          message,
          config,
          contextId,
          callerMetadata,
          event,
        ),
    );
  } catch (err: any) {
    try {
      await updateTask(taskId, {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: err?.message ?? "Handler crashed" }],
        },
      });
    } catch {}
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Default A2A handler that delegates to agentChat.call().
 * Used when no custom handler is provided in A2AConfig.
 */
const defaultHandler: A2AHandler = async (
  message: Message,
  _context: A2AHandlerContext,
): Promise<A2AHandlerResult> => {
  // Extract text from message parts
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

  // A2A note: this message arrived from a different app — the caller cannot
  // see this app's local state (open deck, selected slide, etc.). They only
  // see whatever this agent puts into the reply text. So:
  //   1) include any concrete result (deck/document/dashboard URL, ID, value)
  //      explicitly in the reply — the caller can't navigate locally.
  //   2) URLs must be fully-qualified — relative paths resolve against the
  //      caller's host and 404.
  // We prepend a one-line hint to the user message so the agent knows.
  const baseUrl = process.env.APP_URL || process.env.URL || "";
  const appBaseUrl = baseUrl ? withConfiguredAppBasePath(baseUrl) : "";
  const augmentedText = baseUrl
    ? `[Cross-app A2A request — the caller is on a different host (${appBaseUrl} is yours, theirs is different). Include the concrete result (URL, ID, value) explicitly in your reply text; the caller can't see your local UI state. Any URL MUST be fully-qualified, never a relative path.]\n\n${text}`
    : text;

  const result = await agentChat.call(augmentedText);

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
): {
  context: A2AHandlerContext;
  artifacts: Artifact[];
} {
  const artifacts: Artifact[] = [];
  const context: A2AHandlerContext = {
    taskId,
    contextId,
    metadata,
    event,
    writeArtifact(name, content, mimeType) {
      const artifact: Artifact = {
        name,
        parts: mimeType
          ? [
              {
                type: "file",
                file: {
                  name,
                  mimeType,
                  bytes: Buffer.from(content).toString("base64"),
                },
              },
            ]
          : [{ type: "text", text: content }],
      };
      artifacts.push(artifact);
      return name;
    },
  };
  return { context, artifacts };
}

/**
 * Resolve org context from A2A metadata / event context and wrap `fn`
 * inside `runWithRequestContext` so downstream actions see the org.
 */
async function withA2ARequestContext<T>(
  _metadata: Record<string, unknown> | undefined,
  event: any | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const { runWithRequestContext } =
    await import("../server/request-context.js");

  const verifiedEmail =
    (event?.context?.__a2aVerifiedEmail as string | undefined) ?? undefined;
  // Only trust the org domain from the cryptographically verified JWT claim on
  // the event context. metadata.orgDomain is caller-supplied and must not be
  // used for org resolution — an unauthenticated caller could forge it and
  // gain access to another org's data.
  const orgDomain =
    (event?.context?.__a2aOrgDomain as string | undefined) ?? undefined;

  const resolvedOrgId = await resolveVerifiedA2AOrgId(verifiedEmail, orgDomain);

  return runWithRequestContext(
    { userEmail: verifiedEmail, orgId: resolvedOrgId },
    fn,
  ) as Promise<T>;
}

async function resolveVerifiedA2AOrgId(
  verifiedEmail: string | undefined,
  verifiedOrgDomain: string | undefined,
): Promise<string | undefined> {
  if (verifiedOrgDomain) {
    try {
      const { resolveOrgByDomain } = await import("../org/context.js");
      const org = await resolveOrgByDomain(verifiedOrgDomain);
      if (org) return org.orgId;
    } catch {
      // Org tables may not exist — continue without org context
    }
  }

  if (verifiedEmail) {
    try {
      const { resolveOrgIdForEmail } = await import("../org/context.js");
      return (await resolveOrgIdForEmail(verifiedEmail)) ?? undefined;
    } catch {
      // Org tables may not exist — continue without org context
    }
  }

  return undefined;
}

/**
 * Run the handler against the message and persist the outcome to the task store.
 * Used in sync mode (awaited inline) and in async mode (called by the
 * `_process-task` processor route in a fresh function execution).
 */
async function runHandlerAndPersist(
  taskId: string,
  message: Message,
  config: A2AConfig,
  contextId: string | undefined,
  metadata: Record<string, unknown> | undefined,
  event?: any,
): Promise<void> {
  const { context, artifacts } = makeHandlerContext(
    taskId,
    contextId,
    metadata,
    event,
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
      await updateTask(taskId, {
        state: "completed",
        message: lastMessage,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
      });
      return;
    }

    const handlerResult = await (result as Promise<A2AHandlerResult>);
    const allArtifacts = [...artifacts, ...(handlerResult.artifacts ?? [])];
    await updateTask(taskId, {
      state: "completed",
      message: handlerResult.message,
      artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
    });
  } catch (err: any) {
    await updateTask(taskId, {
      state: "failed",
      message: {
        role: "agent",
        parts: [{ type: "text", text: err?.message ?? "Handler failed" }],
      },
    });
  }
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

  const contextId = params.contextId as string | undefined;
  const metadata = params.metadata as Record<string, unknown> | undefined;

  // The JWT-verified caller email (set by mountA2A in server.ts) is the
  // single source of truth for task ownership — bound at creation, checked
  // on every subsequent tasks/get and tasks/cancel call. Caller-supplied
  // metadata.userEmail is NEVER used for ownership; that would re-introduce
  // the IDOR class fixed here.
  const ownerEmailForTask =
    (event?.context?.__a2aVerifiedEmail as string | undefined) ?? null;

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

  if (asyncMode) {
    // Refuse async mode entirely when no auth is configured in production.
    // The async dispatch path self-fires the `_process-task` route, which
    // accepts unsigned dispatches when A2A_SECRET is unset — that combined
    // with the lack of caller identity here would let any unauthenticated
    // attacker queue and trigger handler runs. In production, require some
    // form of auth so the verifiedEmail is bound to the task.
    const hasA2ASecret = hasConfiguredA2ASecret();
    const hasApiKey = !!(config.apiKeyEnv && process.env[config.apiKeyEnv]);
    if (isA2AProductionRuntime() && !hasA2ASecret && !hasApiKey) {
      return {
        ...jsonRpcError(
          0,
          -32001,
          "A2A async mode is not available — A2A_SECRET or apiKeyEnv must be configured.",
        ),
        _id: 0,
      };
    }
    // Resolve identity up front (cheap), bake it into the task's metadata,
    // and dispatch the actual handler run to a SEPARATE function execution.
    // On serverless hosts (Netlify, Vercel, Cloudflare) detached promises get
    // killed when the response is flushed, so we self-fire a webhook to a
    // dedicated processor route — same cross-platform pattern the integration
    // webhook queue uses. The processor reconstructs the request context from
    // the task metadata and runs the handler with its own full timeout.
    const verifiedEmail =
      (event?.context?.__a2aVerifiedEmail as string | undefined) ?? undefined;
    // Only trust the verified org domain from the JWT claim — do not fall back
    // to metadata.orgDomain which is caller-supplied and unverified.
    const orgDomainHint =
      (event?.context?.__a2aOrgDomain as string | undefined) ?? undefined;

    const taskMetadata: Record<string, unknown> = {
      ...(metadata ?? {}),
      __a2a_processor: {
        verifiedEmail,
        orgDomainHint,
        contextId: contextId ?? null,
        callerMetadata: metadata ?? null,
      },
    };
    const task = await createTask(
      message,
      contextId,
      taskMetadata,
      ownerEmailForTask,
    );
    const working = await updateTask(task.id, { state: "working" });

    // Awaited, not fire-and-forget: this handler is about to return, and a
    // detached dispatch fetch racing only a short settle timer can be killed
    // mid-flight when the serverless response is flushed WITHOUT rejecting —
    // see the `awaitResponse` doc on `fireInternalDispatch` in
    // server/self-dispatch.ts. `awaitResponse: true` requests the stronger
    // guarantee; `fireProcessTaskDispatch` only honors it for the Netlify
    // background-worker path (fast 202 ack) and falls back to the settle
    // race for the portable route, which holds its response open until the
    // handler finishes.
    try {
      await fireProcessTaskDispatch(event, task.id, config, {
        awaitResponse: true,
      });
    } catch (err) {
      console.error("[a2a] Failed to dispatch process-task:", err);
    }

    return { ...jsonRpcResult(0, working ?? task), _id: 0 };
  }

  return withA2ARequestContext(metadata, event, async () => {
    const task = await createTask(
      message,
      contextId,
      undefined,
      ownerEmailForTask,
    );
    await updateTask(task.id, { state: "working" });

    const ctx = makeHandlerContext(task.id, contextId, metadata, event);

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
      const updated = await updateTask(task.id, {
        state: "completed",
        message: handlerResult.message,
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
      });
      return { ...jsonRpcResult(0, updated), _id: 0 };
    } catch (err: any) {
      await updateTask(task.id, {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: err.message ?? "Handler failed" }],
        },
      });
      return {
        ...jsonRpcError(0, -32000, err.message ?? "Handler failed"),
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

  const contextId = params.contextId as string | undefined;
  const metadata = params.metadata as Record<string, unknown> | undefined;
  const ownerEmailForTask =
    (event?.context?.__a2aVerifiedEmail as string | undefined) ?? null;

  await withA2ARequestContext(metadata, event, async () => {
    const task = await createTask(
      message,
      contextId,
      undefined,
      ownerEmailForTask,
    );

    await updateTask(task.id, { state: "working" });

    const { context, artifacts } = makeHandlerContext(
      task.id,
      contextId,
      metadata,
      event,
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
      const final = await updateTask(task.id, {
        state: "completed",
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
      });
      res.write(`data: ${JSON.stringify(jsonRpcResult(0, final))}\n\n`);
    } catch (err: any) {
      await updateTask(task.id, { state: "failed" });
      res.write(
        `data: ${JSON.stringify(jsonRpcError(0, -32000, err.message ?? "Handler failed"))}\n\n`,
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
  if (!task.metadata || typeof task.metadata !== "object") return task;

  const meta = task.metadata as Record<string, unknown>;
  const publicMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "__a2a_processor") continue;
    if (SENSITIVE_METADATA_KEYS.has(k)) continue;
    publicMeta[k] = v;
  }
  return { ...task, metadata: publicMeta };
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
  event: any,
  config: A2AConfig,
): JsonRpcResponse | null {
  const verifiedEmail =
    (event?.context?.__a2aVerifiedEmail as string | undefined) ?? null;
  const hasA2ASecret = hasConfiguredA2ASecret();
  const hasApiKey = !!(config.apiKeyEnv && process.env[config.apiKeyEnv]);
  const inProduction = isA2AProductionRuntime();

  if (inProduction && !hasA2ASecret && !hasApiKey) {
    // No way to authenticate the caller in production — refuse access.
    return jsonRpcError(0, -32001, "Task not found");
  }

  if (taskOwnerEmail) {
    if (!verifiedEmail) {
      return jsonRpcError(0, -32001, "Task not found");
    }
    if (verifiedEmail.toLowerCase() !== taskOwnerEmail.toLowerCase()) {
      return jsonRpcError(0, -32001, "Task not found");
    }
  }
  // Legacy row (no owner_email recorded). The route-level auth gate is the
  // only thing protecting it — fall through and serve.
  return null;
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
  const ownerEmail = await getTaskOwner(id);
  const denied = authorizeTaskAccess(ownerEmail, event, config);
  if (denied) return denied;

  const task = await getTask(id);
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
    const updated = await getTask(id);
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
      // Dispatch has kept failing (or was never delivered) long enough that
      // retrying further would just repeat the same failure forever — stop
      // refiring and surface a terminal error instead of throttling forever.
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
      // A processor that died mid-handler may have already performed
      // side-effectful work. Retrying from the top can duplicate artifacts, so
      // fail deterministically and let the caller issue an intentional retry.
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
  const ownerEmail = await getTaskOwner(id);
  const denied = authorizeTaskAccess(ownerEmail, event, config);
  if (denied) return denied;

  const task = await updateTask(id, { state: "canceled" });
  if (!task) {
    return jsonRpcError(0, -32001, "Task not found");
  }
  return jsonRpcResult(0, sanitizeTaskForResponse(task));
}

/**
 * H3-compatible JSON-RPC handler. Returns JSON directly (H3 serializes it).
 * Streaming is handled via H3's node response when needed.
 */
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
      // Use the raw node response for SSE streaming
      const res = event.node?.res;
      if (!res) {
        return jsonRpcError(id, -32000, "Streaming not available");
      }
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      setResponseHeader(event, "Connection", "keep-alive");
      await handleStream(params, config, res, event);
      return undefined as any; // Response already sent via SSE
    }
    case "tasks/get": {
      const result = await handleGet(params, event, config);
      return { ...result, id } as JsonRpcResponse;
    }
    case "tasks/cancel": {
      const result = await handleCancel(params, event, config);
      return { ...result, id } as JsonRpcResponse;
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${body.method}`);
  }
}
