import type { PlanBlock } from "@shared/plan-content";
import { describe, expect, it } from "vitest";

import { createPlanUndoStack } from "./usePlanUndoStack";

/**
 * Unit contract for the unified plan-editor undo/redo engine.
 *
 * The engine is the single cmd+z authority over the authoritative `blocks[]`
 * tree (PM history is disabled in the plan editor), so it must cover the exact
 * families the verified root-cause analysis found broken:
 *   • block OPTION/CONFIG edits (the headline bug — these never produced a
 *     ProseMirror transaction, so PM history could never see them);
 *   • drag REORDER / cross-region structural moves;
 *   • inline TEXT edits, with Notion-style coalescing so a typing burst is ONE
 *     undo step (and so it never silently no-ops after an autosave reconcile);
 * and that external/agent baseline changes (reset) clear the local stack.
 */

const rich = (id: string, markdown: string): PlanBlock =>
  ({ id, type: "rich-text", data: { markdown } }) as PlanBlock;

const callout = (id: string, tone: string, body: string): PlanBlock =>
  ({ id, type: "callout", data: { tone, body } }) as PlanBlock;

const columns = (
  id: string,
  cols: Array<{ id: string; blocks: PlanBlock[] }>,
): PlanBlock => ({ id, type: "columns", data: { columns: cols } }) as PlanBlock;

/**
 * Simulate the plan editor's commit choke point: every user edit records the
 * pre-edit tree then advances `current`. `restore` (undo/redo) writes `current`
 * back — the analog of the real editor's setContent + setBlocks repaint.
 */
function makeHarness(
  initial: PlanBlock[],
  now: () => number,
  coalesceMs = 1000,
) {
  let current: PlanBlock[] = JSON.parse(JSON.stringify(initial)) as PlanBlock[];
  const stack = createPlanUndoStack({
    restore: (blocks) => {
      current = JSON.parse(JSON.stringify(blocks)) as PlanBlock[];
    },
    getCurrentBlocks: () => current,
    now,
    coalesceMs,
  });
  const commit = (next: PlanBlock[]) => {
    stack.record(current, next);
    current = next;
  };
  return {
    stack,
    commit,
    get: () => current,
  };
}

describe("plan undo stack — block options (the headline bug)", () => {
  it("undoes and redoes a block-data/option edit that never touched the doc", () => {
    let t = 0;
    const h = makeHarness([callout("c1", "info", "hello")], () => t);

    t = 100;
    h.commit([callout("c1", "decision", "hello")]);
    expect((h.get()[0] as { data: { tone: string } }).data.tone).toBe(
      "decision",
    );

    expect(h.stack.undo()).toBe(true);
    expect((h.get()[0] as { data: { tone: string } }).data.tone).toBe("info");

    expect(h.stack.redo()).toBe(true);
    expect((h.get()[0] as { data: { tone: string } }).data.tone).toBe(
      "decision",
    );
  });

  it("treats each distinct option edit as its own undo step (no coalescing)", () => {
    let t = 0;
    const h = makeHarness([callout("c1", "info", "a")], () => t);

    t = 50;
    h.commit([callout("c1", "risk", "a")]);
    t = 80; // within the text window, but data edits never coalesce
    h.commit([callout("c1", "warning", "a")]);

    expect(h.stack.undo()).toBe(true);
    expect((h.get()[0] as { data: { tone: string } }).data.tone).toBe("risk");
    expect(h.stack.undo()).toBe(true);
    expect((h.get()[0] as { data: { tone: string } }).data.tone).toBe("info");
    expect(h.stack.undo()).toBe(false);
  });
});

describe("plan undo stack — structural moves", () => {
  it("reverts a block reorder with one undo and redoes it", () => {
    let t = 0;
    const h = makeHarness(
      [rich("a", "A"), rich("b", "B"), rich("c", "C")],
      () => t,
    );

    t = 100;
    h.commit([rich("c", "C"), rich("a", "A"), rich("b", "B")]);
    expect(h.get().map((b) => b.id)).toEqual(["c", "a", "b"]);

    expect(h.stack.undo()).toBe(true);
    expect(h.get().map((b) => b.id)).toEqual(["a", "b", "c"]);

    expect(h.stack.redo()).toBe(true);
    expect(h.get().map((b) => b.id)).toEqual(["c", "a", "b"]);
  });

  it("reverts a cross-region column dissolve restoring the full prior tree", () => {
    let t = 0;
    const before = [
      columns("col", [
        { id: "k1", blocks: [rich("n1", "left")] },
        { id: "k2", blocks: [rich("n2", "right")] },
      ]),
    ];
    const h = makeHarness(before, () => t);

    // Drag the right block out → column dissolves to two top-level blocks.
    t = 100;
    h.commit([rich("n1", "left"), rich("n2", "right")]);
    expect(h.get().map((b) => b.id)).toEqual(["n1", "n2"]);

    expect(h.stack.undo()).toBe(true);
    expect(h.get().map((b) => b.id)).toEqual(["col"]);
    expect((h.get()[0] as { type: string }).type).toBe("columns");
  });

  it("undoes a nested block-data edit (restores the whole container)", () => {
    let t = 0;
    const before = [
      columns("col", [
        { id: "k1", blocks: [callout("n1", "info", "x")] },
        { id: "k2", blocks: [rich("n2", "y")] },
      ]),
    ];
    const h = makeHarness(before, () => t);

    t = 100;
    h.commit([
      columns("col", [
        { id: "k1", blocks: [callout("n1", "risk", "x")] },
        { id: "k2", blocks: [rich("n2", "y")] },
      ]),
    ]);

    expect(h.stack.undo()).toBe(true);
    const restored = h.get()[0] as {
      data: { columns: Array<{ blocks: Array<{ data: { tone: string } }> }> };
    };
    expect(restored.data.columns[0].blocks[0].data.tone).toBe("info");
  });
});

