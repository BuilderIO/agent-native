import { describe, expect, it, vi } from "vitest";

import { defineAction } from "../action.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import {
  EngineError,
  startModelDispatch,
  type AgentEngine,
  type EngineStreamOptions,
} from "./engine/types.js";
import { createModelInputScopeGuardRegistry } from "./model-input-scope-guards.js";
import {
  createRunSafeBoundaryGuards,
  runAgentLoop,
  runAgentLoopWithMainChatInternalContinuations,
} from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

const UNAVAILABLE = "Protected model input is unavailable.";
const CANARY = "CANARY_MODEL_INPUT_ADMISSION_9f3a";
const MODEL = "test-model";
const TOOL = "selected_read";

type CapturedInput = {
  messages: unknown;
  privateContent: boolean | undefined;
};

/**
 * A real, minimal engine that follows the built-in dispatch contract: it
 * starts each provider request through `startModelDispatch` so the caller's
 * boundary can refuse it, and it returns an empty stream on a refused
 * dispatch. It never talks to a real provider.
 */
function createEngine(input: {
  supportsPrivateContent: boolean;
  capture?: CapturedInput[];
  providerStarts?: number[];
}): AgentEngine {
  let round = 0;
  return {
    name: "test",
    label: "Test",
    defaultModel: MODEL,
    supportedModels: [MODEL],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    ...(input.supportsPrivateContent ? { supportsPrivateContent: true } : {}),
    async *stream(options: EngineStreamOptions) {
      const current = round++;
      input.capture?.push({
        messages: structuredClone(options.messages),
        privateContent: options.privateContent,
      });
      const dispatch = await startModelDispatch(options, () => {
        input.providerStarts?.push(current);
        return current;
      });
      // A built-in engine returns an empty stream on a refused dispatch.
      if (!dispatch.started) return;
      if (current === 0) {
        yield {
          type: "assistant-content",
          parts: [{ type: "tool-call", id: "read-A", name: TOOL, input: {} }],
        };
        yield { type: "stop", reason: "tool_use" };
      } else {
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "Summary" }],
        };
        yield { type: "stop", reason: "end_turn" };
      }
    },
  };
}

/**
 * The scoped action must consult the context hook before reading, and return a
 * fixed refusal when the run did not admit a model-input guard.
 */
function scopedAction(input: {
  declaredPrivate: boolean;
  readBody: () => string;
  guard?: () => boolean;
}) {
  return defineAction({
    description: "Read the selected scoped item",
    parameters: {},
    readOnly: true,
    ...(input.declaredPrivate ? { persistInChatHistory: false } : {}),
    run: async (_args, context) => {
      if (!context?.registerModelInputGuard) return UNAVAILABLE;
      if (!context.registerModelInputGuard(input.guard ?? (() => true)))
        return UNAVAILABLE;
      return input.readBody();
    },
  });
}

function userMessage(text: string) {
  return { role: "user" as const, content: [{ type: "text", text }] };
}

