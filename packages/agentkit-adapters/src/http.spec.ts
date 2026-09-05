import type {
  AgentEvent,
  AgentTransport,
} from "@agent-native/agentkit-protocol";
import {
  AgentKitProtocolError,
  createAgentProtocolEnvelope,
} from "@agent-native/agentkit-protocol";
import { describe, expect, it, vi } from "vitest";

import {
  AgentKitHttpError,
  createAgentKitHttpHandler,
  createAgentKitHttpTransport,
} from "./http.js";

describe("AgentKit HTTP adapter", () => {
  it("round-trips commands and resumable SSE through Fetch primitives", async () => {
    const events: AgentEvent[] = [
      {
        id: "event-1",
        threadId: "thread-1",
        runId: "run-1",
        sequence: 1,
        occurredAt: "2026-08-29T00:00:00.000Z",
        type: "run.started",
      },
      {
        id: "event-2",
        threadId: "thread-1",
        runId: "run-1",
        sequence: 2,
        occurredAt: "2026-08-29T00:00:01.000Z",
        type: "run.completed",
      },
    ];
    const serverTransport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun(input) {
        yield* events.filter(
          (event) => event.sequence > (input.afterSequence ?? 0),
        );
      },
      async cancelRun() {},
      async getRun() {
        return {
          id: "run-1",
          threadId: "thread-1",
          status: "completed",
          lastSequence: 2,
        };
      },
    };
    const handler = createAgentKitHttpHandler({
      transport: serverTransport,
      basePath: "/agentkit",
    });
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      createCorrelationId: () => "request-42",
      fetch: (input, init) => handler(new Request(input, init)),
    });

    const started = await transport.startRun({
      threadId: "thread-1",
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "Go" }],
        },
      ],
    });
    const replay: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId: started.runId,
      afterSequence: 1,
    })) {
      replay.push(event);
    }

    expect(started.runId).toBe("run-1");
    expect(replay.map((event) => event.id)).toEqual(["event-2"]);
    await expect(
      transport.cancelRun({ threadId: "thread-1", runId: "run-1" }),
    ).resolves.toBeUndefined();
    await expect(
      transport.getRun?.({ threadId: "thread-1", runId: "run-1" }),
    ).resolves.toMatchObject({ lastSequence: 2 });
  });

  it("round-trips structured connection decisions without provider setup data", async () => {
    const resolveConnectionRequest = vi.fn(async () => undefined);
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        resolveConnectionRequest,
      },
    });
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      fetch: (input, init) => handler(new Request(input, init)),
    });

    await transport.resolveConnectionRequest?.({
      threadId: "thread-1",
      runId: "run-1",
      requestId: "connection-1",
      response: { status: "connected", connectionId: "workspace-slack" },
    });

    expect(resolveConnectionRequest).toHaveBeenCalledWith(
      {
        threadId: "thread-1",
        runId: "run-1",
        requestId: "connection-1",
        response: {
          status: "connected",
          connectionId: "workspace-slack",
        },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects malformed commands and route identity mismatches", async () => {
    const queueMessage = vi.fn();
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        queueMessage,
      },
    });
    const request = (payload: unknown) =>
      handler(
        new Request("https://agentkit.test/agentkit/threads/thread-1/queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createAgentProtocolEnvelope("request", payload)),
        }),
      );

    expect((await request({ threadId: "thread-1", text: 42 })).status).toBe(
      400,
    );
    expect((await request({ threadId: "thread-2", text: "Go" })).status).toBe(
      400,
    );
    expect(queueMessage).not.toHaveBeenCalled();
  });

  it("keeps backend failures opaque while reporting them to the host", async () => {
    const onError = vi.fn();
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          throw new Error("database password appeared here");
        },
        async *subscribeToRun() {},
        async cancelRun() {},
      },
      onError,
    });
    const response = await handler(
      new Request("https://agentkit.test/agentkit/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          createAgentProtocolEnvelope("request", {
            threadId: "thread-1",
            messages: [],
          }),
        ),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("database password");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("validates response payloads before exposing them to a client", async () => {
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      fetch: async () =>
        Response.json(createAgentProtocolEnvelope("response", { runId: 42 })),
    });

    await expect(
      transport.startRun({ threadId: "thread-1", messages: [] }),
    ).rejects.toThrow("runId: expected a non-empty string");
  });

  it("discovers server capabilities through the versioned endpoint", async () => {
    const handler = createAgentKitHttpHandler({
      transport: {
        capabilities: {
          approvals: true,
          messageQueue: true,
          resumableRuns: false,
        },
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
      },
    });
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      createCorrelationId: () => "request-42",
      fetch: (input, init) => handler(new Request(input, init)),
    });

    await expect(transport.getCapabilities?.()).resolves.toEqual({
      approvals: true,
      messageQueue: true,
      resumableRuns: false,
    });
  });

  it("reports unsupported operations as typed failures instead of empty success", async () => {
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
      },
    });
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      createCorrelationId: () => "request-42",
      fetch: (input, init) => handler(new Request(input, init)),
    });

    const failure = await transport.listThreads?.().catch((error) => error);

    expect(failure).toBeInstanceOf(AgentKitHttpError);
    expect(failure).toMatchObject({
      status: 501,
      code: "operation_unsupported",
      correlationId: "request-42",
      retryable: false,
    });
  });

  it("still responds when the host error observer fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          throw new Error("backend failed");
        },
        async *subscribeToRun() {},
        async cancelRun() {},
      },
      async onError() {
        throw new Error("telemetry failed");
      },
    });

    const response = await handler(
      new Request("https://agentkit.test/agentkit/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agentkit-correlation-id": "request-43",
        },
        body: JSON.stringify(
          createAgentProtocolEnvelope("request", {
            threadId: "thread-1",
            messages: [],
          }),
        ),
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-agentkit-correlation-id")).toBe(
      "request-43",
    );
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("uses a typed error envelope for unknown routes", async () => {
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
      },
    });

    const response = await handler(
      new Request("https://agentkit.test/agentkit/not-a-route"),
    );
    const body = (await response.json()) as {
      kind: string;
      payload: { code: string };
    };

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      kind: "error",
      payload: { code: "route_not_found" },
    });
  });

  it("rejects a successful response with the wrong envelope kind before parsing its payload", async () => {
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      fetch: async () =>
        Response.json(
          createAgentProtocolEnvelope("event", {
            id: "event-1",
            threadId: "thread-1",
            runId: "run-1",
            sequence: 1,
            occurredAt: "2026-08-29T00:00:00.000Z",
            type: "run.started",
          }),
        ),
    });

    await expect(
      transport.startRun({ threadId: "thread-1", messages: [] }),
    ).rejects.toThrow("expected a response envelope");
  });

  it("requires an SSE content type and validates cursors before fetching", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("not an event stream", {
          headers: { "content-type": "application/json" },
        }),
    );
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      fetch: fetcher,
    });

    await expect(
      transport
        .subscribeToRun({
          threadId: "thread-1",
          runId: "run-1",
          afterSequence: -1,
        })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toThrow("non-negative safe integer");
    expect(fetcher).not.toHaveBeenCalled();

    const failure = await transport
      .subscribeToRun({ threadId: "thread-1", runId: "run-1" })
      [Symbol.asyncIterator]()
      .next()
      .catch((error) => error);
    expect(failure).toBeInstanceOf(AgentKitHttpError);
    expect(failure).toMatchObject({
      code: "invalid_event_stream",
      retryable: false,
    });
  });

  it("rejects non-event envelopes inside an SSE response", async () => {
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      createCorrelationId: () => "request-42",
      fetch: async () =>
        new Response(
          `data: ${JSON.stringify(
            createAgentProtocolEnvelope(
              "response",
              { runId: "run-1" },
              "request-42",
            ),
          )}\n\n`,
          {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "x-agentkit-correlation-id": "request-42",
            },
          },
        ),
    });

    await expect(
      transport
        .subscribeToRun({ threadId: "thread-1", runId: "run-1" })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toThrow("expected an event envelope");
  });

  it("rejects an SSE sequence gap before advancing the replay cursor", async () => {
    const event = (sequence: number) =>
      createAgentProtocolEnvelope("event", {
        id: `event-${sequence}`,
        threadId: "thread-1",
        runId: "run-1",
        sequence,
        occurredAt: "2026-08-29T00:00:00.000Z",
        type: "message.delta",
        messageId: "message-1",
        text: String(sequence),
      } satisfies AgentEvent);
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      fetch: async () =>
        new Response(
          `id: 1\ndata: ${JSON.stringify(event(1))}\n\nid: 3\ndata: ${JSON.stringify(event(3))}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        ),
    });

    const iterator = transport
      .subscribeToRun({ threadId: "thread-1", runId: "run-1" })
      [Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { sequence: 1 },
    });
    await expect(iterator.next()).rejects.toThrow(
      "must be contiguous after sequence 1",
    );
  });

  it("rejects a backend sequence gap before writing an invalid SSE cursor", async () => {
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {
          for (const sequence of [1, 3]) {
            yield {
              id: `event-${sequence}`,
              threadId: "thread-1",
              runId: "run-1",
              sequence,
              occurredAt: "2026-08-29T00:00:00.000Z",
              type: "run.started",
            } satisfies AgentEvent;
          }
        },
        async cancelRun() {},
      },
    });

    const response = await handler(
      new Request(
        "https://agentkit.test/agentkit/runs/run-1/events?threadId=thread-1",
      ),
    );
    await expect(response.text()).rejects.toThrow(
      "must be contiguous after sequence 1",
    );
  });

  it("propagates one correlation id through request envelopes, headers, and errors", async () => {
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      createCorrelationId: () => "correlation-99",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          correlationId?: string;
        };
        const headers = new Headers(init?.headers);
        expect(body.correlationId).toBe("correlation-99");
        expect(headers.get("x-agentkit-correlation-id")).toBe("correlation-99");
        return Response.json(
          createAgentProtocolEnvelope(
            "error",
            {
              code: "temporarily_unavailable",
              message: "Try again later.",
              retryable: true,
              correlationId: "correlation-99",
            },
            "correlation-99",
          ),
          {
            status: 503,
            headers: { "x-agentkit-correlation-id": "correlation-99" },
          },
        );
      },
    });

    const failure = await transport
      .startRun({ threadId: "thread-1", messages: [] })
      .catch((error) => error);

    expect(failure).toMatchObject({
      status: 503,
      code: "temporarily_unavailable",
      correlationId: "correlation-99",
      retryable: true,
    });
  });

  it("rejects an aborted request before invoking fetch with a typed correlated error", async () => {
    const fetcher = vi.fn();
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      fetch: fetcher,
    });
    const controller = new AbortController();
    controller.abort("caller left");

    const failure = await transport
      .startRun(
        { threadId: "thread-1", messages: [] },
        { signal: controller.signal, correlationId: "request-aborted" },
      )
      .catch((error) => error);

    expect(fetcher).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(AgentKitProtocolError);
    expect(failure).toMatchObject({
      code: "request_aborted",
      retryable: false,
      correlationId: "request-aborted",
    });
  });

  it("turns an in-flight client abort into a typed correlated error", async () => {
    const requested = Promise.withResolvers<void>();
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      fetch: async (_input, init) => {
        requested.resolve();
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const controller = new AbortController();
    const operation = transport.startRun(
      { threadId: "thread-1", messages: [] },
      { signal: controller.signal, correlationId: "request-in-flight" },
    );
    await requested.promise;

    controller.abort("caller left");
    const failure = await operation.catch((error) => error);

    expect(failure).toBeInstanceOf(AgentKitProtocolError);
    expect(failure).toMatchObject({
      code: "request_aborted",
      retryable: false,
      correlationId: "request-in-flight",
    });
  });

  it("propagates request cancellation and correlation to in-flight backend work", async () => {
    const invoked = Promise.withResolvers<void>();
    let observedSignal: AbortSignal | undefined;
    let observedCorrelationId: string | undefined;
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun(_input, context) {
          observedSignal = context?.signal;
          observedCorrelationId = context?.correlationId;
          invoked.resolve();
          return await new Promise((_resolve, reject) => {
            context?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        },
        async *subscribeToRun() {},
        async cancelRun() {},
      },
    });
    const controller = new AbortController();
    const response = handler(
      new Request("https://agentkit.test/agentkit/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agentkit-correlation-id": "request-backend",
        },
        body: JSON.stringify(
          createAgentProtocolEnvelope("request", {
            threadId: "thread-1",
            messages: [],
          }),
        ),
        signal: controller.signal,
      }),
    );
    await invoked.promise;

    controller.abort("request disconnected");
    const result = await response;
    const envelope = (await result.json()) as {
      payload: { code: string; correlationId?: string; retryable: boolean };
    };

    expect(observedCorrelationId).toBe("request-backend");
    expect(observedSignal?.aborted).toBe(true);
    expect(result.status).toBe(499);
    expect(envelope.payload).toMatchObject({
      code: "request_aborted",
      retryable: false,
      correlationId: "request-backend",
    });
  });

  it("aborts the backend subscription when the response consumer disconnects", async () => {
    const subscribed = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const cancelRun = vi.fn(async () => undefined);
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun({ signal }) {
          subscribed.resolve();
          yield {
            id: "event-1",
            threadId: "thread-1",
            runId: "run-1",
            sequence: 1,
            occurredAt: "2026-08-29T00:00:00.000Z",
            type: "run.started",
          } satisfies AgentEvent;
          await new Promise<void>((resolve) =>
            signal?.addEventListener(
              "abort",
              () => {
                aborted.resolve();
                resolve();
              },
              { once: true },
            ),
          );
        },
        cancelRun,
      },
    });
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      fetch: (input, init) => handler(new Request(input, init)),
    });

    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId: "run-1",
    })) {
      expect(event.sequence).toBe(1);
      break;
    }
    await subscribed.promise;
    await aborted.promise;
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it("propagates request disconnects to the backend subscription signal", async () => {
    const subscribed = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun({ signal }) {
          subscribed.resolve();
          await new Promise<void>((resolve) =>
            signal?.addEventListener(
              "abort",
              () => {
                aborted.resolve();
                resolve();
              },
              { once: true },
            ),
          );
        },
        async cancelRun() {},
      },
    });
    const requestController = new AbortController();
    const response = await handler(
      new Request(
        "https://agentkit.test/agentkit/runs/run-1/events?threadId=thread-1",
        { signal: requestController.signal },
      ),
    );
    const reader = response.body?.getReader();
    const body = reader?.read();
    await subscribed.promise;

    requestController.abort();
    await aborted.promise;
    await expect(body).resolves.toMatchObject({ done: true });
  });

  it("keeps a static handler transport borrowed", async () => {
    const dispose = vi.fn();
    const handler = createAgentKitHttpHandler({
      transport: {
        capabilities: { streaming: true },
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        dispose,
      },
    });

    const response = await handler(
      new Request("https://agentkit.test/agentkit/capabilities"),
    );

    expect(response.status).toBe(200);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("disposes an owned request transport exactly once after JSON success", async () => {
    const dispose = vi.fn();
    const handler = createAgentKitHttpHandler({
      resolveRequestContext() {
        return { principalId: "principal-a" };
      },
      createTransport() {
        return {
          async startRun() {
            return { runId: "run-1" };
          },
          async *subscribeToRun() {},
          async cancelRun() {},
          dispose,
        };
      },
    });

    const response = await handler(
      new Request("https://agentkit.test/agentkit/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          createAgentProtocolEnvelope("request", {
            threadId: "thread-1",
            messages: [],
          }),
        ),
      }),
    );

    expect(response.status).toBe(201);
    expect(dispose).toHaveBeenCalledTimes(1);
    await response.text();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes an owned request transport exactly once after JSON failure", async () => {
    const dispose = vi.fn();
    const handler = createAgentKitHttpHandler({
      resolveRequestContext() {
        return { principalId: "principal-a" };
      },
      createTransport() {
        return {
          async startRun() {
            throw new Error("backend unavailable");
          },
          async *subscribeToRun() {},
          async cancelRun() {},
          dispose,
        };
      },
    });

    const response = await handler(
      new Request("https://agentkit.test/agentkit/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          createAgentProtocolEnvelope("request", {
            threadId: "thread-1",
            messages: [],
          }),
        ),
      }),
    );

    expect(response.status).toBe(500);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("can explicitly borrow a request-created transport", async () => {
    const dispose = vi.fn();
    const handler = createAgentKitHttpHandler({
      transportOwnership: "borrowed",
      resolveRequestContext() {
        return { principalId: "principal-a" };
      },
      createTransport() {
        return {
          async startRun() {
            return { runId: "run-1" };
          },
          async *subscribeToRun() {},
          async cancelRun() {},
          dispose,
        };
      },
    });

    const response = await handler(
      new Request("https://agentkit.test/agentkit/capabilities"),
    );

    expect(response.status).toBe(200);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("retains an owned request transport until its SSE body completes", async () => {
    const dispose = vi.fn();
    const handler = createAgentKitHttpHandler({
      resolveRequestContext() {
        return { principalId: "principal-a" };
      },
      createTransport() {
        return {
          async startRun() {
            return { runId: "run-1" };
          },
          async *subscribeToRun() {
            yield {
              id: "event-1",
              threadId: "thread-1",
              runId: "run-1",
              sequence: 1,
              occurredAt: "2026-08-29T00:00:00.000Z",
              type: "run.completed",
            } satisfies AgentEvent;
          },
          async cancelRun() {},
          dispose,
        };
      },
    });

    const response = await handler(
      new Request(
        "https://agentkit.test/agentkit/runs/run-1/events?threadId=thread-1",
      ),
    );

    expect(dispose).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toContain("run.completed");
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes an owned request transport exactly once when an SSE reader cancels", async () => {
    const subscriptionAborted = Promise.withResolvers<void>();
    const dispose = vi.fn();
    const handler = createAgentKitHttpHandler({
      resolveRequestContext() {
        return { principalId: "principal-a" };
      },
      createTransport() {
        return {
          async startRun() {
            return { runId: "run-1" };
          },
          async *subscribeToRun({ signal }) {
            yield {
              id: "event-1",
              threadId: "thread-1",
              runId: "run-1",
              sequence: 1,
              occurredAt: "2026-08-29T00:00:00.000Z",
              type: "run.started",
            } satisfies AgentEvent;
            await new Promise<void>((resolve) =>
              signal?.addEventListener(
                "abort",
                () => {
                  subscriptionAborted.resolve();
                  resolve();
                },
                { once: true },
              ),
            );
          },
          async cancelRun() {},
          dispose,
        };
      },
    });
    const response = await handler(
      new Request(
        "https://agentkit.test/agentkit/runs/run-1/events?threadId=thread-1",
      ),
    );
    const reader = response.body?.getReader();

    expect(reader).toBeDefined();
    await expect(reader?.read()).resolves.toMatchObject({ done: false });
    expect(dispose).not.toHaveBeenCalled();
    await reader?.cancel();
    await subscriptionAborted.promise;
    expect(dispose).toHaveBeenCalledTimes(1);
    await reader?.cancel();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("fails closed when trusted request context resolution fails", async () => {
    const onError = vi.fn();
    const dispose = vi.fn();
    const createTransport = vi.fn(
      (): AgentTransport => ({
        async startRun() {
          return { runId: "unreachable" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        dispose,
      }),
    );
    const handler = createAgentKitHttpHandler({
      async resolveRequestContext() {
        throw new Error("private identity provider detail");
      },
      createTransport,
      onError,
    });

    const response = await handler(
      new Request("https://agentkit.test/agentkit/capabilities"),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("The AgentKit request could not be completed.");
    expect(body).not.toContain("private identity provider detail");
    expect(createTransport).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("isolates request authority and never passes it through operation context", async () => {
    const operationContexts: unknown[] = [];
    const serverContexts: Array<{
      trusted: {
        principalId: string;
        workspaceId: string;
        secret: string;
      };
    }> = [];
    const handler = createAgentKitHttpHandler({
      resolveRequestContext(request) {
        return {
          principalId: request.headers.get("authorization") ?? "anonymous",
          workspaceId: request.headers.get("x-workspace-id") ?? "unknown",
          secret: `private-${request.headers.get("authorization")}`,
        };
      },
      createTransport(context) {
        serverContexts.push(context);
        return {
          async startRun(_input, operationContext) {
            operationContexts.push(operationContext);
            return { runId: `run-${context.trusted.principalId}` };
          },
          async *subscribeToRun() {},
          async cancelRun() {},
        };
      },
    });
    const startRequest = (principalId: string, workspaceId: string) =>
      handler(
        new Request("https://agentkit.test/agentkit/runs", {
          method: "POST",
          headers: {
            authorization: principalId,
            "content-type": "application/json",
            "x-workspace-id": workspaceId,
          },
          body: JSON.stringify(
            createAgentProtocolEnvelope("request", {
              threadId: "thread-1",
              messages: [],
            }),
          ),
        }),
      );

    const [first, second] = await Promise.all([
      startRequest("principal-a", "workspace-a"),
      startRequest("principal-b", "workspace-b"),
    ]);
    const [firstBody, secondBody] = await Promise.all([
      first.text(),
      second.text(),
    ]);

    expect(firstBody).toContain("run-principal-a");
    expect(secondBody).toContain("run-principal-b");
    expect(firstBody).not.toContain("private-principal-a");
    expect(secondBody).not.toContain("private-principal-b");
    expect(serverContexts.map(({ trusted }) => trusted)).toEqual([
      {
        principalId: "principal-a",
        workspaceId: "workspace-a",
        secret: "private-principal-a",
      },
      {
        principalId: "principal-b",
        workspaceId: "workspace-b",
        secret: "private-principal-b",
      },
    ]);
    for (const context of operationContexts) {
      expect(context).not.toHaveProperty("trusted");
    }
  });

  it("cancels request-scoped transport work without leaking trusted context", async () => {
    const invoked = Promise.withResolvers<void>();
    let serverSignal: AbortSignal | undefined;
    let operationSignal: AbortSignal | undefined;
    const handler = createAgentKitHttpHandler({
      resolveRequestContext() {
        return { principalId: "principal-a", secret: "private-authority" };
      },
      createTransport(context) {
        serverSignal = context.signal;
        return {
          async startRun(_input, operationContext) {
            operationSignal = operationContext?.signal;
            invoked.resolve();
            return await new Promise((_resolve, reject) => {
              operationContext?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            });
          },
          async *subscribeToRun() {},
          async cancelRun() {},
        };
      },
    });
    const controller = new AbortController();
    const pending = handler(
      new Request("https://agentkit.test/agentkit/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          createAgentProtocolEnvelope("request", {
            threadId: "thread-1",
            messages: [],
          }),
        ),
        signal: controller.signal,
      }),
    );
    await invoked.promise;

    controller.abort("request disconnected");
    const response = await pending;
    const body = await response.text();

    expect(serverSignal?.aborted).toBe(true);
    expect(operationSignal?.aborted).toBe(true);
    expect(response.status).toBe(499);
    expect(body).toContain("request_aborted");
    expect(body).not.toContain("private-authority");
  });

  it("validates the steer request envelope and route identities", async () => {
    const steerQueuedMessage = vi.fn();
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        steerQueuedMessage,
      },
    });
    const response = await handler(
      new Request(
        "https://agentkit.test/agentkit/threads/thread-1/queue/message-1/steer",
        {
          method: "POST",
          body: JSON.stringify(
            createAgentProtocolEnvelope("response", {
              threadId: "thread-1",
              messageId: "message-1",
            }),
          ),
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(steerQueuedMessage).not.toHaveBeenCalled();
  });

  it("negotiates explicit capability status over the discovery endpoint", async () => {
    const handler = createAgentKitHttpHandler({
      transport: {
        capabilities: { approvals: true, messageQueue: false },
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
      },
    });
    const transport = createAgentKitHttpTransport({
      baseUrl: "https://agentkit.test/agentkit",
      fetch: (input, init) => handler(new Request(input, init)),
    });

    const discovery = await transport.discoverCapabilities?.({
      protocol: { protocol: "agentkit", versions: [1] },
    });

    expect(discovery?.protocol).toMatchObject({
      status: "compatible",
      selectedVersion: 1,
    });
    expect(discovery?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "approvals", state: "available" }),
        expect.objectContaining({ id: "messageQueue", state: "unsupported" }),
      ]),
    );
  });
});
