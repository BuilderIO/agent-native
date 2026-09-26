import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";
import {
  MAX_AI_CONTENT_BYTES,
  boundAiContent,
  emitAiFeedbackSurveyEvent,
  toAiErrorDetail,
  toPostHogMessages,
} from "./posthog-ai.js";

function captureEvents(): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  registerTrackingProvider({
    name: "qa-posthog-ai",
    track(event) {
      events.push(event);
    },
  });
  return events;
}

async function freshModules() {
  vi.resetModules();
  const registry = await import("../tracking/registry.js");
  for (const name of ["posthog", "mixpanel", "amplitude", "webhook"]) {
    registry.unregisterTrackingProvider(name);
  }
  const providers = await import("../tracking/providers.js");
  const posthogAi = await import("./posthog-ai.js");
  const events: TrackingEvent[] = [];
  registry.registerTrackingProvider({
    name: "qa-posthog-ai",
    track(event) {
      events.push(event);
    },
  });
  providers.registerBuiltinProviders();
  return { ...registry, ...providers, ...posthogAi, events };
}

describe("emitAiFeedbackSurveyEvent", () => {
  afterEach(() => {
    unregisterTrackingProvider("qa-posthog-ai");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const base = {
    runId: "run-1",
    threadId: "thread-1",
    userId: "alice@example.test",
    feedbackType: "thumbs_down" as const,
    value: "thumbs_down",
    submissionId: "sub-1",
    model: "claude-test",
  };

  it("emits nothing when no survey id is configured", async () => {
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_ID", "");
    const events = captureEvents();

    expect(emitAiFeedbackSurveyEvent(base)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(0);
  });

  it("emits nothing when PostHog itself is not configured", async () => {
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_ID", "survey-abc");
    vi.stubEnv("POSTHOG_API_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    expect(emitAiFeedbackSurveyEvent(base)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends `survey sent` to PostHog only, never through the provider fan-out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_ID", "survey-abc");
    vi.stubEnv("POSTHOG_API_KEY", "phc_test");
    vi.stubEnv("POSTHOG_HOST", "https://us.i.posthog.com");
    const mod = await freshModules();

    expect(
      mod.emitAiFeedbackSurveyEvent({
        ...base,
        feedbackType: "text",
        value: "the answer cited the wrong doc",
      }),
    ).toBe(true);
    await mod.flushTracking();

    expect(mod.events).toHaveLength(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    const body = JSON.parse(init.body);
    expect(body.event).toBe("survey sent");
    expect(body.distinct_id).toBe("alice@example.test");
    expect(body.properties).toMatchObject({
      $survey_id: "survey-abc",
      $survey_response_1: "the answer cited the wrong doc",
      $survey_submission_id: "sub-1",
      $survey_completed: true,
      $ai_trace_id: "run-1",
      $ai_session_id: "thread-1",
      feedback_type: "text",
    });
  });

  it("suppresses direct PostHog survey events for +autoz identities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_ID", "survey-abc");
    vi.stubEnv("POSTHOG_API_KEY", "phc_test");
    const mod = await freshModules();

    expect(
      mod.emitAiFeedbackSurveyEvent({
        ...base,
        userId: "signup+autoz-run-1@example.com",
      }),
    ).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suppresses direct PostHog survey events for synthetic traffic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_ID", "survey-abc");
    vi.stubEnv("POSTHOG_API_KEY", "phc_test");
    const mod = await freshModules();

    await runWithRequestContext({ isSyntheticTraffic: true }, () =>
      expect(
        mod.emitAiFeedbackSurveyEvent({
          ...base,
          userId: "alice@example.test",
        }),
      ).toBe(false),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers the rating question with PostHog's choice index, not a label", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_ID", "survey-abc");
    vi.stubEnv("POSTHOG_API_KEY", "phc_test");
    const mod = await freshModules();

    mod.emitAiFeedbackSurveyEvent({ ...base, feedbackType: "thumbs_up" });
    mod.emitAiFeedbackSurveyEvent({ ...base, feedbackType: "thumbs_down" });
    mod.emitAiFeedbackSurveyEvent({
      ...base,
      feedbackType: "text",
      value: "cited the wrong doc",
    });
    await mod.flushTracking();

    const [up, down, followUp] = fetchMock.mock.calls.map(
      (call) => JSON.parse(call[1].body).properties,
    );
    expect(up.$survey_response).toBe(1);
    expect(down.$survey_response).toBe(2);
    expect(followUp.$survey_response_1).toBe("cited the wrong doc");
    expect(followUp).not.toHaveProperty("$survey_response");
    expect(up.$survey_completed).toBe(true);
    expect(down.$survey_completed).toBe(false);
    expect(followUp.$survey_completed).toBe(true);
    expect(followUp.$survey_submission_id).toBe(down.$survey_submission_id);
  });
});

describe("boundAiContent", () => {
  it("passes small payloads through untouched", () => {
    const value = [{ role: "user", content: "hi" }];
    expect(boundAiContent(value)).toEqual({ value, truncated: false });
  });

  it("keeps the last user message and says how much it dropped", () => {
    const messages = Array.from({ length: 200 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index} ${"x".repeat(2000)}`,
    }));
    messages.push({ role: "user", content: "so what changed?" });
    messages.push({ role: "assistant", content: `answer ${"y".repeat(2000)}` });

    const result = boundAiContent(messages);
    const kept = result.value as Array<{ role: string; content: string }>;

    expect(result.truncated).toBe(true);
    expect(kept).toHaveLength(2);
    expect(kept[0].content).toMatch(
      /^\[\d+ message\(s\) omitted: \d+ bytes exceeded the \d+-byte/,
    );
    expect(kept[1]).toEqual({ role: "user", content: "so what changed?" });
  });

  it("marks a single oversized message rather than shipping half of it", () => {
    const huge = [{ role: "user", content: "x".repeat(MAX_AI_CONTENT_BYTES) }];
    const result = boundAiContent(huge);
    const kept = result.value as Array<{ content: string }>;

    expect(result.truncated).toBe(true);
    expect(kept).toHaveLength(1);
    expect(kept[0].content).toContain("omitted");
    expect(JSON.stringify(result.value)).not.toContain("xxxx");
  });

  it("still placeholders an oversized value with no message to keep", () => {
    const result = boundAiContent("y".repeat(MAX_AI_CONTENT_BYTES + 10));

    expect(result.truncated).toBe(true);
    expect(String(result.value)).toContain("truncated");
    expect(String(result.value)).not.toContain("yyyy");
  });

  it("marks unserializable values rather than dropping them silently", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(boundAiContent(cyclic)).toEqual({
      value: "[unserializable]",
      truncated: true,
    });
  });
});

describe("toAiErrorDetail", () => {
  it("returns undefined for a healthy run", () => {
    expect(toAiErrorDetail(null)).toBeUndefined();
    expect(toAiErrorDetail(undefined, {})).toBeUndefined();
  });

  it("carries terminal classification alongside the message", () => {
    expect(
      toAiErrorDetail("model refused", {
        state: "failed",
        code: "provider_error",
        retryable: true,
      }),
    ).toEqual({
      message: "model refused",
      terminal_state: "failed",
      terminal_code: "provider_error",
      retryable: true,
    });
  });

  it("redacts secrets in the error message", () => {
    const detail = toAiErrorDetail("failed with authorization: Bearer abc123");

    expect(detail?.message).not.toContain("abc123");
  });
});

describe("toPostHogMessages", () => {
  it("lifts engine tool results out of the user turn into `tool` messages", () => {
    const normalized = toPostHogMessages([
      { role: "user", content: [{ type: "text", text: "make the report" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Writing it." },
          {
            type: "tool-call",
            id: "call_abc",
            name: "write-report",
            input: { slug: "gold" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_abc",
            toolName: "write-report",
            toolInput: '{"slug":"gold"}',
            content: '{"error":"invalid_blocks"}',
          },
        ],
      },
    ]);

    expect(normalized).toEqual([
      { role: "user", content: "make the report" },
      {
        role: "assistant",
        content: "Writing it.",
        tool_calls: [
          {
            id: "call_abc",
            type: "function",
            function: { name: "write-report", arguments: { slug: "gold" } },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_abc",
        name: "write-report",
        content: '{"error":"invalid_blocks"}',
      },
    ]);
  });

  it("keeps the model's call id on both halves of a tool call", () => {
    const [, call, result] = toPostHogMessages([
      { role: "user", content: [{ type: "text", text: "go" }] },
      {
        role: "assistant",
        content: [
          { type: "tool-call", id: "call_xyz", name: "run", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_xyz",
            toolName: "run",
            toolInput: "{}",
            content: "ok",
          },
        ],
      },
    ]) as Array<Record<string, any>>;

    expect(call.tool_calls[0].id).toBe(result.tool_call_id);
    expect(call.content).toBe("");
  });

  it("replaces attachment bodies with a marker naming what was there", () => {
    const [message] = toPostHogMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", data: "A".repeat(4000), mediaType: "image/png" },
        ],
      },
    ]) as Array<{ content: Array<{ type: string; text: string }> }>;

    expect(message.content[1].text).toContain("image/png");
    expect(JSON.stringify(message)).not.toContain("AAAA");
  });

  it("passes through shapes it does not recognize instead of dropping them", () => {
    const already = [{ role: "user", content: "plain string content" }];
    expect(toPostHogMessages(already)).toEqual(already);
    expect(toPostHogMessages("not a list")).toBe("not a list");

    const unknownPart = [
      { role: "assistant", content: [{ type: "future-part", payload: 1 }] },
    ];
    expect(toPostHogMessages(unknownPart)).toEqual([
      { role: "assistant", content: [{ type: "future-part", payload: 1 }] },
    ]);
  });

  it("lets the truncation rescue keep the question, not the last tool result", () => {
    const filler = Array.from({ length: 100 }, () => ({
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "run-query",
          toolInput: "{}",
          content: `rows ${"x".repeat(2000)}`,
        },
      ],
    }));
    const messages = [
      { role: "user", content: [{ type: "text", text: "why is it slow?" }] },
      ...filler,
    ];

    const result = boundAiContent(toPostHogMessages(messages));
    const kept = result.value as Array<{ role: string; content: string }>;

    expect(result.truncated).toBe(true);
    expect(kept[kept.length - 1]).toEqual({
      role: "user",
      content: "why is it slow?",
    });
  });
});
