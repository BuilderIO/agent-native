import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BACKGROUND_FUNCTION_WALL_HEADROOM_MS } from "../../app-config/run-lifecycle-invariants.js";
import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";
import { createAgentKitProtocolAdapter } from "./agentkit-protocol.js";
import {
  RUN_SIGNED_OUT_MESSAGE,
  RUN_UNVERIFIED_MESSAGE,
  runOutcomeForCode,
  runOutcomeOfEvents,
  type RunOutcome,
  type RunOutcomeReport,
} from "./run-outcome.js";
import { createAgentNativeChatRuntime } from "./runtime.js";

/**
 * Chaos test for the run-lifecycle invariant: the browser never decides how a
 * run ended. A fake server runs a scripted turn on its own clock while the
 * browser's streams are cut at every interesting point, the network drops,
 * the events endpoint refuses, the handoff to a successor run is slow or never
 * comes, and the page reloads. Whatever happens to the pipe, the outcome the
 * reader sees must converge to the server's, and the reader must never see a
 * terminal outcome while the server says the run is still going.
 */

const API = "/_agent-native/agent-chat";
const THREAD = "thread-chaos";
const STEP_MS = 1_000;

type Wire = { type: string; [key: string]: unknown };
type FinalStatus = "completed" | "truncated" | "errored" | "aborted";

interface ServerRun {
  readonly id: string;
  /** When this run's row exists; a successor appears after its handoff. */
  readonly startsAtMs: number;
  readonly events: readonly { atMs: number; event: Wire }[];
  readonly final: {
    readonly atMs: number;
    readonly status: FinalStatus;
    readonly terminalReason: string;
  };
}

interface Chaos {
  /** Events the first stream delivers before the connection is cut. */
  readonly sever: number;
  /** Every reconnect stream is also cut after this many events. */
  readonly reconnectCut?: number;
  /** Extra silence before the server produces its first unseen event. */
  readonly silenceMs?: number;
  /** Every non-POST request fails at the network level until then. */
  readonly networkDownUntilMs?: number;
  /** The events endpoint answers 404 until then. */
  readonly eventsUnavailableUntilMs?: number;
  /** The turn was already stopped: the POST answers JSON with no run id. */
  readonly postAnswersStopped?: boolean;
}

const TEXT_HELLO: Wire = { type: "text", text: "Hello " };
const TOOL_START: Wire = {
  type: "tool_start",
  tool: "search",
  id: "call-1",
  input: { q: "x" },
};
const TOOL_DONE: Wire = {
  type: "tool_done",
  tool: "search",
  id: "call-1",
  result: "found",
};
const TEXT_WORLD: Wire = { type: "text", text: "world" };

const FINALS = {
  succeeded: {
    wire: { type: "done" },
    status: "completed",
    terminalReason: "done",
  },
  failed: {
    wire: {
      type: "error",
      error: "The provider rejected the API key.",
      errorCode: "provider_auth_failed",
    },
    status: "errored",
    terminalReason: "error:provider_auth_failed",
  },
  stopped: {
    wire: { type: "done", reason: "user" },
    status: "aborted",
    terminalReason: "aborted:user",
  },
  interrupted: {
    wire: {
      type: "error",
      error:
        "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
      errorCode: "stale_run",
      recoverable: true,
    },
    status: "errored",
    terminalReason: "error:stale_run",
  },
} as const satisfies Record<
  Exclude<RunOutcome, "running" | "unverified">,
  { wire: Wire; status: FinalStatus; terminalReason: string }
>;

/**
 * A run whose first `seen` events already reached the browser at
 * `startsAtMs`; the server produces each later event one step apart.
 */
function scriptedRun(input: {
  id: string;
  startsAtMs: number;
  wires: readonly Wire[];
  seen: number;
  silenceMs?: number;
  status: FinalStatus;
  terminalReason: string;
}): ServerRun {
  const events = input.wires.map((event, index) => ({
    event,
    atMs:
      index < input.seen
        ? input.startsAtMs
        : input.startsAtMs +
          (input.silenceMs ?? 0) +
          (index - input.seen + 1) * STEP_MS,
  }));
  return {
    id: input.id,
    startsAtMs: input.startsAtMs,
    events,
    final: {
      atMs: events.at(-1)!.atMs,
      status: input.status,
      terminalReason: input.terminalReason,
    },
  };
}

