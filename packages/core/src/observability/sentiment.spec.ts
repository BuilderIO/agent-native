import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILDER_MODEL_UNAUTHORIZED_ERROR_CODE } from "../agent/engine/builder-engine.js";
import {
  EngineError,
  type AgentEngine,
  type EngineEvent,
} from "../agent/engine/types.js";
import { BUILDER_MODEL_CONFIG } from "../agent/model-config.js";
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

// The hosted Builder engine is the real one, with its real model catalog; only
// the network stream is replaced.
const hostedBuilder = vi.hoisted(() => ({
  stream: undefined as
    | undefined
    | ((options: any) => AsyncIterable<EngineEvent>),
  constructionError: undefined as Error | undefined,
}));

vi.mock("../agent/engine/builder-engine.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agent/engine/builder-engine.js")>();
  return {
    ...actual,
    createBuilderEngine: (config?: Record<string, unknown>) => {
      if (hostedBuilder.constructionError)
        throw hostedBuilder.constructionError;
      const engine = actual.createBuilderEngine(config);
      engine.stream = (options) => hostedBuilder.stream!(options);
      return engine;
    },
  };
});

const CLASSIFIER_MODEL = resolveInferredSentimentConfig(
  null,
  {},
).inferredSentimentModel;
// The id the classifier shipped with while the Builder gateway did not list it.
const RETIRED_CLASSIFIER_MODEL = "gpt-5-6-luna";

