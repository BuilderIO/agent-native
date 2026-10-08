import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentEngine, EngineEvent } from "../agent/engine/types.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";
import {
  INFERRED_SENTIMENT_TIMEOUT_MS,
  inferAndTrackSentiment,
  isFirstPartyHostedAgentNative,
  parseInferredSentiment,
  resolveInferredSentimentConfig,
  shouldInferSentimentForTurn,
  shouldSampleInferredSentiment,
} from "./sentiment.js";

describe("inferred sentiment config", () => {
  it("is off by default and auto-enables at 100% only on first-party hosts", () => {
    expect(resolveInferredSentimentConfig(null, {})).toMatchObject({
      inferredSentimentEnabled: false,
      inferredSentimentSampleRate: 0,
      inferredSentimentModel: "gpt-5-6-luna",
    });
    expect(
      resolveInferredSentimentConfig(null, {
        URL: "https://plan.agent-native.com",
      }),
    ).toMatchObject({
      inferredSentimentEnabled: true,
      inferredSentimentSampleRate: 1,
      inferredSentimentModel: "gpt-5-6-luna",
    });
    expect(
      isFirstPartyHostedAgentNative({
        URL: "https://agent-native.com.evil.test",
      }),
    ).toBe(false);
  });

  it("supports stored opt-out plus deployment env overrides", () => {
    expect(
      resolveInferredSentimentConfig(
        { inferredSentimentEnabled: false, inferredSentimentSampleRate: 0.25 },
        { URL: "https://chat.agent-native.com" },
      ),
    ).toMatchObject({
      inferredSentimentEnabled: false,
      inferredSentimentSampleRate: 0.25,
    });
    expect(
      resolveInferredSentimentConfig(
        { inferredSentimentEnabled: false },
        {
          AGENT_NATIVE_INFERRED_SENTIMENT: "on",
          AGENT_NATIVE_INFERRED_SENTIMENT_SAMPLE_RATE: "2",
          AGENT_NATIVE_INFERRED_SENTIMENT_MODEL: "custom-small-model",
        },
      ),
    ).toEqual({
      inferredSentimentEnabled: false,
      inferredSentimentSampleRate: 1,
      inferredSentimentModel: "custom-small-model",
    });
  });

  it("samples deterministically and parses only the three labels", () => {
    expect(shouldSampleInferredSentiment("run-1", 0)).toBe(false);
    expect(shouldSampleInferredSentiment("run-1", 1)).toBe(true);
    expect(shouldSampleInferredSentiment("run-stable", 0.37)).toBe(
      shouldSampleInferredSentiment("run-stable", 0.37),
    );
    expect(parseInferredSentiment("positive")).toBe("positive");
    expect(parseInferredSentiment(" NEUTRAL\n")).toBe("neutral");
    expect(parseInferredSentiment('{"sentiment":"neutral"}')).toBeNull();
    expect(parseInferredSentiment("unclear")).toBeNull();
  });

  it("runs only for original foreground turns or the first background chunk", () => {
    expect(
      shouldInferSentimentForTurn({
        internalContinuation: false,
        isBackgroundWorker: false,
        backgroundContinuationCount: 0,
        hasUserText: true,
      }),
    ).toBe(true);
    expect(
      shouldInferSentimentForTurn({
        internalContinuation: false,
        isBackgroundWorker: true,
        backgroundContinuationCount: 0,
        hasUserText: true,
      }),
    ).toBe(true);
    expect(
      shouldInferSentimentForTurn({
        internalContinuation: false,
        isBackgroundWorker: true,
        backgroundContinuationCount: 1,
        hasUserText: true,
      }),
    ).toBe(false);
    expect(
      shouldInferSentimentForTurn({
        internalContinuation: true,
        isBackgroundWorker: false,
        backgroundContinuationCount: 0,
        hasUserText: true,
      }),
    ).toBe(false);
  });
});

