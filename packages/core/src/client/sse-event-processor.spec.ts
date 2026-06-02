import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentAutoContinueSignal,
  readSSEStream,
  readSSEStreamRaw,
  SSE_NO_PROGRESS_TIMEOUT_MS,
} from "./sse-event-processor.js";

function commentOnlyStream(delayMs: number): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(`: ping ${Date.now()}\n\n`),
          );
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
    },
  });
}

function silentStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start() {
      // Keep the stream open without data to exercise the client-side timer.
    },
  });
}

function eventStream(events: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });
}

async function drain(iterable: AsyncIterable<unknown>) {
  const results: unknown[] = [];
  for await (const result of iterable) {
    results.push(result);
  }
  return results;
}

describe("SSE event processor no-progress recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns comment-only live streams into an auto-continuation signal", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        for await (const _ of readSSEStream(
          commentOnlyStream(SSE_NO_PROGRESS_TIMEOUT_MS + 1),
          [],
          { value: 0 },
          undefined,
        )) {
          // no-op
        }
      } catch (err) {
        return err;
      }
    })();

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS + 1);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
  });

  it("turns silent live streams into an auto-continuation signal", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        for await (const _ of readSSEStream(
          silentStream(),
          [],
          { value: 0 },
          undefined,
        )) {
          // no-op
        }
      } catch (err) {
        return err;
      }
    })();

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
  });

  it("turns raw comment-only live streams into an auto-continuation signal", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    const errPromise = readSSEStreamRaw(
      commentOnlyStream(SSE_NO_PROGRESS_TIMEOUT_MS + 1),
      [],
      { value: 0 },
      undefined,
      onUpdate,
    ).then(
      () => undefined,
      (err) => err,
    );

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS + 1);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("turns raw silent live streams into an auto-continuation signal", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    const errPromise = readSSEStreamRaw(
      silentStream(),
      [],
      { value: 0 },
      undefined,
      onUpdate,
    ).then(
      () => undefined,
      (err) => err,
    );

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("turns raw streams that close without a terminal event into a recovery signal", async () => {
    const content: any[] = [];
    const onUpdate = vi.fn();

    const err = await readSSEStreamRaw(
      eventStream([{ type: "text", text: "partial" }]),
      content,
      { value: 0 },
      undefined,
      onUpdate,
    ).then(
      () => undefined,
      (caught) => caught,
    );

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("stream_ended");
    expect(onUpdate).toHaveBeenCalledWith([{ type: "text", text: "partial" }]);
  });

  it("carries activity trail on auto-continuation signals", async () => {
    const err = await (async () => {
      try {
        for await (const _ of readSSEStream(
          eventStream([
            {
              type: "activity",
              label: "Preparing create-extension action",
              tool: "create-extension",
            },
            { type: "auto_continue", reason: "run_timeout" },
          ]),
          [],
          { value: 0 },
          undefined,
        )) {
          // no-op
        }
      } catch (caught) {
        return caught;
      }
    })();

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("run_timeout");
    expect((err as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Preparing create-extension action",
        tool: "create-extension",
      },
    ]);
  });
});

