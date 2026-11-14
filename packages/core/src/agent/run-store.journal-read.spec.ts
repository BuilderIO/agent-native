import { beforeEach, describe, expect, it, vi } from "vitest";

import { storeLedgerResult } from "../db/store-ledger.test-helpers.js";
import { stripInlineBytes } from "../shared/inline-bytes.js";
import {
  getCompletedAgentExecutionSteps,
  getCurrentTurnEventsForThread,
  getCurrentTurnRunEventsForThread,
  getCurrentTurnRunIdsForThread,
  insertRunEvent,
} from "./run-store.js";
import {
  classifyToolCallJournal,
  toolCallInputFingerprint,
} from "./tool-call-journal.js";

const mocks = vi.hoisted(() => ({
  events: [] as unknown[],
  latest: [] as unknown[],
  runs: [] as unknown[],
  executionSteps: [] as unknown[],
  execute: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
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
  mocks.runs = [];
  mocks.executionSteps = [];
  mocks.execute.mockReset();
  mocks.execute.mockImplementation(async (statement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (sql.includes("SELECT e.run_id AS run_id"))
      return { rows: mocks.events, rowsAffected: 0 };
    if (
      sql.includes(
        "SELECT step_id, operation_id, tool_name, input_json, result_json",
      )
    )
      return { rows: mocks.executionSteps, rowsAffected: 0 };
    if (sql.includes("SELECT id FROM agent_runs"))
      return { rows: mocks.runs, rowsAffected: 0 };
    if (sql.includes("SELECT id, turn_id FROM agent_runs"))
      return { rows: mocks.latest, rowsAffected: 0 };
    return { rows: [], rowsAffected: 0 };
  });
});

describe("completed execution-step journal reader", () => {
  const completeStep = {
    step_id: "step-a",
    operation_id: "operation-a",
    tool_name: "send-message",
    input_json: "{}",
    result_json: '{"sent":true}',
  };

  it.each([
    ["null row", null],
    ["array row", []],
    ["missing step id", { ...completeStep, step_id: undefined }],
    ["unrequested step id", { ...completeStep, step_id: "step-other" }],
    ["missing operation id", { ...completeStep, operation_id: null }],
    ["empty operation id", { ...completeStep, operation_id: " " }],
    ["missing tool name", { ...completeStep, tool_name: null }],
    ["empty tool name", { ...completeStep, tool_name: " " }],
    ["missing intent", { ...completeStep, input_json: null }],
    ["missing result", { ...completeStep, result_json: null }],
  ])("classifies a %s as unreadable persisted data", async (_label, row) => {
    mocks.executionSteps = [row];

    await expect(
      getCompletedAgentExecutionSteps("thread", "turn", ["step-a"]),
    ).rejects.toMatchObject({
      name: "AgentRunJournalUnreadableError",
      errorCode: "tool_call_journal_unreadable",
      reason: "invalid_execution_step",
      threadId: "thread",
      turnId: "turn",
      rowIndex: 0,
    });
  });

  it("leaves completed-step query failures retryable", async () => {
    const storageError = new Error("database unavailable");
    mocks.execute.mockImplementation(async (statement) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (sql.includes("FROM agent_execution_steps")) throw storageError;
      return { rows: [], rowsAffected: 0 };
    });

    await expect(
      getCompletedAgentExecutionSteps("thread", "turn", ["step-a"]),
    ).rejects.toBe(storageError);
  });
});

function recordPersistedEvents() {
  mocks.execute.mockImplementation(async (statement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    const args = typeof statement === "string" ? [] : (statement.args ?? []);
    const ledger = storeLedgerResult(sql);
    if (ledger) return ledger;
    if (sql.includes("INSERT INTO agent_run_events"))
      mocks.events.push({
        run_id: args[0],
        seq: args[1],
        event_data: args[3],
      });
    return {
      rows: sql.includes("SELECT e.run_id AS run_id")
        ? mocks.events
        : sql.includes("SELECT id FROM agent_runs")
          ? mocks.runs
          : [],
      rowsAffected: 0,
    };
  });
}

