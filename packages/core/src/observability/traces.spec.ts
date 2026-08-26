import { afterEach, describe, it, expect } from "vitest";

import { observabilityConfig } from "../app-config/observability.js";
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
import type { ObservabilityConfig } from "./types.js";

// A fully-populated config, for building the `config` argument these tests
// pass in directly. The two sentiment toggles are `.optional()` in the schema
// so `resolveInferredSentimentConfig` can tell "unset" from an explicit
// opt-out; the values here are the self-hosted outcome it produces.
const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  ...observabilityConfig.parse({}),
  inferredSentimentEnabled: false,
  inferredSentimentSampleRate: 0,
};

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

/**
 * A hand-advanced `Date.now`.
 *
 * The latency tests below are about arithmetic on timestamps — which interval
 * gets subtracted, which one is measured, where a span is stamped. Sleeping for
 * real makes that arithmetic race the scheduler, and a loaded CI runner stretches
 * a 20ms sleep into a 200ms one, so the assertions have to be either exact and
 * deterministic or loose enough to stop testing anything. This buys the first.
 */
function manualClock(startMs = 1_700_000_000_000) {
  const realNow = Date.now;
  let now = startMs;
  Date.now = () => now;
  const clock = {
    advance(ms: number) {
      now += ms;
    },
    restore() {
      Date.now = realNow;
    },
  };
  activeClock = clock;
  return clock;
}

let activeClock: { restore: () => void } | null = null;

