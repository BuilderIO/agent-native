// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
import {
  applyDocSurgically,
  defaultParseValue,
  diffTopLevel,
} from "./surgical-apply.js";

/**
 * The surgical reconcile must replace ONLY the changed top-level run —
 * unchanged siblings keep their identity (no NodeView teardown, minimal Yjs
 * ops under Collaboration) — and must converge the editor to exactly the
 * document a full setContent would have produced.
 *
 * NOTE: ProseMirror `Node.eq` relies on NodeType identity, which is
 * per-Schema-instance — so target docs in these tests are parsed with the SAME
 * editor's schema via `defaultParseValue`, mirroring production (where
 * `parseValue` always uses the live editor).
 */

function makeEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: createRichMarkdownExtensions(),
    content: "",
  });
  if (markdown) editor.commands.setContent(markdown);
  return editor;
}

function md(editor: Editor): string {
  return (
    (editor.storage as Record<string, any>).markdown?.getMarkdown?.() ?? ""
  );
}

/** Parse markdown into a doc bound to THIS editor's schema. */
function parse(editor: Editor, markdown: string): ProseMirrorNode {
  const doc = defaultParseValue(editor, markdown);
  if (!doc) throw new Error("defaultParseValue returned null in test setup");
  return doc;
}

describe("diffTopLevel", () => {
  it("returns null for identical documents", () => {
    const editor = makeEditor("# Title\n\nAlpha\n\nBravo");
    try {
      const same = parse(editor, "# Title\n\nAlpha\n\nBravo");
      expect(diffTopLevel(editor.state.doc, same)).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("isolates a single changed middle node", () => {
    const editor = makeEditor("# Title\n\nAlpha\n\nBravo\n\nCharlie");
    try {
      const target = parse(
        editor,
        "# Title\n\nAlpha CHANGED\n\nBravo\n\nCharlie",
      );
      const diff = diffTopLevel(editor.state.doc, target);
      expect(diff).not.toBeNull();
      expect(diff!.fromIndex).toBe(1);
      expect(diff!.oldToIndex).toBe(2);
      expect(diff!.newToIndex).toBe(2);
    } finally {
      editor.destroy();
    }
  });

  it("handles insertion (empty old run)", () => {
    const editor = makeEditor("Alpha\n\nCharlie");
    try {
      const target = parse(editor, "Alpha\n\nBravo\n\nCharlie");
      const diff = diffTopLevel(editor.state.doc, target);
      expect(diff).not.toBeNull();
      expect(diff!.fromIndex).toBe(1);
      expect(diff!.oldToIndex).toBe(1); // nothing removed
      expect(diff!.newToIndex).toBe(2); // one node inserted
    } finally {
      editor.destroy();
    }
  });

  it("handles deletion (empty new run)", () => {
    const editor = makeEditor("Alpha\n\nBravo\n\nCharlie");
    try {
      const target = parse(editor, "Alpha\n\nCharlie");
      const diff = diffTopLevel(editor.state.doc, target);
      expect(diff).not.toBeNull();
      expect(diff!.fromIndex).toBe(1);
      expect(diff!.oldToIndex).toBe(2);
      expect(diff!.newToIndex).toBe(1);
    } finally {
      editor.destroy();
    }
  });
});

describe("applyDocSurgically", () => {
  it("converges the live doc to the target and leaves unchanged nodes intact", () => {
    const editor = makeEditor("# Title\n\nAlpha\n\nBravo\n\nCharlie");
    try {
      const target = parse(
        editor,
        "# Title\n\nAlpha CHANGED\n\nBravo\n\nCharlie",
      );
      const before = editor.state.doc;
      const untouched = [before.child(0), before.child(2), before.child(3)];

      const result = applyDocSurgically(editor, target);
      expect(result).toBe("applied");
      expect(editor.state.doc.eq(target)).toBe(true);

      // Structure-preserving: the untouched siblings are still node-equal
      // (same content at the same top-level slots).
      const after = editor.state.doc;
      expect(after.child(0).eq(untouched[0])).toBe(true);
      expect(after.child(2).eq(untouched[1])).toBe(true);
      expect(after.child(3).eq(untouched[2])).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("returns noop for identical documents without dispatching", () => {
    const editor = makeEditor("Alpha\n\nBravo");
    try {
      const same = parse(editor, "Alpha\n\nBravo");
      const docBefore = editor.state.doc;
      expect(applyDocSurgically(editor, same)).toBe("noop");
      // Same state object — no transaction was dispatched.
      expect(editor.state.doc).toBe(docBefore);
    } finally {
      editor.destroy();
    }
  });

  it("handles full-document divergence (worst case degrades to full replace)", () => {
    const editor = makeEditor("One\n\nTwo");
    try {
      const target = parse(editor, "# Totally\n\nDifferent\n\n- list");
      expect(applyDocSurgically(editor, target)).toBe("applied");

      // Serialization converges to what a full setContent would produce…
      const reference = makeEditor("# Totally\n\nDifferent\n\n- list");
      try {
        expect(md(editor)).toBe(md(reference));
      } finally {
        reference.destroy();
      }
      // …and re-applying the same parsed value is a no-op (stable after one
      // apply — trailing-cursor-paragraph preservation doesn't oscillate).
      const again = parse(editor, "# Totally\n\nDifferent\n\n- list");
      expect(applyDocSurgically(editor, again)).toBe("noop");
    } finally {
      editor.destroy();
    }
  });

  it("preserves the user's trailing empty paragraph across reconciles", () => {
    const editor = makeEditor("Alpha");
    try {
      // Give the user a trailing cursor line below the content.
      editor.commands.focus("end");
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: "paragraph",
      });
      const childCountBefore = editor.state.doc.childCount;

      // Agent rewrites the first paragraph; markdown can't express the
      // trailing empty paragraph, so the parsed doc lacks it.
      const target = parse(editor, "Alpha CHANGED");
      expect(applyDocSurgically(editor, target)).toBe("applied");

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(childCountBefore);
      const last = doc.child(doc.childCount - 1);
      expect(last.type.name).toBe("paragraph");
      expect(last.content.size).toBe(0);
      expect(md(editor)).toContain("Alpha CHANGED");
    } finally {
      editor.destroy();
    }
  });

  it("converges across a sequence of inserts, deletes, and rewrites", () => {
    const editor = makeEditor("Alpha\n\nBravo\n\nCharlie");
    const steps = [
      "Alpha\n\nBravo\n\nInserted\n\nCharlie",
      "Alpha\n\nCharlie",
      "Prefix\n\nAlpha\n\nCharlie",
    ];
    try {
      for (const step of steps) {
        const target = parse(editor, step);
        const result = applyDocSurgically(editor, target);
        expect(result === "applied" || result === "noop").toBe(true);
        expect(editor.state.doc.eq(target)).toBe(true);

        // The serialized output matches what a full setContent would produce.
        const reference = makeEditor(step);
        try {
          expect(md(editor)).toBe(md(reference));
        } finally {
          reference.destroy();
        }
      }
    } finally {
      editor.destroy();
    }
  });

  it("fails (for setContent fallback) when the doc comes from a foreign schema", () => {
    const editor = makeEditor("Alpha");
    const foreign = makeEditor("Alpha CHANGED"); // separate Editor → separate Schema
    try {
      expect(applyDocSurgically(editor, foreign.state.doc)).toBe("failed");
      expect(md(editor)).toBe("Alpha");
    } finally {
      editor.destroy();
      foreign.destroy();
    }
  });

  it("marks the transaction programmatic and history-free", () => {
    const editor = makeEditor("Alpha");
    try {
      const target = parse(editor, "Alpha CHANGED");
      let sawMeta = false;
      let sawHistoryOff = false;
      const origDispatch = editor.view.dispatch.bind(editor.view);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor.view as any).dispatch = (tr: any) => {
        if (tr.getMeta("an-rich-md-programmatic-transaction")) sawMeta = true;
        if (tr.getMeta("addToHistory") === false) sawHistoryOff = true;
        origDispatch(tr);
      };
      applyDocSurgically(editor, target);
      expect(sawMeta).toBe(true);
      expect(sawHistoryOff).toBe(true);
    } finally {
      editor.destroy();
    }
  });
});

describe("defaultParseValue", () => {
  it("parses markdown that applies to the same serialization as setContent", () => {
    const editor = makeEditor("Alpha");
    try {
      const parsed = defaultParseValue(
        editor,
        "# Heading\n\nBody text\n\n- item",
      );
      expect(parsed).not.toBeNull();
      expect(applyDocSurgically(editor, parsed!)).toBe("applied");

      const reference = makeEditor("# Heading\n\nBody text\n\n- item");
      try {
        expect(md(editor)).toBe(md(reference));
      } finally {
        reference.destroy();
      }
    } finally {
      editor.destroy();
    }
  });

  it("returns null when the markdown storage is unavailable", () => {
    const stub = { storage: {}, schema: null } as unknown as Editor;
    expect(defaultParseValue(stub, "# x")).toBeNull();
  });
});