describe("model input guard admission", () => {
  it("admits a declared private read that registers a passing guard before reading", async () => {
    const controller = new AbortController();
    const registry = createModelInputScopeGuardRegistry(() =>
      controller.abort(),
    );
    const order: string[] = [];
    const registerSpy = vi.fn(
      (guard: () => boolean | Promise<boolean>): boolean => {
        const result = registry.register(guard);
        if (result) order.push("register");
        return result;
      },
    );
    const guard = vi.fn(() => true);
    const readBody = vi.fn(() => {
      order.push("read");
      return CANARY;
    });
    const capture: CapturedInput[] = [];
    const providerStarts: number[] = [];
    const engine = createEngine({
      supportsPrivateContent: true,
      capture,
      providerStarts,
    });
    const boundary = createRunSafeBoundaryGuards({
      signal: controller.signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => "none",
      validateModelInput: registry.validate,
    });
    const action = scopedAction({
      declaredPrivate: true,
      readBody,
      guard,
    });

    await runAgentLoop({
      engine,
      model: MODEL,
      systemPrompt: "Test",
      tools: [],
      actions: loadActionsFromStaticRegistry({ [TOOL]: { default: action } }),
      messages: [userMessage("Read the scoped item")],
      signal: controller.signal,
      beforeModelDispatch: boundary.beforeModelDispatch,
      registerModelInputGuard: registerSpy,
      send: () => {},
    });

    // The guard was registered before the body was read.
    expect(order[0]).toBe("register");
    expect(order).toContain("read");
    expect(registerSpy.mock.invocationCallOrder[0]).toBeLessThan(
      readBody.mock.invocationCallOrder[0]!,
    );
    expect(readBody).toHaveBeenCalledTimes(1);

    // The private body reached the model on the second request.
    expect(JSON.stringify(capture[1]?.messages)).toContain(CANARY);

    // Two provider requests started and the run was never aborted.
    expect(providerStarts).toEqual([0, 1]);
    expect(controller.signal.aborted).toBe(false);
    expect(guard.mock.calls.length).toBeGreaterThanOrEqual(1);

    // The ordinary first request has no private marker; the second does.
    expect(capture[0]?.privateContent).toBeUndefined();
    expect(capture[1]?.privateContent).toBe(true);
  });

  const negativeCases: Array<{
    name: string;
    declaredPrivate: boolean;
    engineSupportsPrivate: boolean;
    withBoundary: boolean;
    withRegistration: boolean;
  }> = [
    {
      name: "unsupported engine",
      declaredPrivate: true,
      engineSupportsPrivate: false,
      withBoundary: true,
      withRegistration: true,
    },
    {
      name: "missing boundary",
      declaredPrivate: true,
      engineSupportsPrivate: true,
      withBoundary: false,
      withRegistration: true,
    },
    {
      name: "missing registration",
      declaredPrivate: true,
      engineSupportsPrivate: true,
      withBoundary: true,
      withRegistration: false,
    },
    {
      name: "ordinary public action",
      declaredPrivate: false,
      engineSupportsPrivate: true,
      withBoundary: true,
      withRegistration: true,
    },
  ];

  it.each(negativeCases)(
    "withholds the guard hook when admitted is impossible: $name",
    async (testCase) => {
      const controller = new AbortController();
      const registry = createModelInputScopeGuardRegistry(() =>
        controller.abort(),
      );
      const readBody = vi.fn(() => CANARY);
      const capture: CapturedInput[] = [];
      const providerStarts: number[] = [];
      const engine = createEngine({
        supportsPrivateContent: testCase.engineSupportsPrivate,
        capture,
        providerStarts,
      });
      const boundary = testCase.withBoundary
        ? createRunSafeBoundaryGuards({
            signal: controller.signal,
            flushEvents: async () => {},
            interruptRequestedAtBoundary: async () => "none",
            validateModelInput: registry.validate,
          })
        : undefined;
      const action = scopedAction({
        declaredPrivate: testCase.declaredPrivate,
        readBody,
      });

      await runAgentLoop({
        engine,
        model: MODEL,
        systemPrompt: "Test",
        tools: [],
        actions: loadActionsFromStaticRegistry({
          [TOOL]: { default: action },
        }),
        messages: [userMessage("Read the scoped item")],
        signal: controller.signal,
        ...(boundary
          ? { beforeModelDispatch: boundary.beforeModelDispatch }
          : {}),
        ...(testCase.withRegistration
          ? { registerModelInputGuard: registry.register }
          : {}),
        send: () => {},
      });

      // The hook was withheld, so the action refused before touching content.
      expect(readBody).not.toHaveBeenCalled();
      expect(JSON.stringify(capture)).not.toContain(CANARY);

      // The refusal is the fixed unavailable string, not a fallback success.
      expect(JSON.stringify(capture[1]?.messages)).toContain(UNAVAILABLE);
      expect(providerStarts.length).toBeGreaterThanOrEqual(1);
    },
  );

  it("refuses a resumed private read after the credential nonce changes", async () => {
    const controller = new AbortController();
    const registry = createModelInputScopeGuardRegistry(() =>
      controller.abort(),
    );
    const readBody = vi.fn(() => CANARY);
    let currentNonce = "nonce-A1";
    const guard = vi.fn(() => currentNonce === "nonce-A1");
    const providerStarts: number[] = [];
    const events: AgentChatEvent[] = [];
    let round = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: MODEL,
      supportedModels: [MODEL],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      supportsPrivateContent: true,
      async *stream(options: EngineStreamOptions) {
        const current = round++;
        const dispatch = await startModelDispatch(options, () => {
          providerStarts.push(current);
          return current;
        });
        if (!dispatch.started) return;
        if (current === 0) {
          yield {
            type: "assistant-content",
            parts: [{ type: "tool-call", id: "read-A", name: TOOL, input: {} }],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        if (current === 1) {
          // The credential rotated while the request was in flight.
          currentNonce = "nonce-A2";
          throw new EngineError("Builder gateway timed out", {
            errorCode: "builder_gateway_timeout",
          });
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "Summary" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const boundary = createRunSafeBoundaryGuards({
      signal: controller.signal,
      flushEvents: async () => {},
      interruptRequestedAtBoundary: async () => "none",
      validateModelInput: registry.validate,
    });
    const action = scopedAction({
      declaredPrivate: true,
      readBody,
      guard,
    });
    const historyPrivacyState: { private: boolean } = { private: false };

    await runAgentLoopWithMainChatInternalContinuations({
      engine,
      model: MODEL,
      systemPrompt: "Test",
      tools: [],
      actions: loadActionsFromStaticRegistry({ [TOOL]: { default: action } }),
      messages: [userMessage("Read the scoped item")],
      signal: controller.signal,
      beforeModelDispatch: boundary.beforeModelDispatch,
      registerModelInputGuard: registry.register,
      historyPrivacyState,
      send: (event) => {
        events.push(event);
      },
    });

    // The read happened once; the resumed run refused before a third request.
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(providerStarts).toEqual([0, 1]);
    expect(controller.signal.aborted).toBe(true);
    expect(guard.mock.calls.length).toBeGreaterThanOrEqual(2);

    // No fabricated summary was emitted after the refusal.
    expect(
      events.some((event) => event.type === "text" && event.text === "Summary"),
    ).toBe(false);
    expect(events.some((event) => event.type === "auto_continue")).toBe(false);
    expect(historyPrivacyState.private).toBe(true);
  });
});
