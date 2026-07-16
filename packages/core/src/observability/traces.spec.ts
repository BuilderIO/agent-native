import { afterEach, describe, it, expect, vi } from "vitest";

import {
  protectedExecutionReceiptSchema,
  runWithProtectedExecutionContext,
} from "../protected-execution-context.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";
import { instrumentAgentLoop, redactSensitiveFields } from "./traces.js";
import {
  type AgentSpan,
  SPAN_STATUS_ERROR,
  SPAN_STATUS_OK,
  __resetAgentTracerCache,
  __setAgentTracerForTests,
} from "./tracing.js";
import { DEFAULT_OBSERVABILITY_CONFIG } from "./types.js";

const traceStore = vi.hoisted(() => ({
  spans: [] as unknown[],
  summaries: [] as unknown[],
}));

vi.mock("./store.js", () => ({
  insertTraceSpan: vi.fn(async (span: unknown) => {
    traceStore.spans.push(span);
  }),
  upsertTraceSummary: vi.fn(async (summary: unknown) => {
    traceStore.summaries.push(summary);
  }),
  getLatestTraceSummaryForThread: vi.fn(async () => null),
}));

// M14 in the MCP/A2A audit: tool inputs persisted into trace spans can
// include verbatim credentials (e.g. db-exec INSERTs that contain a raw
// secret value, fetchTool Authorization headers). The captureToolArgs
// path runs every input through `redactSensitiveFields` before writing
// the span — these tests pin down which keys are swapped for "[REDACTED]"
// and ensure the redaction is non-destructive (returns a copy, leaves
// the original input intact for runtime use).

describe("redactSensitiveFields", () => {
  it("redacts top-level sensitive keys", () => {
    const out = redactSensitiveFields({
      authorization: "Bearer xyz",
      cookie: "session=abc",
      apiKey: "sk-123",
      api_key: "sk-456",
      "api-key": "sk-789",
      password: "hunter2",
      secret: "shh",
      token: "tok",
      accessToken: "at",
      access_token: "at2",
      refreshToken: "rt",
      bearer: "br",
      benign: "keep me",
      url: "https://example.com",
    });
    expect(out).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      "api-key": "[REDACTED]",
      password: "[REDACTED]",
      secret: "[REDACTED]",
      token: "[REDACTED]",
      accessToken: "[REDACTED]",
      access_token: "[REDACTED]",
      refreshToken: "[REDACTED]",
      bearer: "[REDACTED]",
      benign: "keep me",
      url: "https://example.com",
    });
  });

  it("matches case-insensitively", () => {
    const out = redactSensitiveFields({
      Authorization: "Bearer xyz",
      AUTHORIZATION: "Bearer abc",
      ApIkEy: "sk-mixed",
    });
    expect(out).toEqual({
      Authorization: "[REDACTED]",
      AUTHORIZATION: "[REDACTED]",
      ApIkEy: "[REDACTED]",
    });
  });

  it("recurses into nested objects and arrays", () => {
    const out = redactSensitiveFields({
      headers: { Authorization: "Bearer xyz", "X-Trace": "abc" },
      items: [
        { token: "t1", name: "alice" },
        { token: "t2", name: "bob" },
      ],
    });
    expect(out).toEqual({
      headers: { Authorization: "[REDACTED]", "X-Trace": "abc" },
      items: [
        { token: "[REDACTED]", name: "alice" },
        { token: "[REDACTED]", name: "bob" },
      ],
    });
  });

  it("does not mutate the original input", () => {
    const original = {
      authorization: "Bearer xyz",
      nested: { token: "tok" },
    };
    const out = redactSensitiveFields(original);
    expect(original.authorization).toBe("Bearer xyz");
    expect(original.nested.token).toBe("tok");
    expect(out).toEqual({
      authorization: "[REDACTED]",
      nested: { token: "[REDACTED]" },
    });
  });

  it("leaves non-matching keys with secret-shaped substrings alone", () => {
    // The pattern uses ^...$ anchors so partial matches like
    // "tokenizer" / "passwordHash" / "secretsCount" don't trigger.
    const out = redactSensitiveFields({
      tokenizer: "bert",
      passwordHash: "hashed",
      secretsCount: 3,
      mySecret: "still keep — substring match doesn't trigger",
    });
    expect(out).toEqual({
      tokenizer: "bert",
      passwordHash: "hashed",
      secretsCount: 3,
      mySecret: "still keep — substring match doesn't trigger",
    });
  });

  it("passes through primitives and null untouched", () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields("plain string")).toBe("plain string");
    expect(redactSensitiveFields(true)).toBe(true);
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });

  it("tolerates circular references by emitting [Circular]", () => {
    const a: any = { token: "t1", name: "alice" };
    a.self = a;
    const out = redactSensitiveFields(a) as Record<string, unknown>;
    expect(out.token).toBe("[REDACTED]");
    expect(out.name).toBe("alice");
    expect(out.self).toBe("[Circular]");
  });
});

