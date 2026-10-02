import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { describe, expect, it, vi } from "vitest";

import { createAgentKitProtocolAdapter } from "./agentkit-protocol.js";
import { runOutcomeOfEvents } from "./run-outcome.js";
import { createAgentNativeChatRuntime } from "./runtime.js";

const API = "/_agent-native/agent-chat";
const THREAD = "thread-auto-continue";

type Wire = Record<string, unknown>;

const DELEGATION_START: Wire = {
  type: "tool_start",
  tool: "call-agent",
  id: "call-1",
  input: { agent: "analytics", message: "Count last week's signups" },
};
const DELEGATION_DONE: Wire = {
  type: "tool_done",
  tool: "call-agent",
  id: "call-1",
  result: "412 signups",
};
const TIME_LIMIT: Wire = { type: "auto_continue", reason: "run_timeout" };

/**
 * A server whose runs each answer one POST. A run ending in a time-limit stop
 * is recorded as `truncated` / `run_timeout` in the foreground, which nothing
 * on the server continues.
 */
function fakeServer(
  runs: readonly (readonly Wire[] | { status: number; body: Wire })[],
) {
  const posts: Wire[] = [];
  const records = new Map<
    string,
    { turnId: string; status: string; reason: string | null }
  >();
  let newest = "";
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.pathname === API) {
      const body = JSON.parse(String(init?.body)) as Wire;
      posts.push(body);
      const script = runs[posts.length - 1]!;
      if (!Array.isArray(script)) {
        const refusal = script as { status: number; body: Wire };
        return Response.json(refusal.body, { status: refusal.status });
      }
      const runId = `run-${posts.length}`;
      const stopped = script.at(-1)?.type === "auto_continue";
      records.set(runId, {
        turnId: String(body.turnId),
        status: stopped ? "truncated" : "completed",
        reason: stopped ? "run_timeout" : "done",
      });
      newest = runId;
      return new Response(
        script
          .map((event, seq) => `data: ${JSON.stringify({ ...event, seq })}\n\n`)
          .join(""),
        {
          headers: { "Content-Type": "text/event-stream", "X-Run-Id": runId },
        },
      );
    }
    if (method === "POST" && url.pathname.endsWith("/abort")) {
      return Response.json({ ok: true });
    }
    if (url.pathname === `${API}/runs/latest`) {
      const record = records.get(newest)!;
      return Response.json({
        runId: newest,
        threadId: THREAD,
        turnId: record.turnId,
        status: record.status,
        dispatchMode: "foreground",
        terminalReason: record.reason,
      });
    }
    if (/\/runs\/[^/]+\/events$/.test(url.pathname)) {
      // The stopped run has nothing more to send.
      return new Response("", {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, posts };
}

async function runTurn(
  server: ReturnType<typeof fakeServer>,
  adapter: { autoContinueLabel?: string } = { autoContinueLabel: "Resuming" },
): Promise<AgentEvent[]> {
  const transport = createAgentKitProtocolAdapter(
    createAgentNativeChatRuntime({ apiUrl: API, fetch: server.fetch }),
    adapter,
  );
  const { runId } = await transport.startRun({
    threadId: THREAD,
    messages: [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "How many signups last week?" }],
      },
    ],
  });
  const events: AgentEvent[] = [];
  for await (const event of transport.subscribeToRun({
    threadId: THREAD,
    runId,
  })) {
    events.push(event);
  }
  await transport.dispose();
  return events;
}

function assistantText(events: readonly AgentEvent[]): string {
  return events
    .flatMap((event) => (event.type === "message.delta" ? [event.text] : []))
    .join("");
}

