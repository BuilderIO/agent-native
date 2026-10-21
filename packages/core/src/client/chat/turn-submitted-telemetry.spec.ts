import { AgentKitClient } from "@agent-native/agentkit/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAgentEngineReadinessForTests } from "../agent-engine-readiness.js";
import { trackEvent } from "../analytics.js";
import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";
import type { RunOutcomeReport } from "./run-outcome.js";
import {
  createAgentNativeChatRuntime,
  type CreateAgentNativeChatRuntimeOptions,
} from "./runtime.js";
import {
  TURN_SUBMITTED_EVENT,
  trackRoutedTurnSubmitted,
  trackTurnSubmitted,
} from "./turn-submitted-telemetry.js";

vi.mock("../analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("../use-agent-chat-running-threads.js", () => ({
  dispatchAgentChatRunning: vi.fn(),
}));

const API_URL = "/_agent-native/agent-chat";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(
  events: unknown[],
  runId = "run-server",
  headers: Record<string, string> = {},
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
          ),
        );
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Run-Id": runId,
        ...headers,
      },
    },
  );
}

/** Answers engine readiness, and every turn POST with a finished run. */
function chatServer(
  respond: (url: string, init?: RequestInit) => Response | undefined = () =>
    undefined,
) {
  const turnBodies: Array<Record<string, unknown>> = [];
  const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/agent-engine/status")) {
      return json({ configured: true, chatEligible: true });
    }
    const custom = respond(url, init);
    if (custom) return custom;
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url === API_URL && method === "POST") {
      turnBodies.push(JSON.parse(String(init?.body)));
      return sseResponse([
        { type: "text", text: "Done." },
        { type: "done", reason: "complete" },
      ]);
    }
    return json({ error: `Unexpected request: ${method} ${url}` }, 404);
  });
  return { fetcher: fetcher as typeof fetch, turnBodies };
}

