import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCurrentTurnEventsForThread,
  getCurrentTurnRunEventsForThread,
} from "./run-store.js";

const mocks = vi.hoisted(() => ({
  events: [] as unknown[],
  latest: [] as unknown[],
  execute: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/capture-error.js", () => ({ captureError: vi.fn() }));

const start = {
  run_id: "run-first",
  seq: 0,
  event_data: JSON.stringify({
    type: "tool_start",
    tool: "send-message",
    input: { destination: "example" },
  }),
};
const done = {
  run_id: "run-first",
  seq: "1",
  event_data: JSON.stringify({
    type: "tool_done",
    tool: "send-message",
    result: "sent",
    completedSideEffect: true,
  }),
};

beforeEach(() => {
  mocks.events = [];
  mocks.latest = [];
  mocks.execute.mockReset();
  mocks.execute.mockImplementation(async (statement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (sql.includes("SELECT e.run_id AS run_id"))
      return { rows: mocks.events, rowsAffected: 0 };
    if (sql.includes("SELECT id, turn_id FROM agent_runs"))
      return { rows: mocks.latest, rowsAffected: 0 };
    return { rows: [], rowsAffected: 0 };
  });
});

describe.each([
  ["run events", getCurrentTurnRunEventsForThread],
  ["events", getCurrentTurnEventsForThread],
] as const)("current-turn journal reader: %s", (_name, read) => {
  it.each([
    ["invalid JSON", { ...done, event_data: "{" }],
    ["missing run id", { ...done, run_id: undefined }],
    ["empty run id", { ...done, run_id: "" }],
    ["non-string run id", { ...done, run_id: 123 }],
    ["missing sequence", { ...done, seq: undefined }],
    ["null sequence", { ...done, seq: null }],
    ["blank sequence", { ...done, seq: "" }],
    ["boolean sequence", { ...done, seq: false }],
    ["non-numeric sequence", { ...done, seq: "invalid" }],
    ["fractional sequence", { ...done, seq: 1.5 }],
    ["negative sequence", { ...done, seq: -1 }],
    ["unsafe sequence", { ...done, seq: "9007199254740993" }],
    ["missing event data", { ...done, event_data: undefined }],
    ["empty event data", { ...done, event_data: "" }],
    ["non-string event data", { ...done, event_data: { type: "done" } }],
    ["null row", null],
    ["array row", []],
  ])("rejects the entire journal for %s", async (_description, corrupt) => {
    mocks.events = [start, corrupt, { ...done, run_id: "run-next" }];
    await expect(read("thread", "turn")).rejects.toMatchObject({
      name: "AgentRunJournalUnreadableError",
      errorCode: "tool_call_journal_unreadable",
      threadId: "thread",
      turnId: "turn",
      rowIndex: 1,
    });
  });

  it.each(
    [
      null,
      [],
      true,
      "done",
      {},
      { type: 1 },
      { type: "unknown_event" },
      { type: "tool_start", tool: "send-message" },
      { type: "tool_start", tool: "send-message", input: [] },
      { type: "tool_done", result: "sent", completedSideEffect: true },
      { type: "tool_done", tool: "send-message" },
      { type: "tool_done", tool: " ", result: "sent" },
      { type: "tool_done", tool: "send-message", id: "", result: "sent" },
      {
        type: "tool_done",
        tool: "send-message",
        result: "sent",
        isError: "true",
      },
      {
        type: "tool_done",
        tool: "send-message",
        result: "sent",
        completedSideEffect: "true",
      },
      { type: "text" },
    ].map((event) => [event] as const),
  )("rejects a JSON-valid malformed event: %j", async (event) => {
    mocks.events = [{ ...done, event_data: JSON.stringify(event) }];
    await expect(read("thread", "turn")).rejects.toMatchObject({
      name: "AgentRunJournalUnreadableError",
      errorCode: "tool_call_journal_unreadable",
      reason: "invalid_event",
    });
  });

  it("returns an empty journal only when no rows exist", async () => {
    await expect(read("thread", "turn")).resolves.toEqual([]);
    await expect(read("thread")).resolves.toEqual([]);
  });

  it("propagates database read failure", async () => {
    const error = new Error("test database unavailable");
    mocks.execute.mockRejectedValueOnce(error);
    await expect(read("thread", "turn")).rejects.toBe(error);
  });

  it("keeps the JSON parse cause without exposing the corrupt payload", async () => {
    mocks.events = [{ ...done, event_data: "{" }];
    await expect(read("thread", "turn")).rejects.toMatchObject({
      name: "AgentRunJournalUnreadableError",
      reason: "invalid_event_json",
      cause: expect.any(SyntaxError),
      message:
        "Delivery outcome is unknown because the run journal could not be read.",
    });
  });

  it.each(
    [null, [], {}, { id: null, turn_id: null }, { id: "run", turn_id: "" }].map(
      (row) => [row] as const,
    ),
  )("rejects an unreadable inferred turn: %j", async (row) => {
    mocks.latest = [row];
    await expect(read("thread")).rejects.toMatchObject({
      name: "AgentRunJournalUnreadableError",
      reason: "invalid_turn",
    });
  });
});

it("preserves continuation order, sequence identities, and completed effects", async () => {
  const continuation = {
    run_id: "run-next",
    seq: 0,
    event_data: JSON.stringify({ type: "done" }),
  };
  mocks.events = [start, done, continuation];
  const expected = mocks.events.map((row) => {
    const event = row as typeof start;
    return {
      runId: event.run_id,
      seq: Number(event.seq),
      event: JSON.parse(event.event_data),
    };
  });
  await expect(
    getCurrentTurnRunEventsForThread("thread", "turn"),
  ).resolves.toEqual(expected);
  await expect(
    getCurrentTurnEventsForThread("thread", "turn"),
  ).resolves.toEqual(expected.map(({ event }) => event));
  const query = mocks.execute.mock.calls.find(
    ([statement]) =>
      typeof statement !== "string" &&
      statement.sql.includes("SELECT e.run_id AS run_id"),
  )?.[0];
  expect(query.args).toEqual(["thread", "turn"]);
  expect(query.sql).toMatch(
    /ORDER BY COALESCE\(r.continuation_order, 0\) ASC,/,
  );
});

it.each([
  [{ id: "run-first", turn_id: "turn" }, "turn"],
  [{ id: "run-first", turn_id: null }, "run-first"],
])("reads the inferred current turn: %j", async (latest, turnId) => {
  mocks.latest = [latest];
  mocks.events = [start, done];
  await expect(getCurrentTurnEventsForThread("thread")).resolves.toHaveLength(
    2,
  );
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({ args: ["thread", turnId] }),
  );
});
