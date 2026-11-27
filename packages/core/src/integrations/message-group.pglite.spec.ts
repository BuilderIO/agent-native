import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { IncomingMessage } from "./types.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const args = (input.args ?? []) as unknown[];
      if (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(input.sql)) {
        const rows = await pglite.prepare(input.sql).all(...args);
        return { rows, rowsAffected: 0 };
      }
      const { changes } = await pglite.prepare(input.sql).run(...args);
      return { rows: [], rowsAffected: changes };
    },
  }),
}));

const {
  absorbPendingTask,
  claimPendingTask,
  ensurePendingTasksTable,
  getNextPendingTaskForThread,
  getPendingTask,
  insertPendingTask,
} = await import("./pending-tasks-store.js");
const { collectMessageGroup } = await import("./message-group.js");
const { telegramAdapter } = await import("./adapters/telegram.js");

const THREAD = "chat:4242";
const instant = async () => {};

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensurePendingTasksTable();
});

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec("DELETE FROM integration_pending_tasks");
});

async function telegramMessage(
  messageId: number,
  message: Record<string, unknown>,
) {
  const incoming = await telegramAdapter().parseIncomingMessage({
    context: {
      __rawBody: {
        update_id: messageId,
        message: {
          message_id: messageId,
          date: 1_700_000_000,
          chat: { id: 4242, type: "private" },
          from: { id: 99, first_name: "QA" },
          ...message,
        },
      },
    },
  } as unknown as H3Event);
  if (!incoming) throw new Error("Telegram update was not parsed");
  return incoming;
}

function albumPhoto(messageId: number, caption?: string, group = "13579") {
  return telegramMessage(messageId, {
    media_group_id: group,
    ...(caption ? { caption } : {}),
    photo: [{ file_id: `photo-${messageId}`, width: 1280, height: 853 }],
  });
}

async function queue(
  id: string,
  incoming: Awaited<ReturnType<typeof telegramMessage>>,
) {
  await insertPendingTask({
    id,
    platform: "telegram",
    externalThreadId: incoming.externalThreadId,
    payload: JSON.stringify({ incoming }),
    ownerEmail: "dispatch+qa@integration.local",
    externalEventKey: `telegram:${incoming.externalThreadId}:${incoming.platformContext.messageId}`,
  });
}

async function claimed(id: string) {
  const task = await claimPendingTask(id);
  if (!task) throw new Error(`task ${id} could not be claimed`);
  return task;
}

async function stored(id: string) {
  const task = await getPendingTask(id);
  if (!task) throw new Error(`task ${id} is missing`);
  return task;
}

function incomingOf(task: { payload: string }) {
  return (JSON.parse(task.payload) as { incoming: IncomingMessage }).incoming;
}

describe("Telegram albums in the integration task queue", () => {
  it("folds a three-photo album into the first task and leaves other messages queued", async () => {
    await queue("album-1", await albumPhoto(10));
    await queue("album-2", await albumPhoto(11, "receipts for March"));
    await queue("album-3", await albumPhoto(12));
    await queue("other-album", await albumPhoto(13, undefined, "24680"));
    await queue("text", await telegramMessage(14, { text: "and one more" }));

    const leader = await claimed("album-1");
    expect(await claimPendingTask("album-2")).toBeNull();

    const merged = await collectMessageGroup(
      leader,
      incomingOf(leader),
      telegramAdapter(),
      { sleep: instant },
    );

    expect(merged?.text).toBe("receipts for March");
    expect(merged?.files?.map((file) => file.id)).toEqual([
      "photo-10",
      "photo-11",
      "photo-12",
    ]);
    expect((await getPendingTask("album-2"))?.status).toBe("completed");
    expect((await getPendingTask("album-3"))?.status).toBe("completed");
    expect((await getPendingTask("other-album"))?.status).toBe("pending");
    expect((await getPendingTask("text"))?.status).toBe("pending");
    expect(await claimPendingTask("album-2")).toBeNull();
    expect(await claimPendingTask("album-3")).toBeNull();
    expect((await getNextPendingTaskForThread("telegram", THREAD))?.id).toBe(
      "other-album",
    );
  });

  it("folds an album without a caption into one message of files", async () => {
    await queue("album-1", await albumPhoto(20));
    await queue("album-2", await albumPhoto(21));
    const leader = await claimed("album-1");

    const merged = await collectMessageGroup(
      leader,
      incomingOf(leader),
      telegramAdapter(),
      { sleep: instant },
    );

    expect(merged?.text).toBe("");
    expect(merged?.files?.map((file) => file.id)).toEqual([
      "photo-20",
      "photo-21",
    ]);
    expect((await getPendingTask("album-2"))?.status).toBe("completed");
  });

  it("waits for album updates that are still arriving", async () => {
    await queue("album-1", await albumPhoto(30));
    const leader = await claimed("album-1");
    let polls = 0;

    const merged = await collectMessageGroup(
      leader,
      incomingOf(leader),
      telegramAdapter(),
      {
        sleep: async () => {
          polls += 1;
          if (polls === 1) await queue("album-2", await albumPhoto(31, "both"));
          if (polls === 3) await queue("album-3", await albumPhoto(32));
        },
      },
    );

    expect(merged?.text).toBe("both");
    expect(merged?.files?.map((file) => file.id)).toEqual([
      "photo-30",
      "photo-31",
      "photo-32",
    ]);
  });

  it("stops waiting after the longest wait even if updates keep arriving", async () => {
    await queue("album-1", await albumPhoto(40));
    const leader = await claimed("album-1");
    let next = 41;

    const merged = await collectMessageGroup(
      leader,
      incomingOf(leader),
      telegramAdapter(),
      {
        maxWaitMs: 1_000,
        sleep: async () => {
          await queue(`album-${next}`, await albumPhoto(next));
          next += 1;
        },
      },
    );

    expect(merged?.files).toHaveLength(6);
  });

  it("returns null for a single photo of an album and for a normal message", async () => {
    await queue("album-1", await albumPhoto(50, "just one"));
    await queue("text", await telegramMessage(51, { text: "hello" }));
    const leader = await claimed("album-1");
    expect(
      await collectMessageGroup(leader, incomingOf(leader), telegramAdapter(), {
        sleep: instant,
      }),
    ).toBeNull();
    expect((await getPendingTask("text"))?.status).toBe("pending");

    const sleep = vi.fn(instant);
    const text = await stored("text");
    expect(
      await collectMessageGroup(text, incomingOf(text), telegramAdapter(), {
        sleep,
      }),
    ).toBeNull();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("absorbs a queued task only once", async () => {
    await queue("album-1", await albumPhoto(60));
    expect(await absorbPendingTask("album-1")).toBe(true);
    expect(await absorbPendingTask("album-1")).toBe(false);
  });
});