describe("plan undo stack — text coalescing", () => {
  it("folds a same-block typing burst within the window into ONE undo", () => {
    let t = 0;
    const h = makeHarness([rich("r1", "")], () => t);

    t = 0;
    h.commit([rich("r1", "h")]);
    t = 100;
    h.commit([rich("r1", "he")]);
    t = 200;
    h.commit([rich("r1", "hel")]);

    // One undo reverts the entire burst back to before it began.
    expect(h.stack.undo()).toBe(true);
    expect((h.get()[0] as { data: { markdown: string } }).data.markdown).toBe(
      "",
    );
    expect(h.stack.undo()).toBe(false);
  });

  it("splits the boundary after a pause longer than the window", () => {
    let t = 0;
    const h = makeHarness([rich("r1", "")], () => t);

    t = 0;
    h.commit([rich("r1", "one")]);
    t = 2000; // > 1000ms window → new boundary
    h.commit([rich("r1", "one two")]);

    expect(h.stack.undo()).toBe(true);
    expect((h.get()[0] as { data: { markdown: string } }).data.markdown).toBe(
      "one",
    );
    expect(h.stack.undo()).toBe(true);
    expect((h.get()[0] as { data: { markdown: string } }).data.markdown).toBe(
      "",
    );
  });

  it("splits the boundary when typing moves to a different block", () => {
    let t = 0;
    const h = makeHarness([rich("r1", ""), rich("r2", "")], () => t);

    t = 0;
    h.commit([rich("r1", "a"), rich("r2", "")]);
    t = 100; // within window but different block
    h.commit([rich("r1", "a"), rich("r2", "b")]);

    expect(h.stack.undo()).toBe(true);
    expect((h.get()[1] as { data: { markdown: string } }).data.markdown).toBe(
      "",
    );
    expect(h.stack.undo()).toBe(true);
    expect((h.get()[0] as { data: { markdown: string } }).data.markdown).toBe(
      "",
    );
  });
});

describe("plan undo stack — isolation & invariants", () => {
  it("does not record a no-op commit", () => {
    let t = 0;
    const h = makeHarness([rich("r1", "x")], () => t);
    t = 100;
    h.commit([rich("r1", "x")]); // identical
    expect(h.stack.canUndo()).toBe(false);
  });

  it("clears the redo branch on a new edit after an undo", () => {
    let t = 0;
    const h = makeHarness([rich("r1", "")], () => t);

    t = 0;
    h.commit([rich("r1", "x")]);
    expect(h.stack.undo()).toBe(true);
    t = 100;
    h.commit([rich("r1", "y")]);

    expect(h.stack.redo()).toBe(false);
    expect((h.get()[0] as { data: { markdown: string } }).data.markdown).toBe(
      "y",
    );
  });

  it("reset() drops local history (external/agent baseline change)", () => {
    let t = 0;
    const h = makeHarness([rich("r1", "")], () => t);
    t = 0;
    h.commit([rich("r1", "x")]);
    h.stack.reset();
    expect(h.stack.canUndo()).toBe(false);
    expect(h.stack.undo()).toBe(false);
  });

  it("caps the retained history at the configured limit", () => {
    let t = 0;
    let current: PlanBlock[] = [rich("r1", "v0")];
    const stack = createPlanUndoStack({
      restore: (b) => {
        current = JSON.parse(JSON.stringify(b)) as PlanBlock[];
      },
      getCurrentBlocks: () => current,
      now: () => t,
      coalesceMs: 0, // never coalesce so every commit is its own boundary
      limit: 3,
    });
    for (let i = 1; i <= 6; i++) {
      t = i * 10;
      const next = [rich("r1", `v${i}`)];
      stack.record(current, next);
      current = next;
    }
    // Only the most recent 3 boundaries survive.
    let count = 0;
    while (stack.undo()) count++;
    expect(count).toBe(3);
  });
});
