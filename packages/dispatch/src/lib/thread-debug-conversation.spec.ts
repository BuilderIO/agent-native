import { describe, expect, it } from "vitest";

import {
  buildConversationRows,
  defaultConversationRowKey,
  type ConversationMessageLike,
  type ConversationRunLike,
} from "./thread-debug-conversation";

function message(
  overrides: Partial<ConversationMessageLike>,
): ConversationMessageLike {
  return {
    index: 0,
    id: null,
    role: "assistant",
    createdAt: null,
    metadata: null,
    ...overrides,
  };
}

function run(id: string, startedAt: number): ConversationRunLike {
  return { id, startedAt };
}

describe("buildConversationRows", () => {
  it("does not insert a folded run as a standalone row", () => {
    const runs = [run("run-1", 1), run("run-2", 2)];
    const messages = [
      message({
        id: "m1",
        role: "assistant",
        createdAt: 2,
        metadata: { runId: "run-2", custom: { foldedRunIds: ["run-1"] } },
      }),
    ];

    const rows = buildConversationRows(messages, runs);

    expect(rows).toEqual([
      {
        kind: "message",
        key: "message:m1",
        message: messages[0],
        run: runs[1],
      },
    ]);
  });

  it("still surfaces a run unrelated to any message", () => {
    const runs = [run("run-1", 1)];
    const rows = buildConversationRows([], runs);

    expect(rows).toEqual([{ kind: "run", key: "run:run-1", run: runs[0] }]);
  });
});

describe("defaultConversationRowKey", () => {
  it("falls back to the last row when the deep-linked run is absent", () => {
    const runs = [run("run-1", 1)];
    const rows = buildConversationRows([], runs);

    expect(defaultConversationRowKey(rows, "run-missing")).toBe("run:run-1");
  });
});
