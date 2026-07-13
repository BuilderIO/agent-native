import { describe, expect, it } from "vitest";

import {
  finalizeTextCreationHistory,
  type ContentHistoryEntry,
  type PendingTextCreationHistory,
} from "./design-editor/history";

const pending: PendingTextCreationHistory = {
  fileId: "screen-1",
  nodeId: "text-1",
  before: "<main></main>",
  created: '<main><div data-agent-native-node-id="text-1"></div></main>',
};

describe("finalizeTextCreationHistory", () => {
  it("coalesces typing into the creation so one undo removes the text layer", () => {
    const result = finalizeTextCreationHistory(
      [
        {
          fileId: pending.fileId,
          before: pending.before,
          after: pending.created,
        },
      ],
      pending,
      '<main><div data-agent-native-node-id="text-1">Hello</div></main>',
    );

    expect(result.status).toBe("coalesced");
    expect(result.stack).toEqual([
      {
        fileId: pending.fileId,
        before: pending.before,
        after:
          '<main><div data-agent-native-node-id="text-1">Hello</div></main>',
      },
    ]);
  });

  it("drops the history entry when an untouched empty creation rolls back", () => {
    const result = finalizeTextCreationHistory(
      [
        {
          fileId: pending.fileId,
          before: pending.before,
          after: pending.created,
        },
      ],
      pending,
      pending.before,
    );

    expect(result).toEqual({ stack: [], status: "rolled-back" });
  });

  it("refuses to coalesce across an intervening edit", () => {
    const stack: ContentHistoryEntry[] = [
      {
        fileId: pending.fileId,
        before: pending.before,
        after: pending.created,
      },
      { fileId: "screen-2", before: "before", after: "after" },
    ];

    expect(finalizeTextCreationHistory(stack, pending, "typed")).toEqual({
      stack,
      status: "stale",
    });
  });

  it("refuses a mismatched creation snapshot instead of corrupting history", () => {
    const stack: ContentHistoryEntry[] = [
      { fileId: pending.fileId, before: pending.before, after: "peer-edit" },
    ];
    expect(finalizeTextCreationHistory(stack, pending, "typed").status).toBe(
      "stale",
    );
  });
});
