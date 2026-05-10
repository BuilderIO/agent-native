import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const emitChatThreadChangeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  intType: () => "INTEGER",
}));

vi.mock("./emitter.js", () => ({
  emitChatThreadChange: emitChatThreadChangeMock,
}));

import { setThreadQueuedMessages, updateThreadData } from "./store.js";

type ChatThreadRow = {
  id: string;
  owner_email: string;
  title: string;
  preview: string;
  thread_data: string;
  message_count: number;
  created_at: number;
  updated_at: number;
};

const userMessage = {
  id: "user-1",
  role: "user",
  content: [{ type: "text", text: "make this slide better" }],
};

const assistantMessage = {
  id: "assistant-1",
  role: "assistant",
  content: [{ type: "text", text: "Done." }],
  status: { type: "complete", reason: "stop" },
  metadata: { runId: "run-1" },
};

describe("chat thread store", () => {
  let row: ChatThreadRow | null;
  let conflictOnce: (() => void) | null;

  beforeEach(() => {
    row = {
      id: "thread-1",
      owner_email: "user@example.com",
      title: "Thread",
      preview: "make this slide better",
      thread_data: JSON.stringify({ messages: [userMessage] }),
      message_count: 1,
      created_at: 1,
      updated_at: 1,
    };
    conflictOnce = null;
    executeMock.mockReset();
    emitChatThreadChangeMock.mockReset();
    executeMock.mockImplementation(async (query: string | any) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args;
      if (/CREATE TABLE/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT id, owner_email/i.test(sql)) {
        return {
          rows: row && args[0] === row.id ? [row] : [],
          rowsAffected: 0,
        };
      }
      if (/UPDATE chat_threads SET thread_data/i.test(sql)) {
        if (conflictOnce) {
          const applyConflict = conflictOnce;
          conflictOnce = null;
          applyConflict();
          return { rows: [], rowsAffected: 0 };
        }
        if (!row || row.id !== args[5] || row.updated_at !== args[6]) {
          return { rows: [], rowsAffected: 0 };
        }
        row = {
          ...row,
          thread_data: args[0],
          title: args[1],
          preview: args[2],
          message_count: args[3],
          updated_at: args[4],
        };
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
  });

  it("retries cross-process thread-data conflicts and preserves server-only messages", async () => {
    conflictOnce = () => {
      row = {
        ...row!,
        thread_data: JSON.stringify({
          messages: [
            { message: userMessage, parentId: null },
            { message: assistantMessage, parentId: "user-1" },
          ],
        }),
        message_count: 2,
        updated_at: 2,
      };
    };

    await updateThreadData(
      "thread-1",
      JSON.stringify({ messages: [userMessage] }),
      "Thread",
      "make this slide better",
      1,
    );

    const repo = JSON.parse(row!.thread_data);
    expect(repo.messages.map((entry: any) => entry.message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(row!.message_count).toBe(2);
    expect(emitChatThreadChangeMock).toHaveBeenCalledWith("thread-1");
  });

  it("lets queued-message clears win while preserving concurrent assistant messages", async () => {
    row!.thread_data = JSON.stringify({
      queuedMessages: [{ id: "queued-1", text: "next" }],
      messages: [{ message: userMessage, parentId: null }],
    });

    conflictOnce = () => {
      row = {
        ...row!,
        thread_data: JSON.stringify({
          queuedMessages: [{ id: "queued-1", text: "next" }],
          messages: [
            { message: userMessage, parentId: null },
            { message: assistantMessage, parentId: "user-1" },
          ],
        }),
        message_count: 2,
        updated_at: 2,
      };
    };

    await setThreadQueuedMessages("thread-1", []);

    const repo = JSON.parse(row!.thread_data);
    expect(repo.queuedMessages).toBeUndefined();
    expect(repo.messages.map((entry: any) => entry.message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
  });
});