function runtimeFor(
  fetcher: typeof fetch,
  options: CreateAgentNativeChatRuntimeOptions = {},
) {
  return createAgentNativeChatRuntime({
    apiUrl: API_URL,
    fetch: fetcher,
    ...options,
  });
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

function submittedEvents(): Array<Record<string, unknown>> {
  return vi
    .mocked(trackEvent)
    .mock.calls.filter(([name]) => name === TURN_SUBMITTED_EVENT)
    .map(([, properties]) => properties as Record<string, unknown>);
}

const userMessage = (text: string) => ({
  id: "user-1",
  role: "user" as const,
  content: [{ type: "text" as const, text }],
});

beforeEach(() => {
  resetAgentEngineReadinessForTests();
  vi.mocked(trackEvent).mockReset();
});

afterEach(() => {
  vi.mocked(trackEvent).mockReset();
});

describe("agent_turn_submitted", () => {
  it("reports a composer turn once, by the user, under the turn id the request carried", async () => {
    const { fetcher, turnBodies } = chatServer();
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: API_URL,
      fetch: fetcher,
    });
    const client = new AgentKitClient({ transport });
    // What the chat composer sends: no submit id, no recovery markers.
    const metadata = { requestMode: "act", model: "model-a" };

    const sent = await client.sendMessage({
      threadId: "thread-composer",
      text: "Summarize this board",
      options: { metadata },
      metadata,
    });
    await sent.completed;

    expect(turnBodies).toHaveLength(1);
    expect(submittedEvents()).toEqual([
      {
        turn_id: turnBodies[0]!.turnId,
        thread_id: "thread-composer",
        run_id: "run-server",
        surface: "chat",
        initiator: "user",
        request_mode: "act",
      },
    ]);
    expect(JSON.stringify(submittedEvents())).not.toContain(
      "Summarize this board",
    );
    await transport.dispose();
  });

  it("reports a sendToAgentChat turn as the app's, with its preset and submit id", async () => {
    const { fetcher, turnBodies } = chatServer();
    const session = await runtimeFor(fetcher).createSession({
      threadId: "thread-app",
    });

    const turn = await session.startTurn({
      prompt: "Draft the outline",
      messages: [userMessage("Draft the outline")],
      metadata: {
        submitMessageId: "submit-app-1",
        agentNativeSurface: "deck-outline",
        requestMode: "plan",
      },
    });
    await drain(turn.events);

    expect(submittedEvents()).toEqual([
      {
        turn_id: turnBodies[0]!.turnId,
        thread_id: "thread-app",
        run_id: "run-server",
        surface: "deck-outline",
        initiator: "app",
        submit_message_id: "submit-app-1",
        request_mode: "plan",
      },
    ]);
  });

  it.each([
    [
      "a background send",
      { submitMessageId: "submit-bg", trackInRunsTray: true },
      undefined,
    ],
    [
      "a recovery retry",
      {
        agentNativeInternalContinuation: true,
        custom: {
          agentNativeRecoveryAction: "retry",
          agentNativeRecoveryOfRunId: "run-failed",
        },
      },
      "run-failed",
    ],
    [
      "a recovery continue",
      {
        agentNativeInternalContinuation: true,
        custom: {
          agentNativeRecoveryAction: "continue",
          agentNativeRecoveryOfRunId: "run-stopped",
        },
      },
      "run-stopped",
    ],
    [
      "a replay after AI setup",
      {
        submitMessageId: "submit-deferred",
        custom: {
          agentNativeResumeAfterSetup: true,
          agentNativeDeferredSubmissionId: "deferred-1",
        },
      },
      undefined,
    ],
    [
      "an approval resume",
      {
        submitMessageId: "submit-approval",
        approvedToolCalls: ["approval-key"],
        hideUserMessage: true,
      },
      undefined,
    ],
  ])(
    "reports %s as started by the chat",
    async (_label, metadata, recoveryOfRunId) => {
      const { fetcher } = chatServer();
      const session = await runtimeFor(fetcher).createSession({
        threadId: "thread-system",
      });

      await drain(
        (
          await session.startTurn({
            prompt: "Go on",
            messages: [userMessage("Go on")],
            metadata,
          })
        ).events,
      );

      const events = submittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ initiator: "system" });
      if (recoveryOfRunId) {
        expect(events[0]!.recovery_of_run_id).toBe(recoveryOfRunId);
      } else {
        expect(events[0]).not.toHaveProperty("recovery_of_run_id");
      }
    },
  );

  it.each([
    ["typed by the person", {}, "user"],
    ["sent by app code", { agentNativeDeferredFromApp: true }, "app"],
  ] as const)(
    "reports a send deferred while the thread restored, %s, as the sender's",
    async (_label, extra, initiator) => {
      const { fetcher } = chatServer();
      const session = await runtimeFor(fetcher).createSession({
        threadId: "thread-deferred",
      });

      await drain(
        (
          await session.startTurn({
            prompt: "Hello",
            messages: [userMessage("Hello")],
            metadata: {
              custom: {
                agentNativeDeferredSubmissionId: "deferred-2",
                ...extra,
              },
            },
          })
        ).events,
      );

      expect(submittedEvents()).toEqual([
        expect.objectContaining({ initiator }),
      ]);
    },
  );

  it("does not report a stream the server refused without starting a run", async () => {
    const { fetcher } = chatServer((url, init) =>
      url === API_URL && String(init?.method).toUpperCase() === "POST"
        ? new Response(
            `data: ${JSON.stringify({ type: "error", error: "Connect a model", errorCode: "missing_llm_credentials" })}\n\n`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          )
        : undefined,
    );
    const session = await runtimeFor(fetcher).createSession({
      threadId: "thread-refused",
    });

    await drain(
      (
        await session.startTurn({
          prompt: "Hello",
          messages: [userMessage("Hello")],
        })
      ).events,
    );

    expect(submittedEvents()).toEqual([]);
  });

  it("does not report a replay of a turn the server already finished", async () => {
    const { fetcher } = chatServer((url, init) =>
      url === API_URL && String(init?.method).toUpperCase() === "POST"
        ? sseResponse(
            [
              { type: "text", text: "Done." },
              { type: "done", reason: "complete" },
            ],
            "run-finished",
            { "X-Dispatch-Mode": "replay" },
          )
        : undefined,
    );
    const session = await runtimeFor(fetcher).createSession({
      threadId: "thread-replay",
    });

    await drain(
      (
        await session.startTurn({
          prompt: "Go on",
          messages: [userMessage("Go on")],
        })
      ).events,
    );

    expect(fetcher).toHaveBeenCalledWith(API_URL, expect.anything());
    expect(submittedEvents()).toEqual([]);
  });

  it("reports a promoted queued turn under its queue turn id", async () => {
    const { fetcher, turnBodies } = chatServer();
    const session = await runtimeFor(fetcher).createSession({
      threadId: "thread-queue",
    });

    await drain(
      (
        await session.startTurn({
          prompt: "Next",
          messages: [userMessage("Next")],
          queuePromotion: {
            messageId: "msg-7",
            claimId: "claim-7",
            turnId: "queue-msg-7",
          },
        })
      ).events,
    );

    expect(turnBodies[0]!.turnId).toBe("queue-msg-7");
    expect(submittedEvents()).toEqual([
      expect.objectContaining({ turn_id: "queue-msg-7", initiator: "user" }),
    ]);
  });

  it("reports a continuation under the turn it continues, as the chat's", async () => {
    const { fetcher, turnBodies } = chatServer();
    const session = await runtimeFor(fetcher).createSession({
      threadId: "thread-continue",
    });

    await drain(
      (await session.continueTurn!({ turnId: "turn-original", prompt: "Go" }))
        .events,
    );

    expect(turnBodies[0]!.turnId).toBe("turn-original");
    expect(submittedEvents()).toEqual([
      expect.objectContaining({
        turn_id: "turn-original",
        initiator: "system",
      }),
    ]);
  });

  it("does not report subscribing to a run that already exists", async () => {
    const { fetcher } = chatServer((url) =>
      url.includes("/runs/") ? sseResponse([{ type: "done" }]) : undefined,
    );
    const runtime = runtimeFor(fetcher);

    await drain(
      await runtime.subscribe!({
        sessionId: "thread-reload",
        runId: "run-existing",
        turnId: "turn-existing",
      }),
    );

    expect(fetcher).toHaveBeenCalled();
    expect(submittedEvents()).toEqual([]);
  });

  it("does not report a turn the server refused, so a queued retry counts once", async () => {
    let busy = true;
    const { fetcher, turnBodies } = chatServer((url, init) => {
      if (url !== API_URL || !busy) return undefined;
      busy = false;
      turnBodies.push(JSON.parse(String(init?.body)));
      return json({ code: "run_slot_busy", activeRunId: "run-active" }, 409);
    });
    const session = await runtimeFor(fetcher).createSession({
      threadId: "thread-busy",
    });

    await expect(
      session.startTurn({ prompt: "Hi", messages: [userMessage("Hi")] }),
    ).rejects.toMatchObject({ status: 409 });
    expect(submittedEvents()).toEqual([]);

    await drain(
      (
        await session.startTurn({
          prompt: "Hi",
          messages: [userMessage("Hi")],
          queuePromotion: {
            messageId: "msg-busy",
            claimId: "claim-busy",
            turnId: "queue-msg-busy",
          },
        })
      ).events,
    );
    expect(submittedEvents()).toEqual([
      expect.objectContaining({ turn_id: "queue-msg-busy" }),
    ]);
  });

  it("reports a turn once when its request falls back to another route", async () => {
    const { fetcher, turnBodies } = chatServer((url) =>
      url.endsWith("/stream-token") ? json({}, 503) : undefined,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = await runtimeFor(fetcher, {
      streamingUrl: "https://stream.example.test/agent-chat",
    }).createSession({ threadId: "thread-fallback" });

    await drain(
      (await session.startTurn({ prompt: "Hi", messages: [userMessage("Hi")] }))
        .events,
    );
    warn.mockRestore();

    expect(
      vi
        .mocked(fetcher)
        .mock.calls.map(([input]) => String(input))
        .filter((url) => !url.includes("/agent-engine/status")),
    ).toEqual([`${API_URL}/stream-token`, API_URL]);
    expect(submittedEvents()).toEqual([
      expect.objectContaining({ turn_id: turnBodies[0]!.turnId }),
    ]);
  });

  it("starts the turn when the analytics call throws", async () => {
    vi.mocked(trackEvent).mockImplementation(() => {
      throw new Error("analytics exploded");
    });
    const { fetcher, turnBodies } = chatServer();
    const session = await runtimeFor(fetcher).createSession({
      threadId: "thread-throw",
    });

    const turn = await session.startTurn({
      prompt: "Hi",
      messages: [userMessage("Hi")],
    });
    const events = await drain(turn.events);

    expect(turnBodies).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "done", reason: "complete" });
    expect(vi.mocked(trackEvent)).toHaveBeenCalledWith(
      TURN_SUBMITTED_EVENT,
      expect.objectContaining({ turn_id: turnBodies[0]!.turnId }),
    );
  });
});

