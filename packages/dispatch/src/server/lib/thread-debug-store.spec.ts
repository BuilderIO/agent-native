import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  createDbExec: vi.fn(),
  getDbExec: () => ({ execute: mocks.execute }),
}));

vi.mock("./dispatch-store.js", () => ({
  currentOrgId: () => null,
  currentOwnerEmail: () => "owner@example.com",
}));

import {
  getAgentThreadDebug,
  searchAgentThreads,
} from "./thread-debug-store.js";

const thread = {
  id: "thread-1",
  owner_email: "owner@example.com",
  title: "A production run",
  preview: "Investigate this run",
  thread_data: JSON.stringify({ messages: [] }),
  message_count: 0,
  created_at: 1,
  updated_at: 2,
};

const run = {
  id: "run-prod-1",
  thread_id: "thread-1",
  status: "completed",
  started_at: 1,
  completed_at: 2,
  heartbeat_at: 2,
};

function rowsForQuery(sql: string, args: unknown[]) {
  if (sql.includes("FROM org_members")) return [];
  if (sql.includes("FROM agent_runs") && sql.includes("WHERE id = ?")) {
    return [run];
  }
  if (sql.includes("FROM agent_runs") && sql.includes("WHERE thread_id = ?")) {
    return [run];
  }
  if (sql.includes("FROM chat_threads")) {
    return args[0] === "thread-1" || args[0] === "owner@example.com"
      ? [thread]
      : [];
  }
  return [];
}

describe("thread-debug-store request/run lookup", () => {
  beforeEach(() => {
    mocks.execute.mockImplementation(async ({ sql, args }) => ({
      rows: rowsForQuery(sql, args),
    }));
  });

  it("finds a thread when search input is an exact run id", async () => {
    const result = await searchAgentThreads({ query: run.id });

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]?.id).toBe(thread.id);
  });

  it("resolves a run id before loading its debug snapshot", async () => {
    const result = await getAgentThreadDebug({ runId: run.id });

    expect(result.lookup).toEqual({
      requestedId: run.id,
      threadId: thread.id,
      runId: run.id,
    });
    expect(result.thread.id).toBe(thread.id);
  });
});