describe("SSE event processor error classification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes stream authentication failures to run-error handling", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    await drain(
      readSSEStream(
        eventStream([{ type: "error", error: "Authentication required" }]),
        [],
        { value: 0 },
        "tab-auth",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: {
          message: "Authentication required",
          tabId: "tab-auth",
        },
      }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:missing-api-key" }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
  });

  it("routes invalid token stream errors to run-error handling", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    await drain(
      readSSEStream(
        eventStream([
          {
            type: "error",
            error: "Invalid token",
            errorCode: "authentication_error",
          },
        ]),
        [],
        { value: 0 },
        "tab-invalid-token",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
  });

  it("routes http auth error codes inside streams to run-error handling", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    await drain(
      readSSEStream(
        eventStream([
          { type: "error", error: "Forbidden", errorCode: "http_403" },
        ]),
        [],
        { value: 0 },
        "tab-http-403",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: {
          message: "Forbidden",
          errorCode: "http_403",
          tabId: "tab-http-403",
        },
      }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
  });

  it("routes recoverable http_403 stream errors to run-error handling", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    await drain(
      readSSEStream(
        eventStream([
          {
            type: "error",
            error: "Forbidden",
            errorCode: "http_403",
            recoverable: true,
          },
        ]),
        [],
        { value: 0 },
        "tab-http-403",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: {
          message: "Forbidden",
          errorCode: "http_403",
          recoverable: true,
          tabId: "tab-http-403",
        },
      }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
  });

  it("routes missing provider credentials to the setup gate", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "error",
            error: "No LLM provider is connected",
            errorCode: "missing_credentials",
          },
        ]),
        [],
        { value: 0 },
        "tab-missing",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:missing-api-key" }),
    );
    expect(results[0]).toEqual({
      content: [{ type: "text", text: "Error: No LLM provider is connected" }],
      status: { type: "incomplete", reason: "error" },
    });
  });

  it("dispatches activity events without adding visible content", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "activity",
            label: "Preparing create-document action",
            tool: "create-document",
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-activity",
      ),
    );

    expect(results).toEqual([
      {
        content: [],
        metadata: {
          custom: {
            activityTrail: [
              {
                label: "Preparing create-document action",
                tool: "create-document",
              },
            ],
          },
        },
      },
    ]);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity",
        detail: {
          label: "Preparing create-document action",
          tool: "create-document",
          tabId: "tab-activity",
        },
      }),
    );
  });

  it("clears visible activity when the server clears a corrective draft", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    await drain(
      readSSEStream(
        eventStream([
          {
            type: "activity",
            label: "Preparing data-source-status action",
            tool: "data-source-status",
          },
          { type: "clear" },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-clear",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity-clear",
        detail: { tabId: "tab-clear" },
      }),
    );
  });

  it("dispatches visible activity for tool starts", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "create-document",
            input: { title: "Plan" },
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-tool-start",
      ),
    );

    expect(results[0]).toEqual({
      content: [
        expect.objectContaining({
          type: "tool-call",
          toolName: "create-document",
        }),
      ],
      metadata: {
        custom: {
          activityTrail: [
            {
              label: "Running create-document",
              tool: "create-document",
            },
          ],
        },
      },
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity",
        detail: {
          label: "Running create-document",
          tool: "create-document",
          tabId: "tab-tool-start",
        },
      }),
    );
  });

  it("surfaces bare 'builder_gateway_error' instead of looping auto-continuation", async () => {
    // Production-agent retries this synchronously up to MAX_RETRIES inside
    // the run before emitting `error`. By the time the client sees this
    // event the server has given up — auto-continuing on top of that just
    // sends another POST that hits the same wall, which is what produced
    // the 32-continuation regenerate-loop user-visible bug.
    const iter = readSSEStream(
      eventStream([
        {
          type: "error",
          error:
            'Gateway error (no detail; raw event: {"type":"stop","reason":"error","requestId":"req_1"})',
          errorCode: "builder_gateway_error",
        },
      ]),
      [],
      { value: 0 },
      "tab-gateway",
    )[Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value?.status).toEqual({
      type: "incomplete",
      reason: "error",
    });
    const second = await iter.next();
    expect(second.done).toBe(true);
  });

  it("surfaces daily gateway caps instead of looping auto-continuation", async () => {
    const iter = readSSEStream(
      eventStream([
        {
          type: "error",
          error:
            "Daily gateway request cap reached (cap: 5000). Please try again tomorrow.",
          errorCode: "rate_limit_exceeded",
        },
      ]),
      [],
      { value: 0 },
      "tab-gateway-cap",
    )[Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value?.status).toEqual({
      type: "incomplete",
      reason: "error",
    });
    const second = await iter.next();
    expect(second.done).toBe(true);
  });

  it("auto-continues Builder gateway network errors", async () => {
    const err = await readSSEStream(
      eventStream([
        {
          type: "error",
          error: "Builder gateway network error: socket hang up",
          errorCode: "builder_gateway_network_error",
        },
      ]),
      [],
      { value: 0 },
      "tab-gateway-network",
    )
      [Symbol.asyncIterator]()
      .next()
      .then(
        () => undefined,
        (caught) => caught,
      );

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("stream_ended");
  });
});