describe("turn submitted trackers", () => {
  it("swallow a send that throws", () => {
    const send = vi.fn(() => {
      throw new Error("analytics down");
    });

    expect(() =>
      trackTurnSubmitted(
        { turnId: "turn-1", surface: "chat", initiator: "user" },
        send,
      ),
    ).not.toThrow();
    expect(() =>
      trackRoutedTurnSubmitted({ routedTo: "builder", surface: "chat" }, send),
    ).not.toThrow();
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("agent_run_outcome turn id", () => {
  it("carries the turn id the run's request sent", async () => {
    const { fetcher, turnBodies } = chatServer();
    const reports: RunOutcomeReport[] = [];
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: API_URL,
      fetch: fetcher,
      adapter: { onRunOutcome: (report) => reports.push(report) },
    });
    const client = new AgentKitClient({ transport });

    await (
      await client.sendMessage({ threadId: "thread-outcome", text: "Hi" })
    ).completed;

    expect(reports).toEqual([
      expect.objectContaining({
        outcome: "succeeded",
        turnId: turnBodies[0]!.turnId,
      }),
    ]);
    await transport.dispose();
  });

  it("carries the turn id of a turn refused at its start", async () => {
    const { fetcher, turnBodies } = chatServer((url, init) => {
      if (url !== API_URL) return undefined;
      turnBodies.push(JSON.parse(String(init?.body)));
      return json({ error: "No model", code: "missing_credentials" }, 403);
    });
    const reports: RunOutcomeReport[] = [];
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: API_URL,
      fetch: fetcher,
      adapter: { onRunOutcome: (report) => reports.push(report) },
    });

    await expect(
      transport.startRun({
        threadId: "thread-refused",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "Hi" }] },
        ],
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(reports).toEqual([
      expect.objectContaining({ turnId: turnBodies[0]!.turnId }),
    ]);
    await transport.dispose();
  });

  it("leaves the turn id out for a run this page did not start", async () => {
    const { fetcher } = chatServer();
    const reports: RunOutcomeReport[] = [];
    const runtime = runtimeFor(fetcher);
    runtime.subscribe = async () =>
      (async function* () {
        yield { type: "done", reason: "complete" } as const;
      })();
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: API_URL,
      fetch: fetcher,
      runtime,
      adapter: { onRunOutcome: (report) => reports.push(report) },
    });

    await drain(
      transport.subscribeToRun({
        threadId: "thread-restored",
        runId: "run-from-before-reload",
      }),
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]).not.toHaveProperty("turnId");
    expect(submittedEvents()).toEqual([]);
    await transport.dispose();
  });
});
