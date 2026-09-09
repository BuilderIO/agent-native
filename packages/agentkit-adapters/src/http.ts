import type {
  AgentActionResult,
  AgentCapabilities,
  AgentCapabilitiesDiscovery,
  AgentCapabilityDescriptor,
  AgentError,
  AgentEvent,
  AgentRequestContext,
  AgentTransport,
  DiscoverCapabilitiesInput,
  FilePart,
} from "@agent-native/agentkit-protocol";
import {
  AgentProtocolValidationError,
  AgentKitProtocolError,
  createCapabilityUnsupportedError,
  createAgentProtocolEnvelope,
  createOperationUnsupportedError,
  createRequestAbortedError,
  isAgentKitProtocolError,
  negotiateAgentKitProtocolVersion,
  parseAgentActionResult,
  parseAgentCapabilities,
  parseAgentCapabilitiesDiscovery,
  parseCancelRunInput,
  parseCompleteUploadInput,
  parseCreateThreadInput,
  parseCreateUploadInput,
  parseForkThreadInput,
  parseAgentEvent,
  parseGetRunInput,
  parseAgentQueuedMessages,
  parseAgentThread,
  parseAgentUploadTarget,
  parseAgentProtocolEnvelope,
  parseFilePart,
  parseInvokeActionInput,
  parseListThreadsInput,
  parseQueueMessageInput,
  parseQueueMessageResult,
  parseResolveApprovalInput,
  parseResolveConnectionRequestInput,
  parseStartRunInput,
  parseStartRunResult,
  parseSubscribeToRunInput,
  parseSteerQueuedMessageResult,
  parseSubmitFeedbackInput,
  parseThreadMessageInput,
  parseListThreadsResult,
  parseNullableAgentRunSnapshot,
  parseNullableAgentThread,
  parseNullableAgentThreadSnapshot,
  parseUpdateThreadInput,
  parseDiscoverCapabilitiesInput,
  parseVoidResponse,
} from "@agent-native/agentkit-protocol";

export interface AgentKitHttpTransportOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Stable request correlation for distributed traces and deterministic tests. */
  createCorrelationId?: () => string;
  /** Aborts every request owned by this transport lifecycle. */
  signal?: AbortSignal;
}

export class AgentKitHttpError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    public readonly code?: string,
    public readonly correlationId?: string,
    public readonly retryable = inferHttpRetryability(status),
  ) {
    super(message);
    this.name = "AgentKitHttpError";
  }
}

