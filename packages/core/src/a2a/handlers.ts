import { setResponseHeader, setResponseStatus } from "h3";
import type {
  A2AConfig,
  A2AHandler,
  A2AHandlerContext,
  A2AHandlerResult,
  JsonRpcRequest,
  JsonRpcResponse,
  Message,
  Artifact,
} from "./types.js";
import {
  createTask,
  getTask,
  updateTask,
  claimA2ATaskForProcessing,
} from "./task-store.js";
import { agentChat } from "../shared/agent-chat.js";
import { signInternalToken } from "../integrations/internal-token.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";

// Inlined to avoid pulling the entire core-routes-plugin (and its h3
// transitive deps) into the a2a/handlers test boundary. Must stay in sync
// with FRAMEWORK_ROUTE_PREFIX in `server/core-routes-plugin.ts`.
const A2A_PROCESS_TASK_PATH = "/_agent-native/a2a/_process-task";

/**
 * Resolve the base URL we should fire the A2A processor request to. Mirrors
 * the integration-webhook resolveBaseUrl pattern — prefer explicit env vars
 * (most reliable on serverless), fall back to inbound request headers.
 */
function resolveSelfBaseUrl(event: any | undefined): string {
  const fromEnv =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL;
  if (fromEnv) return withConfiguredAppBasePath(String(fromEnv));

  try {
    const headers = event?.node?.req?.headers ?? event?.headers;
    const get = (name: string): string | undefined => {
      if (!headers) return undefined;
      if (typeof headers.get === "function") {
        return headers.get(name) ?? undefined;
      }
      const map = headers as Record<string, string | undefined>;
      return map[name] ?? map[String(name).toLowerCase()];
    };
    const proto = get("x-forwarded-proto") || "http";
    const host = get("host") || `localhost:${process.env.PORT || 3000}`;
    return withConfiguredAppBasePath(`${proto}://${host}`);
  } catch {
    return withConfiguredAppBasePath(
      `http://localhost:${process.env.PORT || 3000}`,
    );
  }
}

/**
 * Fire-and-forget POST to the A2A processor route on the same deployment.
 * Used when an A2A send is requested in async mode — the processor runs the
 * handler in a fresh function execution so it gets its own full timeout.
 */
async function fireProcessTaskDispatch(
  event: any,
  taskId: string,
): Promise<void> {
  const baseUrl = resolveSelfBaseUrl(event);
  const url = `${baseUrl}${A2A_PROCESS_TASK_PATH}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    headers["Authorization"] = `Bearer ${signInternalToken(taskId)}`;
  } catch {
    // No A2A_SECRET configured — self-fire unsigned. The processor accepts
    // unsigned dispatches when no secret is set (mirrors the integration
    // webhook flow).
  }
  // Race the fetch against a short timer. On Netlify Lambda, returning
  // immediately can freeze the function before the outbound TCP handshake
  // starts, leaving the request stuck. This gives it ~250ms to leave the
  // box at the cost of slightly higher response latency on async A2A sends.
  const dispatchPromise = fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ taskId }),
  }).catch((err) => {
    console.error("[a2a] Process-task dispatch fetch failed:", err);
  });
  await Promise.race([
    dispatchPromise,
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
  ]);
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

  let resolvedOrgId: string | undefined;
  if (orgDomainHint) {
    try {
      const { resolveOrgByDomain } = await import("../org/context.js");
      const org = await resolveOrgByDomain(orgDomainHint);
      if (org) resolvedOrgId = org.orgId;
    } catch {}
  }

  const { runWithRequestContext } =
    await import("../server/request-context.js");
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
  }
}

/**
 * Default A2A handler that delegates to agentChat.call().
 * Used when no custom handler is provided in A2AConfig.
 */
const defaultHandler: A2AHandler = async (
  message: Message,
  context: A2AHandlerContext,
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
): {
  context: A2AHandlerContext;
  artifacts: Artifact[];
} {
  const artifacts: Artifact[] = [];
  const context: A2AHandlerContext = {
    taskId,
    contextId,
    metadata,
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
  metadata: Record<string, unknown> | undefined,
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

  let resolvedOrgId: string | undefined;
  if (orgDomain) {
    try {
      const { resolveOrgByDomain } = await import("../org/context.js");
      const org = await resolveOrgByDomain(orgDomain);
      if (org) resolvedOrgId = org.orgId;
    } catch {
      // Org tables may not exist — continue without org context
    }
  }

  return runWithRequestContext(
    { userEmail: verifiedEmail, orgId: resolvedOrgId },
    fn,
  ) as Promise<T>;
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
): Promise<void> {
  const { context, artifacts } = makeHandlerContext(
    taskId,
    contextId,
    metadata,
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

  // Async mode: return the task immediately in `working` state, run the
  // handler in the background, and let the caller poll `tasks/get`. This is
  // the workaround for Netlify's ~26s function / 30s gateway timeout when the
  // handler runs LLM + tool loops that can exceed those bounds.
  const asyncMode =
    params.async === true ||
    (metadata && (metadata as any).async === true) ||
    (event && event.context?.__a2aForceAsync === true);

  if (asyncMode) {
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
    const task = await createTask(message, contextId, taskMetadata);
    const working = await updateTask(task.id, { state: "working" });

    fireProcessTaskDispatch(event, task.id).catch((err) => {
      console.error("[a2a] Failed to dispatch process-task:", err);
    });

    return { ...jsonRpcResult(0, working ?? task), _id: 0 };
  }

  return withA2ARequestContext(metadata, event, async () => {
    const task = await createTask(message, contextId);
    await updateTask(task.id, { state: "working" });

    const ctx = makeHandlerContext(task.id, contextId, metadata);

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

  await withA2ARequestContext(metadata, event, async () => {
    const task = await createTask(message, contextId);

    await updateTask(task.id, { state: "working" });

    const { context, artifacts } = makeHandlerContext(
      task.id,
      contextId,
      metadata,
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

async function handleGet(
  params: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const id = params.id as string;
  if (!id) {
    return jsonRpcError(0, -32602, "Invalid params: id required");
  }
  const task = await getTask(id);
  if (!task) {
    return jsonRpcError(0, -32001, "Task not found");
  }
  // Strip internal processor metadata before returning to callers — it may
  // contain verifiedEmail and callerMetadata that should not be exposed.
  if (task.metadata && typeof task.metadata === "object") {
    const { __a2a_processor: _proc, ...publicMeta } = task.metadata as Record<
      string,
      unknown
    >;
    return jsonRpcResult(0, { ...task, metadata: publicMeta });
  }
  return jsonRpcResult(0, task);
}

async function handleCancel(
  params: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const id = params.id as string;
  if (!id) {
    return jsonRpcError(0, -32602, "Invalid params: id required");
  }
  const task = await updateTask(id, { state: "canceled" });
  if (!task) {
    return jsonRpcError(0, -32001, "Task not found");
  }
  return jsonRpcResult(0, task);
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
      const result = await handleGet(params);
      return { ...result, id } as JsonRpcResponse;
    }
    case "tasks/cancel": {
      const result = await handleCancel(params);
      return { ...result, id } as JsonRpcResponse;
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${body.method}`);
  }
}
