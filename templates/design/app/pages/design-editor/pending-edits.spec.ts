import { describe, expect, it } from "vitest";

import type {
  PendingLiveTextEdit,
  PendingVisualStyleEdit,
} from "./pending-edits";
import {
  appendPendingLiveNonStyleUndoEntry,
  appendPendingVisualStyleUndoEntry,
  formatVisualEditClipboardPrompt,
} from "./pending-edits";

function styleEdit(
  selector: string,
  styles: Record<string, string>,
): PendingVisualStyleEdit {
  return {
    screenId: "home",
    filename: "index.html",
    screenName: "Home",
    selector,
    classes: [],
    styles,
    originalStyles: { color: "red" },
    updatedAt: 1,
  };
}

function textEdit(value: string): PendingLiveTextEdit {
  return {
    kind: "text",
    screenId: "home",
    filename: "index.html",
    screenName: "Home",
    selector: "h1",
    classes: [],
    value,
    originalValue: "Hello",
    updatedAt: 1,
  };
}

describe("appendPendingVisualStyleUndoEntry", () => {
  it("coalesces consecutive ticks on the same target and keeps the first revert", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "blue" }),
      revertStyles: { color: "red" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "green" }),
      revertStyles: { color: "blue" },
    });
    expect(stack).toHaveLength(1);
    expect(stack[0]?.edit.styles).toEqual({ color: "green" });
    expect(stack[0]?.revertStyles).toEqual({ color: "red" });
  });

  it("merges later properties into the same-target entry instead of replacing it", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "blue" }),
      revertStyles: { color: "red" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { opacity: "0.5" }),
      revertStyles: { opacity: "1" },
    });
    expect(stack).toHaveLength(1);
    expect(stack[0]?.edit.styles).toEqual({ color: "blue", opacity: "0.5" });
    expect(stack[0]?.revertStyles).toEqual({ color: "red", opacity: "1" });
  });

  it("keeps distinct selectors as separate undo steps", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "blue" }),
      revertStyles: { color: "red" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("p", { color: "green" }),
      revertStyles: { color: "black" },
    });
    expect(stack).toHaveLength(2);
  });
});

describe("appendPendingLiveNonStyleUndoEntry", () => {
  it("coalesces consecutive text edits on the same node", () => {
    const stack: Array<{
      kind: "text";
      edit: PendingLiveTextEdit;
      revertValue: string;
    }> = [];
    appendPendingLiveNonStyleUndoEntry(stack, {
      kind: "text",
      edit: textEdit("Hel"),
      revertValue: "Hello",
    });
    appendPendingLiveNonStyleUndoEntry(stack, {
      kind: "text",
      edit: textEdit("Help"),
      revertValue: "Hel",
    });
    expect(stack).toHaveLength(1);
    expect(stack[0]?.edit.value).toBe("Help");
    expect(stack[0]?.revertValue).toBe("Hello");
  });
});

describe("formatVisualEditClipboardPrompt", () => {
  it("uses the page-local WebMCP handoff inside supported hosts", () => {
    const prompt = "Apply the exact source edits from this canvas.";
    expect(formatVisualEditClipboardPrompt(prompt, "chatgpt")).toContain(
      "get-visual-edit-prompt",
    );
    expect(formatVisualEditClipboardPrompt(prompt, "claude")).toContain(
      "get-visual-edit-prompt",
    );
    expect(formatVisualEditClipboardPrompt(prompt, "webmcp")).toContain(
      "get-visual-edit-prompt",
    );
  });

  it("keeps the detailed prompt for ordinary clipboard use", () => {
    expect(formatVisualEditClipboardPrompt("Apply these edits.", null)).toBe(
      "Apply these edits.",
    );
  });
});
