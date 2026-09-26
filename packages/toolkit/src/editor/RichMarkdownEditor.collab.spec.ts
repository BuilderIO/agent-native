// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";

function extensionNames(
  opts?: Parameters<typeof createRichMarkdownExtensions>[0],
): string[] {
  return createRichMarkdownExtensions(opts).map((ext) => ext.name);
}

describe("createRichMarkdownExtensions collaboration wiring", () => {
  it("adds no collaboration extensions when ydoc is absent", () => {
    const names = extensionNames();
    expect(names).not.toContain("collaboration");
    expect(names).not.toContain("collaborationCaret");
  });

  it("adds Collaboration only when a ydoc is provided", () => {
    const ydoc = new Y.Doc();
    try {
      const names = extensionNames({ ydoc });
      expect(names).toContain("collaboration");
      expect(names).not.toContain("collaborationCaret");
    } finally {
      ydoc.destroy();
    }
  });

  it("adds CollaborationCaret when ydoc and awareness are both provided", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    try {
      const names = extensionNames({
        ydoc,
        awareness,
        user: { name: "Ada", color: "#60a5fa", email: "ada@example.com" },
      });
      expect(names).toContain("collaboration");
      expect(names).toContain("collaborationCaret");
    } finally {
      awareness.destroy();
      ydoc.destroy();
    }
  });

  it("disables StarterKit undo/redo only in collab mode", () => {
    const findStarterKit = (
      opts?: Parameters<typeof createRichMarkdownExtensions>[0],
    ) =>
      createRichMarkdownExtensions(opts).find(
        (ext) => ext.name === "starterKit",
      );

    const standalone = findStarterKit();
    expect((standalone?.options as { undoRedo?: unknown })?.undoRedo).toBe(
      undefined,
    );

    const ydoc = new Y.Doc();
    try {
      const collab = findStarterKit({ ydoc });
      expect((collab?.options as { undoRedo?: unknown })?.undoRedo).toBe(false);
    } finally {
      ydoc.destroy();
    }
  });
});