it.each([
  { attachments: [{ type: "file", data: "QQ==" }] },
  { body: "Read data:text/plain;base64,QQ== before sending" },
  { body: "[inline text/plain data omitted]" },
  JSON.parse(
    '{"__proto__":{"destination":"a"},"constructor":"own","prototype":"own","attachments":[{"type":"file","data":"QQ==","url":"https://example.invalid/file"}]}',
  ),
])(
  "retains execution identity and stored integrity across repeated persistence: %j",
  async (input) => {
    recordPersistedEvents();
    await insertRunEvent(
      "run-first",
      0,
      JSON.stringify({
        type: "tool_start",
        tool: "send-report",
        id: "call-a",
        input,
      }),
      { toolInputSource: "execution" },
    );
    const firstStored = (mocks.events[0] as typeof start).event_data;
    await insertRunEvent("run-first", 1, firstStored, {
      toolInputSource: "execution",
    });
    expect((mocks.events[1] as typeof start).event_data).toBe(firstStored);
    const [event] = await getCurrentTurnEventsForThread("thread", "turn");
    expect(event).toMatchObject({
      input: stripInlineBytes(input, "placeholder"),
      inputFingerprint: toolCallInputFingerprint(input),
      inputStoredFingerprint: toolCallInputFingerprint(
        stripInlineBytes(input, "placeholder"),
      ),
    });
    expect(firstStored).not.toContain("QQ==");
    if (Object.hasOwn(input, "__proto__")) {
      expect(
        Object.hasOwn((event as { input: object }).input, "__proto__"),
      ).toBe(true);
      expect(JSON.stringify(event)).toContain(
        '"__proto__":{"destination":"a"}',
      );
    }
  },
);

it("does not manufacture original identity for an already projected legacy event", async () => {
  recordPersistedEvents();
  await insertRunEvent(
    "run-first",
    0,
    JSON.stringify({
      type: "tool_start",
      tool: "send-report",
      input: { attachments: [{ type: "file", omitted: "inline-bytes" }] },
    }),
  );
  expect((mocks.events[0] as typeof start).event_data).not.toContain(
    "Fingerprint",
  );
  await expect(
    getCurrentTurnEventsForThread("thread", "turn"),
  ).rejects.toMatchObject({ errorCode: "tool_call_journal_unreadable" });
});

it("keeps raw input identity when only the result contains inline bytes", async () => {
  recordPersistedEvents();
  const input = { destination: "example" };
  await insertRunEvent(
    "run-first",
    0,
    JSON.stringify({
      type: "tool_done",
      tool: "send-report",
      input,
      result: "data:text/plain;base64,QQ==",
    }),
    { toolInputSource: "execution" },
  );
  const [event] = await getCurrentTurnEventsForThread("thread", "turn");
  expect(event).toMatchObject({
    input,
    inputFingerprint: toolCallInputFingerprint(input),
    inputStoredFingerprint: toolCallInputFingerprint(input),
  });
  expect(JSON.stringify(event)).not.toContain("QQ==");
});

it.each(["tool_start", "tool_done"])(
  "rejects %s with corrupt stored integrity even when its original digest is valid",
  async (type) => {
    const input = {
      destination: "example",
      attachments: [{ type: "file", data: "QQ==" }],
    };
    mocks.events = [
      {
        ...start,
        event_data: JSON.stringify({
          type,
          tool: "send-report",
          input: stripInlineBytes(input, "placeholder"),
          inputFingerprint: toolCallInputFingerprint(input),
          inputStoredFingerprint: "0".repeat(64),
          result: "sent",
        }),
      },
    ];
    await expect(
      getCurrentTurnEventsForThread("thread", "turn"),
    ).rejects.toMatchObject({
      errorCode: "tool_call_journal_unreadable",
      reason: "invalid_event",
    });
  },
);

