// @vitest-environment happy-dom

import { Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
import {
  applyDocSurgically,
  defaultParseValue,
  diffTopLevel,
  planDocReconcile,
  reconcileDocAgainstBase,
} from "./surgical-apply.js";

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
      expect(diff!.oldToIndex).toBe(1);
      expect(diff!.newToIndex).toBe(2);
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

      const reference = makeEditor("# Totally\n\nDifferent\n\n- list");
      try {
        expect(md(editor)).toBe(md(reference));
      } finally {
        reference.destroy();
      }
      const again = parse(editor, "# Totally\n\nDifferent\n\n- list");
      expect(applyDocSurgically(editor, again)).toBe("noop");
    } finally {
      editor.destroy();
    }
  });

  it("preserves the user's trailing empty paragraph across reconciles", () => {
    const editor = makeEditor("Alpha");
    try {
      editor.commands.focus("end");
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: "paragraph",
      });
      const childCountBefore = editor.state.doc.childCount;

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
    const foreign = makeEditor("Alpha CHANGED");
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

describe("reconcileDocAgainstBase", () => {
  it.each([
    { base: "Alpha", server: "Accepted", live: "Accepted" },
    {
      base: "Alpha\n\nBravo",
      server: "Accepted\n\nBravo",
      live: "Accepted\n\nBravo local",
    },
  ])(
    "acknowledges common replacements without a transaction: $live",
    ({ base, server, live }) => {
      const editor = makeEditor(live);
      try {
        const before = editor.state.doc;
        const result = reconcileDocAgainstBase(
          editor,
          parse(editor, base),
          parse(editor, server),
        );
        expect(result.status).toBe("noop");
        expect(editor.state.doc).toBe(before);
        expect(md(editor)).toBe(live);
      } finally {
        editor.destroy();
      }
    },
  );

  it.each([
    {
      base: "Alpha\n\nBravo",
      server: "Accepted\n\nBravo",
      live: "Different\n\nBravo local",
    },
    {
      base: "Alpha\n\nBravo",
      server: "Accepted\n\nBravo server",
      live: "Accepted\n\nBravo local",
    },
    {
      base: "Alpha\n\nBravo",
      server: "Bravo\n\nAlpha",
      live: "Bravo\n\nAlpha local",
    },
    {
      base: "Same\n\nMiddle\n\nSame",
      server: "Accepted\n\nMiddle\n\nSame",
      live: "Accepted\n\nMiddle local\n\nSame",
    },
  ])(
    "preserves conflicting or ambiguous common-change candidates: $live",
    ({ base, server, live }) => {
      const editor = makeEditor(live);
      try {
        const before = editor.state.doc;
        const result = reconcileDocAgainstBase(
          editor,
          parse(editor, base),
          parse(editor, server),
        );
        expect(["conflict", "failed"]).toContain(result.status);
        expect(editor.state.doc).toBe(before);
      } finally {
        editor.destroy();
      }
    },
  );

  it("applies remaining server changes beside a common replacement and local edit", () => {
    const editor = makeEditor("Accepted\n\nBravo local\n\nCharlie");
    try {
      const result = reconcileDocAgainstBase(
        editor,
        parse(editor, "Alpha\n\nBravo\n\nCharlie"),
        parse(editor, "Accepted\n\nBravo\n\nCharlie server"),
      );
      expect(result.status).toBe("applied");
      expect(md(editor)).toBe("Accepted\n\nBravo local\n\nCharlie server");
    } finally {
      editor.destroy();
    }
  });

  it("merges a server insertion between unchanged blocks with a separate local edit", () => {
    const editor = makeEditor("Alpha\n\nBravo\n\nCharlie local");
    try {
      const base = parse(editor, "Alpha\n\nBravo\n\nCharlie");
      const server = parse(editor, "Alpha\n\nInserted\n\nBravo\n\nCharlie");
      const result = reconcileDocAgainstBase(editor, base, server);

      expect(result.status).toBe("applied");
      expect(md(editor)).toBe("Alpha\n\nInserted\n\nBravo\n\nCharlie local");
    } finally {
      editor.destroy();
    }
  });

  it("preserves non-overlapping local and server changes", () => {
    const editor = makeEditor("Alpha local\n\nBravo\n\nCharlie");
    try {
      const base = parse(editor, "Alpha\n\nBravo\n\nCharlie");
      const server = parse(editor, "Alpha\n\nBravo\n\nCharlie server");
      const result = reconcileDocAgainstBase(editor, base, server);

      expect(result.status).toBe("applied");
      expect(md(editor)).toBe("Alpha local\n\nBravo\n\nCharlie server");
    } finally {
      editor.destroy();
    }
  });

  it("merges separated server changes around a local change", () => {
    const editor = makeEditor("Alpha\n\nBravo local\n\nCharlie");
    try {
      const base = parse(editor, "Alpha\n\nBravo\n\nCharlie");
      const server = parse(editor, "Alpha server\n\nBravo\n\nCharlie server");
      const result = reconcileDocAgainstBase(editor, base, server);

      expect(result.status).toBe("applied");
      expect(md(editor)).toBe("Alpha server\n\nBravo local\n\nCharlie server");
    } finally {
      editor.destroy();
    }
  });

  it("returns a conflict without mutating an overlapping local draft", () => {
    const editor = makeEditor("Alpha local\n\nBravo");
    try {
      const before = editor.state.doc;
      const base = parse(editor, "Alpha\n\nBravo");
      const server = parse(editor, "Alpha server\n\nBravo");
      const result = reconcileDocAgainstBase(editor, base, server);

      expect(result.status).toBe("conflict");
      expect(editor.state.doc).toBe(before);
      expect(md(editor)).toBe("Alpha local\n\nBravo");
    } finally {
      editor.destroy();
    }
  });

  it("preserves a local insertion at the start boundary of a server replacement", () => {
    const editor = makeEditor(
      "Alpha\n\nLocal before Bravo\n\nBravo\n\nCharlie",
    );
    try {
      const before = editor.state.doc;
      const base = parse(editor, "Alpha\n\nBravo\n\nCharlie");
      const server = parse(editor, "Alpha\n\nBravo server\n\nCharlie");
      const result = reconcileDocAgainstBase(editor, base, server);

      expect(result.status).toBe("conflict");
      expect(editor.state.doc).toBe(before);
      expect(md(editor)).toBe(
        "Alpha\n\nLocal before Bravo\n\nBravo\n\nCharlie",
      );
    } finally {
      editor.destroy();
    }
  });

  it("preserves a local insertion at the end boundary of a server replacement", () => {
    const editor = makeEditor("Alpha\n\nBravo\n\nLocal after Bravo\n\nCharlie");
    try {
      const before = editor.state.doc;
      const base = parse(editor, "Alpha\n\nBravo\n\nCharlie");
      const server = parse(editor, "Alpha\n\nBravo server\n\nCharlie");
      const result = reconcileDocAgainstBase(editor, base, server);

      expect(result.status).toBe("conflict");
      expect(editor.state.doc).toBe(before);
      expect(md(editor)).toBe("Alpha\n\nBravo\n\nLocal after Bravo\n\nCharlie");
    } finally {
      editor.destroy();
    }
  });

  it("fails closed when repeated blocks make alignment ambiguous", () => {
    const editor = makeEditor("Same\n\nLocal\n\nSame");
    try {
      const base = parse(editor, "Same\n\nMiddle\n\nSame");
      const server = parse(editor, "Same\n\nServer\n\nSame");
      const result = reconcileDocAgainstBase(editor, base, server);

      expect(["conflict", "failed"]).toContain(result.status);
      expect(md(editor)).toBe("Same\n\nLocal\n\nSame");
    } finally {
      editor.destroy();
    }
  });

  it.each(["prefer-live", "conflict"] as const)(
    "does not count a change both sides made beside repeated blocks (%s)",
    (overlapPolicy) => {
      const editor = makeEditor("Same\n\nAlpha edited\n\nSame");
      try {
        const result = reconcileDocAgainstBase(
          editor,
          parse(editor, "Same\n\nAlpha\n\nSame"),
          parse(editor, "Same\n\nAlpha edited\n\nSame\n\nServer tail."),
          { overlapPolicy },
        );

        expect(result).toMatchObject({ status: "applied", setAside: 0 });
        expect(md(editor)).toBe("Same\n\nAlpha edited\n\nSame\n\nServer tail.");
      } finally {
        editor.destroy();
      }
    },
  );

  it("counts the server changes prefer-live sets aside", () => {
    const editor = makeEditor("Alpha local\n\nBravo");
    try {
      const result = reconcileDocAgainstBase(
        editor,
        parse(editor, "Alpha\n\nBravo"),
        parse(editor, "Alpha server\n\nBravo server"),
        { overlapPolicy: "prefer-live" },
      );

      expect(result).toMatchObject({ status: "applied", setAside: 1 });
      expect(md(editor)).toBe("Alpha local\n\nBravo server");
    } finally {
      editor.destroy();
    }
  });
});

// TrailingNode keeps an empty paragraph after a last block that is not a
// paragraph. Saved Markdown leaves it out, so the base parsed from it has none.
describe("reconcileDocAgainstBase beside the editor's filler line", () => {
  function blockTypes(doc: ProseMirrorNode): string[] {
    return Array.from({ length: doc.childCount }, (_, i) => {
      const node = doc.child(i);
      return node.textContent ? node.type.name : `empty ${node.type.name}`;
    });
  }

  function openPage(markdown: string): Editor {
    const editor = makeEditor(markdown);
    const last = editor.state.doc.lastChild!;
    if (last.type.name === "paragraph" && last.textContent) return editor;
    expect(last.type.name, "the editor's filler line").toBe("paragraph");
    expect(last.content.size).toBe(0);
    return editor;
  }

  it.each(["prefer-live", "conflict"] as const)(
    "keeps an item added to a closing list (%s)",
    (overlapPolicy) => {
      const base = "Intro.\n\n1. One\n2. Two";
      const server = "Intro.\n\n1. One\n2. Two\n3. Three";
      const editor = openPage(base);
      try {
        const result = reconcileDocAgainstBase(
          editor,
          parse(editor, base),
          parse(editor, server),
          { overlapPolicy },
        );

        expect(result).toMatchObject({ status: "applied", setAside: 0 });
        expect(md(editor)).toContain("3. Three");
        expect(blockTypes(editor.state.doc)).toEqual([
          "paragraph",
          "orderedList",
          "empty paragraph",
        ]);
      } finally {
        editor.destroy();
      }
    },
  );

  it("keeps every change when a closing list is replaced beside edits elsewhere", () => {
    const base = [
      "# Plan",
      "Context paragraph.",
      "## Next steps",
      "1. Fix the bugs.",
      "2. Redesign the hand-off.",
    ].join("\n\n");
    const server = [
      "# Plan",
      "Context paragraph, revised.",
      "## Next steps",
      "1. Fix the bugs.\n2. Redesign the hand-off, then run it once.\n3. Answer the open question.",
    ].join("\n\n");
    const editor = openPage(base);
    try {
      const result = reconcileDocAgainstBase(
        editor,
        parse(editor, base),
        parse(editor, server),
        { overlapPolicy: "prefer-live" },
      );

      expect(result).toMatchObject({ status: "applied", setAside: 0 });
      expect(md(editor)).toContain("Context paragraph, revised.");
      expect(md(editor)).toContain("3. Answer the open question.");
      expect(editor.state.doc.lastChild!.content.size).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("keeps a section added after a closing list, without a stray empty line", () => {
    const base = "Intro.\n\n- One\n- Two";
    const server = "Intro.\n\n- One\n- Two\n\n## Added\n\nNew paragraph.";
    const editor = openPage(base);
    try {
      const result = reconcileDocAgainstBase(
        editor,
        parse(editor, base),
        parse(editor, server),
        { overlapPolicy: "prefer-live" },
      );

      expect(result).toMatchObject({ status: "applied", setAside: 0 });
      expect(blockTypes(editor.state.doc)).toEqual([
        "paragraph",
        "bulletList",
        "heading",
        "paragraph",
      ]);
      expect(editor.state.doc.lastChild!.textContent).toBe("New paragraph.");
    } finally {
      editor.destroy();
    }
  });

  it("keeps a reworded closing heading and the line after it", () => {
    const editor = openPage("Intro.\n\n## Old heading");
    try {
      const result = reconcileDocAgainstBase(
        editor,
        parse(editor, "Intro.\n\n## Old heading"),
        parse(editor, "Intro.\n\n## New heading"),
        { overlapPolicy: "prefer-live" },
      );

      expect(result).toMatchObject({ status: "applied", setAside: 0 });
      expect(md(editor)).toContain("## New heading");
      expect(blockTypes(editor.state.doc)).toEqual([
        "paragraph",
        "heading",
        "empty paragraph",
      ]);
    } finally {
      editor.destroy();
    }
  });

  it.each([
    {
      label: "rewording the closing paragraph",
      base: "# T\n\nOld last line.",
      server: "# T\n\nNew last line.",
    },
    {
      label: "appending after the closing paragraph",
      base: "# T\n\nLast line.",
      server: "# T\n\nLast line.\n\nAppended line.",
    },
  ])(
    "merges a page that ends in a paragraph as before: $label",
    ({ base, server }) => {
      const editor = openPage(base);
      try {
        expect(editor.state.doc.lastChild!.textContent).not.toBe("");
        const result = reconcileDocAgainstBase(
          editor,
          parse(editor, base),
          parse(editor, server),
          { overlapPolicy: "prefer-live" },
        );

        expect(result).toMatchObject({ status: "applied", setAside: 0 });
        expect(md(editor)).toBe(server);
      } finally {
        editor.destroy();
      }
    },
  );

  it("keeps a typed empty line after a closing paragraph", () => {
    const editor = makeEditor("# Title\n\nLast line.");
    try {
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: "paragraph",
      });
      expect(editor.state.doc.childCount).toBe(3);
      const result = reconcileDocAgainstBase(
        editor,
        parse(editor, "# Title\n\nLast line."),
        parse(editor, "# New title\n\nLast line."),
        { overlapPolicy: "prefer-live" },
      );

      expect(result).toMatchObject({ status: "applied", setAside: 0 });
      expect(blockTypes(editor.state.doc)).toEqual([
        "heading",
        "paragraph",
        "empty paragraph",
      ]);
    } finally {
      editor.destroy();
    }
  });

  it.each(["prefer-live", "conflict"] as const)(
    "keeps a server edit to the closing paragraph above a typed empty line (%s)",
    (overlapPolicy) => {
      const editor = makeEditor("# Title\n\nLast line.");
      try {
        editor.commands.insertContentAt(editor.state.doc.content.size, {
          type: "paragraph",
        });
        const result = reconcileDocAgainstBase(
          editor,
          parse(editor, "# Title\n\nLast line."),
          parse(editor, "# Title\n\nLast line, revised."),
          { overlapPolicy },
        );

        expect(result).toMatchObject({ status: "applied", setAside: 0 });
        expect(blockTypes(editor.state.doc)).toEqual([
          "heading",
          "paragraph",
          "empty paragraph",
        ]);
        expect(editor.state.doc.child(1).textContent).toBe(
          "Last line, revised.",
        );
      } finally {
        editor.destroy();
      }
    },
  );

  it("leaves a base that really ends in an empty paragraph alone", () => {
    const editor = openPage("## Heading");
    try {
      const { schema } = editor;
      const heading = editor.state.doc.firstChild!;
      const empty = schema.nodes.paragraph!.create();
      const appended = schema.nodes.paragraph!.create(
        null,
        schema.text("Appended."),
      );
      const plan = planDocReconcile(
        editor.state.doc,
        schema.nodes.doc!.create(null, [heading, empty]),
        schema.nodes.doc!.create(null, [heading, empty, appended]),
        { overlapPolicy: "prefer-live" },
      );

      expect(plan).toMatchObject({ status: "applied", setAside: 0 });
      if (plan.status !== "applied") return;
      expect(blockTypes(plan.mergedDoc)).toEqual([
        "heading",
        "empty paragraph",
        "paragraph",
      ]);
    } finally {
      editor.destroy();
    }
  });

  const StyledLines = Extension.create({
    name: "styledLines",
    addGlobalAttributes() {
      return [
        {
          types: ["paragraph"],
          attributes: { indent: { default: 0 }, color: { default: null } },
        },
      ];
    },
  });

  it.each([
    { style: { indent: 1 }, overlapPolicy: "prefer-live" as const },
    { style: { color: "red" }, overlapPolicy: "prefer-live" as const },
    { style: { indent: 1 }, overlapPolicy: "conflict" as const },
    { style: { color: "red" }, overlapPolicy: "conflict" as const },
  ])(
    "treats a styled empty closing line as the tab's own edit: $style ($overlapPolicy)",
    ({ style, overlapPolicy }) => {
      const editor = new Editor({
        extensions: [...createRichMarkdownExtensions(), StyledLines],
        content: "",
      });
      try {
        editor.commands.setContent("# H");
        editor.commands.setTextSelection(1);
        const fillerFrom =
          editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(fillerFrom, undefined, style),
        );
        const result = reconcileDocAgainstBase(
          editor,
          parse(editor, "# H"),
          parse(editor, "Replacement."),
          { overlapPolicy },
        );

        expect(result).toMatchObject(
          overlapPolicy === "prefer-live"
            ? { status: "noop", setAside: 1 }
            : { status: "conflict" },
        );
        expect(blockTypes(editor.state.doc)).toEqual([
          "heading",
          "empty paragraph",
        ]);
        expect(editor.state.doc.lastChild!.attrs).toMatchObject(style);
      } finally {
        editor.destroy();
      }
    },
  );

  it.each([
    { focused: true, blocks: ["heading", "paragraph", "empty paragraph"] },
    { focused: false, blocks: ["heading", "paragraph"] },
  ])(
    "keeps the empty closing line only while the cursor is typing on it (focused: $focused)",
    ({ focused, blocks }) => {
      const base = "Intro.\n\n- One\n- Two";
      const editor = openPage(base);
      try {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        editor.isFocused = focused;
        const result = reconcileDocAgainstBase(
          editor,
          parse(editor, base),
          parse(editor, `${base}\n\n## Added\n\nNew paragraph.`),
          { overlapPolicy: "prefer-live" },
        );

        expect(result).toMatchObject({ status: "applied", setAside: 0 });
        expect(blockTypes(editor.state.doc).slice(2)).toEqual(blocks);
        if (!focused) return;
        editor.commands.insertContent("Typed.");
        expect(editor.state.doc.lastChild!.textContent).toBe("Typed.");
        expect(md(editor)).toContain("New paragraph.\n\nTyped.");
      } finally {
        editor.destroy();
      }
    },
  );

  it("keeps the empty closing line while a selection reaches into it", () => {
    const base = "Intro.\n\n- One\n- Two";
    const editor = openPage(base);
    try {
      const inTwo =
        editor.state.doc.child(0).nodeSize +
        editor.state.doc.child(1).nodeSize -
        4;
      editor.commands.setTextSelection({
        from: inTwo,
        to: editor.state.doc.content.size - 1,
      });
      editor.isFocused = true;
      const result = reconcileDocAgainstBase(
        editor,
        parse(editor, base),
        parse(editor, `${base}\n\n## Added\n\nNew paragraph.`),
        { overlapPolicy: "prefer-live" },
      );

      expect(result).toMatchObject({ status: "applied", setAside: 0 });
      const doc = editor.state.doc;
      expect(blockTypes(doc).slice(2)).toEqual([
        "heading",
        "paragraph",
        "empty paragraph",
      ]);
      expect(editor.state.selection.from).toBe(inTwo);
      expect(editor.state.selection.to).toBe(doc.content.size - 1);
    } finally {
      editor.destroy();
    }
  });

  // Once it follows a paragraph, the kept line is saved like a typed one, so it
  // stays whether or not the editor still has focus.
  it.each([true, false])(
    "keeps a later server edit to a paragraph added beside a kept empty line (focused: %s)",
    (focused) => {
      const base = "Intro.\n\n- One\n- Two";
      const added = `${base}\n\n## Added\n\nNew paragraph.`;
      const editor = openPage(base);
      try {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        editor.isFocused = true;
        expect(
          reconcileDocAgainstBase(
            editor,
            parse(editor, base),
            parse(editor, added),
            { overlapPolicy: "prefer-live" },
          ),
        ).toMatchObject({ status: "applied", setAside: 0 });
        expect(editor.state.doc.lastChild?.content.size).toBe(0);

        editor.isFocused = focused;
        const result = reconcileDocAgainstBase(
          editor,
          parse(editor, added),
          parse(editor, `${base}\n\n## Added\n\nNew paragraph, revised.`),
          { overlapPolicy: "prefer-live" },
        );

        expect(result).toMatchObject({ status: "applied", setAside: 0 });
        expect(blockTypes(editor.state.doc).slice(2)).toEqual([
          "heading",
          "paragraph",
          "empty paragraph",
        ]);
        expect(editor.state.doc.child(3).textContent).toBe(
          "New paragraph, revised.",
        );
      } finally {
        editor.destroy();
      }
    },
  );

  it("still sets aside a server change to a closing block the tab edited", () => {
    const base = "Intro.\n\n- One\n- Two";
    const editor = openPage(base);
    try {
      editor.commands.insertContentAt(
        editor.state.doc.child(0).nodeSize +
          editor.state.doc.child(1).nodeSize -
          3,
        " local",
      );
      const live = md(editor);
      const result = reconcileDocAgainstBase(
        editor,
        parse(editor, base),
        parse(editor, "Intro.\n\n- One\n- Two\n- Three"),
        { overlapPolicy: "prefer-live" },
      );

      expect(result).toMatchObject({ status: "noop", setAside: 1 });
      expect(md(editor)).toBe(live);
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
