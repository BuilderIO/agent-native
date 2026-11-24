import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAgentEngineReadinessForTests } from "../agent-engine-readiness.js";
import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";

vi.mock("../use-agent-chat-running-threads.js", () => ({
  dispatchAgentChatRunning: vi.fn(),
}));

const apiUrl = "/_agent-native/agent-chat";
const threadId = "thread-send-now";
const messageId = "queued-send-now";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Send now for an already-promoted queued message", () => {
  beforeEach(() => resetAgentEngineReadinessForTests());
  afterEach(() => vi.useRealTimers());

  it("returns the run of a message the server already promoted, for claim and steer", async () => {
    for (const deliverInActiveRun of [true, false]) {
      const writes: Array<Record<string, unknown>> = [];
      const fetcher = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          if (url.startsWith(`${apiUrl}/runs/active?`)) {
            return json({
              active: deliverInActiveRun,
              status: deliverInActiveRun ? "running" : "idle",
              runId: "run-active",
            });
          }
          if (url.endsWith(`/threads/${threadId}/queued`)) {
            writes.push(JSON.parse(String(init?.body)).mutation);
            return json({
              queuedMessages: [],
              alreadySubmitted: true,
              submittedRunId: "run-promoted",
            });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              queuedMessages: [
                { id: messageId, threadId, text: "Use the blue theme" },
              ],
            }),
          });
        },
      );
      const transport = createAgentNativeAgentKitTransport({
        apiUrl,
        fetch: fetcher as typeof fetch,
      });
      await expect(
        transport.steerQueuedMessage?.({
          threadId,
          messageId,
          deliverInActiveRun,
        }),
      ).resolves.toEqual({ runId: "run-promoted", alreadySubmitted: true });
      expect(writes).toHaveLength(1);
      await transport.dispose();
    }
  });

  it("clears the promotion claim and starts no run when the server answers already submitted", async () => {
    for (const deliverInActiveRun of [true, false]) {
      let startRequests = 0;
      const mutations: Array<Record<string, unknown>> = [];
      const fetcher = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          const method = String(init?.method ?? "GET").toUpperCase();
          if (url.startsWith(`${apiUrl}/runs/active?`)) {
            return json({
              active: deliverInActiveRun,
              status: deliverInActiveRun ? "running" : "idle",
              runId: "run-active",
            });
          }
          if (url.endsWith(`/threads/${threadId}/queued`)) {
            mutations.push(JSON.parse(String(init?.body)).mutation);
            return json({
              queuedMessages: [],
              alreadySubmitted: true,
              submittedRunId: "run-promoted",
            });
          }
          if (url.endsWith(apiUrl) && method === "POST") startRequests += 1;
          return json({
            id: threadId,
            threadData: JSON.stringify({
              queuedMessages: [
                { id: messageId, threadId, text: "Use the blue theme" },
              ],
            }),
          });
        },
      );
      const transport = createAgentNativeAgentKitTransport({
        apiUrl,
        fetch: fetcher as typeof fetch,
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await transport.steerQueuedMessage?.({
          threadId,
          messageId,
          deliverInActiveRun,
        });
        expect(result).toStrictEqual({
          runId: "run-promoted",
          alreadySubmitted: true,
        });
      }
      expect(startRequests).toBe(0);
      expect(mutations.map((mutation) => mutation.type)).toEqual(
        deliverInActiveRun ? ["steer", "steer"] : ["claim", "claim"],
      );
      const claimIds = mutations
        .filter((mutation) => mutation.type === "claim")
        .map((mutation) => mutation.claimId);
      expect(new Set(claimIds).size).toBe(deliverInActiveRun ? 0 : 2);
      await transport.dispose();
    }
  });

  it("rejects an already-submitted answer that names no run instead of treating it as promoted", async () => {
    for (const deliverInActiveRun of [true, false]) {
      let startRequests = 0;
      const mutations: Array<Record<string, unknown>> = [];
      const fetcher = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          const method = String(init?.method ?? "GET").toUpperCase();
          if (url.startsWith(`${apiUrl}/runs/active?`)) {
            return json({
              active: deliverInActiveRun,
              status: deliverInActiveRun ? "running" : "idle",
              runId: "run-active",
            });
          }
          if (url.endsWith(`/threads/${threadId}/queued`)) {
            mutations.push(JSON.parse(String(init?.body)).mutation);
            return json({ queuedMessages: [], alreadySubmitted: true });
          }
          if (url.endsWith(apiUrl) && method === "POST") startRequests += 1;
          return json({
            id: threadId,
            threadData: JSON.stringify({
              queuedMessages: [
                { id: messageId, threadId, text: "Use the blue theme" },
              ],
            }),
          });
        },
      );
      const transport = createAgentNativeAgentKitTransport({
        apiUrl,
        fetch: fetcher as typeof fetch,
      });
      await expect(
        transport.steerQueuedMessage?.({
          threadId,
          messageId,
          deliverInActiveRun,
        }),
      ).rejects.toThrow("must include submittedRunId");
      expect(startRequests).toBe(0);
      await transport.dispose();
    }
  });
});
