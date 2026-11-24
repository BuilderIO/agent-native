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
              agentNativeRunDurationMs: 5_027,
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
    ).toBe("Worked for 5s");
  });

  it("shows the saved duration when an edit fork carries only the reply", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false })
          : json({
              id: threadId,
              threadData: JSON.stringify({
                messages: JSON.parse(storedThread.threadData).messages,
              }),
            }),
      ) as typeof fetch,
    });
    const chatClient = new AgentKitClient({ transport });
    client = chatClient;
    await chatClient.loadThread(threadId);
    await act(async () =>
      root.render(
        <AgentKitProvider controller={chatClient} threadId={threadId}>
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      ),
    );

    const reply = container.querySelector('[data-role="assistant"]');
    expect(reply?.textContent).toContain(savedAnswer);
    expect(
      reply?.querySelector(".agentkit-activities-label")?.textContent,
    ).toBe("Worked for 5s");
  });
});

describe("returning before the final chat snapshot is saved", () => {
  it.each([false, true])(
    "renders the replayed completion within 15s (partial reply saved: %s)",
    async (partialReplySaved) => {
      const claim = "Created the presentation: ocean-tides-marker.";
      let releaseReplay: (response: Response) => void = () => {
        throw new Error("Replay has not started");
      };
      const replay = new Promise<Response>((resolve) => {
        releaseReplay = resolve;
      });
      const requests: string[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        const url = String(input);
        requests.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith(`/threads/${threadId}`))
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    id: promptId,
                    role: "user",
                    content: [{ type: "text", text: "Create ocean tides" }],
                    metadata: { custom: { submittedRunId: runId } },
                  },
                },
                ...(partialReplySaved
                  ? [
                      {
                        message: {
                          id: streamedId,
                          role: "assistant",
                          content: [
                            { type: "text", text: "Created the presentation:" },
                          ],
                          status: { type: "incomplete", reason: "error" },
                          metadata: { runId },
                        },
                      },
                    ]
                  : []),
              ],
            }),
            runLifecycles: {
              queriedRunIds: [runId],
              runs: [
                {
                  id: runId,
                  status: "running",
                  startedAt,
                  completedAt: null,
                  errorCode: null,
                  abortReason: null,
                  terminalReason: null,
                },
              ],
            },
          });
        if (url.includes("/runs/active?") || url.includes("/runs/latest?"))
          return json({ active: false, status: "completed", runId, turnId });
        if (url.endsWith(`/runs/${runId}/events?after=0`)) return replay;
        throw new Error(
          `Unexpected chat request: ${init?.method ?? "GET"} ${url}`,
        );
      };
      const transport = createAgentNativeAgentKitTransport({ fetch: fetcher });
      const chatClient = new AgentKitClient({ transport });
      client = chatClient;
      try {
        await act(async () =>
          root.render(
            <AgentKitProvider controller={chatClient} threadId={threadId}>
              <AgentKitChat composer={false} />
            </AgentKitProvider>,
          ),
        );
        const reopenedAt = performance.now();
        const loading = chatClient.loadThread(threadId);
        await act(async () => {
          await vi.waitFor(() =>
            expect(requests).toContain(
              `GET /_agent-native/agent-chat/threads/${threadId}`,
            ),
          );
        });
        expect(container.textContent).not.toContain(claim);
        await act(async () => {
          releaseReplay(
            new Response(
              [
                { type: "text", text: claim, seq: 1 },
                { type: "done", reason: "complete", seq: 2 },
              ]
                .map((value) => `data: ${JSON.stringify(value)}\n\n`)
                .join(""),
              { headers: { "content-type": "text/event-stream" } },
            ),
          );
          await loading;
        });
        await vi.waitFor(
          () => {
            const replies = container.querySelectorAll(
              '[data-message-id][data-role="assistant"]',
            );
            expect([...replies].map((reply) => reply.textContent)).toEqual([
              expect.stringContaining(claim),
            ]);
          },
          { timeout: 15_000 },
        );
        // wall-clock-ok: Completion must be visible within 15s of reopening the conversation.
        expect(performance.now() - reopenedAt).toBeLessThan(15_000);
        expect(requests).toContain(
          `GET /_agent-native/agent-chat/runs/${runId}/events?after=0`,
        );
        expect(chatClient.getThread(threadId).runs[runId]?.status).toBe(
          "completed",
        );
        expect(
          container.querySelectorAll('[data-running="true"]'),
        ).toHaveLength(0);
        expect(requests.every((request) => request.startsWith("GET "))).toBe(
          true,
        );
      } finally {
        releaseReplay(new Response(""));
        await act(async () => root.unmount());
        await chatClient.shutdown();
        await transport.dispose();
      }
    },
  );
});
