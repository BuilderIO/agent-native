import { describe, expect, it } from "vitest";

import {
  createNewNodeTracker,
  NEW_NODE_WINDOW_MS,
} from "./use-new-node-highlight";

describe("the steps marked as just added", () => {
  it("marks nothing for the steps the page opened with", () => {
    const tracker = createNewNodeTracker();
    expect(tracker.observe(["a", "b"], 0).size).toBe(0);
  });

  it("marks only the steps that appear after that", () => {
    const tracker = createNewNodeTracker();
    tracker.observe(["a", "b"], 0);
    expect([...tracker.observe(["a", "b", "c"], 100)]).toEqual(["c"]);
    expect([...tracker.observe(["a", "b", "c"], 900)]).toEqual(["c"]);
  });

  it("keeps a mark for 2.5 seconds from when the step appeared", () => {
    const tracker = createNewNodeTracker();
    tracker.observe(["a"], 0);
    tracker.observe(["a", "c"], 100);
    expect(tracker.live(100 + NEW_NODE_WINDOW_MS - 1).has("c")).toBe(true);
    expect(tracker.live(100 + NEW_NODE_WINDOW_MS).has("c")).toBe(false);
  });

  it("drops the mark of a step that leaves the graph, and marks it again when it returns", () => {
    const tracker = createNewNodeTracker();
    tracker.observe(["a"], 0);
    tracker.observe(["a", "c"], 100);
    expect(tracker.observe(["a"], 200).size).toBe(0);
    expect([...tracker.observe(["a", "c"], 300)]).toEqual(["c"]);
  });

  it("ends each mark on its own time, and reports the first one to end", () => {
    const tracker = createNewNodeTracker();
    tracker.observe(["a"], 0);
    tracker.observe(["a", "d"], 1000);
    tracker.observe(["a", "d", "e"], 2000);
    expect(tracker.nextExpiry()).toBe(1000 + NEW_NODE_WINDOW_MS);
    expect([...tracker.live(1000 + NEW_NODE_WINDOW_MS)]).toEqual(["e"]);
  });
});