function createFakeServer(runs: readonly ServerRun[], chaos: Chaos) {
  const startedAt = Date.now();
  const clock = () => Date.now() - startedAt;
  const requests: string[] = [];
  const postedTurnIds: string[] = [];
  const statusAt = (run: ServerRun, t: number) =>
    t >= run.final.atMs ? run.final.status : "running";
  const newestRunAt = (t: number) =>
    [...runs].reverse().find((run) => run.startsAtMs <= t)!;
  const sse = (events: Wire[], runId: string) =>
    new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      {
        headers: { "Content-Type": "text/event-stream", "X-Run-Id": runId },
      },
    );

  const fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const method = String(init?.method ?? "GET").toUpperCase();
      const t = clock();
      requests.push(`${method} ${url.pathname}${url.search}`);
      if (method === "POST" && url.pathname === API) {
        postedTurnIds.push(
          String((JSON.parse(String(init?.body)) as Wire).turnId),
        );
        if (chaos.postAnswersStopped) {
          return Response.json({ ok: true, stopped: true });
        }
        const first = runs[0]!;
        return sse(
          first.events
            .slice(0, chaos.sever)
            .map(({ event }, seq) => ({ ...event, seq })),
          first.id,
        );
      }
      if (
        chaos.networkDownUntilMs !== undefined &&
        t < chaos.networkDownUntilMs
      ) {
        throw new TypeError("Failed to fetch");
      }
      if (method === "POST" && url.pathname.endsWith("/abort")) {
        return Response.json({ ok: true });
      }
      if (url.pathname === `${API}/runs/latest`) {
        const runId = url.searchParams.get("runId");
        if (runId && !runs.some((run) => run.id === runId)) {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }
        const run = newestRunAt(t);
        const status = statusAt(run, t);
        return Response.json({
          runId: run.id,
          threadId: THREAD,
          turnId: postedTurnIds[0] ?? "turn-server",
          status,
          terminalReason:
            status === "running" ? null : run.final.terminalReason,
        });
      }
      const eventsMatch = url.pathname.match(/\/runs\/([^/]+)\/events$/);
      if (eventsMatch && method === "GET") {
        if (
          chaos.eventsUnavailableUntilMs !== undefined &&
          t < chaos.eventsUnavailableUntilMs
        ) {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }
        const run = runs.find((candidate) => candidate.id === eventsMatch[1]);
        if (!run) {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }
        const after = Number(url.searchParams.get("after") ?? 0);
        const available = run.events
          .map(({ event, atMs }, seq) => ({ event: { ...event, seq }, atMs }))
          .filter(({ event, atMs }) => event.seq >= after && atMs <= t)
          .map(({ event }) => event);
        return sse(
          chaos.reconnectCut === undefined
            ? available
            : available.slice(0, chaos.reconnectCut),
          run.id,
        );
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  ) as unknown as typeof fetch & { mock: { calls: unknown[][] } };

  /** The outcome the server's own records give the turn at time `t`. */
  const outcomeAt = (t: number): RunOutcome => {
    const run = newestRunAt(t);
    const status = statusAt(run, t);
    if (status === "running") return "running";
    if (status === "completed") return "succeeded";
    if (status === "truncated") {
      // Continuing until a successor carries the turn; with none scripted,
      // the turn stopped at the boundary.
      return runs.at(-1) === run ? "interrupted" : "running";
    }
    const reason = run.final.terminalReason;
    return runOutcomeForCode(
      reason.startsWith("error:")
        ? reason.slice("error:".length)
        : `aborted_${reason.slice("aborted:".length)}`,
    );
  };

  return { fetch, clock, requests, outcomeAt };
}

type Observed = { event: AgentEvent; atMs: number };

function isTerminal(event: AgentEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled"
  );
}

async function readUntilSettled(
  events: AsyncIterable<AgentEvent>,
  clock: () => number,
): Promise<Observed[]> {
  const observed: Observed[] = [];
  let settled = false;
  const reading = (async () => {
    for await (const event of events) {
      observed.push({ event, atMs: clock() });
    }
  })().finally(() => {
    settled = true;
  });
  const limitMs = BACKGROUND_FUNCTION_WALL_HEADROOM_MS + 120_000;
  for (let elapsed = 0; !settled && elapsed < limitMs; elapsed += 500) {
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(settled, "the reader converged to a terminal event").toBe(true);
  await reading;
  return observed;
}

function assistantText(observed: readonly Observed[]): string {
  const completed = observed
    .map(({ event }) => event)
    .filter(
      (event): event is Extract<AgentEvent, { type: "message.completed" }> =>
        event.type === "message.completed" &&
        event.message.role === "assistant",
    )
    .at(-1);
  return (completed?.message.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function expectConvergedToServer(
  observed: readonly Observed[],
  server: ReturnType<typeof createFakeServer>,
  expected: RunOutcome,
): Observed {
  const terminals = observed.filter(({ event }) => isTerminal(event));
  expect(terminals).toHaveLength(1);
  const terminal = terminals[0]!;
  expect(observed.at(-1)).toBe(terminal);
  // The invariant: a terminal outcome only ever appears once the server's
  // own record is terminal, and it is the server's outcome.
  const truth = server.outcomeAt(terminal.atMs);
  expect(truth).not.toBe("running");
  expect(runOutcomeOfEvents(observed.map(({ event }) => event))).toBe(truth);
  expect(truth).toBe(expected);
  return terminal;
}

function singleRunScript(
  finalOutcome: keyof typeof FINALS,
  chaos: Chaos,
): ServerRun[] {
  const final = FINALS[finalOutcome];
  return [
    scriptedRun({
      id: "run-1",
      startsAtMs: 0,
      wires: [TEXT_HELLO, TOOL_START, TOOL_DONE, TEXT_WORLD, final.wire],
      seen: chaos.sever,
      silenceMs: chaos.silenceMs,
      status: final.status,
      terminalReason: final.terminalReason,
    }),
  ];
}

const SEVER_POINTS = [
  { sever: 0, label: "before the first event" },
  { sever: 1, label: "mid-text" },
  { sever: 2, label: "after tool_start, before tool_done" },
  { sever: 3, label: "after tool_done, before the final text" },
  { sever: 4, label: "after the final text, before the terminal event" },
] as const;

async function startTurn(
  server: ReturnType<typeof createFakeServer>,
  adapter: { onRunOutcome?: (report: RunOutcomeReport) => void } = {},
) {
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
        parts: [{ type: "text", text: "Find it" }],
      },
    ],
  });
  return { transport, runId };
}

