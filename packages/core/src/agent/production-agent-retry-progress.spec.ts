import { describe, expect, it, vi } from "vitest";

import {
  EngineError,
  type AgentEngine,
  type EngineEvent,
} from "./engine/types.js";
import {
  runAgentLoop,
  runAgentLoopWithMainChatInternalContinuations,
} from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

describe("model retry progress", () => {
  it.each(["retry", "continuation"])(
    "keeps the explanation visible after a stalled %s",
    async (path) => {
      vi.useFakeTimers({ now: 1_000_000 });
      let attempts = 0;
      const engine: AgentEngine = {
        name: "test",
        label: "Test",
        defaultModel: "test",
        supportedModels: ["test"],
        capabilities: {
          thinking: false,
          promptCaching: false,
          vision: false,
          computerUse: false,
          parallelToolCalls: false,
        },
        async *stream(): AsyncIterable<EngineEvent> {
          attempts += 1;
          if (attempts === 1) {
            await new Promise((resolve) => setTimeout(resolve, 120_000));
            throw new EngineError("Builder gateway request timed out", {
              errorCode:
                path === "retry"
                  ? "provider_network_error"
                  : "builder_gateway_timeout",
              providerRetryable: true,
            });
          }
          yield { type: "text-delta", text: "Recovered" };
          yield { type: "stop", reason: "end_turn" };
        },
      };
      const events: AgentChatEvent[] = [];
      try {
        const runLoop =
          path === "retry"
            ? runAgentLoop
            : runAgentLoopWithMainChatInternalContinuations;
        const run = runLoop({
          engine,
          model: "test",
          systemPrompt: "Test",
          tools: [],
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Edit the intro." }],
            },
          ],
          actions: {},
          send: (event) => events.push(event),
          signal: new AbortController().signal,
        });
        await vi.advanceTimersByTimeAsync(120_000);
        const clear = events.findLastIndex((event) => event.type === "clear");
        const retry = events.findIndex(
          (event) =>
            event.type === "activity" && event.label.includes("retrying"),
        );
        expect(clear).toBeGreaterThanOrEqual(0);
        expect(retry).toBeGreaterThan(clear);
        await vi.advanceTimersByTimeAsync(10_000);
        await run;
        expect(attempts).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
