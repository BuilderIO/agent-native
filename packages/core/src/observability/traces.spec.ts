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
        if (event.name === "$ai_generation") events.push(event);
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
          usageReported: true,
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
    // capturePrompts is off, so no message content leaves the process.
    expect(event.properties?.["$ai_input"]).toBeUndefined();
    // Tool CALLS still ship: PostHog derives $ai_tools_called only from
    // tool-call blocks inside $ai_output_choices. The assistant's text content
    // and the call arguments stay withheld.
    const choices = event.properties?.["$ai_output_choices"] as Array<{
      role: string;
      content?: unknown;
      tool_calls?: Array<{ function: { name: string; arguments?: unknown } }>;
    }>;
    expect(choices).toHaveLength(1);
    expect(choices[0].role).toBe("assistant");
    expect(choices[0]).not.toHaveProperty("content");
    expect(choices[0].tool_calls?.map((c) => c.function.name)).toEqual([
      "read",
    ]);
    expect(choices[0].tool_calls?.[0].function).not.toHaveProperty("arguments");
    expect(JSON.stringify(choices)).not.toContain("must-not-be-tracked");
  });

  it("exports messages and tool definitions when capturePrompts is on", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_generation") events.push(event);
      },
    });

    const loopOpts: any = {
      engine: { name: "anthropic" },
      model: "claude-test",
      systemPrompt: "",
      tools: [
        { name: "search", description: "Search the docs", inputSchema: {} },
      ],
      messages: [{ role: "user", content: "how do I deploy?" }],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "text", text: "Run " });
        send({ type: "text", text: "pnpm deploy." });
        return {
          inputTokens: 5,
          outputTokens: 3,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
          usageReported: true,
        };
      },
      loopOpts,
      runId: "run-content",
      threadId: "thread-content",
      userId: "user@example.com",
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        capturePrompts: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    expect(events[0]?.properties?.["$ai_input"]).toEqual([
      { role: "user", content: "how do I deploy?" },
    ]);
    expect(events[0]?.properties?.["$ai_output_choices"]).toEqual([
      { role: "assistant", content: "Run pnpm deploy." },
    ]);
    expect(events[0]?.properties?.["$ai_tools"]).toEqual([
      {
        type: "function",
        function: { name: "search", description: "Search the docs" },
      },
    ]);
  });

  it("emits an $ai_trace for the run and an $ai_span per tool call", async () => {
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
        send({ type: "tool_start", id: "a", tool: "search", input: {} });
        send({ type: "tool_done", id: "a", tool: "search", result: "ok" });
        send({ type: "tool_start", id: "b", tool: "write", input: {} });
        send({
          type: "tool_done",
          id: "b",
          tool: "write",
          result: "Error: disk full",
          isError: true,
        });
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
          usageReported: true,
        };
      },
      loopOpts,
      runId: "run-tree",
      threadId: "thread-tree",
      userId: "user@example.com",
      browserSessionId: "browser-session-1",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const traces = events.filter((e) => e.name === "$ai_trace");
    const spans = events.filter((e) => e.name === "$ai_span");
    const generations = events.filter((e) => e.name === "$ai_generation");

    expect(traces).toHaveLength(1);
    expect(generations).toHaveLength(1);
    expect(spans).toHaveLength(2);

    expect(traces[0]?.properties).toMatchObject({
      $ai_trace_id: "run-tree",
      $ai_session_id: "thread-tree",
      $ai_span_name: "agent_run",
      $ai_model: "claude-test",
      $ai_provider: "anthropic",
      $ai_is_error: false,
      $session_id: "browser-session-1",
    });
    // A healthy trace carries no error object at all.
    expect(traces[0]?.properties).not.toHaveProperty("$ai_error");

    // Every node hangs off the run's trace id, so PostHog renders one tree.
    for (const span of spans) {
      expect(span.properties).toMatchObject({
        $ai_trace_id: "run-tree",
        $ai_parent_id: "run-tree",
      });
    }
    expect(generations[0]?.properties?.["$ai_parent_id"]).toBe("run-tree");

    expect(spans.map((s) => s.properties?.["$ai_span_name"]).sort()).toEqual([
      "search",
      "write",
    ]);
    const failed = spans.find((s) => s.properties?.["$ai_is_error"] === true);
    expect(failed?.properties?.["$ai_span_name"]).toBe("write");
    // The failure is visible, but the tool's result text is withheld: this run
    // has the default `captureToolResults: false`.
    expect(failed?.properties).not.toHaveProperty("$ai_error");
  });

  it("omits tool span content unless capture is enabled", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_span") events.push(event);
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
        send({
          type: "tool_start",
          id: "a",
          tool: "search",
          input: { query: "must-not-be-tracked" },
        });
        send({ type: "tool_done", id: "a", tool: "search", result: "ok" });
        return {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
        };
      },
      loopOpts,
      runId: "run-no-content",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    // Absent, not empty — an empty object would read as "the tool took no args".
    expect(events[0]?.properties).not.toHaveProperty("$ai_input_state");
    expect(JSON.stringify(events[0])).not.toContain("must-not-be-tracked");
  });

  it("redacts and gates tool failure detail on tool spans", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_span") events.push(event);
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
    // A tool result echoing an upstream response with credentials in it.
    const leakyResult =
      "Error: upstream rejected: authorization: Bearer abcdef123456 key=sk-not-a-real-key-000000000";

    const run = (captureToolResults: boolean) =>
      instrumentAgentLoop({
        runAgentLoop: async ({ send }: any) => {
          send({ type: "tool_start", id: "a", tool: "fetch", input: {} });
          send({
            type: "tool_done",
            id: "a",
            tool: "fetch",
            result: leakyResult,
            isError: true,
          });
          return {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "claude-test",
          };
        },
        loopOpts,
        runId: `run-leak-${captureToolResults}`,
        threadId: null,
        userId: null,
        config: {
          ...DEFAULT_OBSERVABILITY_CONFIG,
          enabled: true,
          captureToolResults,
        },
      });

    await run(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Withheld entirely, but the failure is still visible.
    expect(events).toHaveLength(1);
    expect(events[0]?.properties?.["$ai_is_error"]).toBe(true);
    expect(events[0]?.properties).not.toHaveProperty("$ai_error");
    expect(events[0]?.properties).not.toHaveProperty("$ai_output_state");

    events.length = 0;
    await run(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(events[0]);
    expect(serialized).toContain("REDACTED");
    expect(serialized).not.toContain("abcdef123456");
    expect(serialized).not.toContain("sk-not-a-real-key-000000000");
  });

  it("does not emit tool spans when captureLlmSpans is off", async () => {
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
        send({ type: "tool_start", id: "a", tool: "search", input: {} });
        send({ type: "tool_done", id: "a", tool: "search", result: "ok" });
        return {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
        };
      },
      loopOpts,
      runId: "run-no-spans",
      threadId: null,
      userId: null,
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        captureLlmSpans: false,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.filter((e) => e.name === "$ai_span")).toHaveLength(0);
    // The trace itself still ships — spans are the opt-out, not the run.
    expect(events.filter((e) => e.name === "$ai_trace")).toHaveLength(1);
  });

  it("keeps tool detail in invocation order and pairs parallel calls by id", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_generation") events.push(event);
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
        if (event.name === "$ai_generation") events.push(event);
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
        if (event.name === "$ai_generation") events.push(event);
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
    // The engine never reported a usage figure for this run (it threw before
    // any provider response). An unreported token/cost/TTFT figure must be
    // absent from the payload, never coerced to a literal 0 that is
    // indistinguishable from a real empty-input run.
    expect(events[0]?.properties?.input_tokens).toBeUndefined();
    expect(events[0]?.properties?.output_tokens).toBeUndefined();
    expect(events[0]?.properties?.total_tokens).toBeUndefined();
    expect(events[0]?.properties?.cache_read_tokens).toBeUndefined();
    expect(events[0]?.properties?.cache_write_tokens).toBeUndefined();
    expect(events[0]?.properties?.cost_cents_x100).toBeUndefined();
    expect(events[0]?.properties?.cost_usd).toBeUndefined();
    expect(events[0]?.properties?.time_to_first_token_ms).toBeUndefined();
    expect(events[0]?.properties?.["$ai_input_tokens"]).toBeUndefined();
    expect(events[0]?.properties?.["$ai_output_tokens"]).toBeUndefined();
    expect(events[0]?.properties?.["$ai_total_cost_usd"]).toBeUndefined();
    expect(JSON.stringify(events[0])).not.toContain("must-not-be-tracked");
  });

  it.each([
    {
      event: {
        type: "tripwire" as const,
        reason: "Delegated input budget exhausted",
        processor: "run-input-token-budget",
      },
      error: "Delegated input budget exhausted",
    },
    {
      event: { type: "loop_limit" as const, maxIterations: 80 },
      error: "Agent stopped at the loop limit",
    },
  ])(
    "marks a non-throwing $event.type terminal as an errored generation",
    async ({ event, error }) => {
      const events: TrackingEvent[] = [];
      registerTrackingProvider({
        name: `qa-terminal-${event.type}`,
        track(tracked) {
          if (tracked.name === "$ai_generation") events.push(tracked);
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
          send(event);
          return {
            inputTokens: 100,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            usageReported: true,
            model: "gpt-test",
          };
        },
        loopOpts,
        runId: `run-${event.type}`,
        threadId: "thread-parent",
        userId: "user@example.com",
        config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
        delegation: {
          protocol: "a2a",
          callerApp: "slides",
          taskId: `task-${event.type}`,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toHaveLength(1);
      expect(events[0]?.properties).toMatchObject({
        status: "error",
        error_message: error,
        delegated: true,
      });
    },
  );

  it("reports success when a transient terminal event is cleared and recovered", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-terminal-recovered",
      track(tracked) {
        if (tracked.name === "$ai_generation") events.push(tracked);
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
        send({ type: "error", error: "transient network failure" });
        send({ type: "clear" });
        send({ type: "text", text: "recovered" });
        send({ type: "done" });
        return {
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          usageReported: true,
          model: "gpt-test",
        };
      },
      loopOpts,
      runId: "run-recovered-terminal",
      threadId: null,
      userId: "user@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events[0]?.properties).toMatchObject({ status: "success" });
  });

  it("uses the typed terminal outcome when legacy events would look successful", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-typed-terminal",
      track(tracked) {
        if (tracked.name === "$ai_generation") events.push(tracked);
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
      runAgentLoop: async ({ send, onOutcome }) => {
        send({ type: "text", text: "partial" });
        send({ type: "done" });
        onOutcome?.({
          state: "failed",
          code: "provider_network_error",
          retryable: false,
          message: "The delegated provider failed.",
        });
        return {
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          usageReported: true,
          model: "gpt-test",
        };
      },
      loopOpts,
      runId: "run-typed-terminal",
      threadId: "thread-parent",
      userId: "user@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
      delegation: {
        protocol: "a2a",
        callerApp: "slides",
        taskId: "task-typed-terminal",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(1);
    expect(events[0]?.properties).toMatchObject({
      status: "error",
      error_message: "The delegated provider failed.",
      terminal_state: "failed",
      terminal_code: "provider_network_error",
      terminal_retryable: false,
      delegated: true,
      delegation_protocol: "a2a",
      caller_app: "slides",
    });
  });

  it("omits usage/cost figures when the run ends for no-progress without throwing", async () => {
    // Mirrors the real no-progress abort path (production-agent.ts returns
    // `usage` normally with placeholder zeros instead of throwing) rather
    // than the thrown-error path covered above — the measured bug was a
    // resolved run with literal 0s, not an exception.
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_generation") events.push(event);
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
      runAgentLoop: async () => ({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "gpt-test",
        // usageReported intentionally omitted — no `usage` event ever
        // arrived before the no-progress abort.
      }),
      loopOpts,
      runId: "run-no-progress",
      threadId: "thread-1",
      userId: "user@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    expect(events[0]?.properties?.input_tokens).toBeUndefined();
    expect(events[0]?.properties?.output_tokens).toBeUndefined();
    expect(events[0]?.properties?.total_tokens).toBeUndefined();
    expect(events[0]?.properties?.cache_read_tokens).toBeUndefined();
    expect(events[0]?.properties?.cache_write_tokens).toBeUndefined();
    expect(events[0]?.properties?.cost_cents_x100).toBeUndefined();
    expect(events[0]?.properties?.cost_usd).toBeUndefined();
    expect(events[0]?.properties?.time_to_first_token_ms).toBeUndefined();
  });

  it("reports time_to_first_token_ms measured from run start when the engine reports a first-event timestamp", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_generation") events.push(event);
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
      runAgentLoop: async () => {
        const firstEngineEventAtMs = Date.now() + 25;
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "gpt-test",
          usageReported: true,
          firstEngineEventAtMs,
        };
      },
      loopOpts,
      runId: "run-ttft",
      threadId: "thread-1",
      userId: "user@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    const ttft = events[0]?.properties?.time_to_first_token_ms;
    expect(typeof ttft).toBe("number");
    expect(ttft as number).toBeGreaterThanOrEqual(0);
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
        if (event.name === "$ai_generation") events.push(event);
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
        if (event.name === "$ai_generation") events.push(event);
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