it.each(["tool_start", "tool_done"])(
  "rejects %s fingerprints that contradict unredacted arguments",
  async (type) => {
    mocks.events = [
      {
        ...done,
        event_data: JSON.stringify({
          type,
          tool: "send-message",
          id: "call-a",
          input: { destination: "b" },
          inputFingerprint: toolCallInputFingerprint({ destination: "a" }),
          result: "B sent",
        }),
      },
    ];
    await expect(
      getCurrentTurnEventsForThread("thread", "turn"),
    ).rejects.toMatchObject({
      errorCode: "tool_call_journal_unreadable",
      reason: "invalid_event",
    });
  },
);

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
      { type: "tool_done", result: "sent", completedSideEffect: true },
      { type: "tool_done", tool: "send-message" },
      { type: "tool_done", tool: " ", result: "sent" },
      { type: "tool_done", tool: "send-message", id: "", result: "sent" },
      ...[null, 1, "short", "x".repeat(64)].map((inputFingerprint) => ({
        type: "tool_done",
        tool: "send-message",
        result: "sent",
        inputFingerprint,
      })),
      ...[null, 1, "short", "x".repeat(64)].map((argumentsHash) => ({
        type: "tool_done",
        tool: "send-message",
        result: "sent",
        argumentsHash,
      })),
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

  it.each([[], "{truncated", 1, null])(
    "retains recorded tool inputs without deciding action validity: %j",
    async (input) => {
      const event = { type: "tool_start", tool: "send-message", input };
      mocks.events = [{ ...start, event_data: JSON.stringify(event) }];
      const events = await read("thread", "turn");
      expect(events).toEqual(
        _name === "run events"
          ? [{ runId: "run-first", seq: 0, event }]
          : [event],
      );
    },
  );

  it("returns an empty journal only when no rows exist", async () => {
    await expect(read("thread", "turn")).resolves.toEqual([]);
    await expect(read("thread")).resolves.toEqual([]);
  });

  it("retains the structured approval pause outcome during journal replay", async () => {
    const event = {
      type: "tool_done",
      tool: "send-message",
      id: "call-approved",
      result: "Awaiting human approval. This action did NOT execute.",
      completedSideEffect: false,
      approvalPause: true,
    };
    mocks.events = [{ ...done, event_data: JSON.stringify(event) }];

    const events = await read("thread", "turn");

    expect(events[0]).toMatchObject(
      _name === "run events"
        ? { runId: "run-first", event: { approvalPause: true } }
        : { approvalPause: true },
    );
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
  expect(query.sql).toContain("r.dispatch_mode IS DISTINCT FROM 'turn-abort'");
  expect(query.sql).toContain(
    "r.status IS DISTINCT FROM 'aborted' OR r.terminal_reason IS DISTINCT FROM 'aborted:duplicate_submission'",
  );
  expect(query.sql).toMatch(
    /ORDER BY COALESCE\(r.continuation_order, 0\) ASC,/,
  );
});

it("reads compact write receipts from persisted tool completions", async () => {
  const receipt = {
    changed: true,
    verified: true,
    summary: "Design output: 2 files saved.",
    subject: "design-1",
  };
  mocks.events = [
    {
      run_id: "run-first",
      seq: 0,
      event_data: JSON.stringify({
        type: "tool_done",
        tool: "generate-design",
        result: "Saved two files.",
        completedSideEffect: true,
        receipt,
      }),
    },
  ];

  await expect(
    getCurrentTurnRunEventsForThread("thread", "turn"),
  ).resolves.toMatchObject([{ event: { type: "tool_done", receipt } }]);
});