describe("run lifecycle chaos: a cut stream never decides how a run ended", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const finalOutcome of Object.keys(FINALS) as (keyof typeof FINALS)[]) {
    for (const point of SEVER_POINTS) {
      it(`converges to "${finalOutcome}" when the stream is cut ${point.label}`, async () => {
        const chaos: Chaos = { sever: point.sever };
        const server = createFakeServer(
          singleRunScript(finalOutcome, chaos),
          chaos,
        );
        const { transport, runId } = await startTurn(server);

        const observed = await readUntilSettled(
          transport.subscribeToRun({ threadId: THREAD, runId }),
          server.clock,
        );

        const terminal = expectConvergedToServer(
          observed,
          server,
          finalOutcome,
        );
        if (finalOutcome === "succeeded") {
          expect(assistantText(observed)).toBe("Hello world");
        }
        if (terminal.event.type === "run.failed") {
          // The server's real reason, never a client-invented pipe code.
          expect(terminal.event.error.code).toBe(
            finalOutcome === "failed" ? "provider_auth_failed" : "stale_run",
          );
          expect(terminal.event.error.message).toBe(
            (FINALS[finalOutcome].wire as { error: string }).error,
          );
        }
        expect(
          observed.some(
            ({ event }) =>
              event.type === "run.failed" &&
              event.error.code === "stream_ended",
          ),
        ).toBe(false);
        await transport.dispose();
      });
    }
  }

  for (const point of [
    ...SEVER_POINTS.slice(0, 4),
    { sever: 4, label: "after the handoff signal" },
  ]) {
    it(`follows a slow handoff to a successor run when the first stream is cut ${point.label}`, async () => {
      const chaos: Chaos = { sever: point.sever };
      const first = scriptedRun({
        id: "run-1",
        startsAtMs: 0,
        wires: [
          TEXT_HELLO,
          TOOL_START,
          TOOL_DONE,
          { type: "auto_continue", reason: "run_timeout" },
        ],
        seen: point.sever,
        status: "truncated",
        terminalReason: "run_timeout",
      });
      const successor = scriptedRun({
        id: "run-2",
        // The successor row appears well after the chunk ended.
        startsAtMs: first.final.atMs + 8_000,
        wires: [TEXT_WORLD, { type: "done" }],
        seen: 0,
        status: "completed",
        terminalReason: "done",
      });
      const server = createFakeServer([first, successor], chaos);
      const { transport, runId } = await startTurn(server);

      const observed = await readUntilSettled(
        transport.subscribeToRun({ threadId: THREAD, runId }),
        server.clock,
      );

      expectConvergedToServer(observed, server, "succeeded");
      expect(assistantText(observed)).toBe("Hello world");
      await transport.dispose();
    });
  }

  it("reports a continuation nobody picks up as interrupted with the server's reason, after the handoff grace", async () => {
    const chaos: Chaos = { sever: 4 };
    const first = scriptedRun({
      id: "run-1",
      startsAtMs: 0,
      wires: [
        TEXT_HELLO,
        TOOL_START,
        TOOL_DONE,
        { type: "auto_continue", reason: "stream_ended" },
      ],
      seen: 4,
      status: "truncated",
      terminalReason: "stream_ended",
    });
    const server = createFakeServer([first], chaos);
    const { transport, runId } = await startTurn(server);

    const observed = await readUntilSettled(
      transport.subscribeToRun({ threadId: THREAD, runId }),
      server.clock,
    );

    const terminal = expectConvergedToServer(observed, server, "interrupted");
    expect(terminal.atMs).toBeGreaterThanOrEqual(
      BACKGROUND_FUNCTION_WALL_HEADROOM_MS,
    );
    expect(terminal.event).toMatchObject({
      type: "run.failed",
      error: { code: "stream_ended", retryable: true },
    });
    await transport.dispose();
  });

  it("keeps a run alive through a long silent tool while every reconnect closes empty", async () => {
    // The old pipe-owned path failed this as `stream_ended` after three empty
    // reconnects even though the server was still running the tool.
    const chaos: Chaos = { sever: 2, silenceMs: 90_000 };
    const server = createFakeServer(singleRunScript("succeeded", chaos), chaos);
    const { transport, runId } = await startTurn(server);

    const observed = await readUntilSettled(
      transport.subscribeToRun({ threadId: THREAD, runId }),
      server.clock,
    );

    const terminal = expectConvergedToServer(observed, server, "succeeded");
    expect(terminal.atMs).toBeGreaterThanOrEqual(90_000);
    expect(assistantText(observed)).toBe("Hello world");
    await transport.dispose();
  });

  it("delivers every event exactly once when each reconnect is cut after one event", async () => {
    const chaos: Chaos = { sever: 1, reconnectCut: 1 };
    const server = createFakeServer(singleRunScript("succeeded", chaos), chaos);
    const { transport, runId } = await startTurn(server);

    const observed = await readUntilSettled(
      transport.subscribeToRun({ threadId: THREAD, runId }),
      server.clock,
    );

    expectConvergedToServer(observed, server, "succeeded");
    expect(assistantText(observed)).toBe("Hello world");
    expect(
      observed.filter(({ event }) => event.type === "tool.started"),
    ).toHaveLength(1);
    await transport.dispose();
  });

  for (const finalOutcome of ["succeeded", "failed"] as const) {
    it(`waits out a network outage, then reports the server's "${finalOutcome}" — unreachable is not failed`, async () => {
      const chaos: Chaos = { sever: 2, networkDownUntilMs: 20_000 };
      const server = createFakeServer(
        singleRunScript(finalOutcome, chaos),
        chaos,
      );
      const { transport, runId } = await startTurn(server);

      const observed = await readUntilSettled(
        transport.subscribeToRun({ threadId: THREAD, runId }),
        server.clock,
      );

      const terminal = expectConvergedToServer(observed, server, finalOutcome);
      expect(terminal.atMs).toBeGreaterThanOrEqual(20_000);
      await transport.dispose();
    });
  }

  it("keeps following a running run while its events endpoint refuses to resume", async () => {
    const chaos: Chaos = {
      sever: 1,
      silenceMs: 40_000,
      eventsUnavailableUntilMs: 30_000,
    };
    const server = createFakeServer(singleRunScript("succeeded", chaos), chaos);
    const { transport, runId } = await startTurn(server);

    const observed = await readUntilSettled(
      transport.subscribeToRun({ threadId: THREAD, runId }),
      server.clock,
    );

    expectConvergedToServer(observed, server, "succeeded");
    expect(assistantText(observed)).toBe("Hello world");
    await transport.dispose();
  });

  it("reports a finished run's recorded outcome when its events stay unreadable", async () => {
    // The reply itself is in the persisted thread history the client reloads
    // on completion; what the stream cannot deliver must not hold the run
    // open or turn it into a failure.
    const chaos: Chaos = { sever: 1, eventsUnavailableUntilMs: 600_000 };
    const server = createFakeServer(singleRunScript("succeeded", chaos), chaos);
    const { transport, runId } = await startTurn(server);

    const observed = await readUntilSettled(
      transport.subscribeToRun({ threadId: THREAD, runId }),
      server.clock,
    );

    const terminal = expectConvergedToServer(observed, server, "succeeded");
    expect(terminal.atMs).toBeLessThan(60_000);
    await transport.dispose();
  });

  it("reports a turn the server already stopped as stopped, though its reply carries no run", async () => {
    const chaos: Chaos = { sever: 0, postAnswersStopped: true };
    const marker = scriptedRun({
      id: `turn-abort:${THREAD}:turn`,
      startsAtMs: 0,
      wires: [{ type: "done", reason: "user" }],
      seen: 1,
      status: "aborted",
      terminalReason: "aborted:user",
    });
    const server = createFakeServer([marker], chaos);
    const { transport, runId } = await startTurn(server);

    const observed = await readUntilSettled(
      transport.subscribeToRun({ threadId: THREAD, runId }),
      server.clock,
    );

    expectConvergedToServer(observed, server, "stopped");
    expect(
      server.requests.some((request) =>
        request.startsWith(`GET ${API}/runs/latest?threadId=${THREAD}&turnId=`),
      ),
    ).toBe(true);
    await transport.dispose();
  });

  for (const point of SEVER_POINTS.slice(1, 4)) {
    it(`survives a page reload ${point.label}: unmount never stops the run, and a fresh page restores it`, async () => {
      const chaos: Chaos = { sever: point.sever };
      const server = createFakeServer(
        singleRunScript("succeeded", chaos),
        chaos,
      );
      const { transport, runId } = await startTurn(server);
      await vi.advanceTimersByTimeAsync(0);

      await transport.dispose();
      expect(
        server.requests.filter((request) => request.includes("/abort")),
      ).toEqual([]);

      const reloaded = createAgentKitProtocolAdapter(
        createAgentNativeChatRuntime({ apiUrl: API, fetch: server.fetch }),
      );
      const observed = await readUntilSettled(
        reloaded.subscribeToRun({ threadId: THREAD, runId }),
        server.clock,
      );

      expectConvergedToServer(observed, server, "succeeded");
      expect(assistantText(observed)).toBe("Hello world");
      expect(server.requests).toContain(
        `GET ${API}/runs/latest?threadId=${THREAD}&runId=run-1`,
      );
      await reloaded.dispose();
    });
  }
});

