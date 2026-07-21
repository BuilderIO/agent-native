import { afterEach, describe, it, expect } from "vitest";

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
      tools: [
        {
          name: "read",
          started_offset_ms: expect.any(Number),
          duration_ms: expect.any(Number),
          status: "success",
          error_class: null,
        },
      ],
      tools_truncated: false,
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

  it("keeps tool detail in invocation order and pairs parallel calls by id", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        events.push(event);
      },
    });

    const loopOpts: any = {
      engine: { name: "builder" },
      model: "gpt-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({
          type: "tool_start",
          id: "first",
          tool: "read",
          input: { secret: "must-not-be-tracked" },
        });
        send({
          type: "tool_start",
          id: "second",
          tool: "read",
          input: { result: "also-private" },
        });
        send({
          type: "tool_done",
          id: "unknown",
          tool: "read",
          result: "unmatched legacy noise",
        });
        send({
          type: "tool_done",
          id: "second",
          tool: "read",
          result: "ok",
        });
        send({
          type: "tool_done",
          id: "first",
          tool: "read",
          result: "private failure detail",
          isError: true,
        });
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "gpt-test",
        };
      },
      loopOpts,
      runId: "run-parallel-tools",
      threadId: "thread-1",
      userId: "user@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    expect(events[0]?.properties?.tools).toEqual([
      {
        name: "read",
        started_offset_ms: expect.any(Number),
        duration_ms: expect.any(Number),
        status: "error",
        error_class: "tool_error",
      },
      {
        name: "read",
        started_offset_ms: expect.any(Number),
        duration_ms: expect.any(Number),
        status: "success",
        error_class: null,
      },
    ]);
    expect(JSON.stringify(events[0]?.properties?.tools)).not.toContain(
      "private",
    );
  });

  it("caps tracked tool detail while retaining complete rollup counts", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        events.push(event);
      },
    });

    const loopOpts: any = {
      engine: { name: "builder" },
      model: "gpt-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        for (let index = 0; index < 51; index++) {
          const id = `call-${index}`;
          send({ type: "tool_start", id, tool: `tool-${index}`, input: {} });
          send({ type: "tool_done", id, tool: `tool-${index}`, result: "ok" });
        }
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "gpt-test",
        };
      },
      loopOpts,
      runId: "run-many-tools",
      threadId: null,
      userId: "user@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
      delegation: {
        protocol: "a2a",
        callerApp: "slides",
        taskId: "task-analytics",
        parentRunId: "run-slides",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    expect(events[0]?.properties).toMatchObject({
      tool_calls: 51,
      successful_tools: 51,
      failed_tools: 0,
      tools_truncated: true,
      delegated: true,
      delegation_protocol: "a2a",
      caller_app: "slides",
      a2a_task_id: "task-analytics",
      parent_run_id: "run-slides",
    });
    const tools = events[0]?.properties?.tools as Array<{ name: string }>;
    expect(tools).toHaveLength(50);
    expect(tools[0]?.name).toBe("tool-0");
    expect(tools[49]?.name).toBe("tool-49");
  });

  it("emits failed generations and finalizes an interrupted tool", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        events.push(event);
      },
    });
    const loopOpts: any = {
      engine: { name: "builder" },
      model: "gpt-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await expect(
      instrumentAgentLoop({
        runAgentLoop: async ({ send, runId }) => {
          expect(runId).toBe("run-interrupted");
          send({
            type: "tool_start",
            id: "hung-call",
            tool: "slow-provider-read",
            input: { private: "must-not-be-tracked" },
          });
          throw new Error("delegated run timed out");
        },
        loopOpts,
        runId: "run-interrupted",
        threadId: "thread-parent",
        userId: "user@example.com",
        config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
        delegation: {
          protocol: "a2a",
          callerApp: "slides",
          taskId: "task-analytics",
          parentRunId: "run-slides",
          parentTurnId: "turn-slides",
        },
      }),
    ).rejects.toThrow("delegated run timed out");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(1);
    expect(events[0]?.properties).toMatchObject({
      run_id: "run-interrupted",
      model: "gpt-test",
      status: "error",
      input_tokens: 0,
      output_tokens: 0,
      tool_calls: 1,
      successful_tools: 0,
      failed_tools: 1,
      parent_run_id: "run-slides",
      parent_turn_id: "turn-slides",
      tools: [
        {
          name: "slow-provider-read",
          status: "error",
          error_class: "interrupted",
          duration_ms: expect.any(Number),
        },
      ],
    });
    expect(JSON.stringify(events[0])).not.toContain("must-not-be-tracked");
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

  it("distinguishes explicit tool failures from legacy inferred errors", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        events.push(event);
      },
    });
    const { tracer, spans } = createRecordingTracer();
    __setAgentTracerForTests(tracer as any);

    const loopOpts: any = {
      engine: { name: "builder" },
      model: "gpt-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "tool_start", tool: "mutate", input: {} });
        send({
          type: "tool_done",
          tool: "mutate",
          result: "Invalid action parameters for mutate: input did not match.",
          isError: true,
        });
        send({ type: "tool_start", tool: "legacy-read", input: {} });
        send({
          type: "tool_done",
          tool: "legacy-read",
          result: "Error: private legacy failure detail",
        });
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "gpt-test",
        };
      },
      loopOpts,
      runId: "run-explicit-tool-error",
      threadId: "thread-1",
      userId: "user@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const toolSpan = spans.find((span) => span.name === "tool.call");
    expect(toolSpan?.status?.code).toBe(SPAN_STATUS_ERROR);
    expect(toolSpan?.status?.message).toContain("Invalid action parameters");

    const runSpan = spans.find((span) => span.name === "agent.run");
    expect(runSpan?.attributes["agent.tool_calls"]).toBe(2);
    expect(runSpan?.attributes["agent.successful_tools"]).toBe(0);
    expect(runSpan?.attributes["agent.failed_tools"]).toBe(2);

    expect(events).toHaveLength(1);
    expect(events[0]?.properties).toMatchObject({
      tool_calls: 2,
      successful_tools: 0,
      failed_tools: 2,
      tools: [
        {
          name: "mutate",
          status: "error",
          error_class: "tool_error",
        },
        {
          name: "legacy-read",
          status: "error",
          error_class: "legacy_inferred_error",
        },
      ],
      tools_truncated: false,
    });
  });

  it("omits tool error text by default and includes it truncated when captureToolResults is opted in", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        events.push(event);
      },
    });

    const loopOpts: any = {
      engine: { name: "builder" },
      model: "gpt-test",
      systemPrompt: "",
      tools: [],
      messages: [],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };
    const longError = `HubSpot 500: ${"x".repeat(600)}`;

    const runOnce = async (captureToolResults: boolean, result = longError) => {
      await instrumentAgentLoop({
        runAgentLoop: async ({ send }) => {
          send({ type: "tool_start", tool: "account-deep-dive", input: {} });
          send({
            type: "tool_done",
            tool: "account-deep-dive",
            result,
            isError: true,
          });
          return {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "gpt-test",
          };
        },
        loopOpts,
        runId: `run-${captureToolResults}`,
        threadId: "thread-1",
        userId: "user@example.com",
        config: {
          ...DEFAULT_OBSERVABILITY_CONFIG,
          enabled: true,
          captureToolResults,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    await runOnce(false);
    const tools = events[0]?.properties?.tools as Array<
      Record<string, unknown>
    >;
    expect(tools[0]?.error_message).toBeUndefined();

    events.length = 0;
    await runOnce(true);
    const toolsWithCapture = events[0]?.properties?.tools as Array<
      Record<string, unknown>
    >;
    expect(toolsWithCapture[0]?.error_message).toBe(
      `${longError.slice(0, 500)}…`,
    );
    expect((toolsWithCapture[0]?.error_message as string).length).toBe(501);

    events.length = 0;
    const credentialError =
      "Provider failed: Authorization: Bearer <EXAMPLE_BEARER_TOKEN>; api_key=<EXAMPLE_API_KEY>";
    await runOnce(true, credentialError);
    const redactedTools = events[0]?.properties?.tools as Array<
      Record<string, unknown>
    >;
    expect(redactedTools[0]?.error_message).toBe(
      "Provider failed: Authorization: [REDACTED]; api_key=[REDACTED]",
    );

    events.length = 0;
    await runOnce(
      true,
      "Provider rejected key sk-proj-example-redaction-value",
    );
    const standaloneKeyTools = events[0]?.properties?.tools as Array<
      Record<string, unknown>
    >;
    expect(standaloneKeyTools[0]?.error_message).toBe(
      "Provider rejected key [REDACTED]",
    );

    events.length = 0;
    await runOnce(true, "Stripe rejected key sk_live_1234567890abcdefghijk");
    const stripeKeyTools = events[0]?.properties?.tools as Array<
      Record<string, unknown>
    >;
    expect(stripeKeyTools[0]?.error_message).toBe(
      "Stripe rejected key [REDACTED]",
    );

    events.length = 0;
    await runOnce(
      true,
      'Provider failed: {"cookie":"session-secret","authorization":"Bearer session-token","api_key":"key-value"}',
    );
    const jsonCredentialTools = events[0]?.properties?.tools as Array<
      Record<string, unknown>
    >;
    expect(jsonCredentialTools[0]?.error_message).toBe(
      'Provider failed: {"cookie":"[REDACTED]","authorization":"[REDACTED]","api_key":"[REDACTED]"}',
    );
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