describe("inferAndTrackSentiment", () => {
  afterEach(() => unregisterTrackingProvider("sentiment-test"));

  it("uses a tool-less bounded Luna call and emits no message content", async () => {
    const calls: any[] = [];
    const engine = {
      name: "builder",
      label: "Builder",
      defaultModel: "gpt-5-6-luna",
      supportedModels: ["gpt-5-6-luna"],
      capabilities: {},
      async *stream(options: any): AsyncIterable<EngineEvent> {
        calls.push(options);
        yield { type: "text-delta", text: "negative" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    } as AgentEngine;
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "sentiment-test",
      track(event) {
        events.push(event);
      },
    });

    const privateText = `This is bad ${"x".repeat(3_000)}`;
    await inferAndTrackSentiment({
      engine,
      classifierModel: "gpt-5-6-luna",
      precedingResponseModel: "claude-sonnet-5",
      text: privateText,
      precedingRunId: "run-before",
      classificationTriggerRunId: "run-1",
      threadId: "thread-1",
      userId: "person@example.com",
      sampleRate: 1,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "gpt-5-6-luna",
      tools: [],
      maxOutputTokens: 8,
      temperature: 0,
      reasoningEffort: "low",
    });
    const classifiedText = calls[0].messages[0].content[0].text as string;
    expect(Array.from(classifiedText).length).toBe(2_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "$ai_sentiment",
      userId: "person@example.com",
      properties: {
        method: "llm",
        sentiment: "negative",
        model: "claude-sonnet-5",
        classifier_model: "gpt-5-6-luna",
        classifier_engine: "builder",
        attribution: "user_reaction_to_preceding_model",
        run_id: "run-before",
        classification_trigger_run_id: "run-1",
        thread_id: "thread-1",
        $ai_model: "claude-sonnet-5",
        $ai_trace_id: "run-before",
        $ai_session_id: "thread-1",
      },
    });
    expect(JSON.stringify(events[0])).not.toContain(privateText);
    expect(events[0].properties).not.toHaveProperty("message");
    expect(events[0].properties).not.toHaveProperty("text");
  });

  describe("failures", () => {
    const base = {
      classifierModel: "gpt-5-6-luna",
      precedingResponseModel: "claude-test",
      text: "private words that must never leave",
      precedingRunId: "run-before",
      classificationTriggerRunId: "run-2",
      threadId: "thread-1",
      userId: "person@example.com",
      sampleRate: 1,
    };

    function lunaEngine(
      stream: (options: any) => AsyncIterable<EngineEvent>,
      overrides: Partial<AgentEngine> = {},
    ) {
      return {
        name: "builder",
        label: "Builder",
        defaultModel: "gpt-5-6-luna",
        supportedModels: ["gpt-5-6-luna"],
        capabilities: {},
        stream,
        ...overrides,
      } as AgentEngine;
    }

    function captureEvents() {
      const events: TrackingEvent[] = [];
      registerTrackingProvider({
        name: "sentiment-test",
        track(event) {
          events.push(event);
        },
      });
      return events;
    }

    function expectOnlyFailure(
      events: TrackingEvent[],
      reason: string,
      engineName: string | undefined = "builder",
    ) {
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: "$ai_sentiment_failed",
        userId: "person@example.com",
        properties: {
          reason,
          method: "llm",
          source: "agent_observability",
          classifier_model: "gpt-5-6-luna",
          classifier_engine: engineName,
          run_id: "run-before",
          classification_trigger_run_id: "run-2",
          thread_id: "thread-1",
        },
      });
      expect(events[0].properties).not.toHaveProperty("sentiment");
      expect(JSON.stringify(events[0])).not.toContain("private words");
    }

    it("reports engine_unavailable when the engine cannot serve the classifier model", async () => {
      const events = captureEvents();
      const engine = lunaEngine(
        async function* () {
          throw new Error("must not run");
        },
        { name: "anthropic", supportedModels: ["claude-test"] },
      );

      await expect(
        inferAndTrackSentiment({ ...base, engine }),
      ).resolves.toBeUndefined();

      expectOnlyFailure(events, "engine_unavailable", "anthropic");
    });

    it("reports engine_unavailable when the stream errors", async () => {
      const events = captureEvents();
      const engine = lunaEngine(async function* () {
        yield {
          type: "stop",
          reason: "error",
          error: "gateway refused: no credentials",
        };
      });

      await inferAndTrackSentiment({ ...base, engine });

      expectOnlyFailure(events, "engine_unavailable");
      expect(JSON.stringify(events[0])).not.toContain("gateway refused");
    });

    it("reports engine_unavailable when the stream throws", async () => {
      const events = captureEvents();
      const engine = lunaEngine(async function* () {
        throw new Error("401 from gateway");
      });

      await inferAndTrackSentiment({ ...base, engine });

      expectOnlyFailure(events, "engine_unavailable");
    });

    it("reports timeout when the classifier never answers", async () => {
      vi.useFakeTimers();
      try {
        const events = captureEvents();
        const engine = lunaEngine(async function* (options: any) {
          await new Promise<void>((resolve) =>
            options.abortSignal.addEventListener("abort", () => resolve()),
          );
        });

        const run = inferAndTrackSentiment({ ...base, engine });
        await vi.advanceTimersByTimeAsync(INFERRED_SENTIMENT_TIMEOUT_MS + 1);
        await run;

        expectOnlyFailure(events, "timeout");
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports parse_failed when the answer is not one of the three labels", async () => {
      const events = captureEvents();
      const engine = lunaEngine(async function* () {
        yield { type: "text-delta", text: "kind of annoyed?" };
        yield { type: "stop", reason: "end_turn" };
      });

      await inferAndTrackSentiment({ ...base, engine });

      expectOnlyFailure(events, "parse_failed");
    });

    it("reports empty when the model answers nothing", async () => {
      const events = captureEvents();
      const engine = lunaEngine(async function* () {
        yield { type: "stop", reason: "end_turn" };
      });

      await inferAndTrackSentiment({ ...base, engine });

      expectOnlyFailure(events, "empty");
    });

    it("reports empty when there is no text to classify, without calling the engine", async () => {
      const events = captureEvents();
      const stream = vi.fn(async function* () {
        yield { type: "text-delta", text: "neutral" } as EngineEvent;
      });
      const engine = lunaEngine(stream);

      await inferAndTrackSentiment({ ...base, text: "   ", engine });

      expectOnlyFailure(events, "empty");
      expect(stream).not.toHaveBeenCalled();
    });

    it("warns instead of vanishing when something outside the classifier throws", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const events = captureEvents();
      const engine = lunaEngine(async function* () {}, {
        supportedModels: undefined as unknown as string[],
      });

      try {
        await expect(
          inferAndTrackSentiment({ ...base, engine }),
        ).resolves.toBeUndefined();

        expect(events).toHaveLength(0);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("sentiment inference failed"),
          expect.any(String),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it("classifies with the run's own engine when it serves the model", async () => {
      const events = captureEvents();
      const stream = vi.fn(async function* () {
        yield { type: "text-delta", text: "positive" } as EngineEvent;
        yield { type: "stop", reason: "end_turn" } as EngineEvent;
      });
      const runEngine = lunaEngine(stream, { name: "builder-run" });

      await inferAndTrackSentiment({ ...base, runEngine });

      expect(stream).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: "$ai_sentiment",
        properties: { sentiment: "positive", classifier_engine: "builder-run" },
      });
    });
  });
});