describe("a message sent while the server still owns the thread", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A thread another run holds for `busyPolls` reads of `/runs/active`, with
   * the server's real queue: the message only exists on the server once it
   * sits in `queue`.
   */
  function createBusyThreadServer(
    options: {
      busyPolls?: number;
      activeAnswer?: (poll: number) => Response | undefined;
      /** AgentKit messages already in the saved thread. */
      savedMessages?: unknown[];
    } = {},
  ) {
    const posts: string[] = [];
    const bodies: Wire[] = [];
    const queue: { id: string; text: string }[] = [];
    const mutations: string[] = [];
    let activePolls = 0;
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const method = String(init?.method ?? "GET").toUpperCase();
        const busy = activePolls <= (options.busyPolls ?? 3);
        if (method === "POST" && url.pathname === API) {
          const body = JSON.parse(String(init?.body)) as Wire;
          bodies.push(body);
          posts.push(String(body.message));
          if (busy || (posts.length === 1 && options.busyPolls !== 0)) {
            return Response.json(
              {
                error: "Run already in progress for this thread",
                code: "run_slot_busy",
                retryable: true,
                activeRunId: "run-earlier",
              },
              { status: 409 },
            );
          }
          return new Response(
            [
              { type: "text", text: "On it.", seq: 0 },
              { type: "done", seq: 1 },
            ]
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
            {
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-next",
              },
            },
          );
        }
        if (url.pathname === `${API}/runs/active`) {
          activePolls += 1;
          return (
            options.activeAnswer?.(activePolls) ??
            Response.json(
              activePolls <= (options.busyPolls ?? 3)
                ? { active: true, status: "running", runId: "run-earlier" }
                : { active: false, status: "idle" },
            )
          );
        }
        if (url.pathname === `${API}/threads/${THREAD}/queued`) {
          const mutation = (
            JSON.parse(String(init?.body)) as {
              mutation: {
                type: string;
                messageId?: string;
                message?: { id: string; text: string };
                index?: number;
              };
            }
          ).mutation;
          mutations.push(mutation.type);
          if (mutation.type === "append" || mutation.type === "restore") {
            queue.splice(mutation.index ?? queue.length, 0, mutation.message!);
            return Response.json({
              queuedMessages: queue,
              message: mutation.message,
            });
          }
          const index = queue.findIndex(
            (message) => message.id === mutation.messageId,
          );
          const [removed] = index >= 0 ? queue.splice(index, 1) : [];
          if (mutation.type === "claim" && !removed) {
            return Response.json(
              { error: `Unknown queued message: ${mutation.messageId}` },
              { status: 500 },
            );
          }
          return Response.json({
            queuedMessages: queue,
            ...(removed ? { removedMessage: removed, index } : {}),
          });
        }
        if (url.pathname === `${API}/threads/${THREAD}`) {
          return Response.json({
            id: THREAD,
            threadData: JSON.stringify({
              queuedMessages: queue,
              ...(options.savedMessages
                ? { agentKit: { messages: options.savedMessages } }
                : {}),
            }),
          });
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      },
    );
    return {
      fetch: fetcher as unknown as typeof fetch,
      bodies,
      posts,
      queue,
      mutations,
      activePolls: () => activePolls,
    };
  }

  function send(
    transport: ReturnType<typeof createAgentNativeAgentKitTransport>,
    signal?: AbortSignal,
  ) {
    const result: { started?: { runId: string }; error?: unknown } = {};
    const done = transport
      .startRun(
        {
          threadId: THREAD,
          messages: [
            {
              id: "user-2",
              role: "user",
              parts: [{ type: "text", text: "And the next thing" }],
            },
          ],
        },
        signal ? { signal } : undefined,
      )
      .then(
        (started) => {
          result.started = started;
        },
        (error: unknown) => {
          result.error = error;
        },
      );
    return { result, done };
  }

  async function settle(
    pending: ReturnType<typeof send>,
    limitMs = 30_000,
  ): Promise<void> {
    for (
      let elapsed = 0;
      !pending.result.started && !pending.result.error && elapsed < limitMs;
      elapsed += 500
    ) {
      await vi.advanceTimersByTimeAsync(500);
    }
    await pending.done;
  }

  it("is delivered once the earlier run finishes instead of failing with 409", async () => {
    const server = createBusyThreadServer();
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: API,
      fetch: server.fetch,
    });

    const pending = send(transport);
    await settle(pending);

    expect(pending.result.error).toBeUndefined();
    expect(pending.result.started?.runId).toBe("run-next");
    // Refused once before it was saved, parked in the server's queue, then
    // claimed back and delivered exactly once.
    expect(server.posts).toEqual(["And the next thing", "And the next thing"]);
    expect(server.mutations).toEqual(["append", "claim"]);
    expect(server.queue).toEqual([]);
    expect(server.activePolls()).toBeGreaterThanOrEqual(5);

    const observed = await readUntilSettled(
      transport.subscribeToRun({ threadId: THREAD, runId: "run-next" }),
      () => 0,
    );
    expect(runOutcomeOfEvents(observed.map(({ event }) => event))).toBe(
      "succeeded",
    );
    await transport.dispose();
  });

  it("keeps the message on the server when the page goes away mid-wait, for the next page to send", async () => {
    const server = createBusyThreadServer({ busyPolls: Infinity });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: API,
      fetch: server.fetch,
    });
    const unmount = new AbortController();

    const pending = send(transport, unmount.signal);
    await vi.advanceTimersByTimeAsync(5_000);
    // While this page waits to deliver it, its own queue does not list it,
    // so its queue promotion cannot race the wait.
    await expect(
      transport.listQueuedMessages!({ threadId: THREAD }),
    ).resolves.toEqual([]);

    unmount.abort();
    await settle(pending);

    expect(pending.result.error).toBeDefined();
    expect(server.queue).toEqual([
      expect.objectContaining({ id: "user-2", text: "And the next thing" }),
    ]);
    // The next page sees it queued, and promotes it like any queued message.
    const nextPage = createAgentNativeAgentKitTransport({
      apiUrl: API,
      fetch: server.fetch,
    });
    await expect(
      nextPage.listQueuedMessages!({ threadId: THREAD }),
    ).resolves.toEqual([expect.objectContaining({ id: "user-2" })]);
    await transport.dispose();
    await nextPage.dispose();
  });

  it("sends a parked message once when the next page finds it both saved and queued", async () => {
    // The earlier run finished while the send waited, and saving its thread
    // took the waiting message with it; the parked copy is still queued.
    const server = createBusyThreadServer({
      busyPolls: 0,
      savedMessages: [
        {
          id: "user-2",
          role: "user",
          status: "complete",
          createdAt: "2026-10-01T00:00:00.000Z",
          parts: [{ type: "text", text: "And the next thing" }],
        },
      ],
    });
    server.queue.push({ id: "user-2", text: "And the next thing" });
    const nextPage = createAgentNativeAgentKitTransport({
      apiUrl: API,
      fetch: server.fetch,
    });

    const promoting = nextPage.steerQueuedMessage!({
      threadId: THREAD,
      messageId: "user-2",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await promoting;

    expect(server.posts).toEqual(["And the next thing"]);
    expect(server.bodies[0]?.history).toEqual([]);
    expect(server.queue).toEqual([]);
    await nextPage.dispose();
  });

  it("keeps waiting through a transient /runs/active failure", async () => {
    const server = createBusyThreadServer({
      activeAnswer: (poll) =>
        poll === 2
          ? Response.json({ error: "Service unavailable" }, { status: 503 })
          : undefined,
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: API,
      fetch: server.fetch,
    });

    const pending = send(transport);
    await settle(pending);

    expect(pending.result.error).toBeUndefined();
    expect(pending.result.started?.runId).toBe("run-next");
    expect(server.queue).toEqual([]);
    await transport.dispose();
  });

  it("takes the message back out and fails visibly when the wait cannot go on", async () => {
    const server = createBusyThreadServer({
      activeAnswer: (poll) =>
        poll >= 2
          ? Response.json({ error: "Forbidden" }, { status: 403 })
          : undefined,
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: API,
      fetch: server.fetch,
    });

    const pending = send(transport);
    await settle(pending);

    expect(pending.result.started).toBeUndefined();
    expect(pending.result.error).toMatchObject({ status: 403 });
    // Not left queued to be sent behind the user's back after the failure.
    expect(server.queue).toEqual([]);
    expect(server.mutations).toEqual(["append", "remove"]);
    await transport.dispose();
  });
});