describe("AgentKit continues a turn the server stopped at its time limit", () => {
  it("resumes in the same turn, so finished delegations keep their idempotency key", async () => {
    const server = fakeServer([
      [
        { type: "text", text: "Checking. " },
        DELEGATION_START,
        DELEGATION_DONE,
        TIME_LIMIT,
      ],
      [{ type: "text", text: "Still summarizing. " }, TIME_LIMIT],
      [{ type: "text", text: "412 signups." }, { type: "done" }],
    ]);

    const events = await runTurn(server);

    const [first, ...continuations] = server.posts;
    expect(continuations).toHaveLength(2);
    // The server's turn id, not the runtime's id for a continuation: the
    // turn's journal and `call-agent`'s idempotency key are keyed by it.
    for (const [index, body] of continuations.entries()) {
      expect(body).toMatchObject({
        turnId: first!.turnId,
        internalContinuation: true,
        autoContinueOfRunId: `run-${index + 1}`,
      });
    }
    expect(runOutcomeOfEvents(events)).toBe("succeeded");
    expect(assistantText(events)).toBe(
      "Checking. Still summarizing. 412 signups.",
    );
    const messageIds = new Set(
      events.flatMap((event) =>
        event.type === "message.delta" ? [event.messageId] : [],
      ),
    );
    expect(messageIds.size).toBe(1);
    expect(
      events.filter(
        (event) =>
          event.type === "activity.started" &&
          event.activity.kind === "status" &&
          event.activity.label === "Resuming",
      ),
    ).toHaveLength(2);
  });

  it("ends as stopped with Continue available once the server refuses another continuation", async () => {
    const server = fakeServer([
      [{ type: "text", text: "Working. " }, TIME_LIMIT],
      {
        status: 409,
        body: {
          error: "This turn will not continue automatically.",
          code: "auto_continue_cap_reached",
          retryable: false,
        },
      },
    ]);

    const events = await runTurn(server);

    expect(server.posts).toHaveLength(2);
    expect(runOutcomeOfEvents(events)).toBe("interrupted");
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      error: { code: "auto_continue_cap_reached", retryable: true },
    });
  });

  it("keeps Stop working while the continuation is being sent", async () => {
    let releaseContinuation!: () => void;
    const continuationHeld = new Promise<void>((resolve) => {
      releaseContinuation = resolve;
    });
    let continuationSent!: () => void;
    const continuationStarted = new Promise<void>((resolve) => {
      continuationSent = resolve;
    });
    const aborts: Wire[] = [];
    const server = fakeServer([
      [{ type: "text", text: "Working. " }, TIME_LIMIT],
      [{ type: "text", text: "Should never show." }, { type: "done" }],
    ]);
    const serve = server.fetch;
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/abort")) {
          aborts.push(JSON.parse(String(init?.body)) as Wire);
        }
        if (
          url.pathname === API &&
          (JSON.parse(String(init?.body)) as Wire).internalContinuation
        ) {
          continuationSent();
          await continuationHeld;
        }
        return serve(input, init);
      },
    ) as unknown as typeof globalThis.fetch;
    const transport = createAgentKitProtocolAdapter(
      createAgentNativeChatRuntime({ apiUrl: API, fetch }),
      { autoContinueLabel: "Resuming" },
    );
    const { runId } = await transport.startRun({
      threadId: THREAD,
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "Go" }] },
      ],
    });
    const events: AgentEvent[] = [];
    const reading = (async () => {
      for await (const event of transport.subscribeToRun({
        threadId: THREAD,
        runId,
      })) {
        events.push(event);
      }
    })();

    await continuationStarted;
    await transport.cancelRun({ threadId: THREAD, runId });
    releaseContinuation();
    await reading;
    await transport.dispose();

    expect(runOutcomeOfEvents(events)).toBe("stopped");
    expect(aborts).toEqual([expect.objectContaining({ reason: "user" })]);
    expect(assistantText(events)).toBe("Working. ");
  });

  it("continues without a status row for a host that gives no label", async () => {
    const server = fakeServer([
      [{ type: "text", text: "Working. " }, TIME_LIMIT],
      [{ type: "text", text: "Done." }, { type: "done" }],
    ]);

    const events = await runTurn(server, {});

    expect(runOutcomeOfEvents(events)).toBe("succeeded");
    expect(events.some((event) => event.type === "activity.started")).toBe(
      false,
    );
  });
});
