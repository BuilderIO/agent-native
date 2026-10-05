import { describe, expect, it } from "vitest";

import {
  buildConversationRows,
  defaultConversationRowKey,
} from "./thread-debug-conversation";

function user(index: number, runId: string | null, createdAt: number) {
  return {
    index,
    id: `u${index}`,
    role: "user",
    createdAt,
    metadata: runId ? { custom: { submittedRunId: runId } } : {},
  };
}

function assistant(index: number, runId: string | null, createdAt: number) {
  return {
    index,
    id: `a${index}`,
    role: "assistant",
    createdAt,
    metadata: runId ? { runId } : {},
  };
}

function run(id: string, startedAt: number) {
  return { id, startedAt };
}

describe("buildConversationRows", () => {
  it("attaches each run to its assistant reply without a separate run row", () => {
    const rows = buildConversationRows(
      [user(0, "run-1", 100), assistant(1, "run-1", 200)],
      [run("run-1", 110)],
    );
    expect(rows.map((row) => row.key)).toEqual(["message:u0", "message:a1"]);
    expect(rows[1].run?.id).toBe("run-1");
  });

  it("puts a run with no reply directly after the prompt that submitted it", () => {
    const rows = buildConversationRows(
      [user(0, "run-1", 100), user(1, "run-2", 300)],
      [run("run-1", 110), run("run-2", 310)],
    );
    expect(rows.map((row) => row.key)).toEqual([
      "message:u0",
      "run:run-1",
      "message:u1",
      "run:run-2",
    ]);
  });

  it("keeps runs no message mentions, ordered by start time", () => {
    const rows = buildConversationRows(
      [user(0, null, 100), assistant(1, null, 200), user(2, null, 400)],
      [run("late", 500), run("middle", 300)],
    );
    expect(rows.map((row) => row.key)).toEqual([
      "message:u0",
      "message:a1",
      "run:middle",
      "message:u2",
      "run:late",
    ]);
  });

  it("shows a thread with no persisted messages as its runs", () => {
    const rows = buildConversationRows([], [run("run-1", 100)]);
    expect(rows.map((row) => row.key)).toEqual(["run:run-1"]);
  });
});

describe("defaultConversationRowKey", () => {
  it("prefers the reply to a deep-linked run over its prompt", () => {
    const rows = buildConversationRows(
      [
        user(0, "run-1", 100),
        assistant(1, "run-1", 200),
        user(2, "run-2", 300),
        assistant(3, "run-2", 400),
      ],
      [run("run-1", 110), run("run-2", 310)],
    );
    expect(defaultConversationRowKey(rows, "run-1")).toBe("message:a1");
    expect(defaultConversationRowKey(rows, null)).toBe("message:a3");
  });
});
