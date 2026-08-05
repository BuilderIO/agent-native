import { describe, expect, it } from "vitest";

import { reorderQueuedMessages } from "./QueuedMessageList.js";

const queue = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("reorderQueuedMessages", () => {
  it("moves a message earlier", () => {
    expect(reorderQueuedMessages(queue, "c", -1).map((m) => m.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("moves a message later", () => {
    expect(reorderQueuedMessages(queue, "a", 1).map((m) => m.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("keeps every message when the move runs off either end", () => {
    expect(reorderQueuedMessages(queue, "a", -1).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(reorderQueuedMessages(queue, "c", 1).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps every message when the id is unknown", () => {
    expect(reorderQueuedMessages(queue, "missing", 1).map((m) => m.id)).toEqual(
      ["a", "b", "c"],
    );
  });

  it("does not mutate the input", () => {
    const original = [...queue];
    reorderQueuedMessages(queue, "a", 1);
    expect(queue).toEqual(original);
  });
});
