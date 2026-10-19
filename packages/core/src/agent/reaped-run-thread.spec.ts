import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const client = {
  transaction: pglite.transaction,
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => client,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const threads = new Map<string, string>();
let threadDataBeforeFoldWrite: string | null = null;
let beforeFoldUpdate: (() => Promise<void>) | undefined;
// What the watched thread held when the reaper started the run that replaces
// a reaped one. Reading the watched thread waits briefly for that start, so a
// replacement started before the reaped run is saved is seen every time.
let watchedThread = "";
let replacementStarted: (() => void) | undefined;
const threadAtDispatch: Array<string | undefined> = [];
vi.mock("../chat-threads/store.js", () => ({
  withThreadDataLock: (_id: string, fn: () => Promise<unknown>) => fn(),
  getThread: async (id: string) => {
    if (id === watchedThread) {
      await new Promise<void>((resolve) => {
        replacementStarted = resolve;
        setTimeout(resolve, 200);
      });
    }
    return threads.has(id)
      ? { id, threadData: threads.get(id), title: "", preview: "" }
      : null;
  },
  updateThreadData: async (
    id: string,
    threadData: string,
    _title: string,
    _preview: string,
    _messageCount: number,
    options?: {
      beforeUpdate?: (tx: {
        execute: (
          input: string | { sql: string; args?: unknown[] },
        ) => Promise<{
          rows: unknown[];
          rowsAffected: number;
        }>;
      }) => Promise<boolean>;
    },
  ) => {
    if (options?.beforeUpdate) {
      const beforeUpdate = beforeFoldUpdate;
      beforeFoldUpdate = undefined;
      await beforeUpdate?.();
      const allowed = await options.beforeUpdate({
        execute: async (input) => {
          if (typeof input === "string") {
            return { rows: [], rowsAffected: 0 };
          }
          if (input.sql.includes("pg_advisory_xact_lock")) {
            return { rows: [], rowsAffected: 0 };
          }
          if (input.sql.includes("FROM agent_execution_leases")) {
            return {
              rows: await (
                await pglite.prepare(input.sql)
              ).all(...(input.args ?? [])),
              rowsAffected: 0,
            };
          }
          if (threadDataBeforeFoldWrite !== null) {
            threads.set(id, threadDataBeforeFoldWrite);
            threadDataBeforeFoldWrite = null;
          }
          return {
            rows: [{ thread_data: threads.get(id) }],
            rowsAffected: 0,
          };
        },
      });
      if (!allowed) return false;
    }
    threads.set(id, threadData);
    return true;
  },
}));

vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: vi.fn(async () => {
    threadAtDispatch.push(threads.get(watchedThread));
    replacementStarted?.();
  }),
}));

// Loaded up front, as in a warm server, so starting a replacement is not
// slowed by a first import.
await import("./durable-background.js");

const {
  beginAgentExecutionStep,
  claimTurnExecutionLease,
  completeAgentExecutionStep,
  insertRun,
  insertRunEvent,
  markAgentExecutionStepDispatched,
  reapIfStale,
  updateRunStatusIfRunning,
} = await import("./run-store.js");
const { withExecutionFence } = await import("./execution-fence.js");
const { buildAssistantMessage, foldAssistantTurn } =
  await import("./thread-data-builder.js");

const SEND = { to: "ana@example.com", subject: "Invoice" };
let seq = 0;