function inferHttpRetryability(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status !== 501 && status !== 505)
  );
}

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function defaultCorrelationId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `agentkit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function combineAbortSignals(
  first?: AbortSignal,
  second?: AbortSignal,
): { signal?: AbortSignal; release(): void } {
  if (!first) return { signal: second, release() {} };
  if (!second || first === second) return { signal: first, release() {} };
  const controller = new AbortController();
  const abortFromFirst = () => controller.abort(first.reason);
  const abortFromSecond = () => controller.abort(second.reason);
  if (first.aborted) abortFromFirst();
  else first.addEventListener("abort", abortFromFirst, { once: true });
  if (second.aborted) abortFromSecond();
  else second.addEventListener("abort", abortFromSecond, { once: true });
  return {
    signal: controller.signal,
    release() {
      first.removeEventListener("abort", abortFromFirst);
      second.removeEventListener("abort", abortFromSecond);
    },
  };
}

function requestAborted(
  correlationId: string | undefined,
  message?: string,
): AgentKitProtocolError {
  return new AgentKitProtocolError(
    createRequestAbortedError({ correlationId, message }),
  );
}

function assertRequestActive(
  signal: AbortSignal | undefined,
  correlationId: string | undefined,
): void {
  if (signal?.aborted) throw requestAborted(correlationId);
}

function isAbortFailure(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function assertRouteIdentifier(
  routeValue: string,
  payloadValue: string,
  name: string,
): void {
  if (routeValue !== payloadValue) {
    throw new AgentProtocolValidationError(
      name,
      "the route and request payload must match",
    );
  }
}

function responseCorrelationId(
  response: Response,
  envelopeCorrelationId?: string,
  expectedCorrelationId?: string,
): string | undefined {
  const headerCorrelationId =
    response.headers.get("x-agentkit-correlation-id") ?? undefined;
  const received = envelopeCorrelationId ?? headerCorrelationId;
  if (
    envelopeCorrelationId &&
    headerCorrelationId &&
    envelopeCorrelationId !== headerCorrelationId
  ) {
    throw new AgentProtocolValidationError(
      "envelope.correlationId",
      "must match the response correlation header",
    );
  }
  if (expectedCorrelationId && received && expectedCorrelationId !== received) {
    throw new AgentProtocolValidationError(
      "envelope.correlationId",
      "must match the request correlation id",
    );
  }
  return received ?? expectedCorrelationId;
}

async function parseResponse<T>(
  response: Response,
  parsePayload: (payload: unknown, path: string) => T,
  expectedCorrelationId?: string,
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AgentKitHttpError(
      response.status,
      "The AgentKit response was not valid JSON.",
      undefined,
      "invalid_response",
      responseCorrelationId(response, undefined, expectedCorrelationId),
      false,
    );
  }
  const envelope = parseAgentProtocolEnvelope(body);
  const correlationId = responseCorrelationId(
    response,
    envelope.correlationId,
    expectedCorrelationId,
  );
  if (!response.ok) {
    if (envelope.kind !== "error") {
      throw new AgentProtocolValidationError(
        "envelope.kind",
        "expected an error envelope",
      );
    }
    const payload = envelope.payload as AgentError;
    throw new AgentKitHttpError(
      response.status,
      payload.message,
      payload.details,
      payload.code,
      correlationId,
      payload.retryable ?? inferHttpRetryability(response.status),
    );
  }
  if (envelope.kind !== "response") {
    throw new AgentProtocolValidationError(
      "envelope.kind",
      "expected a response envelope",
    );
  }
  return parsePayload(envelope.payload, "envelope.payload");
}

async function* parseEventStream(
  response: Response,
  expectedCorrelationId: string,
  afterSequence: number,
): AsyncGenerator<AgentEvent> {
  if (!response.ok) {
    await parseResponse(response, parseVoidResponse, expectedCorrelationId);
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "text/event-stream") {
    throw new AgentKitHttpError(
      response.status,
      "The AgentKit event response was not an event stream.",
      undefined,
      "invalid_event_stream",
      responseCorrelationId(response, undefined, expectedCorrelationId),
      false,
    );
  }
  if (!response.body) {
    throw new AgentKitHttpError(
      response.status,
      "The AgentKit event response did not include a body.",
      undefined,
      "invalid_event_stream",
      responseCorrelationId(response, undefined, expectedCorrelationId),
      false,
    );
  }
  const correlationId = responseCorrelationId(
    response,
    undefined,
    expectedCorrelationId,
  );
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let lastSequence = afterSequence;
  let streamDone = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += value ?? "";
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const id = lines
          .find((line) => line.startsWith("id:"))
          ?.slice(3)
          .trim();
        if (
          id !== undefined &&
          (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))
        ) {
          throw new AgentProtocolValidationError(
            "event.id",
            "expected a non-negative safe integer cursor",
          );
        }
        const envelope = parseAgentProtocolEnvelope(
          JSON.parse(data) as unknown,
        );
        if (envelope.kind !== "event") {
          throw new AgentProtocolValidationError(
            "envelope.kind",
            "expected an event envelope",
          );
        }
        if (
          envelope.correlationId &&
          envelope.correlationId !== correlationId
        ) {
          throw new AgentProtocolValidationError(
            "envelope.correlationId",
            "must match the event stream correlation id",
          );
        }
        const event = parseAgentEvent(envelope.payload, "envelope.payload");
        if (id !== undefined && Number(id) !== event.sequence) {
          throw new AgentProtocolValidationError(
            "event.id",
            "must match the event sequence",
          );
        }
        if (event.sequence !== lastSequence + 1) {
          throw new AgentProtocolValidationError(
            "event.sequence",
            `must be contiguous after sequence ${lastSequence}`,
          );
        }
        lastSequence = event.sequence;
        yield event;
      }
      if (done) {
        streamDone = true;
        break;
      }
    }
    if (buffer.trim()) {
      throw new Error(
        "The AgentKit event stream ended with an incomplete event.",
      );
    }
  } finally {
    if (!streamDone) await Promise.allSettled([reader.cancel()]);
    reader.releaseLock();
  }
}

export function createAgentKitHttpTransport(
  options: AgentKitHttpTransportOptions,
): AgentTransport {
  const fetcher = options.fetch ?? globalThis.fetch;
  const baseUrl = trimSlash(options.baseUrl);
  const createCorrelationId =
    options.createCorrelationId ?? defaultCorrelationId;

  async function request<T>(
    path: string,
    parsePayload: (payload: unknown, path: string) => T,
    init: RequestInit = {},
    context?: AgentRequestContext,
  ): Promise<T> {
    const correlationId = context?.correlationId ?? createCorrelationId();
    const combinedSignal = combineAbortSignals(options.signal, context?.signal);
    assertRequestActive(combinedSignal.signal, correlationId);
    try {
      const configuredHeaders =
        typeof options.headers === "function"
          ? await options.headers()
          : options.headers;
      assertRequestActive(combinedSignal.signal, correlationId);
      const headers = new Headers(configuredHeaders);
      headers.set("x-agentkit-correlation-id", correlationId);
      let body = init.body;
      if (body !== undefined) {
        if (typeof body !== "string") {
          throw new AgentProtocolValidationError(
            "request.body",
            "expected a JSON request envelope",
          );
        }
        const envelope = parseAgentProtocolEnvelope(
          JSON.parse(body) as unknown,
        );
        if (envelope.kind !== "request") {
          throw new AgentProtocolValidationError(
            "envelope.kind",
            "expected a request envelope",
          );
        }
        body = JSON.stringify({ ...envelope, correlationId });
      }
      if (init.body !== undefined)
        headers.set("content-type", "application/json");
      headers.set("accept", "application/json");
      const response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        headers,
        body,
        signal: combinedSignal.signal,
      });
      assertRequestActive(combinedSignal.signal, correlationId);
      return await parseResponse(response, parsePayload, correlationId);
    } catch (error) {
      if (combinedSignal.signal?.aborted || isAbortFailure(error)) {
        throw requestAborted(correlationId);
      }
      throw error;
    } finally {
      combinedSignal.release();
    }
  }

  return {
    discoverCapabilities(input, context) {
      return request(
        "/capabilities/discover",
        parseAgentCapabilitiesDiscovery,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    getCapabilities(context) {
      return request("/capabilities", parseAgentCapabilities, {}, context);
    },
    createThread(input, context) {
      return request(
        "/threads",
        parseAgentThread,
        {
          method: "POST",
          body: JSON.stringify(
            createAgentProtocolEnvelope("request", input ?? {}),
          ),
        },
        context,
      );
    },
    listThreads(input, context) {
      const query = new URLSearchParams();
      if (input?.limit !== undefined) query.set("limit", String(input.limit));
      if (input?.cursor) query.set("cursor", input.cursor);
      return request(`/threads?${query}`, parseListThreadsResult, {}, context);
    },
    getThread(input, context) {
      return request(
        `/threads/${encodeURIComponent(input.threadId)}`,
        parseNullableAgentThread,
        {},
        context,
      );
    },
    getThreadSnapshot(input, context) {
      return request(
        `/threads/${encodeURIComponent(input.threadId)}/snapshot`,
        parseNullableAgentThreadSnapshot,
        {},
        context,
      );
    },
    updateThread(input, context) {
      return request(
        `/threads/${encodeURIComponent(input.threadId)}`,
        parseAgentThread,
        {
          method: "PATCH",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    forkThread(input, context) {
      return request(
        `/threads/${encodeURIComponent(input.threadId)}/fork`,
        parseAgentThread,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    async deleteThread(input, context) {
      await request(
        `/threads/${encodeURIComponent(input.threadId)}`,
        parseVoidResponse,
        { method: "DELETE" },
        context,
      );
    },
    listQueuedMessages(input, context) {
      return request(
        `/threads/${encodeURIComponent(input.threadId)}/queue`,
        parseAgentQueuedMessages,
        {},
        context,
      );
    },
    queueMessage(input, context) {
      return request(
        `/threads/${encodeURIComponent(input.threadId)}/queue`,
        parseQueueMessageResult,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    async steerQueuedMessage(input, context) {
      return request(
        `/threads/${encodeURIComponent(input.threadId)}/queue/${encodeURIComponent(input.messageId)}/steer`,
        parseSteerQueuedMessageResult,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    async removeQueuedMessage(input, context) {
      await request(
        `/threads/${encodeURIComponent(input.threadId)}/queue/${encodeURIComponent(input.messageId)}`,
        parseVoidResponse,
        { method: "DELETE" },
        context,
      );
    },
    async startRun(input, context) {
      return request(
        "/runs",
        parseStartRunResult,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    async *subscribeToRun(input) {
      parseSubscribeToRunInput(input);
      const afterSequence = input.afterSequence ?? 0;
      const query = new URLSearchParams({
        threadId: input.threadId,
        afterSequence: String(afterSequence),
      });
      const headers = new Headers(
        typeof options.headers === "function"
          ? await options.headers()
          : options.headers,
      );
      const correlationId = createCorrelationId();
      headers.set("x-agentkit-correlation-id", correlationId);
      headers.set("accept", "text/event-stream");
      const combinedSignal = combineAbortSignals(options.signal, input.signal);
      try {
        const response = await fetcher(
          `${baseUrl}/runs/${encodeURIComponent(input.runId)}/events?${query}`,
          { headers, signal: combinedSignal.signal },
        );
        yield* parseEventStream(response, correlationId, afterSequence);
      } finally {
        combinedSignal.release();
      }
    },
    async cancelRun(input, context) {
      await request(
        `/runs/${encodeURIComponent(input.runId)}/cancel`,
        parseVoidResponse,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    getRun(input, context) {
      const query = new URLSearchParams({ threadId: input.threadId });
      return request(
        `/runs/${encodeURIComponent(input.runId)}?${query}`,
        parseNullableAgentRunSnapshot,
        {},
        context,
      );
    },
    async resolveApproval(input, context) {
      await request(
        `/runs/${encodeURIComponent(input.runId)}/approvals/${encodeURIComponent(input.approvalId)}`,
        parseVoidResponse,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    async resolveConnectionRequest(input, context) {
      await request(
        `/runs/${encodeURIComponent(input.runId)}/connections/${encodeURIComponent(input.requestId)}`,
        parseVoidResponse,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    invokeAction(input, context): Promise<AgentActionResult> {
      return request(
        "/actions",
        parseAgentActionResult,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    createUpload(input, context) {
      return request(
        "/uploads",
        parseAgentUploadTarget,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    completeUpload(input, context): Promise<FilePart> {
      return request(
        `/uploads/${encodeURIComponent(input.uploadId)}/complete`,
        parseFilePart,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    async cancelUpload(input, context) {
      await request(
        `/uploads/${encodeURIComponent(input.uploadId)}/cancel`,
        parseVoidResponse,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
    async submitFeedback(input, context) {
      await request(
        "/feedback",
        parseVoidResponse,
        {
          method: "POST",
          body: JSON.stringify(createAgentProtocolEnvelope("request", input)),
        },
        context,
      );
    },
  };
}

export interface AgentKitHttpServerRequestContext<
  TTrustedContext,
> extends AgentRequestContext {
  /**
   * Host-resolved authority for this request. This value is never read from a
   * protocol envelope and is never serialized into an AgentKit response.
   */
  readonly trusted: TTrustedContext;
}

interface AgentKitHttpHandlerBaseOptions {
  basePath?: string;
  /** Receives validation, transport, and backend failures for host logging. */
  onError?: (error: unknown, request: Request) => void | Promise<void>;
}

export type AgentKitHttpHandlerOptions<TTrustedContext = never> =
  AgentKitHttpHandlerBaseOptions &
    (
      | {
          /** A host-owned transport for handlers whose trust scope is static. */
          transport: AgentTransport;
          transportOwnership?: never;
          resolveRequestContext?: never;
          createTransport?: never;
        }
      | {
          transport?: never;
          /**
           * Request-created transports are owned by the handler by default.
           * Use `borrowed` only when the factory returns a host-managed transport.
           */
          transportOwnership?: "borrowed" | "owned";
          /** Resolves authenticated, authorized host state from this request. */
          resolveRequestContext: (
            request: Request,
          ) => TTrustedContext | Promise<TTrustedContext>;
          /**
           * Creates a transport closed over the resolved authority. Transport
           * operations still receive only cancellation and correlation state.
           */
          createTransport: (
            context: AgentKitHttpServerRequestContext<TTrustedContext>,
          ) => AgentTransport | Promise<AgentTransport>;
        }
    );

function json(
  payload: unknown,
  status = 200,
  correlationId?: string,
): Response {
  return Response.json(
    createAgentProtocolEnvelope("response", payload ?? null, correlationId),
    {
      status,
      headers: correlationId
        ? { "x-agentkit-correlation-id": correlationId }
        : undefined,
    },
  );
}

function unsupported(
  operation: string,
  message: string,
  correlationId?: string,
): Response {
  return Response.json(
    createAgentProtocolEnvelope(
      "error",
      createOperationUnsupportedError(operation, {
        message,
        correlationId,
      }),
      correlationId,
    ),
    {
      status: 501,
      headers: correlationId
        ? { "x-agentkit-correlation-id": correlationId }
        : undefined,
    },
  );
}

function capabilityDescriptors(
  capabilities: AgentCapabilities,
): AgentCapabilityDescriptor[] {
  const descriptors: AgentCapabilityDescriptor[] = [];
  for (const [id, value] of Object.entries(capabilities)) {
    if (id === "protocolVersion") continue;
    if (value !== true && value !== false && id !== "reasoning") continue;
    const unsupported =
      value === false || (id === "reasoning" && value === "none");
    descriptors.push(
      unsupported
        ? {
            id: id as AgentCapabilityDescriptor["id"],
            state: "unsupported",
            error: createCapabilityUnsupportedError(
              id as AgentCapabilityDescriptor["id"],
            ),
          }
        : {
            id: id as AgentCapabilityDescriptor["id"],
            state: "available",
          },
    );
  }
  return descriptors;
}

async function discoverCapabilities(
  transport: AgentTransport,
  input: DiscoverCapabilitiesInput,
  correlationId?: string,
  context?: AgentRequestContext,
): Promise<AgentCapabilitiesDiscovery> {
  if (transport.discoverCapabilities) {
    return transport.discoverCapabilities(input, context);
  }
  const protocol = negotiateAgentKitProtocolVersion(input.protocol, {
    correlationId,
  });
  const legacy = transport.getCapabilities
    ? await transport.getCapabilities(context)
    : (transport.capabilities ?? {});
  return {
    protocol,
    capabilities: capabilityDescriptors(legacy),
    discoveredAt: new Date().toISOString(),
    legacy,
  };
}

async function requestPayload<T>(
  request: Request,
  parse: (value: unknown) => T,
  expectedCorrelationId?: string,
): Promise<{ value: T; correlationId?: string }> {
  const envelope = parseAgentProtocolEnvelope(await request.json());
  if (envelope.kind !== "request") {
    throw new AgentProtocolValidationError(
      "envelope.kind",
      "expected a request envelope",
    );
  }
  if (
    expectedCorrelationId &&
    envelope.correlationId &&
    expectedCorrelationId !== envelope.correlationId
  ) {
    throw new AgentProtocolValidationError(
      "envelope.correlationId",
      "must match the request correlation header",
    );
  }
  return {
    value: parse(envelope.payload),
    correlationId: envelope.correlationId ?? expectedCorrelationId,
  };
}

function eventStream(
  events: AsyncIterable<AgentEvent>,
  abortController: AbortController,
  correlationId?: string,
  subscription?: { threadId: string; runId: string; afterSequence: number },
  onClose?: () => void | Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  const signal = abortController.signal;
  let lastSequence = subscription?.afterSequence ?? 0;
  let readerCancelled = false;
  let finalization: Promise<void> | undefined;
  const finalize = (): Promise<void> => {
    finalization ??= (async () => {
      signal.removeEventListener("abort", stopIterator);
      try {
        await iterator.return?.();
      } finally {
        await onClose?.();
      }
    })();
    return finalization;
  };
  const stopIterator = () => {
    void finalize();
  };
  signal.addEventListener("abort", stopIterator, { once: true });
  return new Response(
    new ReadableStream({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            if (!readerCancelled) controller.close();
            await finalize();
            return;
          }
          const event = parseAgentEvent(next.value);
          if (subscription && event.threadId !== subscription.threadId) {
            throw new AgentProtocolValidationError(
              "event.threadId",
              "must match the subscribed thread",
            );
          }
          if (subscription && event.runId !== subscription.runId) {
            throw new AgentProtocolValidationError(
              "event.runId",
              "must match the subscribed run",
            );
          }
          if (event.sequence !== lastSequence + 1) {
            throw new AgentProtocolValidationError(
              "event.sequence",
              `must be contiguous after sequence ${lastSequence}`,
            );
          }
          lastSequence = event.sequence;
          controller.enqueue(
            encoder.encode(
              `id: ${event.sequence}\ndata: ${JSON.stringify(createAgentProtocolEnvelope("event", event, correlationId))}\n\n`,
            ),
          );
        } catch (error) {
          if (!signal.aborted) controller.error(error);
          else if (!readerCancelled) controller.close();
          await finalize();
        } finally {
          if (signal.aborted) await finalize();
        }
      },
      async cancel() {
        readerCancelled = true;
        abortController.abort();
        await finalize();
      },
    }),
    {
      headers: {
        "cache-control": "no-cache, no-transform",
        "content-type": "text/event-stream",
        ...(correlationId
          ? { "x-agentkit-correlation-id": correlationId }
          : {}),
      },
    },
  );
}

/** Framework-neutral Fetch handler for serverless, Node, and edge runtimes. */
export function createAgentKitHttpHandler<TTrustedContext = never>(
  options: AgentKitHttpHandlerOptions<TTrustedContext>,
): (request: Request) => Promise<Response> {
  const basePath = trimSlash(options.basePath ?? "/agentkit");
  return async (request) => {
    let correlationId =
      request.headers.get("x-agentkit-correlation-id") ?? undefined;
    let requestTransport: Promise<AgentTransport> | undefined;
    let createdTransport: AgentTransport | undefined;
    let transportDisposal: Promise<void> | undefined;
    let streamOwnsTransportLifecycle = false;
    const reportError = async (error: unknown): Promise<void> => {
      try {
        await options.onError?.(error, request);
      } catch (observerError) {
        // Error observers must not prevent a standards-compliant response to
        // the original failed request.
        console.error("AgentKit error observer failed.", observerError);
      }
    };
    const disposeRequestTransport = (): Promise<void> => {
      if (
        options.transport ||
        options.transportOwnership === "borrowed" ||
        !createdTransport?.dispose
      ) {
        return Promise.resolve();
      }
      transportDisposal ??= Promise.resolve().then(() =>
        createdTransport?.dispose?.(),
      );
      return transportDisposal;
    };
    const releaseRequestTransport = async (): Promise<void> => {
      try {
        await disposeRequestTransport();
      } catch (error) {
        await reportError(error);
      }
    };
    const getTransport = (): Promise<AgentTransport> => {
      if (options.transport) return Promise.resolve(options.transport);
      requestTransport ??= (async () => {
        assertRequestActive(request.signal, correlationId);
        const trusted = await options.resolveRequestContext(request);
        assertRequestActive(request.signal, correlationId);
        const context: AgentKitHttpServerRequestContext<TTrustedContext> = {
          trusted,
          signal: request.signal,
          get correlationId() {
            return correlationId;
          },
        };
        const transport = await options.createTransport(context);
        createdTransport = transport;
        assertRequestActive(request.signal, correlationId);
        return transport;
      })();
      return requestTransport;
    };
    const respond = (payload: unknown, status = 200) =>
      json(payload, status, correlationId);
    const notSupported = (operation: string, message: string) =>
      unsupported(operation, message, correlationId);
    const readPayload = async <T>(parse: (value: unknown) => T): Promise<T> => {
      const parsed = await requestPayload(request, parse, correlationId);
      correlationId = parsed.correlationId;
      return parsed.value;
    };
    const invoke = async <T>(
      operation: (context: AgentRequestContext) => Promise<T>,
    ): Promise<T> => {
      const context: AgentRequestContext = {
        signal: request.signal,
        ...(correlationId ? { correlationId } : {}),
      };
      assertRequestActive(context.signal, context.correlationId);
      try {
        const result = await operation(context);
        assertRequestActive(context.signal, context.correlationId);
        return result;
      } catch (error) {
        if (context.signal?.aborted || isAbortFailure(error)) {
          throw requestAborted(context.correlationId);
        }
        throw error;
      }
    };
    try {
      assertRequestActive(request.signal, correlationId);
      const url = new URL(request.url);
      const path = url.pathname.startsWith(basePath)
        ? url.pathname.slice(basePath.length) || "/"
        : url.pathname;
      const transport = await getTransport();
      if (request.method === "GET" && path === "/capabilities") {
        const getCapabilities = transport.getCapabilities;
        return respond(
          getCapabilities
            ? await invoke((context) => getCapabilities(context))
            : (transport.capabilities ?? {}),
        );
      }
      if (request.method === "POST" && path === "/capabilities/discover") {
        const input = await readPayload(parseDiscoverCapabilitiesInput);
        return respond(
          await invoke((context) =>
            discoverCapabilities(transport, input, correlationId, context),
          ),
        );
      }
      if (request.method === "POST" && path === "/runs") {
        const input = await readPayload(parseStartRunInput);
        return respond(
          await invoke((context) => transport.startRun(input, context)),
          201,
        );
      }
      if (path === "/threads" && request.method === "POST") {
        const createThread = transport.createThread;
        if (!createThread)
          return notSupported(
            "createThread",
            "Thread creation is not supported.",
          );
        const input = await readPayload(parseCreateThreadInput);
        return respond(
          await invoke((context) => createThread(input, context)),
          201,
        );
      }
      if (path === "/threads" && request.method === "GET") {
        const listThreads = transport.listThreads;
        if (!listThreads)
          return notSupported(
            "listThreads",
            "Thread listing is not supported.",
          );
        const input = parseListThreadsInput({
          limit: url.searchParams.has("limit")
            ? Number(url.searchParams.get("limit"))
            : undefined,
          cursor: url.searchParams.get("cursor") ?? undefined,
        });
        return respond(await invoke((context) => listThreads(input, context)));
      }
      const snapshotMatch = path.match(/^\/threads\/([^/]+)\/snapshot$/);
      if (snapshotMatch?.[1] && request.method === "GET") {
        const getThreadSnapshot = transport.getThreadSnapshot;
        if (!getThreadSnapshot)
          return notSupported(
            "getThreadSnapshot",
            "Thread snapshots are not supported.",
          );
        return respond(
          await invoke((context) =>
            getThreadSnapshot(
              { threadId: decodeURIComponent(snapshotMatch[1]) },
              context,
            ),
          ),
        );
      }
      const forkMatch = path.match(/^\/threads\/([^/]+)\/fork$/);
      if (forkMatch?.[1] && request.method === "POST") {
        const forkThread = transport.forkThread;
        if (!forkThread)
          return notSupported("forkThread", "Thread forking is not supported.");
        const input = await readPayload(parseForkThreadInput);
        assertRouteIdentifier(
          decodeURIComponent(forkMatch[1]),
          input.threadId,
          "threadId",
        );
        return respond(
          await invoke((context) => forkThread(input, context)),
          201,
        );
      }
      const queueItemMatch = path.match(
        /^\/threads\/([^/]+)\/queue\/([^/]+)(?:\/(steer))?$/,
      );
      if (queueItemMatch?.[1] && queueItemMatch[2]) {
        const routeInput = {
          threadId: decodeURIComponent(queueItemMatch[1]),
          messageId: decodeURIComponent(queueItemMatch[2]),
        };
        if (request.method === "POST" && queueItemMatch[3] === "steer") {
          const steerQueuedMessage = transport.steerQueuedMessage;
          if (!steerQueuedMessage)
            return notSupported(
              "steerQueuedMessage",
              "Queue steering is not supported.",
            );
          const input = await readPayload(parseThreadMessageInput);
          assertRouteIdentifier(
            routeInput.threadId,
            input.threadId,
            "threadId",
          );
          assertRouteIdentifier(
            routeInput.messageId,
            input.messageId,
            "messageId",
          );
          return respond(
            await invoke((context) => steerQueuedMessage(input, context)),
          );
        }
        if (request.method === "DELETE" && !queueItemMatch[3]) {
          const removeQueuedMessage = transport.removeQueuedMessage;
          if (!removeQueuedMessage)
            return notSupported(
              "removeQueuedMessage",
              "Queue removal is not supported.",
            );
          const input = parseThreadMessageInput(routeInput);
          await invoke((context) => removeQueuedMessage(input, context));
          return respond(undefined);
        }
      }
      const queueMatch = path.match(/^\/threads\/([^/]+)\/queue$/);
      if (queueMatch?.[1]) {
        const threadId = decodeURIComponent(queueMatch[1]);
        if (request.method === "GET") {
          const listQueuedMessages = transport.listQueuedMessages;
          if (!listQueuedMessages)
            return notSupported(
              "listQueuedMessages",
              "Queued message listing is not supported.",
            );
          return respond(
            await invoke((context) =>
              listQueuedMessages({ threadId }, context),
            ),
          );
        }
        if (request.method === "POST") {
          const queueMessage = transport.queueMessage;
          if (!queueMessage)
            return notSupported(
              "queueMessage",
              "Message queues are not supported.",
            );
          const input = await readPayload(parseQueueMessageInput);
          assertRouteIdentifier(threadId, input.threadId, "threadId");
          return respond(
            await invoke((context) => queueMessage(input, context)),
            201,
          );
        }
      }
      const threadMatch = path.match(/^\/threads\/([^/]+)$/);
      if (threadMatch?.[1]) {
        const threadId = decodeURIComponent(threadMatch[1]);
        if (request.method === "GET") {
          const getThread = transport.getThread;
          if (!getThread)
            return notSupported("getThread", "Thread reads are not supported.");
          return respond(
            await invoke((context) => getThread({ threadId }, context)),
          );
        }
        if (request.method === "PATCH") {
          const updateThread = transport.updateThread;
          if (!updateThread)
            return notSupported(
              "updateThread",
              "Thread updates are not supported.",
            );
          const input = await readPayload(parseUpdateThreadInput);
          assertRouteIdentifier(threadId, input.threadId, "threadId");
          return respond(
            await invoke((context) => updateThread(input, context)),
          );
        }
        if (request.method === "DELETE") {
          const deleteThread = transport.deleteThread;
          if (!deleteThread)
            return notSupported(
              "deleteThread",
              "Thread deletion is not supported.",
            );
          await invoke((context) => deleteThread({ threadId }, context));
          return respond(undefined);
        }
      }
      const eventsMatch = path.match(/^\/runs\/([^/]+)\/events$/);
      if (request.method === "GET" && eventsMatch?.[1]) {
        const threadId = url.searchParams.get("threadId");
        if (!threadId) {
          throw new AgentProtocolValidationError("threadId", "is required");
        }
        const afterSequenceValue = url.searchParams.get("afterSequence") ?? "0";
        if (
          !/^\d+$/.test(afterSequenceValue) ||
          !Number.isSafeInteger(Number(afterSequenceValue))
        ) {
          throw new AgentProtocolValidationError(
            "afterSequence",
            "expected a non-negative safe integer",
          );
        }
        const runId = decodeURIComponent(eventsMatch[1]);
        const input = parseSubscribeToRunInput({
          runId,
          threadId,
          afterSequence: Number(afterSequenceValue),
        });
        const abortController = new AbortController();
        const abortFromRequest = () =>
          abortController.abort(request.signal.reason);
        if (request.signal.aborted) abortFromRequest();
        else
          request.signal.addEventListener("abort", abortFromRequest, {
            once: true,
          });
        const response = eventStream(
          transport.subscribeToRun({
            ...input,
            signal: abortController.signal,
          }),
          abortController,
          correlationId,
          {
            threadId: input.threadId,
            runId: input.runId,
            afterSequence: input.afterSequence ?? 0,
          },
          async () => {
            request.signal.removeEventListener("abort", abortFromRequest);
            await releaseRequestTransport();
          },
        );
        streamOwnsTransportLifecycle = true;
        return response;
      }
      const runMatch = path.match(/^\/runs\/([^/]+)$/);
      if (request.method === "GET" && runMatch?.[1]) {
        const getRun = transport.getRun;
        if (!getRun)
          return notSupported("getRun", "Run reads are not supported.");
        const threadId = url.searchParams.get("threadId");
        if (!threadId) {
          throw new AgentProtocolValidationError("threadId", "is required");
        }
        const input = parseGetRunInput({
          runId: decodeURIComponent(runMatch[1]),
          threadId,
        });
        return respond(await invoke((context) => getRun(input, context)));
      }
      const cancelMatch = path.match(/^\/runs\/([^/]+)\/cancel$/);
      if (request.method === "POST" && cancelMatch?.[1]) {
        const input = await readPayload(parseCancelRunInput);
        assertRouteIdentifier(
          decodeURIComponent(cancelMatch[1]),
          input.runId,
          "runId",
        );
        await invoke((context) => transport.cancelRun(input, context));
        return respond(undefined);
      }
      const approvalMatch = path.match(/^\/runs\/([^/]+)\/approvals\/([^/]+)$/);
      if (request.method === "POST" && approvalMatch) {
        const resolveApproval = transport.resolveApproval;
        if (!resolveApproval) {
          return notSupported(
            "resolveApproval",
            "Approvals are not supported.",
          );
        }
        const input = await readPayload(parseResolveApprovalInput);
        assertRouteIdentifier(
          decodeURIComponent(approvalMatch[1] ?? ""),
          input.runId,
          "runId",
        );
        assertRouteIdentifier(
          decodeURIComponent(approvalMatch[2] ?? ""),
          input.approvalId,
          "approvalId",
        );
        await invoke((context) => resolveApproval(input, context));
        return respond(undefined);
      }
      const connectionMatch = path.match(
        /^\/runs\/([^/]+)\/connections\/([^/]+)$/,
      );
      if (request.method === "POST" && connectionMatch) {
        const resolveConnectionRequest = transport.resolveConnectionRequest;
        if (!resolveConnectionRequest) {
          return notSupported(
            "resolveConnectionRequest",
            "Connection requests are not supported.",
          );
        }
        const input = await readPayload(parseResolveConnectionRequestInput);
        assertRouteIdentifier(
          decodeURIComponent(connectionMatch[1] ?? ""),
          input.runId,
          "runId",
        );
        assertRouteIdentifier(
          decodeURIComponent(connectionMatch[2] ?? ""),
          input.requestId,
          "requestId",
        );
        await invoke((context) => resolveConnectionRequest(input, context));
        return respond(undefined);
      }
      if (request.method === "POST" && path === "/actions") {
        const invokeAction = transport.invokeAction;
        if (!invokeAction) {
          return notSupported("invokeAction", "Actions are not supported.");
        }
        const input = await readPayload(parseInvokeActionInput);
        return respond(await invoke((context) => invokeAction(input, context)));
      }
      if (request.method === "POST" && path === "/uploads") {
        const createUpload = transport.createUpload;
        if (!createUpload)
          return notSupported("createUpload", "Uploads are not supported.");
        const input = await readPayload(parseCreateUploadInput);
        return respond(
          await invoke((context) => createUpload(input, context)),
          201,
        );
      }
      const uploadMatch = path.match(/^\/uploads\/([^/]+)\/(complete|cancel)$/);
      if (request.method === "POST" && uploadMatch?.[1] && uploadMatch[2]) {
        const payload = await readPayload(parseCompleteUploadInput);
        assertRouteIdentifier(
          decodeURIComponent(uploadMatch[1]),
          payload.uploadId,
          "uploadId",
        );
        if (uploadMatch[2] === "complete") {
          const completeUpload = transport.completeUpload;
          if (!completeUpload)
            return notSupported(
              "completeUpload",
              "Upload completion is not supported.",
            );
          return respond(
            await invoke((context) => completeUpload(payload, context)),
          );
        }
        const cancelUpload = transport.cancelUpload;
        if (!cancelUpload)
          return notSupported(
            "cancelUpload",
            "Upload cancellation is not supported.",
          );
        await invoke((context) => cancelUpload(payload, context));
        return respond(undefined);
      }
      if (request.method === "POST" && path === "/feedback") {
        const submitFeedback = transport.submitFeedback;
        if (!submitFeedback)
          return notSupported("submitFeedback", "Feedback is not supported.");
        const input = await readPayload(parseSubmitFeedbackInput);
        await invoke((context) => submitFeedback(input, context));
        return respond(undefined);
      }
      return Response.json(
        createAgentProtocolEnvelope(
          "error",
          {
            code: "route_not_found",
            message: "AgentKit route not found.",
            retryable: false,
            correlationId,
          },
          correlationId,
        ),
        {
          status: 404,
          headers: correlationId
            ? { "x-agentkit-correlation-id": correlationId }
            : undefined,
        },
      );
    } catch (error) {
      await reportError(error);
      const expected =
        error instanceof AgentProtocolValidationError ||
        error instanceof SyntaxError;
      const propagated =
        error instanceof AgentKitHttpError
          ? {
              code: error.code ?? "http_error",
              message: error.message,
              retryable: error.retryable,
              correlationId: error.correlationId,
              details: error.details,
            }
          : isAgentKitProtocolError(error)
            ? error.protocolError
            : request.signal.aborted || isAbortFailure(error)
              ? createRequestAbortedError({ correlationId })
              : undefined;
      correlationId = propagated?.correlationId ?? correlationId;
      const status =
        error instanceof AgentKitHttpError
          ? error.status
          : propagated?.code === "request_aborted"
            ? 499
            : propagated?.code === "operation_unsupported" ||
                propagated?.code === "capability_unsupported"
              ? 501
              : propagated?.code === "capability_unavailable"
                ? 503
                : propagated?.code === "protocol_version_unsupported"
                  ? 426
                  : expected
                    ? 400
                    : 500;
      const payload: AgentError =
        propagated ??
        (expected
          ? {
              code: "invalid_request",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
              correlationId,
            }
          : {
              code: "internal_error",
              message: "The AgentKit request could not be completed.",
              retryable: true,
              correlationId,
            });
      return Response.json(
        createAgentProtocolEnvelope("error", payload, correlationId),
        {
          status,
          headers: correlationId
            ? { "x-agentkit-correlation-id": correlationId }
            : undefined,
        },
      );
    } finally {
      if (!streamOwnsTransportLifecycle) await releaseRequestTransport();
    }
  };
}