describe("run outcome telemetry: one report per run, saying how the outcome was established", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function reportsFor(
    finalOutcome: keyof typeof FINALS,
    sever: number,
  ): Promise<RunOutcomeReport[]> {
    const chaos: Chaos = { sever };
    const server = createFakeServer(
      singleRunScript(finalOutcome, chaos),
      chaos,
    );
    const reports: RunOutcomeReport[] = [];
    const { transport, runId } = await startTurn(server, {
      onRunOutcome: (report) => reports.push(report),
    });
    await readUntilSettled(
      transport.subscribeToRun({ threadId: THREAD, runId }),
      server.clock,
    );
    await transport.dispose();
    return reports;
  }

  it("reports a terminal event the run's own stream delivered as unverified-by-the-pipe, with its real code", async () => {
    const reports = await reportsFor("failed", 5);

    expect(reports).toEqual([
      {
        runId: "run-1",
        threadId: THREAD,
        outcome: "failed",
        code: "provider_auth_failed",
        terminalSource: "stream",
        verifiedAfterPipeClosed: false,
        resumeAttempts: 0,
        quietReads: 0,
        drainAttempts: 0,
      },
    ]);
  });

  it("reports an outcome read from the server's record after the stream was cut as verified", async () => {
    const reports = await reportsFor("interrupted", 1);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      outcome: "interrupted",
      code: "stale_run",
      retryable: true,
      verifiedAfterPipeClosed: true,
    });
    // Either the server's own terminal event arrived on a re-read stream, or
    // the record alone ended it; never the browser's own guess.
    expect(["stream", "authority"]).toContain(reports[0]!.terminalSource);
    expect(reports[0]!.code).not.toBe("stream_ended");
  });

  it("reports every outcome kind exactly once, however the stream was cut", async () => {
    for (const finalOutcome of Object.keys(FINALS) as (keyof typeof FINALS)[]) {
      for (const sever of [0, 2, 4]) {
        const reports = await reportsFor(finalOutcome, sever);
        expect(reports).toHaveLength(1);
        expect(reports[0]!.outcome).toBe(finalOutcome);
      }
    }
  });

  it("never lets a throwing callback change how the run ends", async () => {
    const chaos: Chaos = { sever: 2 };
    const server = createFakeServer(singleRunScript("succeeded", chaos), chaos);
    const { transport, runId } = await startTurn(server, {
      onRunOutcome: () => {
        throw new Error("telemetry down");
      },
    });
    const observed = await readUntilSettled(
      transport.subscribeToRun({ threadId: THREAD, runId }),
      server.clock,
    );
    expect(runOutcomeOfEvents(observed.map(({ event }) => event))).toBe(
      "succeeded",
    );
    await transport.dispose();
  });
});

