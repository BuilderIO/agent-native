import { describe, expect, it, vi } from "vitest";

import { defineAction } from "../action.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import { startModelDispatch, type AgentEngine } from "./engine/types.js";
import { createModelInputScopeGuardRegistry } from "./model-input-scope-guards.js";
import {
  createRunSafeBoundaryGuards,
  runAgentLoop,
} from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("private model input scope lifecycle", () => {
  it.each(["different item", "same item with a fresh nonce"])(
    "cancels without a provider call or continuation after selecting %s during credential lookup",
    async (change) => {
      const body = "CANARY_PRIVATE_SCOPE_BODY_2b91";
      const controller = new AbortController();
      const registry = createModelInputScopeGuardRegistry(() =>
        controller.abort(),
      );
      const expected = { item: "item-A", nonce: "nonce-A1" };
      let selected = expected;
      const credentialsStarted = deferred();
      const credentialsReady = deferred();
      const readBody = vi.fn(() => body);
      const providerRounds: number[] = [];
      const observerInputs: unknown[] = [];
      const events: AgentChatEvent[] = [];
      let privateModelInput = "";
      let round = 0;
      const engine: AgentEngine = {
        name: "test",
        label: "Test",
        defaultModel: "test-model",
        supportedModels: ["test-model"],
        supportsPrivateContent: true,
        capabilities: {
          thinking: false,
          promptCaching: false,
          vision: false,
          computerUse: false,
          parallelToolCalls: false,
        },
        async *stream(options) {
          const current = round++;
          if (current === 1) {
            privateModelInput = JSON.stringify(options.messages);
            credentialsStarted.resolve();
            await credentialsReady.promise;
          }
          const dispatch = await startModelDispatch(options, () => {
            providerRounds.push(current);
            return current;
          });
          // A built-in engine may return an empty stream on refused dispatch.
          if (!dispatch.started) return;
          if (current === 0) {
            yield {
              type: "assistant-content",
              parts: [
                {
                  type: "tool-call",
                  id: "read-A",
                  name: "selected_read",
                  input: {},
                },
              ],
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
      const read = defineAction({
        description: "Read the requested selected item",
        parameters: {},
        readOnly: true,
        persistInChatHistory: false,
        run: async (_args, context) => {
          if (
            !context?.registerModelInputGuard?.(
              () =>
                selected.item === expected.item &&
                selected.nonce === expected.nonce,
            )
          )
            return "Protected model input is unavailable.";
          return readBody();
        },
      });
      const boundary = createRunSafeBoundaryGuards({
        signal: controller.signal,
        flushEvents: async () => {},
        interruptRequestedAtBoundary: async () => "none",
        validateModelInput: registry.validate,
      });
      const run = runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "Test",
        tools: [],
        actions: loadActionsFromStaticRegistry({
          selected_read: { default: read },
        }),
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Summarize selected item item-A" }],
          },
        ],
        signal: controller.signal,
        beforeModelDispatch: boundary.beforeModelDispatch,
        registerModelInputGuard: registry.register,
        send: (event) => {
          events.push(event);
        },
        onModelInput: (messages) => {
          observerInputs.push(structuredClone(messages));
        },
      });
      try {
        await credentialsStarted.promise;
        selected =
          change === "different item"
            ? { item: "item-B", nonce: "nonce-B1" }
            : { item: "item-A", nonce: "nonce-A2" };
      } finally {
        credentialsReady.resolve();
      }
      await run;
      expect(readBody).toHaveBeenCalledTimes(1);
      expect(privateModelInput).toContain(body);
      expect(providerRounds).toEqual([0]);
      expect(controller.signal.aborted).toBe(true);
      expect(events.some((event) => event.type === "auto_continue")).toBe(
        false,
      );
      expect(JSON.stringify(observerInputs)).not.toContain(body);
      expect(round).toBe(2);
    },
  );
});
