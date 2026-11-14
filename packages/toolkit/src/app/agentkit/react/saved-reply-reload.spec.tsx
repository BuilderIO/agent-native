// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agentkit-chat/transport";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

const threadId = "thread-saved-reply-reload";
const runId = "run-saved-reply-reload";
const turnId = "turn-saved-reply-reload";
const promptId = "message-prompt";
const streamedId = "message-streamed-reply";
const startedAt = Date.parse("2026-10-26T21:43:54.411Z");
const completedAt = startedAt + 19_193;
const streamedAnswer = "Here are the main answers so you can pick.";
const savedAnswer = "Here are the main answers, so you can pick your own.";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function event(sequence: number, occurredAt: number, body: object) {
  return {
    id: `${runId}:${sequence}`,
    threadId,
    runId,
    sequence,
    occurredAt: iso(occurredAt),
    ...body,
  };
}

const activity = {
  id: "activity-read",
  kind: "read",
  label: "Read the brief",
};

// The thread as the server saves it: its own copy of the reply under its own
// id, beside the chat's copy under the id the run's events use.
const storedThread = {
  id: threadId,
  threadData: JSON.stringify({
    messages: [
      {
        message: {
          id: `server-user-${runId}`,
          role: "user",
          content: [{ type: "text", text: "Compare them" }],
          metadata: {
            custom: {
              submittedRunId: runId,
              submittedTurnId: turnId,
              agentKitMessageId: promptId,
            },
          },
        },
        parentId: null,
      },
      {
        message: {
          id: `server-${runId}`,
          role: "assistant",
          status: { type: "complete", reason: "stop" },
          content: [{ type: "text", text: savedAnswer }],
          metadata: {
            runId,
            custom: {
              turnId,
              foldedRunIds: [runId],
              agentNativeRunDurationMs: 19_027,
            },
          },
        },
        parentId: `server-user-${runId}`,
      },
    ],
    agentKit: {
      messages: [
        {
          id: promptId,
          role: "user",
          parts: [{ type: "text", text: "Compare them" }],
        },
        {
          id: streamedId,
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: streamedAnswer }],
        },
      ],
      events: [
        event(1, startedAt, { type: "run.started" }),
        event(2, startedAt + 200, {
          type: "activity.started",
          activity: { ...activity, status: "running" },
        }),
        event(3, startedAt + 1_200, {
          type: "activity.completed",
          activity: { ...activity, status: "completed" },
        }),
        event(4, completedAt, {
          type: "message.completed",
          message: {
            id: streamedId,
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: streamedAnswer }],
          },
        }),
        event(5, completedAt, { type: "run.completed" }),
      ],
      runs: [
        {
          id: runId,
          threadId,
          status: "completed",
          startedAt: iso(startedAt),
          completedAt: iso(completedAt),
          lastSequence: 5,
          activeMessageId: streamedId,
        },
      ],
      activeRunIds: [],
      suggestions: [],
    },
  }),
  runLifecycles: {
    queriedRunIds: [runId],
    runs: [
      {
        id: runId,
        status: "completed",
        startedAt,
        completedAt,
        errorCode: null,
        abortReason: null,
        terminalReason: "done",
      },
    ],
  },
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let client: AgentKitClient | undefined;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client?.dispose();
  client = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

describe("reloading a thread whose saved reply differs from the stream", () => {
  it("shows the saved reply with its Worked for row", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "completed", runId })
          : json(storedThread),
      ) as typeof fetch,
    });
    client = new AgentKitClient({ transport });
    await client.loadThread(threadId);
    await act(async () =>
      root.render(
        <AgentKitProvider controller={client!} threadId={threadId}>
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      ),
    );

    const transcript = container.querySelector(".agentkit-transcript")!;
    const replies = transcript.querySelectorAll(
      '[data-message-id][data-role="assistant"]',
    );
    expect(
      [...replies].map((reply) => reply.getAttribute("data-message-id")),
    ).toEqual([streamedId]);
    expect(replies[0]?.textContent).toContain(savedAnswer);
    expect(transcript.textContent).not.toContain(streamedAnswer);
    expect(
      transcript.querySelector(".agentkit-activities-label")?.textContent,
    ).toBe("Worked for 19s");
  });
});