function userTurn(text: string) {
  return {
    message: {
      id: `user-${seq}`,
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

/** A run whose worker died after sending the email, before it could save. */
async function crashAfterSending(
  thread: string,
  turn: string,
  run: string,
  options: Parameters<typeof insertRun>[3] = { dispatchMode: "foreground" },
): Promise<void> {
  await insertRun(run, thread, turn, options);
  await insertRunEvent(
    run,
    1,
    JSON.stringify({
      type: "tool_start",
      tool: "send-email",
      id: "c1",
      input: SEND,
    }),
  );
  await insertRunEvent(
    run,
    2,
    JSON.stringify({
      type: "tool_done",
      tool: "send-email",
      id: "c1",
      input: SEND,
      result: "sent",
      completedSideEffect: true,
    }),
  );
}

function savedMessages(thread: string): any[] {
  return JSON.parse(threads.get(thread)!).messages.map(
    (entry: any) => entry.message ?? entry,
  );
}

describe("a run the server reaps after its worker died", () => {
  beforeEach(() => {
    seq += 1;
    threadDataBeforeFoldWrite = null;
    beforeFoldUpdate = undefined;
  });

  it("saves the steps it finished into the thread, with its error", async () => {
    const thread = `thread-reaped-${seq}`;
    const turn = `turn-reaped-${seq}`;
    const run = `run-reaped-${seq}`;
    threads.set(thread, JSON.stringify({ messages: [userTurn("Bill Ana")] }));
    await crashAfterSending(thread, turn, run);

    expect(await reapIfStale(run, -1)).toBe(true);

    const [, reply] = savedMessages(thread);
    expect(reply.role).toBe("assistant");
    expect(reply.content).toContainEqual(
      expect.objectContaining({
        type: "tool-call",
        toolName: "send-email",
        args: SEND,
        result: "sent",
      }),
    );
    expect(reply.metadata.custom).toMatchObject({
      turnId: turn,
      runError: { errorCode: "stale_run", recoverable: true, runId: run },
    });
  });

  it("projects a completed journal receipt when tool_done was not persisted", async () => {
    const thread = `thread-reaped-${seq}`;
    const turn = `turn-reaped-${seq}`;
    const run = `run-reaped-${seq}`;
    const stepId = `receipt-step-${seq}`;
    const argumentsHash = "a".repeat(64);
    const input = { to: "ana@example.com", subject: "Invoice" };
    threads.set(thread, JSON.stringify({ messages: [userTurn("Bill Ana")] }));
    await insertRun(run, thread, turn);
    const fence = await claimTurnExecutionLease(thread, turn, run);
    await insertRunEvent(
      run,
      1,
      JSON.stringify({
        type: "tool_start",
        tool: "send-email",
        id: stepId,
        input,
      }),
    );
    const intent = {
      ...fence,
      stepId,
      operationId: stepId,
      toolName: "send-email",
      inputJson: JSON.stringify({ argumentsHash, input }),
      replayPolicy: "never" as const,
    };
    await withExecutionFence(fence, async () => {
      await beginAgentExecutionStep(intent);
      await markAgentExecutionStepDispatched(intent);
      await completeAgentExecutionStep(
        intent,
        JSON.stringify({
          result: "sent from durable receipt",
          isError: false,
          completedSideEffect: true,
        }),
      );
    });
    await pglite
      .prepare(
        `UPDATE agent_execution_leases
            SET lease_expires_at = clock_timestamp() - INTERVAL '1 second'
          WHERE thread_id = ? AND turn_id = ?`,
      )
      .run(thread, turn);

    expect(await reapIfStale(run, -1)).toBe(true);

    expect(savedMessages(thread).at(-1)?.content).toContainEqual(
      expect.objectContaining({
        type: "tool-call",
        toolName: "send-email",
        result: "sent from durable receipt",
      }),
    );
  });

  it("is saved before the run that replaces it starts", async () => {
    const thread = `thread-reaped-${seq}`;
    const turn = `turn-reaped-${seq}`;
    const run = `run-reaped-${seq}`;
    watchedThread = thread;
    threads.set(thread, JSON.stringify({ messages: [userTurn("Bill Ana")] }));
    await crashAfterSending(thread, turn, run, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({
        message: "Bill Ana",
        threadId: thread,
      }),
    });

    expect(await reapIfStale(run, -1)).toBe(true);

    await vi.waitFor(() => expect(threadAtDispatch).toHaveLength(1));
    expect(threadAtDispatch[0]).toContain('"toolName":"send-email"');
  });

  it("leaves the thread alone once a later prompt was saved", async () => {
    const thread = `thread-reaped-${seq}`;
    const turn = `turn-reaped-${seq}`;
    const run = `run-reaped-${seq}`;
    const nextPrompt = userTurn("Never mind");
    (nextPrompt.message as any).metadata = {
      custom: { submittedTurnId: `${turn}-later` },
    };
    const later = JSON.stringify({
      messages: [userTurn("Bill Ana"), nextPrompt],
    });
    threads.set(thread, later);
    await crashAfterSending(thread, turn, run);

    expect(await reapIfStale(run, -1)).toBe(true);

    expect(threads.get(thread)).toBe(later);
  });

  it("rechecks prompt ownership inside the thread-data write", async () => {
    const thread = `thread-reaped-${seq}`;
    const turn = `turn-reaped-${seq}`;
    const run = `run-reaped-${seq}`;
    threads.set(thread, JSON.stringify({ messages: [userTurn("Bill Ana")] }));
    await crashAfterSending(thread, turn, run);
    const nextPrompt = userTurn("Never mind");
    (nextPrompt.message as any).metadata = {
      custom: { submittedTurnId: `${turn}-later` },
    };
    const later = JSON.stringify({
      messages: [userTurn("Bill Ana"), nextPrompt],
    });
    threadDataBeforeFoldWrite = later;

    expect(await reapIfStale(run, -1)).toBe(true);

    expect(threads.get(thread)).toBe(later);
  });

  it("leaves the thread alone once a later turn started", async () => {
    const thread = `thread-reaped-${seq}`;
    const turn = `turn-reaped-${seq}`;
    const run = `run-reaped-${seq}`;
    const later = JSON.stringify({
      messages: [userTurn("Bill Ana"), userTurn("Never mind")],
    });
    threads.set(thread, later);
    await crashAfterSending(thread, turn, run);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await insertRun(`${run}-later`, thread, `${turn}-later`, {
      dispatchMode: "foreground",
    });
    await updateRunStatusIfRunning(`${run}-later`, "completed");

    expect(await reapIfStale(run, -1)).toBe(true);

    expect(threads.get(thread)).toBe(later);
  });

  it("does not fold an old run over a reply from a newer execution generation", async () => {
    const thread = `thread-reaped-${seq}`;
    const turn = `turn-reaped-${seq}`;
    const run = `run-reaped-${seq}`;
    const replacementRun = `${run}-replacement`;
    threads.set(thread, JSON.stringify({ messages: [userTurn("Bill Ana")] }));
    await crashAfterSending(thread, turn, run);
    await claimTurnExecutionLease(thread, turn, run);
    await insertRun(replacementRun, thread, turn);
    await pglite
      .prepare(
        `UPDATE agent_execution_leases
            SET lease_expires_at = clock_timestamp() - INTERVAL '1 second'
          WHERE thread_id = ? AND turn_id = ? AND owner_run_id = ?`,
      )
      .run(thread, turn, run);
    await claimTurnExecutionLease(thread, turn, replacementRun);

    const replacementReply = buildAssistantMessage(
      [
        { seq: 0, event: { type: "text", text: "Newer reply" } },
        { seq: 1, event: { type: "done" } },
      ],
      replacementRun,
      { turnId: turn },
    );
    expect(replacementReply).not.toBeNull();
    threads.set(
      thread,
      JSON.stringify(
        foldAssistantTurn(
          { messages: [userTurn("Bill Ana")] },
          replacementReply!,
          { runId: replacementRun, turnId: turn },
        ),
      ),
    );
    const beforeReap = threads.get(thread);

    expect(await reapIfStale(run, -1)).toBe(true);

    expect(threads.get(thread)).toBe(beforeReap);
    expect(savedMessages(thread).at(-1)?.content).toContainEqual(
      expect.objectContaining({ type: "text", text: "Newer reply" }),
    );
    expect(savedMessages(thread).at(-1)?.content).not.toContainEqual(
      expect.objectContaining({ type: "tool-call", toolName: "send-email" }),
    );
  });

  it("does not fold after a successor claims between reap and projection", async () => {
    const thread = `thread-reaped-${seq}`;
    const turn = `turn-reaped-${seq}`;
    const run = `run-reaped-${seq}`;
    const replacementRun = `${run}-replacement`;
    threads.set(thread, JSON.stringify({ messages: [userTurn("Bill Ana")] }));
    await crashAfterSending(thread, turn, run);
    const oldFence = await claimTurnExecutionLease(thread, turn, run);
    await pglite
      .prepare(
        `UPDATE agent_execution_leases
            SET lease_expires_at = clock_timestamp() - INTERVAL '1 second'
          WHERE thread_id = ? AND turn_id = ?`,
      )
      .run(thread, turn);
    beforeFoldUpdate = async () => {
      await insertRun(replacementRun, thread, turn);
      const replacementFence = await claimTurnExecutionLease(
        thread,
        turn,
        replacementRun,
      );
      expect(BigInt(replacementFence.generation)).toBe(
        BigInt(oldFence.generation) + 1n,
      );
      const replacementReply = buildAssistantMessage(
        [
          { seq: 0, event: { type: "text", text: "Newer reply" } },
          { seq: 1, event: { type: "done" } },
        ],
        replacementRun,
        { turnId: turn },
      );
      expect(replacementReply).not.toBeNull();
      threads.set(
        thread,
        JSON.stringify(
          foldAssistantTurn(
            { messages: [userTurn("Bill Ana")] },
            replacementReply!,
            { runId: replacementRun, turnId: turn },
          ),
        ),
      );
    };
    const beforeReap = threads.get(thread);

    expect(await reapIfStale(run, -1)).toBe(true);

    expect(threads.get(thread)).not.toBe(beforeReap);
    expect(savedMessages(thread).at(-1)?.content).toContainEqual(
      expect.objectContaining({ type: "text", text: "Newer reply" }),
    );
    expect(savedMessages(thread).at(-1)?.content).not.toContainEqual(
      expect.objectContaining({ type: "tool-call", toolName: "send-email" }),
    );
  });
});
