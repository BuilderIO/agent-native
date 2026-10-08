import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const client = {
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
  updateThreadData: async (id: string, threadData: string) => {
    threads.set(id, threadData);
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

const { insertRun, insertRunEvent, reapIfStale, updateRunStatusIfRunning } =
  await import("./run-store.js");

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
});