describe("inferred sentiment config", () => {
  it("is off by default and auto-enables at 100% only on first-party hosts", () => {
    expect(resolveInferredSentimentConfig(null, {})).toMatchObject({
      inferredSentimentEnabled: false,
      inferredSentimentSampleRate: 0,
      inferredSentimentModel: CLASSIFIER_MODEL,
    });
    expect(
      resolveInferredSentimentConfig(null, {
        URL: "https://plan.agent-native.com",
      }),
    ).toMatchObject({
      inferredSentimentEnabled: true,
      inferredSentimentSampleRate: 1,
      inferredSentimentModel: CLASSIFIER_MODEL,
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

  it("defaults the classifier to a model the Builder gateway lists", () => {
    const supported: readonly string[] = BUILDER_MODEL_CONFIG.supportedModels;
    for (const env of [{}, { URL: "https://plan.agent-native.com" }]) {
      const { inferredSentimentModel } = resolveInferredSentimentConfig(
        null,
        env,
      );
      expect(supported).toContain(inferredSentimentModel);
      expect(inferredSentimentModel).not.toBe(RETIRED_CLASSIFIER_MODEL);
    }
    expect(supported).not.toContain(RETIRED_CLASSIFIER_MODEL);
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
      defaultModel: CLASSIFIER_MODEL,
      supportedModels: [CLASSIFIER_MODEL],
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
      classifierModel: CLASSIFIER_MODEL,
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
      model: CLASSIFIER_MODEL,
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
        classifier_model: CLASSIFIER_MODEL,
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
      classifierModel: CLASSIFIER_MODEL,
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
        defaultModel: CLASSIFIER_MODEL,
        supportedModels: [CLASSIFIER_MODEL],
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
      classifierModel: string = CLASSIFIER_MODEL,
    ) {
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: "$ai_sentiment_failed",
        userId: "person@example.com",
        properties: {
          reason,
          method: "llm",
          source: "agent_observability",
          classifier_model: classifierModel,
          classifier_engine: engineName,
          run_id: "run-before",
          classification_trigger_run_id: "run-2",
          thread_id: "thread-1",
        },
      });
      expect(events[0].properties).not.toHaveProperty("sentiment");
      expect(JSON.stringify(events[0])).not.toContain("private words");
    }

    it("reports model_unsupported, not engine_unavailable, when the engine does not list the classifier model", async () => {
      const events = captureEvents();
      const stream = vi.fn(async function* (
        _options: any,
      ): AsyncIterable<EngineEvent> {
        throw new Error("must not run");
      });
      const engine = lunaEngine(stream, {
        name: "anthropic",
        supportedModels: ["claude-test"],
      });

      await expect(
        inferAndTrackSentiment({ ...base, engine }),
      ).resolves.toBeUndefined();

      expectOnlyFailure(events, "model_unsupported", "anthropic");
      expect(stream).not.toHaveBeenCalled();
    });

    describe("hosted Builder engine", () => {
      const anthropicRun = () =>
        lunaEngine(async function* () {}, {
          name: "anthropic",
          supportedModels: ["claude-test"],
        });

      afterEach(() => {
        hostedBuilder.stream = undefined;
        hostedBuilder.constructionError = undefined;
      });

      it("classifies on the real Builder catalog when the run's engine cannot serve the model", async () => {
        const events = captureEvents();
        const stream = vi.fn(async function* (
          _options: any,
        ): AsyncIterable<EngineEvent> {
          yield { type: "text-delta", text: "negative" };
          yield { type: "stop", reason: "end_turn" };
        });
        hostedBuilder.stream = stream;

        await inferAndTrackSentiment({ ...base, runEngine: anthropicRun() });

        expect(stream).toHaveBeenCalledTimes(1);
        expect(stream.mock.calls[0][0]).toMatchObject({
          model: CLASSIFIER_MODEL,
        });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          name: "$ai_sentiment",
          properties: {
            sentiment: "negative",
            classifier_model: CLASSIFIER_MODEL,
            classifier_engine: "builder",
          },
        });
      });

      it("reports the retired id as model_unsupported on the real Builder catalog", async () => {
        const events = captureEvents();
        const stream = vi.fn(async function* (
          _options: any,
        ): AsyncIterable<EngineEvent> {
          yield { type: "text-delta", text: "negative" };
        });
        hostedBuilder.stream = stream;

        await inferAndTrackSentiment({
          ...base,
          classifierModel: RETIRED_CLASSIFIER_MODEL,
          runEngine: anthropicRun(),
        });

        expectOnlyFailure(
          events,
          "model_unsupported",
          "builder",
          RETIRED_CLASSIFIER_MODEL,
        );
        expect(stream).not.toHaveBeenCalled();
      });

      it("still reports engine_unavailable when the hosted engine cannot be constructed", async () => {
        const events = captureEvents();
        hostedBuilder.constructionError = new Error("no gateway");

        await inferAndTrackSentiment({ ...base, runEngine: anthropicRun() });

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          name: "$ai_sentiment_failed",
          properties: {
            reason: "engine_unavailable",
            classifier_model: CLASSIFIER_MODEL,
          },
        });
        expect(events[0].properties.classifier_engine).toBeUndefined();
      });
    });

    it("keeps a custom classifier model on a run engine that preserves custom models", async () => {
      const events = captureEvents();
      const stream = vi.fn(async function* (_options: any) {
        yield { type: "text-delta", text: "neutral" } as EngineEvent;
        yield { type: "stop", reason: "end_turn" } as EngineEvent;
      });
      const runEngine = lunaEngine(stream, {
        name: "byo-gateway",
        supportedModels: ["something-else"],
        preserveCustomModels: true,
      });

      await inferAndTrackSentiment({
        ...base,
        classifierModel: "custom-small-model",
        runEngine,
      });

      expect(stream).toHaveBeenCalledTimes(1);
      expect(stream.mock.calls[0][0]).toMatchObject({
        model: "custom-small-model",
      });
      expect(events[0]).toMatchObject({
        name: "$ai_sentiment",
        properties: {
          sentiment: "neutral",
          classifier_model: "custom-small-model",
          classifier_engine: "byo-gateway",
        },
      });
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

    it("reports engine_unavailable for an error stop whose code is not a model rejection", async () => {
      const events = captureEvents();
      const engine = lunaEngine(async function* () {
        yield {
          type: "stop",
          reason: "error",
          error: "gateway refused: 502 for private words",
          errorCode: "http_502",
        };
      });

      await inferAndTrackSentiment({ ...base, engine });

      expectOnlyFailure(events, "engine_unavailable");
      expect(JSON.stringify(events[0])).not.toContain("gateway refused");
    });

    describe.each([
      BUILDER_MODEL_UNAUTHORIZED_ERROR_CODE,
      "model_not_found",
      "not_found_error",
    ])("a gateway rejection coded %s", (errorCode) => {
      it("reports model_unsupported from an error stop", async () => {
        const events = captureEvents();
        const engine = lunaEngine(async function* () {
          yield {
            type: "stop",
            reason: "error",
            error: "model refused for private words",
            errorCode,
          };
        });

        await inferAndTrackSentiment({ ...base, engine });

        expectOnlyFailure(events, "model_unsupported");
        expect(JSON.stringify(events[0])).not.toContain("model refused");
        expect(JSON.stringify(events[0])).not.toContain(errorCode);
      });

      it("reports model_unsupported from a thrown error", async () => {
        const events = captureEvents();
        const engine = lunaEngine(async function* () {
          throw new EngineError("model refused for private words", {
            errorCode,
          });
        });

        await inferAndTrackSentiment({ ...base, engine });

        expectOnlyFailure(events, "model_unsupported");
        expect(JSON.stringify(events[0])).not.toContain("model refused");
      });
    });

    it("reports engine_unavailable for a thrown error whose code is not a model rejection", async () => {
      const events = captureEvents();
      const engine = lunaEngine(async function* () {
        throw new EngineError("overloaded", { errorCode: "overloaded_error" });
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