// OpenTelemetry export: instrumentAgentLoop wraps the run, each tool call, and
// the model call in OTel spans. With no provider registered the api package's
// no-op tracer means zero spans escape; with a registered (test) provider the
// spans carry the expected names and attributes.

interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  status?: { code: number; message?: string };
  ended: boolean;
}

function createRecordingTracer() {
  const spans: RecordedSpan[] = [];
  const tracer = {
    startSpan(
      name: string,
      options?: { attributes?: Record<string, string | number | boolean> },
    ): AgentSpan {
      const recorded: RecordedSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        ended: false,
      };
      spans.push(recorded);
      return {
        setAttribute(key, value) {
          recorded.attributes[key] = value;
        },
        setAttributes(attributes) {
          Object.assign(recorded.attributes, attributes);
        },
        setStatus(status) {
          recorded.status = status;
        },
        recordException() {},
        end() {
          recorded.ended = true;
        },
      };
    },
  };
  return { tracer, spans };
}

describe("instrumentAgentLoop OpenTelemetry export", () => {
  afterEach(() => {
    __resetAgentTracerCache();
    unregisterTrackingProvider("qa-ai-generation");
    unregisterTrackingProvider("qa-protected-generation");
    traceStore.spans.length = 0;
    traceStore.summaries.length = 0;
  });

  it("emits a PostHog-compatible AI generation tracking event", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        events.push(event);
      },
    });

    const loopOpts: any = {
      engine: { name: "anthropic" },
      model: "claude-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "tool_start", tool: "read", input: { path: "x" } });
        send({ type: "tool_done", tool: "read", result: "ok" });
        return {
          inputTokens: 1_000_000,
          outputTokens: 100_000,
          cacheReadTokens: 1_000,
          cacheWriteTokens: 0,
          model: "claude-test",
        };
      },
      loopOpts,
      runId: "run-ai-1",
      threadId: "thread-ai-1",
      userId: "user@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
      experimentAssignments: [
        {
          experimentId: "hosted-model-test",
          variantId: "gpt-5-6-luna",
        },
      ],
      modelSelectionSource: "experiment",
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.name).toBe("$ai_generation");
    expect(event.userId).toBe("user@example.com");
    expect(event.properties).toMatchObject({
      source: "agent_observability",
      span_type: "llm_call",
      run_id: "run-ai-1",
      thread_id: "thread-ai-1",
      model: "claude-test",
      provider: "anthropic",
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_tokens: 1_000,
      cache_write_tokens: 0,
      total_tokens: 1_100_000,
      status: "success",
      tool_calls: 1,
      successful_tools: 1,
      failed_tools: 0,
      model_selection_source: "experiment",
      experiment_id: "hosted-model-test",
      experiment_variant: "gpt-5-6-luna",
      experiment_ids: "hosted-model-test",
      experiment_variants: "gpt-5-6-luna",
      $ai_trace_id: "run-ai-1",
      $ai_session_id: "thread-ai-1",
      $ai_model: "claude-test",
      $ai_provider: "anthropic",
      $ai_input_tokens: 1_000_000,
      $ai_output_tokens: 100_000,
      $ai_is_error: false,
      $ai_request_count: 1,
    });
    expect(event.properties?.cost_cents_x100).toEqual(expect.any(Number));
    expect(event.properties?.cost_usd).toEqual(expect.any(Number));
    expect(event.properties?.["$ai_total_cost_usd"]).toEqual(
      expect.any(Number),
    );
    expect(event.properties?.["$ai_input"]).toBeUndefined();
    expect(event.properties?.["$ai_output_choices"]).toBeUndefined();
  });

  it("emits run/tool/llm spans with expected names and attributes", async () => {
    const { tracer, spans } = createRecordingTracer();
    __setAgentTracerForTests(tracer as any);

    const loopOpts: any = {
      engine: {},
      model: "claude-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "tool_start", tool: "read", input: { path: "x" } });
        send({ type: "tool_done", tool: "read", result: "ok" });
        send({ type: "tool_start", tool: "db-exec", input: {} });
        send({ type: "tool_done", tool: "db-exec", result: "Error: boom" });
        return {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 5,
          cacheWriteTokens: 0,
          model: "claude-test",
        };
      },
      loopOpts,
      runId: "run-otel-1",
      threadId: "thread-1",
      userId: "user@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    // Let the tool-span microtasks settle.
    await new Promise((r) => setTimeout(r, 0));

    const byName = (n: string) => spans.filter((s) => s.name === n);

    // Run span.
    const runSpan = byName("agent.run")[0];
    expect(runSpan).toBeDefined();
    expect(runSpan.attributes["agent.run_id"]).toBe("run-otel-1");
    expect(runSpan.attributes["agent.model"]).toBe("claude-test");
    expect(runSpan.attributes["agent.tool_calls"]).toBe(2);
    expect(runSpan.attributes["agent.failed_tools"]).toBe(1);
    expect(runSpan.status?.code).toBe(SPAN_STATUS_OK);
    expect(runSpan.ended).toBe(true);

    // Tool spans: one success, one error.
    const toolSpans = byName("tool.call");
    expect(toolSpans).toHaveLength(2);
    const readSpan = toolSpans.find(
      (s) => s.attributes["tool.name"] === "read",
    );
    const dbSpan = toolSpans.find(
      (s) => s.attributes["tool.name"] === "db-exec",
    );
    expect(readSpan?.status?.code).toBe(SPAN_STATUS_OK);
    expect(readSpan?.ended).toBe(true);
    expect(dbSpan?.status?.code).toBe(SPAN_STATUS_ERROR);
    expect(dbSpan?.status?.message).toBe("Error: boom");
    expect(dbSpan?.ended).toBe(true);

    // LLM span carries model + token usage.
    const llmSpan = byName("llm.call")[0];
    expect(llmSpan).toBeDefined();
    expect(llmSpan.attributes["llm.model"]).toBe("claude-test");
    expect(llmSpan.attributes["llm.input_tokens"]).toBe(100);
    expect(llmSpan.attributes["llm.output_tokens"]).toBe(20);
    expect(llmSpan.attributes["llm.cache_read_tokens"]).toBe(5);
    expect(llmSpan.status?.code).toBe(SPAN_STATUS_OK);
    expect(llmSpan.ended).toBe(true);
  });

  it("keeps protected trace persistence and export content-free", async () => {
    const canary = "protected-plaintext-canary";
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-protected-generation",
      track(event) {
        events.push(event);
      },
    });
    const { tracer, spans } = createRecordingTracer();
    __setAgentTracerForTests(tracer as any);
    const receipt = protectedExecutionReceiptSchema.parse({
      version: 1,
      actionName: "protected-read",
      resourceType: "document",
      placement: "enrolled_broker",
      status: "executed",
    });
    const loopOpts: any = {
      engine: { name: "anthropic" },
      model: "claude-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await runWithProtectedExecutionContext(receipt, () =>
      instrumentAgentLoop({
        runAgentLoop: async ({ send }) => {
          send({
            type: "tool_start",
            tool: "protected-tool",
            input: { body: canary },
          });
          send({
            type: "tool_done",
            tool: "protected-tool",
            result: `Error: ${canary}`,
          });
          return {
            inputTokens: 120,
            outputTokens: 30,
            cacheReadTokens: 5,
            cacheWriteTokens: 0,
            model: "claude-test",
          };
        },
        loopOpts,
        runId: "run-protected-1",
        threadId: "thread-protected-1",
        userId: "user@example.com",
        config: {
          ...DEFAULT_OBSERVABILITY_CONFIG,
          enabled: true,
          captureToolArgs: true,
          inferredSentimentEnabled: true,
        },
        metadata: { body: canary },
        sentimentInput: canary,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const persisted = traceStore.spans as Array<{
      spanType: string;
      errorMessage: string | null;
      metadata: unknown;
      inputTokens: number;
      outputTokens: number;
    }>;
    expect(persisted).toHaveLength(3);
    expect(JSON.stringify(persisted)).not.toContain(canary);
    expect(
      persisted.find((span) => span.spanType === "tool_call"),
    ).toMatchObject({
      errorMessage: "Protected execution failed",
      metadata: null,
    });
    expect(
      persisted.find((span) => span.spanType === "agent_run"),
    ).toMatchObject({ metadata: null, inputTokens: 120, outputTokens: 30 });
    expect(events).toEqual([]);

    const runSpan = spans.find((span) => span.name === "agent.run");
    const toolSpan = spans.find((span) => span.name === "tool.call");
    expect(runSpan?.attributes).toMatchObject({
      "agent.protected_placement": "enrolled_broker",
      "agent.protected_resource_type": "document",
      "agent.input_tokens": 120,
      "agent.output_tokens": 30,
    });
    expect(toolSpan?.status?.message).toBe("Protected execution failed");
    expect(JSON.stringify(spans)).not.toContain(canary);
  });

  it("replaces protected run errors and classifier metadata", async () => {
    const canary = "protected-run-error-canary";
    const receipt = protectedExecutionReceiptSchema.parse({
      version: 1,
      actionName: "protected-read",
      resourceType: "document",
      placement: "trusted_endpoint",
      status: "executed",
    });
    const loopOpts: any = {
      engine: {},
      model: "claude-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await expect(
      runWithProtectedExecutionContext(receipt, () =>
        instrumentAgentLoop({
          runAgentLoop: async () => {
            throw new Error(canary);
          },
          loopOpts,
          runId: "run-protected-error",
          threadId: null,
          userId: "user@example.com",
          config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
          metadata: { body: canary },
          classifyError: () => ({
            errorMessage: canary,
            metadata: { body: canary },
          }),
        }),
      ),
    ).rejects.toThrow(canary);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(traceStore.spans).toEqual([
      expect.objectContaining({
        spanType: "agent_run",
        errorMessage: "Protected execution failed",
        metadata: null,
      }),
    ]);
    expect(JSON.stringify(traceStore.spans)).not.toContain(canary);
  });

  it("no-ops (emits no spans) when no provider is registered", async () => {
    __setAgentTracerForTests(null);

    const loopOpts: any = {
      engine: {},
      model: "claude-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    // Must complete without throwing even though no tracer is available.
    const usage = await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "tool_start", tool: "read", input: {} });
        send({ type: "tool_done", tool: "read", result: "ok" });
        return {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
        };
      },
      loopOpts,
      runId: "run-otel-2",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    expect(usage.model).toBe("claude-test");
  });

  it("allows recoverable run-timeout aborts to be classified as successful run spans", async () => {
    const { tracer, spans } = createRecordingTracer();
    __setAgentTracerForTests(tracer as any);
    const controller = new AbortController();

    const loopOpts: any = {
      engine: {},
      model: "claude-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: controller.signal,
    };

    await expect(
      instrumentAgentLoop({
        runAgentLoop: async () => {
          controller.abort("run_timeout");
          throw new Error("This operation was aborted");
        },
        loopOpts,
        runId: "run-timeout-classified",
        threadId: "thread-1",
        userId: "user@example.com",
        config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
        classifyError: () => ({
          status: "success",
          errorMessage: null,
          metadata: {
            terminalReason: "run_timeout",
            recoverableContinuation: true,
          },
        }),
      }),
    ).rejects.toThrow("This operation was aborted");

    const runSpan = spans.find((span) => span.name === "agent.run");
    expect(runSpan?.status?.code).toBe(SPAN_STATUS_OK);
    expect(runSpan?.status?.message).toBeUndefined();
    expect(runSpan?.ended).toBe(true);
  });
});
