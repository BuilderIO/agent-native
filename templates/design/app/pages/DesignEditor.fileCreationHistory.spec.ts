import { describe, expect, it } from "vitest";

import {
  pruneFileCreationHistoryStack,
  type FileCreationHistoryEntry,
} from "./design-editor/history";

function entry(filename: string): FileCreationHistoryEntry {
  return { filename, content: "<div></div>", fileType: "html" };
}

describe("pruneFileCreationHistoryStack (Item 1 — redo survives undo)", () => {
  it("prunes entries whose filename is being hard-deleted (default)", () => {
    const stack = [entry("a.html"), entry("b.html"), entry("c.html")];
    const deleted = new Set(["b.html"]);
    const result = pruneFileCreationHistoryStack(stack, deleted);
    expect(result.stack.map((e) => e.filename)).toEqual(["a.html", "c.html"]);
    expect(result.removed).toBe(1);
  });

  it("removes multiple matching entries and reports the count", () => {
    const stack = [entry("a.html"), entry("b.html"), entry("c.html")];
    const deleted = new Set(["a.html", "c.html"]);
    const result = pruneFileCreationHistoryStack(stack, deleted);
    expect(result.stack.map((e) => e.filename)).toEqual(["b.html"]);
    expect(result.removed).toBe(2);
  });

  it("keeps every entry when nothing matches", () => {
    const stack = [entry("a.html"), entry("b.html")];
    const deleted = new Set(["z.html"]);
    const result = pruneFileCreationHistoryStack(stack, deleted);
    expect(result.stack.map((e) => e.filename)).toEqual(["a.html", "b.html"]);
    expect(result.removed).toBe(0);
  });

  it("skip:true keeps the just-pushed redo entry (the core bug)", () => {
    const redoStack = [entry("screen-2.html")];
    const deleted = new Set(["screen-2.html"]);
    const result = pruneFileCreationHistoryStack(redoStack, deleted, {
      skip: true,
    });
    expect(result.stack).toBe(redoStack);
    expect(result.stack.map((e) => e.filename)).toEqual(["screen-2.html"]);
    expect(result.removed).toBe(0);
  });

  it("without skip, the same redo entry would be destroyed (documents the bug)", () => {
    const redoStack = [entry("screen-2.html")];
    const deleted = new Set(["screen-2.html"]);
    const result = pruneFileCreationHistoryStack(redoStack, deleted);
    expect(result.stack).toHaveLength(0);
    expect(result.removed).toBe(1);
  });
});
