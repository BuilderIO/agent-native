import { describe, expect, it, vi } from "vitest";

import {
  buildAssistantTurnSegments,
  buildUserMessage,
  foldAgentChatRunCompletion,
} from "../../agent/thread-data-builder.js";
import type { RunEvent } from "../../agent/types.js";
import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";

vi.mock("../use-agent-chat-running-threads.js", () => ({
  dispatchAgentChatRunning: vi.fn(),
}));

const threadId = "thread-stopped-reload";
const runId = "run-stopped-reload";
const turnId = "turn-stopped-reload";
const startedAt = Date.parse("2026-10-24T10:00:01.000Z");
const PARTIAL =
  "13. Kelp forests shelter otters.\n14. Mangrove forests grow along tropical co";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The thread the server saves when the user stops the run mid-reply. */
function stoppedThreadData(input: {
  events: RunEvent[];
  savedBeforeStop?: (promptId: string) => Record<string, unknown>;
}) {
  const prompt = buildUserMessage({
    text: "Write 20 numbered sentences about the ocean.",
    runId,
    turnId,
    createdAt: new Date("2026-10-24T10:00:00.000Z"),
  });
  const repo = {
    messages: [{ message: prompt, parentId: null }],
    headId: prompt.id,
    ...(input.savedBeforeStop
      ? { agentKit: input.savedBeforeStop(prompt.id) }
      : {}),
  };
  const turn = buildAssistantTurnSegments(input.events, runId, {
    turnId,
    suppressInternalContinuation: true,
  });
  return JSON.stringify(
    foldAgentChatRunCompletion(
      repo,
      turn.assistant,
      {
        runId,
        threadId,
        turnId,
        parentId: prompt.id,
        status: "aborted",
        abortReason: "user",
        startedAt,
        events: input.events,
      },
      turn.steered,
    ),
  );
}

function reloadTransport(threadData: string) {
  return createAgentNativeAgentKitTransport({
    fetch: vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/runs/active")) {
        return json({ active: false, status: "idle" });
      }
      return json({
        id: threadId,
        threadData,
        runLifecycles: {
          queriedRunIds: [runId],
          runs: [
            {
              id: runId,
              status: "aborted",
              startedAt,
              completedAt: startedAt + 4_000,
              errorCode: null,
              abortReason: "user",
              terminalReason: "aborted:user",
            },
          ],
        },
      });
    }) as typeof fetch,
  });
}

const partialEvents: RunEvent[] = [
  {
    seq: 0,
    event: { type: "text", text: "13. Kelp forests shelter otters.\n" },
  },
  { seq: 1, event: { type: "text", text: "14. Mangrove forests grow along" } },
  { seq: 2, event: { type: "text", text: " tropical co" } },
  { seq: 3, event: { type: "done", reason: "user" } },
];

describe("reloading a thread whose run the user stopped", () => {
  it.each([
    { saved: "only the server's save" },
    { saved: "the client's snapshot from before the stop" },
  ])("shows the partial reply and the stop, from $saved", async ({ saved }) => {
    const transport = reloadTransport(
      stoppedThreadData({
        events: partialEvents,
        ...(saved === "only the server's save"
          ? {}
          : {
              savedBeforeStop: (promptId) => ({
                messages: [
                  {
                    id: promptId,
                    role: "user",
                    status: "complete",
                    parts: [
                      {
                        type: "text",
                        text: "Write 20 numbered sentences about the ocean.",
                      },
                    ],
                    createdAt: "2026-10-24T10:00:00.000Z",
                  },
                ],
                runs: [
                  { id: runId, threadId, status: "running", lastSequence: 3 },
                ],
                activeRunIds: [runId],
              }),
            }),
      }),
    );

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    const reply = snapshot?.messages.at(-1);
    expect(reply?.role).toBe("assistant");
    expect(reply?.parts).toEqual([
      expect.objectContaining({ type: "text", text: PARTIAL }),
    ]);
    expect(snapshot?.runs).toContainEqual(
      expect.objectContaining({
        id: runId,
        status: "cancelled",
        activeMessageId: reply?.id,
      }),
    );
    expect(snapshot?.activeRunIds).not.toContain(runId);
    await transport.dispose();
  });

  it("shows the stop without an empty reply when the run wrote nothing", async () => {
    const transport = reloadTransport(
      stoppedThreadData({
        events: [{ seq: 0, event: { type: "done", reason: "user" } }],
      }),
    );

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.role)).toEqual(["user"]);
    expect(snapshot?.runs).toContainEqual(
      expect.objectContaining({ id: runId, status: "cancelled" }),
    );
    await transport.dispose();
  });
});