it("lists actual runs for one turn in continuation order, excluding abort markers", async () => {
  mocks.runs = [{ id: "run-first" }, { id: "run-next" }];

  await expect(
    getCurrentTurnRunIdsForThread("thread", "turn"),
  ).resolves.toEqual(["run-first", "run-next"]);

  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({ args: ["thread", "turn"] }),
  );
  const query = mocks.execute.mock.calls.find(
    ([statement]) =>
      typeof statement !== "string" &&
      statement.sql.includes("SELECT id FROM agent_runs"),
  )?.[0];
  expect(query.sql).toContain("COALESCE(turn_id, id) = ?");
  expect(query.sql).toContain("dispatch_mode IS DISTINCT FROM 'turn-abort'");
  expect(query.sql).toMatch(/ORDER BY COALESCE\(continuation_order, 0\) ASC,/);
});

it("rejects a run list with an unreadable identifier", async () => {
  mocks.runs = [{ id: "run-first" }, { id: " " }];

  await expect(
    getCurrentTurnRunIdsForThread("thread", "turn"),
  ).rejects.toMatchObject({
    name: "AgentRunJournalUnreadableError",
    threadId: "thread",
    turnId: "turn",
    rowIndex: 1,
    reason: "invalid_row",
  });
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

it.each([
  {},
  { url: "https://example.invalid/report" },
  { fileId: "fixture-file" },
])(
  "keeps each call's original-input fingerprint through SQL byte stripping without conflating payloads: %j",
  async (reference) => {
    const input = {
      destination: "example",
      attachments: [
        { type: "file", name: "report.txt", data: "QQ==", ...reference },
      ],
    };
    const other = {
      ...input,
      attachments: [{ ...input.attachments[0], data: "Qg==" }],
    };
    const events = [
      { type: "tool_start", tool: "send-report", input },
      { type: "tool_start", tool: "send-report", input: other },
      {
        type: "tool_done",
        tool: "send-report",
        input: other,
        result: "second sent",
        completedSideEffect: true,
      },
      {
        type: "tool_done",
        tool: "send-report",
        input,
        result: "first sent",
        completedSideEffect: true,
      },
    ];
    mocks.execute.mockImplementation(async (statement) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : (statement.args ?? []);
      const ledger = storeLedgerResult(sql);
      if (ledger) return ledger;
      if (sql.includes("INSERT INTO agent_run_events")) {
        mocks.events.push({
          run_id: args[0],
          seq: args[1],
          event_data: args[3],
        });
      }
      return {
        rows: sql.includes("SELECT e.run_id AS run_id") ? mocks.events : [],
        rowsAffected: 0,
      };
    });
    for (const [seq, event] of events.entries())
      await insertRunEvent("run-first", seq, JSON.stringify(event), {
        toolInputSource: "execution",
      });
    expect(JSON.stringify(mocks.events)).not.toContain("QQ==");
    expect(JSON.stringify(mocks.events)).not.toContain("Qg==");
    const journal = classifyToolCallJournal(
      await getCurrentTurnEventsForThread("thread", "turn"),
    );
    // The stored inputs lost their bytes; each fingerprint still names the
    // input its call ran with, and no other.
    expect(
      new Map(
        journal.completed.map((entry) => [
          entry.inputFingerprint,
          entry.result,
        ]),
      ),
    ).toEqual(
      new Map([
        [toolCallInputFingerprint(input), "first sent"],
        [toolCallInputFingerprint(other), "second sent"],
      ]),
    );
    expect(journal.interrupted).toHaveLength(0);
  },
);

it.each([
  { attachments: [{ type: "file", omitted: "inline-bytes" }] },
  { body: "[inline text/plain data omitted]" },
])(
  "fails closed for legacy stripped arguments without original identity: %j",
  async (input) => {
    mocks.events = [
      {
        ...start,
        event_data: JSON.stringify({
          type: "tool_start",
          tool: "send-report",
          input,
        }),
      },
      done,
    ];
    await expect(
      getCurrentTurnEventsForThread("thread", "turn"),
    ).rejects.toMatchObject({ errorCode: "tool_call_journal_unreadable" });
  },
);