describe("following a run the browser cannot read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A turn whose first stream closes after one text event, with every later
   * request answered by `answer` (one simulated round trip later).
   */
  function scriptedServer(
    answer: (
      url: URL,
      method: string,
      init?: RequestInit,
    ) => Response | Promise<Response>,
  ) {
    const startedAt = Date.now();
    const requests: { method: string; path: string; atMs: number }[] = [];
    const signals: { path: string; signal?: AbortSignal | null }[] = [];
    let turnId = "turn-server";
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const method = String(init?.method ?? "GET").toUpperCase();
        requests.push({
          method,
          path: `${url.pathname}${url.search}`,
          atMs: Date.now() - startedAt,
        });
        signals.push({ path: url.pathname, signal: init?.signal });
        if (method === "POST" && url.pathname === API) {
          turnId = String((JSON.parse(String(init?.body)) as Wire).turnId);
          return new Response(
            `data: ${JSON.stringify({ type: "text", text: "Hi", seq: 0 })}\n\n`,
            {
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-1",
              },
            },
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        return answer(url, method, init);
      },
    ) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
    return { fetch, requests, signals, turnId: () => turnId };
  }

  const running = (runId: string, turnId: string) =>
    Response.json({
      runId,
      threadId: THREAD,
      turnId,
      status: "running",
      terminalReason: null,
    });

  async function follow(server: ReturnType<typeof scriptedServer>) {
    const transport = createAgentKitProtocolAdapter(
      createAgentNativeChatRuntime({ apiUrl: API, fetch: server.fetch }),
    );
    const { runId } = await transport.startRun({
      threadId: THREAD,
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "Go" }] },
      ],
    });
    const observed: AgentEvent[] = [];
    let settled = false;
    const reading = (async () => {
      for await (const event of transport.subscribeToRun({
        threadId: THREAD,
        runId,
      })) {
        observed.push(event);
      }
    })().finally(() => {
      settled = true;
    });
    return {
      transport,
      runId,
      observed,
      settled: () => settled,
      reading,
    };
  }

  for (const successor of [true, false]) {
    it(`backs off ${successor ? "a successor" : "the same run"} whose events stream keeps refusing, then reports it unverified — never failed`, async () => {
      const server = scriptedServer((url) => {
        if (url.pathname === `${API}/runs/latest`) {
          return running(successor ? "run-2" : "run-1", server.turnId());
        }
        if (/\/runs\/[^/]+\/events$/.test(url.pathname)) {
          return Response.json(
            { error: "Service unavailable" },
            { status: 503 },
          );
        }
        throw new Error(`Unexpected ${url}`);
      });
      const followed = await follow(server);

      await vi.advanceTimersByTimeAsync(10_000);
      const inTenSeconds = server.requests.filter(
        (request) => request.method === "GET",
      ).length;
      // Before the backoff this was ~500 requests in ten seconds.
      expect(inTenSeconds).toBeLessThanOrEqual(16);
      expect(runOutcomeOfEvents(followed.observed)).toBe("running");

      for (let elapsed = 0; !followed.settled() && elapsed < 300_000; ) {
        await vi.advanceTimersByTimeAsync(1_000);
        elapsed += 1_000;
      }
      expect(followed.settled()).toBe(true);
      const terminals = followed.observed.filter(
        (event) =>
          event.type === "run.failed" ||
          event.type === "run.completed" ||
          event.type === "run.cancelled",
      );
      expect(terminals).toEqual([
        expect.objectContaining({
          type: "run.failed",
          error: expect.objectContaining({
            code: "run_events_unreachable",
            message: RUN_UNVERIFIED_MESSAGE,
            retryable: true,
          }),
        }),
      ]);
      expect(runOutcomeOfEvents(followed.observed)).toBe("unverified");
      await followed.transport.dispose();
    });
  }

  for (const refusal of [
    {
      label: "401 (signed out)",
      response: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
      message: RUN_SIGNED_OUT_MESSAGE,
    },
    {
      label: "403",
      response: () => Response.json({ error: "Forbidden" }, { status: 403 }),
      message: RUN_UNVERIFIED_MESSAGE,
    },
    {
      label: "400",
      response: () => Response.json({ error: "Bad request" }, { status: 400 }),
      message: RUN_UNVERIFIED_MESSAGE,
    },
    {
      label: "200 with an HTML body",
      response: () =>
        new Response("<html><body>Sign in</body></html>", {
          headers: { "Content-Type": "text/html" },
        }),
      message: RUN_UNVERIFIED_MESSAGE,
    },
  ]) {
    it(`ends as unverified, not "running" forever, when /runs/latest answers ${refusal.label}`, async () => {
      const server = scriptedServer((url) => {
        if (url.pathname === `${API}/runs/latest`) return refusal.response();
        throw new Error(`Unexpected ${url}`);
      });
      const followed = await follow(server);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(followed.settled()).toBe(true);
      expect(followed.observed.at(-1)).toMatchObject({
        type: "run.failed",
        error: { code: "run_state_unreadable", message: refusal.message },
      });
      expect(runOutcomeOfEvents(followed.observed)).toBe("unverified");
      expect(
        server.requests.filter((request) =>
          request.path.startsWith(`${API}/runs/latest`),
        ),
      ).toHaveLength(1);
      await followed.transport.dispose();
    });
  }

  it("keeps polling through a 5xx from /runs/latest and follows the run once it answers", async () => {
    let latestReads = 0;
    const server = scriptedServer((url) => {
      if (url.pathname === `${API}/runs/latest`) {
        latestReads += 1;
        if (latestReads <= 4) {
          return Response.json({ error: "Bad gateway" }, { status: 502 });
        }
        return Response.json({
          runId: "run-1",
          threadId: THREAD,
          turnId: server.turnId(),
          status: "completed",
          terminalReason: "done",
        });
      }
      if (url.pathname === `${API}/runs/run-1/events`) {
        return new Response(
          `data: ${JSON.stringify({ type: "done", seq: 1 })}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      throw new Error(`Unexpected ${url}`);
    });
    const followed = await follow(server);

    for (let elapsed = 0; !followed.settled() && elapsed < 60_000; ) {
      await vi.advanceTimersByTimeAsync(500);
      elapsed += 500;
    }

    expect(latestReads).toBeGreaterThanOrEqual(5);
    expect(runOutcomeOfEvents(followed.observed)).toBe("succeeded");
    await followed.transport.dispose();
  });

  it("closes a stream that finished opening after the user pressed Stop", async () => {
    let releaseEvents!: () => void;
    const eventsOpened = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });
    let eventsRequested = false;
    const server = scriptedServer(async (url, method) => {
      if (url.pathname === `${API}/runs/latest`) {
        return running("run-1", server.turnId());
      }
      if (url.pathname === `${API}/runs/run-1/events`) {
        eventsRequested = true;
        await eventsOpened;
        return new Response(new ReadableStream(), {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (method === "POST" && url.pathname === `${API}/runs/run-1/abort`) {
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected ${url}`);
    });
    const followed = await follow(server);
    for (let elapsed = 0; !eventsRequested && elapsed < 5_000; ) {
      await vi.advanceTimersByTimeAsync(50);
      elapsed += 50;
    }
    expect(eventsRequested).toBe(true);

    const stopping = followed.transport.cancelRun({
      threadId: THREAD,
      runId: followed.runId,
    });
    releaseEvents();
    await vi.advanceTimersByTimeAsync(100);
    await stopping;
    await vi.advanceTimersByTimeAsync(0);

    const eventsSignal = server.signals
      .filter((entry) => entry.path === `${API}/runs/run-1/events`)
      .at(-1)?.signal;
    expect(eventsSignal?.aborted).toBe(true);
    expect(
      (
        await followed.transport.getRun({
          threadId: THREAD,
          runId: followed.runId,
        })
      )?.status,
    ).toBe("cancelled");
    await followed.transport.dispose();
  });

  it("stops the whole turn when Stop lands while waiting for a successor", async () => {
    const server = scriptedServer((url, method) => {
      if (url.pathname === `${API}/runs/latest`) {
        // The chunk handed off; its successor has not appeared yet.
        return Response.json({
          runId: "run-1",
          threadId: THREAD,
          turnId: server.turnId(),
          status: "truncated",
          terminalReason: "run_timeout",
        });
      }
      if (url.pathname === `${API}/runs/run-1/events`) {
        return new Response(
          `data: ${JSON.stringify({ type: "auto_continue", reason: "run_timeout", seq: 1 })}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      if (method === "POST" && url.pathname === `${API}/runs/run-1/abort`) {
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected ${url}`);
    });
    const followed = await follow(server);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(followed.settled()).toBe(false);

    const stopping = followed.transport.cancelRun({
      threadId: THREAD,
      runId: followed.runId,
    });
    await vi.advanceTimersByTimeAsync(100);
    await stopping;
    const requestsAtStop = server.requests.length;
    await vi.advanceTimersByTimeAsync(30_000);

    const abort = server.fetch.mock.calls.find(([input]) =>
      String(input).endsWith("/runs/run-1/abort"),
    );
    expect(
      JSON.parse(String((abort?.[1] as RequestInit | undefined)?.body)),
    ).toMatchObject({ runId: "run-1", reason: "user" });
    expect(runOutcomeOfEvents(followed.observed)).toBe("stopped");
    // Nothing keeps following a turn the user stopped.
    expect(server.requests.length).toBe(requestsAtStop);
    await followed.transport.dispose();
  });

  it("does not count a restored run's placeholder stream as a closed pipe", async () => {
    const server = scriptedServer((url) => {
      if (url.pathname === `${API}/runs/latest`) {
        return Response.json({
          runId: "run-1",
          threadId: THREAD,
          status: "running",
          terminalReason: null,
        });
      }
      if (url.pathname === `${API}/runs/run-1/events`) {
        return new Response(
          [
            { type: "text", text: "Done", seq: 0 },
            { type: "done", seq: 1 },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      throw new Error(`Unexpected ${url}`);
    });
    const reports: RunOutcomeReport[] = [];
    const restored = createAgentKitProtocolAdapter(
      createAgentNativeChatRuntime({ apiUrl: API, fetch: server.fetch }),
      { onRunOutcome: (report) => reports.push(report) },
    );
    const observed = await readUntilSettled(
      restored.subscribeToRun({ threadId: THREAD, runId: "run-1" }),
      () => 0,
    );

    expect(runOutcomeOfEvents(observed.map(({ event }) => event))).toBe(
      "succeeded",
    );
    expect(reports).toEqual([
      expect.objectContaining({
        outcome: "succeeded",
        terminalSource: "stream",
        verifiedAfterPipeClosed: false,
      }),
    ]);
    await restored.dispose();
  });
});