describe("instrumentAgentLoop OpenTelemetry export", () => {
  afterEach(() => {
    // Restored here rather than in each test so a failing assertion cannot
    // leak the patched clock into the rest of the file.
    activeClock?.restore();
    activeClock = null;
    __resetAgentTracerCache();
    unregisterTrackingProvider("qa-ai-generation");
  });

  // A run cut off at an `auto_continue` boundary never reaches the loop's
  // outcome classification, so before this it reported no terminal state at
  // all: `$ai_error` absent, `terminal_state` null, and the reason recoverable
  // only from `agent_run_events` on a 7-day retention.
  it("reports an unplanned cut-off with its reason as a failed terminal state", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_trace" || event.name === "$ai_generation") {
          events.push(event);
        }
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
        send({ type: "text", text: "partial" });
        send({ type: "auto_continue", reason: "no_progress" });
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
      runId: "run-cutoff-1",
      threadId: "thread-cutoff-1",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((r) => setTimeout(r, 0));

    const trace = events.find((event) => event.name === "$ai_trace");
    expect(trace).toBeDefined();
    expect(trace!.properties).toMatchObject({
      terminal_reason: "no_progress",
      $ai_is_error: true,
      $ai_error: expect.objectContaining({
        terminal_state: "failed",
        terminal_code: "no_progress",
        retryable: true,
      }),
    });

    // A `no_progress` cut-off is OUR boundary, not a failed model call: the
    // run is marked failed, the generation that answered normally is not.
    expect(trace!.properties?.["$ai_error_type"]).toBe("no_progress");
    const generation = events.find((event) => event.name === "$ai_generation");
    expect(generation!.properties?.status).toBe("success");
    expect(generation!.properties?.["$ai_is_error"]).toBe(false);
    expect(generation!.properties).not.toHaveProperty("terminal_state");
  });

  // A trace from a scheduled automation was indistinguishable from a chat turn
  // in LLM analytics: every path emitted the hardcoded `agent_run` name, and
  // `metadata` — the one channel that could have said which automation this was
  // — reached the local SQL store and stopped there.
  it("carries the caller's span name and run metadata into LLM analytics", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_trace") events.push(event);
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
      runAgentLoop: async () => ({
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "claude-test",
        usageReported: true,
      }),
      loopOpts,
      runId: "run-named-1",
      threadId: "thread-named-1",
      userId: "alice@example.com",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
      spanName: "background_automation_run",
      metadata: {
        automation: "daily-digest",
        trigger: "background_automation",
        // Non-scalar values are operational noise in an analytics property and
        // are dropped rather than stringified into an unqueryable blob.
        nested: { dropped: true },
      },
    });

    await new Promise((r) => setTimeout(r, 0));

    const trace = events.find((event) => event.name === "$ai_trace");
    expect(trace!.properties).toMatchObject({
      $ai_span_name: "background_automation_run",
      run_automation: "daily-digest",
      run_trigger: "background_automation",
    });
    expect(trace!.properties).not.toHaveProperty("run_nested");
    // A scheduled run has a real owner; per-user observability reads depend on
    // it not being null.
    expect(trace!.userId).toBe("alice@example.com");
  });

  // A throw from inside a `finally` REPLACES what the block was doing, so an
  // assembly failure in trace finalization would have turned a completed run
  // into a failed one — instrumentation altering the run it observes.
  it("does not let a trace-assembly failure change the run's own result", async () => {
    const loopOpts: any = {
      engine: { name: "anthropic" },
      model: "claude-test",
      systemPrompt: "",
      tools: [],
      messages: {
        // `buildGenerationContent` walks messages; a getter that throws stands
        // in for any malformed payload it could trip on.
        get length() {
          throw new Error("assembly blew up");
        },
      },
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    const usage = await instrumentAgentLoop({
      runAgentLoop: async () => ({
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "claude-test",
        usageReported: true,
      }),
      loopOpts,
      runId: "run-assembly-throw",
      threadId: "thread-assembly-throw",
      userId: "alice@example.com",
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        capturePrompts: true,
      },
    });

    expect(usage).toMatchObject({ model: "claude-test", inputTokens: 1 });
  });

  it("does not count a planned run_timeout boundary as an error", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_trace") events.push(event);
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
        send({ type: "text", text: "partial" });
        send({ type: "auto_continue", reason: "run_timeout" });
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
      runId: "run-cutoff-2",
      threadId: "thread-cutoff-2",
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((r) => setTimeout(r, 0));

    // A hosted foreground chunk ends this way roughly every 40s by design; the
    // reason is still recorded so the run_timeout:no_progress ratio is legible.
    expect(events[0]!.properties).toMatchObject({
      terminal_reason: "run_timeout",
    });
    expect(events[0]!.properties.$ai_is_error).toBe(false);
    expect(events[0]!.properties.$ai_error).toBeUndefined();
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

  it("exports messages when capturePrompts is on", async () => {
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
    // The app's tool catalogue is never shipped: it is identical on every call
    // and the calls that happened are already named in `$ai_output_choices`
    // and in their own spans.
    expect(events[0]?.properties).not.toHaveProperty("$ai_tools");
  });

  it("captures the request messages, not the transcript the loop appended to", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_generation" || event.name === "$ai_trace") {
          events.push(event);
        }
      },
    });

    const loopOpts: any = {
      engine: { name: "anthropic" },
      model: "claude-test",
      systemPrompt: "",
      tools: [],
      messages: [{ role: "user", content: "hello!" }],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await instrumentAgentLoop({
      // Every engine loop in this framework appends its own turns to the array
      // it was handed — assistant replies, tool results, continuation prompts.
      runAgentLoop: async ({ send, messages }) => {
        send({ type: "text", text: "Hi there." });
        messages.push({ role: "assistant", content: "Hi there." });
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
      runId: "run-mutated",
      threadId: "thread-mutated",
      userId: "user@example.com",
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        capturePrompts: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const generation = events.find((e) => e.name === "$ai_generation");
    const trace = events.find((e) => e.name === "$ai_trace");
    expect(generation?.properties?.["$ai_input"]).toEqual([
      { role: "user", content: "hello!" },
    ]);
    // The reply belongs to the output side only; PostHog rendered it as part of
    // the prompt when the mutated array was read back after the run.
    expect(generation?.properties?.["$ai_output_choices"]).toEqual([
      { role: "assistant", content: "Hi there." },
    ]);
    // Content rides the generations, never a second copy on the trace.
    expect(trace?.properties).not.toHaveProperty("$ai_input_state");
    expect(trace?.properties).not.toHaveProperty("$ai_output_state");
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
    // The failure is visible and classified, but the tool's result text is
    // withheld: this run has the default `captureToolResults: false`.
    expect(failed?.properties?.["$ai_error_type"]).toBe("tool_error");
    expect(
      (failed?.properties?.["$ai_error"] as { message: string })?.message,
    ).toContain("withheld");
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
    // The tool's text is withheld, but the span says so and says what kind of
    // failure it was — never just a bare `$ai_is_error`.
    expect(events).toHaveLength(1);
    expect(events[0]?.properties?.["$ai_is_error"]).toBe(true);
    expect(events[0]?.properties?.["$ai_error_type"]).toBe("tool_error");
    expect(
      (events[0]?.properties?.["$ai_error"] as { message: string })?.message,
    ).toContain("withheld");
    expect(JSON.stringify(events[0])).not.toContain("abcdef123456");
    // The output side says withheld rather than going absent: an empty
    // `$ai_output_state` reads as a tool that returned nothing, which is a
    // different fact about the run than one whose answer we chose not to ship.
    expect(events[0]?.properties?.["$ai_output_state"]).toContain("withheld");

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

  // `captureLlmSpans` and `captureToolArgs` gate different things, and review
  // has already read the first as if it were the second. `captureLlmSpans`
  // decides whether each tool gets its own `$ai_span` event; what a tool call
  // is allowed to SAY is `captureToolArgs`. Dropping the generation's tool list
  // along with the span events would leave a trace showing a model that
  // answered without any sign it called anything.
  it("keeps tool calls in the generation when only span emission is off", async () => {
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
        send({
          type: "tool_start",
          id: "a",
          tool: "search",
          input: { query: "pricing", apiKey: "sk-should-not-appear" },
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
      runId: "run-spans-off-args-on",
      threadId: null,
      userId: null,
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        captureLlmSpans: false,
        captureToolArgs: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.filter((e) => e.name === "$ai_span")).toHaveLength(0);

    const generation = events.find((e) => e.name === "$ai_generation");
    const choices = generation?.properties?.["$ai_output_choices"] as Array<{
      tool_calls?: Array<{ function: { name: string; arguments?: unknown } }>;
    }>;
    const call = choices?.[0]?.tool_calls?.[0];
    expect(call?.function.name).toBe("search");
    // Arguments ride on `captureToolArgs`, which is on here — and the span's
    // own redaction still applies to them.
    expect(call?.function.arguments).toEqual({
      query: "pricing",
      apiKey: "[REDACTED]",
    });
  });

  // The other half of the same contract: turning span emission back ON must not
  // start exporting arguments that `captureToolArgs` withheld.
  it("omits tool arguments when captureToolArgs is off, spans or not", async () => {
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
        send({
          type: "tool_start",
          id: "a",
          tool: "search",
          input: { query: "pricing" },
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
      runId: "run-spans-on-args-off",
      threadId: null,
      userId: null,
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        captureLlmSpans: true,
        captureToolArgs: false,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.filter((e) => e.name === "$ai_span")).toHaveLength(1);

    const generation = events.find((e) => e.name === "$ai_generation");
    const choices = generation?.properties?.["$ai_output_choices"] as Array<{
      tool_calls?: Array<{ function: Record<string, unknown> }>;
    }>;
    const call = choices?.[0]?.tool_calls?.[0];
    // The call is still visible — that it happened is not the secret.
    expect(call?.function.name).toBe("search");
    expect(call?.function).not.toHaveProperty("arguments");
  });

  // A backend pairs a tool call with its result by id. Emitting our span id on
  // the call while the transcript carries the model's meant they never matched,
  // so every tool call in PostHog rendered with its output nowhere in sight.
  it("pairs a tool call with its result by the id the model issued", async () => {
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
      messages: [{ role: "user", content: [{ type: "text", text: "search" }] }],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await instrumentAgentLoop({
      runAgentLoop: async ({ send, messages }) => {
        send({ type: "model_stream", status: "start" });
        send({
          type: "tool_start",
          id: "call_abc",
          tool: "search",
          input: { query: "gold" },
        });
        send({ type: "model_stream", status: "end" });
        send({
          type: "tool_done",
          id: "call_abc",
          tool: "search",
          result: "no rows",
        });
        // What the engine appends for the next round-trip: a tool result has
        // no `tool` role to live in, so it rides inside a `user` message.
        messages.push({
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_abc",
              toolName: "search",
              toolInput: '{"query":"gold"}',
              content: "no rows",
            },
          ],
        });
        send({ type: "model_stream", status: "start" });
        send({ type: "text", text: "Nothing found." });
        send({ type: "model_stream", status: "end" });
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
      runId: "run-callid-pairing",
      threadId: null,
      userId: null,
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        capturePrompts: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const choices = events[0]?.properties?.["$ai_output_choices"] as Array<{
      tool_calls?: Array<{ id: string }>;
    }>;
    const callId = choices?.[0]?.tool_calls?.[0]?.id;
    expect(callId).toBe("call_abc");
    // The span id namespace never reaches the transcript, so it can never pair.
    expect(callId).not.toMatch(/^span-/);

    // The second round-trip saw the result, normalized into a `tool` message
    // carrying the same id — which is what makes the two halves one call.
    const laterInput = events
      .flatMap((event) => (event.properties?.["$ai_input"] as unknown[]) ?? [])
      .find(
        (message) =>
          !!message &&
          typeof message === "object" &&
          (message as { role?: string }).role === "tool",
      ) as { tool_call_id?: string; content?: string } | undefined;
    expect(laterInput?.tool_call_id).toBe("call_abc");
    expect(laterInput?.content).toBe("no rows");
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
      delegation_task_id: "task-analytics",
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

  // PostHog's trace query sums `$ai_latency` over the trace's direct children
  // AND over any event with no `$ai_parent_id` — which the `$ai_trace` event
  // itself is. Emitting it there reported roughly twice the real duration, and
  // a generation claiming the whole run counted tool time a second time.
  it("reports trace latency through children only, with tool time removed from the generation", async () => {
    const clock = manualClock();
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
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
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        clock.advance(20);
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
        clock.advance(5);
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
      runId: "run-latency",
      threadId: "thread-latency",
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const trace = byName.get("$ai_trace")?.[0];
    const generation = byName.get("$ai_generation")?.[0];
    const span = byName.get("$ai_span")?.[0];
    expect(trace).toBeDefined();
    expect(generation).toBeDefined();
    expect(span).toBeDefined();

    // The trace contributes no latency of its own; PostHog derives it.
    expect(trace?.properties).not.toHaveProperty("$ai_latency");
    // ...but the run duration is still recorded for the other backends.
    expect(trace?.properties?.duration_ms).toEqual(expect.any(Number));

    // What PostHog will sum: the generation plus its sibling tool spans. One
    // 20ms tool inside a 25ms run, so the children account for the run exactly
    // once. Before this the generation also claimed the full 25ms.
    const spanLatency = span?.properties?.["$ai_latency"] as number;
    const generationLatency = generation?.properties?.["$ai_latency"] as number;
    const runSeconds = (trace?.properties?.duration_ms as number) / 1000;
    expect(runSeconds).toBe(0.025);
    expect(spanLatency).toBe(0.02);
    expect(generationLatency).toBe(0.005);
  });

  // The engine already brackets each LLM round-trip with `model_stream`
  // start/end, and that bracket closes before any tool of the turn starts. When
  // it is present the generation's latency is measured, so none of the
  // subtraction machinery below applies — overlapping tools cannot distort it.
  it("measures generation latency from model_stream brackets when present", async () => {
    const clock = manualClock();
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
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
        // Two round-trips of ~20ms each, with a ~40ms parallel tool fan-out in
        // between. Model time is ~40ms; the run is ~80ms.
        send({ type: "model_stream", status: "start" });
        clock.advance(20);
        send({ type: "model_stream", status: "end" });

        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        send({ type: "tool_start", id: "b", tool: "search", input: {} });
        clock.advance(40);
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
        send({ type: "tool_done", id: "b", tool: "search", result: "ok" });

        send({ type: "model_stream", status: "start" });
        clock.advance(20);
        send({ type: "model_stream", status: "end" });
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
          usageReported: true,
          llmCalls: 2,
        };
      },
      loopOpts,
      runId: "run-measured",
      threadId: "thread-measured",
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const trace = byName.get("$ai_trace")?.[0];
    const generations = byName.get("$ai_generation") ?? [];
    const spans = byName.get("$ai_span") ?? [];
    expect(spans).toHaveLength(2);

    // One generation per round-trip, each carrying its own bracket and none of
    // the 40ms tool window between them. Under the old aggregate the run was a
    // single generation covering all 80ms.
    expect(generations).toHaveLength(2);
    expect(
      generations.map((e) => e.properties?.["$ai_latency"] as number),
    ).toEqual([0.02, 0.02]);
    expect(generations.map((e) => e.properties?.latency_source)).toEqual([
      "measured",
      "measured",
    ]);
    // Both tools were requested by the first call, so PostHog draws them under
    // it rather than under the trace root.
    expect(spans.map((e) => e.properties?.["$ai_parent_id"])).toEqual([
      generations[0]?.properties?.["$ai_span_id"],
      generations[0]?.properties?.["$ai_span_id"],
    ]);
    // Every generation is one request: `$ai_request_count` prices this call,
    // not the run.
    expect(generations.map((e) => e.properties?.["$ai_request_count"])).toEqual(
      [1, 1],
    );

    const runSeconds = (trace?.properties?.duration_ms as number) / 1000;
    expect(runSeconds).toBe(0.08);

    // Each tool reports its own real duration, so two tools sharing one 40ms
    // window contribute ~80ms of work to a ~80ms run. Summed children exceeding
    // the wall clock is the honest result of concurrency, not an error: the
    // trace's own `duration_ms` is what reports elapsed time, and the waterfall
    // places each span by its timestamp. Shrinking the generation to force the
    // sum down would only trade a true number for a flattering one.
    expect(spans.map((e) => e.properties?.["$ai_latency"] as number)).toEqual([
      0.04, 0.04,
    ]);
  });

  it("gives each round-trip its own prompt, answer, and tokens", async () => {
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
      },
    });

    const loopOpts: any = {
      engine: { name: "anthropic" },
      model: "claude-test",
      systemPrompt: "",
      tools: [{ name: "read", description: "Read a file", inputSchema: {} }],
      messages: [{ role: "user", content: "read the config" }],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    };

    await instrumentAgentLoop({
      runAgentLoop: async ({ send, messages, onUsage }) => {
        send({ type: "model_stream", status: "start" });
        send({ type: "text", text: "Let me look." });
        onUsage?.({
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
        } as any);
        send({ type: "model_stream", status: "end", reason: "tool_use" });
        messages.push({ role: "assistant", content: "Let me look." });

        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
        messages.push({ role: "user", content: "ok" });

        send({ type: "model_stream", status: "start" });
        send({ type: "text", text: "Port 8080." });
        onUsage?.({
          inputTokens: 300,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
        } as any);
        send({ type: "model_stream", status: "end", reason: "end_turn" });
        return {
          inputTokens: 400,
          outputTokens: 30,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
          usageReported: true,
          llmCalls: 2,
        };
      },
      loopOpts,
      runId: "run-split",
      threadId: "thread-split",
      userId: "user@example.com",
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        capturePrompts: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const generations = byName.get("$ai_generation") ?? [];
    expect(generations).toHaveLength(2);

    // Each call reports the tokens it actually used, not the run's total split
    // or repeated.
    expect(generations.map((e) => e.properties?.["$ai_input_tokens"])).toEqual([
      100, 300,
    ]);
    expect(generations.map((e) => e.properties?.["$ai_output_tokens"])).toEqual(
      [10, 20],
    );

    // The first call saw only the user's message; the second saw the answer and
    // the tool result the loop appended in between.
    expect(generations[0]?.properties?.["$ai_input"]).toEqual([
      { role: "user", content: "read the config" },
    ]);
    expect(generations[1]?.properties?.["$ai_input"]).toEqual([
      { role: "user", content: "read the config" },
      { role: "assistant", content: "Let me look." },
      { role: "user", content: "ok" },
    ]);
    expect(generations[0]?.properties?.["$ai_output_choices"]).toEqual([
      {
        role: "assistant",
        content: "Let me look.",
        tool_calls: [
          {
            type: "function",
            id: expect.any(String),
            function: { name: "read" },
          },
        ],
      },
    ]);
    expect(generations[1]?.properties?.["$ai_output_choices"]).toEqual([
      { role: "assistant", content: "Port 8080." },
    ]);

    // Why each call stopped: the first handed off to a tool, the second was
    // done. A `max_tokens` here is the only signal that an answer was cut off.
    expect(generations.map((e) => e.properties?.["$ai_stop_reason"])).toEqual([
      "tool_use",
      "end_turn",
    ]);

    // The tool catalogue rides no event at all.
    expect(generations[0]?.properties).not.toHaveProperty("$ai_tools");
    expect(generations[1]?.properties).not.toHaveProperty("$ai_tools");
  });

  it("marks the failing layer: the model call, the tool, or the run", async () => {
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
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

    // The model answered; a tool then failed and stopped the run.
    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "model_stream", status: "start" });
        send({ type: "model_stream", status: "end" });
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        send({
          type: "tool_done",
          id: "a",
          tool: "read",
          result: "boom",
          isError: true,
        });
        send({ type: "error", error: "read failed" } as any);
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
          usageReported: true,
          llmCalls: 1,
        };
      },
      loopOpts,
      runId: "run-tool-failed",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The tool failed and the run failed; the model call did not.
    expect(byName.get("$ai_span")?.[0]?.properties?.["$ai_is_error"]).toBe(
      true,
    );
    expect(byName.get("$ai_trace")?.[0]?.properties?.["$ai_is_error"]).toBe(
      true,
    );
    expect(
      byName.get("$ai_generation")?.[0]?.properties?.["$ai_is_error"],
    ).toBe(false);

    byName.clear();

    // The run died with the model's stream still open — that call failed.
    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "model_stream", status: "start" });
        throw new Error("provider stream reset");
      },
      loopOpts,
      runId: "run-model-failed",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    const failed = byName.get("$ai_generation")?.[0];
    expect(failed?.properties?.["$ai_is_error"]).toBe(true);
    expect(
      (failed?.properties?.["$ai_error"] as { message: string })?.message,
    ).toBe("provider stream reset");
  });

  it("never reports a failure with nothing in $ai_error", async () => {
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
      },
    });

    await instrumentAgentLoop({
      runAgentLoop: async () => {
        throw new Error("boom");
      },
      loopOpts: {
        engine: { name: "anthropic" },
        model: "claude-test",
        systemPrompt: "",
        tools: [],
        messages: [],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      } as any,
      runId: "run-silent-failure",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
      // A classifier may report a failure with no message of its own.
      classifyError: () => ({ status: "error", errorMessage: null }),
    }).catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 0));

    // `$ai_is_error` alone tells the reader something broke and nothing else.
    for (const event of [
      byName.get("$ai_trace")?.[0],
      byName.get("$ai_generation")?.[0],
    ]) {
      expect(event?.properties?.["$ai_is_error"]).toBe(true);
      expect(
        (event?.properties?.["$ai_error"] as { message: string })?.message,
      ).toBeTruthy();
      expect(event?.properties?.["$ai_error_type"]).toBeTruthy();
    }
  });

  it("keeps a failed call red and a finished call's tokens after a later throw", async () => {
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
      },
    });

    await instrumentAgentLoop({
      runAgentLoop: async ({ send, onUsage }) => {
        // A call that finished and reported its tokens.
        send({ type: "model_stream", status: "start" });
        onUsage?.({
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
        } as any);
        send({ type: "model_stream", status: "end", reason: "tool_use" });
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
        // A call the provider failed. The loop closes the bracket on its way
        // out and never returns its aggregate usage.
        send({ type: "model_stream", status: "start" });
        send({ type: "model_stream", status: "end", reason: "error" });
        throw new Error("provider stream error");
      },
      loopOpts: {
        engine: { name: "anthropic" },
        model: "claude-test",
        systemPrompt: "",
        tools: [],
        messages: [],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      } as any,
      runId: "run-late-throw",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    }).catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 0));

    const generations = byName.get("$ai_generation") ?? [];
    expect(generations).toHaveLength(2);
    // The engine reported this call's usage as it happened; the loop's
    // aggregate never arrived, and that must not erase it.
    expect(generations[0]?.properties?.["$ai_input_tokens"]).toBe(100);
    expect(generations[0]?.properties?.["$ai_is_error"]).toBe(false);
    // The failed call closed its bracket before finalization, and is still red.
    expect(generations[1]?.properties?.["$ai_is_error"]).toBe(true);
    expect(generations[1]?.properties?.["$ai_stop_reason"]).toBe("error");
    // The tool ran under the call that requested it, not the trace root.
    expect(byName.get("$ai_span")?.[0]?.properties?.["$ai_parent_id"]).toBe(
      generations[0]?.properties?.["$ai_span_id"],
    );
  });

  it("keeps an interrupted tool under the call that requested it", async () => {
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
      },
    });

    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "model_stream", status: "start" });
        send({ type: "model_stream", status: "end", reason: "tool_use" });
        send({ type: "tool_start", id: "hung", tool: "slow-read", input: {} });
        // Killed with the tool still in flight: it never reaches `tool_done`.
        throw new Error("run timed out");
      },
      loopOpts: {
        engine: { name: "anthropic" },
        model: "claude-test",
        systemPrompt: "",
        tools: [],
        messages: [],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      } as any,
      runId: "run-interrupted-parent",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    }).catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 0));

    const generation = byName.get("$ai_generation")?.[0];
    const span = byName.get("$ai_span")?.[0];
    expect(span?.properties?.["$ai_parent_id"]).toBe(
      generation?.properties?.["$ai_span_id"],
    );
    expect(span?.properties?.["$ai_error_type"]).toBe("interrupted");
    // And it counts against the call that asked for it.
    expect(generation?.properties?.tool_calls).toBe(1);
  });

  // The shared event is stamped when the operation BEGAN — Mixpanel, Amplitude,
  // webhooks and Agent-Native Analytics read it verbatim. PostHog's
  // timestamp-is-end convention is applied in its own provider.
  it("stamps generations and spans at the moment they began", async () => {
    const clock = manualClock();
    const runStart = Date.now();
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
      },
    });

    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "model_stream", status: "start" });
        clock.advance(4000);
        send({ type: "model_stream", status: "end", reason: "tool_use" });
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        clock.advance(1000);
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
        send({ type: "model_stream", status: "start" });
        clock.advance(2000);
        send({ type: "model_stream", status: "end", reason: "end_turn" });
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
          usageReported: true,
          llmCalls: 2,
        };
      },
      loopOpts: {
        engine: { name: "anthropic" },
        model: "claude-test",
        systemPrompt: "",
        tools: [],
        messages: [],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      } as any,
      runId: "run-started-at",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const startOf = (event: TrackingEvent): number =>
      Date.parse(event.timestamp!) - runStart;

    const generations = byName.get("$ai_generation") ?? [];
    const span = byName.get("$ai_span")?.[0];
    expect(generations).toHaveLength(2);
    // Call one ran 0–4s, its tool 4–5s, call two 5–7s.
    expect(startOf(generations[0])).toBe(0);
    expect(startOf(span!)).toBe(4000);
    expect(startOf(generations[1])).toBe(5000);
    expect(generations[1]?.properties?.created_at_ms).toBe(runStart + 5000);
  });

  // The fallback still has to exist for engines that never bracket their model
  // calls, but a latency built on it must not be mistaken for a measured one.
  it("labels a derived latency when the engine emits no model_stream", async () => {
    const clock = manualClock();
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
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
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        clock.advance(20);
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
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
      runId: "run-derived",
      threadId: "thread-derived",
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(byName.get("$ai_generation")?.[0]?.properties?.latency_source).toBe(
      "derived",
    );
  });

  // Tools run in parallel all the time. Summing sibling durations subtracts
  // more than the run spent in tools, which drove the generation's remainder to
  // zero and left the trace total short of the wall clock.
  it("counts overlapping tool spans once when deriving generation latency", async () => {
    const clock = manualClock();
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
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
        // Three tools covering the same ~40ms window: summed they are ~120ms,
        // which is longer than the run itself.
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        send({ type: "tool_start", id: "b", tool: "search", input: {} });
        send({ type: "tool_start", id: "c", tool: "fetch", input: {} });
        clock.advance(40);
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
        send({ type: "tool_done", id: "b", tool: "search", result: "ok" });
        send({ type: "tool_done", id: "c", tool: "fetch", result: "ok" });
        clock.advance(30);
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
      runId: "run-overlap",
      threadId: "thread-overlap",
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const trace = byName.get("$ai_trace")?.[0];
    const generation = byName.get("$ai_generation")?.[0];
    const spans = byName.get("$ai_span") ?? [];
    expect(spans).toHaveLength(3);

    const runSeconds = (trace?.properties?.duration_ms as number) / 1000;
    const generationLatency = generation?.properties?.["$ai_latency"] as number;
    const summedSpans = spans.reduce(
      (sum, e) => sum + (e.properties?.["$ai_latency"] as number),
      0,
    );

    // Three tools share one 40ms window inside a 70ms run, so the premise
    // holds: summing their durations claims 120ms of a 70ms run, and the old
    // code subtracted all of it and clamped the generation to zero.
    expect(runSeconds).toBe(0.07);
    expect(summedSpans).toBe(0.12);
    // Counting the shared window once leaves exactly the 30ms tail.
    expect(generationLatency).toBe(0.03);
  });

  // Tool time is only subtracted from the generation because sibling `$ai_span`
  // events carry it. When those events are not emitted, nothing else holds the
  // run's tool time and the generation has to keep it.
  it("keeps full generation latency when tool spans are not exported", async () => {
    const clock = manualClock();
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
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
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        clock.advance(30);
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
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
      runId: "run-no-span-latency",
      threadId: "thread-no-span-latency",
      userId: null,
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        captureLlmSpans: false,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const trace = byName.get("$ai_trace")?.[0];
    const generation = byName.get("$ai_generation")?.[0];
    expect(byName.get("$ai_span") ?? []).toHaveLength(0);

    const runSeconds = (trace?.properties?.duration_ms as number) / 1000;
    const generationLatency = generation?.properties?.["$ai_latency"] as number;
    // The generation is the trace's only child, so it carries the whole run
    // rather than losing the 30ms of tool time nothing else reports.
    expect(runSeconds).toBe(0.03);
    expect(generationLatency).toBe(0.03);
  });

  // A span's own timestamp is the tool's start, and `$ai_latency` its duration,
  // so the two together must land inside the run that contains it.
  it("places a tool span inside the run that contains it", async () => {
    const clock = manualClock();
    const byName = new Map<string, TrackingEvent[]>();
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (!event.name.startsWith("$ai_")) return;
        const list = byName.get(event.name) ?? [];
        list.push(event);
        byName.set(event.name, list);
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
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        clock.advance(40);
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
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
      runId: "run-span-timestamp",
      threadId: "thread-span-timestamp",
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const trace = byName.get("$ai_trace")?.[0];
    const span = byName.get("$ai_span")?.[0];
    expect(span).toBeDefined();

    // The trace is stamped at run start; the tool ran for the whole 40ms of it,
    // so the span resolves to exactly the run's window.
    const runStartMs = Date.parse(trace!.timestamp);
    const runEndMs = runStartMs + (trace!.properties?.duration_ms as number);
    const spanStartMs = Date.parse(span!.timestamp);
    const spanEndMs =
      spanStartMs + (span!.properties?.["$ai_latency"] as number) * 1000;

    expect(spanStartMs).toBe(runStartMs);
    expect(spanEndMs).toBe(runEndMs);
  });

  // `$ai_time_to_first_token` is a SECONDS field. It was being handed the
  // millisecond value verbatim, inflating every TTFT in LLM analytics 1000x.
  it("reports $ai_time_to_first_token in seconds while keeping the ms property", async () => {
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
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "gpt-test",
        usageReported: true,
        firstEngineEventAtMs: Date.now() + 2000,
      }),
      loopOpts,
      runId: "run-ttft-seconds",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const props = events[0]?.properties ?? {};
    const ms = props.time_to_first_token_ms as number;
    const seconds = props["$ai_time_to_first_token"] as number;
    expect(ms).toBeGreaterThan(1000);
    expect(seconds).toBeCloseTo(ms / 1000, 2);
  });

  // PostHog multiplies `$ai_request_count` by per-request pricing. A hardcoded
  // 1 undercharged every multi-step run.
  it("reports the run's real LLM round-trip count", async () => {
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
      runAgentLoop: async () => ({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "claude-test",
        usageReported: true,
        llmCalls: 4,
      }),
      loopOpts,
      runId: "run-request-count",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events[0]?.properties?.["$ai_request_count"]).toBe(4);
  });

  // Every round-trip emits a generation carrying its own prompt and answer, so
  // a trace-level copy was the first call's prompt and the last call's answer
  // shipped a second time.
  it("keeps run content on the generations rather than repeating it on the trace", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_trace" || event.name === "$ai_generation") {
          events.push(event);
        }
      },
    });

    await instrumentAgentLoop({
      runAgentLoop: async ({ send }: any) => {
        send({ type: "text", text: "the weather is fine" });
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
          usageReported: true,
        };
      },
      loopOpts: {
        engine: { name: "anthropic" },
        model: "claude-test",
        systemPrompt: "",
        tools: [],
        messages: [{ role: "user", content: "what is the weather?" }],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      } as any,
      runId: "run-trace-state",
      threadId: null,
      userId: null,
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        capturePrompts: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const trace = events.find((e) => e.name === "$ai_trace");
    const generation = events.find((e) => e.name === "$ai_generation");
    expect(trace?.properties).not.toHaveProperty("$ai_input_state");
    expect(trace?.properties).not.toHaveProperty("$ai_output_state");
    expect(generation?.properties?.["$ai_input"]).toEqual([
      { role: "user", content: "what is the weather?" },
    ]);
    expect(generation?.properties?.["$ai_output_choices"]).toEqual([
      { role: "assistant", content: "the weather is fine" },
    ]);
  });

  // Only a FAILED tool's content had anywhere to go, so a healthy tool span
  // shipped an input and no output — indistinguishable from a tool that
  // returned nothing.
  it("carries successful tool output on the span when captureToolResults is on", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_span") events.push(event);
      },
    });

    const run = (captureToolResults: boolean) =>
      instrumentAgentLoop({
        runAgentLoop: async ({ send }: any) => {
          send({ type: "tool_start", id: "a", tool: "read", input: {} });
          send({
            type: "tool_done",
            id: "a",
            tool: "read",
            result: "three matching rows",
          });
          return {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "claude-test",
          };
        },
        loopOpts: {
          engine: { name: "anthropic" },
          model: "claude-test",
          systemPrompt: "",
          tools: [],
          messages: [],
          actions: {},
          send: () => {},
          signal: new AbortController().signal,
        } as any,
        runId: `run-tool-output-${captureToolResults}`,
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
    expect(events).toHaveLength(1);
    expect(events[0]?.properties?.["$ai_is_error"]).toBe(false);
    // Withheld, not absent — the tool answered, this app just does not export
    // what it said. The real result never appears either way.
    expect(events[0]?.properties?.["$ai_output_state"]).toContain("withheld");
    expect(JSON.stringify(events[0])).not.toContain("three matching rows");

    events.length = 0;
    await run(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(1);
    expect(events[0]?.properties?.["$ai_output_state"]).toBe(
      "three matching rows",
    );
  });

  // Every event in a run is emitted in one burst at the end. Stamping them all
  // with the flush time collapses the trace tree's timeline into an instant.
  it("stamps each AI event with when it happened, not when the run flushed", async () => {
    const clock = manualClock();
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name.startsWith("$ai_")) events.push(event);
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

    const startedAt = Date.now();
    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        clock.advance(30);
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
        return {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
        };
      },
      loopOpts,
      runId: "run-timestamps",
      threadId: null,
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const at = (name: string) =>
      new Date(events.find((e) => e.name === name)?.timestamp ?? 0).getTime();

    // The trace and generation are anchored to run start; the tool span ran
    // later. If every event were stamped at flush time these would be equal.
    expect(at("$ai_trace")).toBeCloseTo(startedAt, -2);
    expect(at("$ai_generation")).toBeCloseTo(startedAt, -2);
    expect(at("$ai_span")).toBeGreaterThan(at("$ai_trace"));
  });
  // Two different identifiers with two different lifetimes. `$ai_session_id`
  // is the thread (backend-owned, groups traces into a conversation);
  // `$session_id` is PostHog's frontend session, propagated from the
  // `X-Agent-Native-Session-Id` header so a trace joins session replay.
  // Collapsing them would break whichever one lost.
  it("sends $ai_session_id (thread) and $session_id (browser) as distinct ids on every AI event", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name.startsWith("$ai_")) events.push(event);
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
        send({ type: "tool_start", id: "a", tool: "read", input: {} });
        send({ type: "tool_done", id: "a", tool: "read", result: "ok" });
        return {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-test",
        };
      },
      loopOpts,
      runId: "run-sessions",
      threadId: "thread-sessions",
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
      browserSessionId: "browser-session-xyz",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const names = events.map((e) => e.name).sort();
    expect(names).toEqual(["$ai_generation", "$ai_span", "$ai_trace"]);
    for (const event of events) {
      expect(event.properties?.["$ai_session_id"]).toBe("thread-sessions");
      expect(event.properties?.["$session_id"]).toBe("browser-session-xyz");
      expect(event.properties?.["$ai_trace_id"]).toBe("run-sessions");
    }
  });

  // PostHog rejects ids outside this set, and a rejected id silently detaches
  // the event from its trace.
  it("emits trace and session ids within PostHog's allowed character set", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name.startsWith("$ai_")) events.push(event);
      },
    });

    await instrumentAgentLoop({
      runAgentLoop: async () => ({
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "claude-test",
      }),
      loopOpts: {
        engine: { name: "anthropic" },
        model: "claude-test",
        systemPrompt: "",
        tools: [],
        messages: [],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      } as any,
      runId: "run-1770000000000-a1b2c3",
      threadId: "thread-1770000000000-d4e5f6",
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const allowed = /^[A-Za-z0-9\-_~.@()!':|]+$/;
    for (const event of events) {
      expect(String(event.properties?.["$ai_trace_id"])).toMatch(allowed);
      expect(String(event.properties?.["$ai_session_id"])).toMatch(allowed);
    }
  });

  // `$ai_trace` has exactly eight schema properties. Anything else that PostHog
  // aggregates from elsewhere (tokens, cost, latency) must not appear under an
  // `$ai_*` name here or it is counted twice.
  it("keeps the $ai_trace event to PostHog's trace schema", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_trace") events.push(event);
      },
    });

    await instrumentAgentLoop({
      runAgentLoop: async () => ({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "claude-test",
        usageReported: true,
      }),
      loopOpts: {
        engine: { name: "anthropic" },
        model: "claude-test",
        systemPrompt: "",
        tools: [],
        messages: [],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      } as any,
      runId: "run-trace-schema",
      threadId: "thread-trace-schema",
      userId: null,
      config: { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const aiKeys = Object.keys(events[0]?.properties ?? {})
      .filter((k) => k.startsWith("$ai_"))
      .sort();
    // No `$ai_error`: the run succeeded, and undefined properties are dropped
    // rather than sent as null.
    expect(aiKeys).toEqual([
      "$ai_is_error",
      "$ai_model",
      "$ai_provider",
      "$ai_session_id",
      "$ai_span_name",
      "$ai_trace_id",
    ]);
    // Metrics PostHog derives from the trace's children never appear here.
    for (const derived of [
      "$ai_latency",
      "$ai_input_tokens",
      "$ai_output_tokens",
      "$ai_total_cost_usd",
    ]) {
      expect(events[0]?.properties).not.toHaveProperty(derived);
    }
  });

  // PostHog accepts a `system` role in `$ai_input`, but the prompt is app
  // configuration rather than conversation content and is near-identical on
  // every run. Keeping it out is deliberate, not an oversight.
  it("keeps the system prompt out of $ai_input even when capturePrompts is on", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-ai-generation",
      track(event) {
        if (event.name === "$ai_generation") events.push(event);
      },
    });

    await instrumentAgentLoop({
      runAgentLoop: async () => ({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "claude-test",
        usageReported: true,
      }),
      loopOpts: {
        engine: { name: "anthropic" },
        model: "claude-test",
        systemPrompt: "You are a careful assistant.",
        tools: [],
        messages: [{ role: "user", content: "hi" }],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      } as any,
      runId: "run-system-prompt",
      threadId: null,
      userId: null,
      config: {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        enabled: true,
        capturePrompts: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events[0]?.properties?.["$ai_input"]).toEqual([
      { role: "user", content: "hi" },
    ]);
    expect(JSON.stringify(events[0])).not.toContain("careful assistant");
    expect(events[0]?.properties?.["$ai_stream"]).toBe(true);
  });
});
