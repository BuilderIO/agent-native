// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import {
  VISUAL_INDENT,
  parseNfmForEditor,
  serializeEditorToNfm,
} from "@shared/notion-markdown";
import {
  suggestionFormattingSourceRange,
  suggestionFormattingSourceSlice,
} from "@shared/suggestion-formatting";
import { suggestionTextPresentationForSource } from "@shared/suggestion-text";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor, getSchema } from "@tiptap/core";
import {
  NodeSelection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  act,
  createElement,
  type ComponentProps,
  type ComponentType,
} from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Markdown } from "tiptap-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  createSuggestionDraftSession,
  previewSuggestionDraft,
  recordSuggestionReplacementIntent,
  suggestionDraftOperations,
} from "./suggestions/draft-session";

it("maps a native escaped-backtick code proposal and preserves native Undo", () => {
  const editor = new Editor({
    extensions: [StarterKit],
    content: nfmToDoc("\\`"),
  });
  try {
    const baseline = docToNfm(editor.getJSON() as any);
    const session = createSuggestionDraftSession({
      id: "undo-format",
      baseContent: baseline,
      baseRevision: "one",
      startedAt: "2026-09-08T00:00:00.000Z",
    });
    editor.commands.setTextSelection({ from: 1, to: 2 });
    editor.commands.toggleCode();
    const draft = docToNfm(editor.getJSON() as any);
    expect(draft).toBe("`` ` ``");
    const operations = suggestionDraftOperations(session, draft);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: "set_inline_mark",
      before: { changedText: "\\`" },
      after: { changedText: "`` ` ``" },
    });
    expect(previewSuggestionDraft(session, draft, null).status).toBe("ready");
    for (const presentation of ["draft", "canonical"] as const) {
      const source = presentation === "draft" ? draft : baseline;
      const sourceEditor = createMarkdownEditor(source);
      try {
        const anchor =
          presentation === "draft"
            ? draftSuggestionAnchors(operations, draft)[0]!
            : operations[0]!.anchor;
        expect(
          suggestionHighlightSpec(sourceEditor.state.doc, {
            id: `escaped-backtick-${presentation}`,
            kind: operations[0]!.kind,
            beforeText: operations[0]!.before.changedText,
            afterText: operations[0]!.after.changedText,
            anchor,
            presentation,
          }),
        ).not.toBeNull();
      } finally {
        sourceEditor.destroy();
      }
    }
    expect(docToNfm(editor.getJSON() as any)).toBe(draft);
    expect(session.baseContent).toBe(baseline);
    expect(editor.commands.undo()).toBe(true);
    expect(
      previewSuggestionDraft(session, docToNfm(editor.getJSON() as any), null),
    ).toEqual({ status: "ready", suggestions: [] });
  } finally {
    editor.destroy();
  }
});

type TooltipProviderProps = Omit<
  ComponentProps<typeof TooltipProvider>,
  "children"
>;
const TooltipProviderWithoutChildren =
  TooltipProvider as ComponentType<TooltipProviderProps>;

import { CodeBlock } from "./extensions/CodeBlockNode";
import { NotionToggle } from "./extensions/NotionExtensions";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import { createPreviewDocumentSaveController } from "./previewDocumentSaveController";
import { insertMediaPlaceholder } from "./SlashCommandMenu";
import {
  draftSuggestionAnchors,
  markdownSuggestionOperations,
} from "./suggestions/markdown-operation";
import {
  createVisualEditorExtensions,
  commitPendingImageUpload,
  didCommitMediaSource,
  EmptyLineParagraph,
  getRecentEditPresenceMarkerRect,
  hasAncestorType,
  parseNfmForCollabReconcile,
  ensurePendingImageUpload,
  restorePendingImagePicker,
  runIfMediaCreationAllowed,
  uploadAndInsertAudioFiles,
  uploadAndInsertImageFiles,
  uploadAndInsertVideoFiles,
  isUserInitiatedCollaborativeEditorUpdate,
  shouldApplyExternalContentSync,
  shouldPersistEffectivelyEmptyEditorUpdate,
  shouldPersistCollaborativeEditorUpdate,
  shouldPersistLocalFileEditorUpdate,
  shouldSkipMediaDraftPersistence,
  shouldSeedCollaborativeContent,
  serializeEditorDraftForPersistence,
  suggestionReplacementIntentForTransaction,
  type VisualEditorSuggestion,
  VisualEditor,
  suggestionHighlightSpec,
} from "./VisualEditor";

describe("suggestion replacement intent", () => {
  it("keeps a suffix Add after native backspaces cancel an insertion in a mixed session", () => {
    const editor = createMarkdownEditor(
      "This reads better compared to the original.\n\nEditors publish carefully.\n\nFinal sentence.",
    );
    const baseContent = docToNfm(editor.state.doc.toJSON());
    const session = createSuggestionDraftSession({
      id: "mixed-native",
      baseContent,
      baseRevision: "one",
      startedAt: "now",
    });
    editor.on("beforeTransaction", ({ transaction }) => {
      const intent = suggestionReplacementIntentForTransaction(
        transaction,
        editor.state.selection,
      );
      if (intent)
        recordSuggestionReplacementIntent(
          session,
          intent,
          intent.beforeMarkdown,
        );
    });
    const select = (from: number, to = from) =>
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, from, to),
        ),
      );
    const find = (text: string) => {
      let found = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes(text))
          found = pos + node.text.indexOf(text);
      });
      expect(found).toBeGreaterThanOrEqual(0);
      return found;
    };
    try {
      const original = "This reads better compared to the original.";
      const replacement = "This reads more clearly than the original.";
      select(find(original), find(original) + original.length);
      editor.view.dispatch(editor.state.tr.insertText(replacement));
      select(find("publish"), find("publish") + "publish".length);
      editor.view.dispatch(editor.state.tr.deleteSelection());
      const canceled = " Added words.";
      select(find("Final sentence.") + "Final sentence".length);
      for (const character of canceled)
        editor.view.dispatch(editor.state.tr.insertText(character));
      for (let index = 0; index < canceled.length; index++) {
        const caret = editor.state.selection.from;
        editor.view.dispatch(editor.state.tr.delete(caret - 1, caret));
      }
      const canceledOperations = suggestionDraftOperations(
        session,
        docToNfm(editor.state.doc.toJSON()),
      );
      expect(canceledOperations).toHaveLength(2);
      select(find("Final sentence.") + "Final sentence.".length);
      for (const character of canceled)
        editor.view.dispatch(editor.state.tr.insertText(character));
      expect(
        suggestionDraftOperations(
          session,
          docToNfm(editor.state.doc.toJSON()),
        ).map((operation) => [
          operation.kind,
          operation.before.changedText,
          operation.after.changedText,
        ]),
      ).toEqual([
        ["replace_text", original, replacement],
        ["delete_text", "publish", ""],
        ["insert_text", "", canceled],
      ]);
    } finally {
      editor.destroy();
    }
  });

  it("does not treat collapsed-caret deletion as selected overwrite", () => {
    const editor = createMarkdownEditor("Final sentence. Added words.");
    try {
      const caret = editor.state.doc.content.size - 1;
      expect(
        suggestionReplacementIntentForTransaction(
          editor.state.tr.delete(caret - 1, caret),
          { from: caret, to: caret, empty: true },
        ),
      ).toBeNull();
    } finally {
      editor.destroy();
    }
  });
  it("captures whole-document replacement without inserting inline markers at the root", () => {
    const editor = createMarkdownEditor(
      "First paragraph.\n\nSecond paragraph.",
    );
    try {
      const intent = suggestionReplacementIntentForTransaction(
        editor.state.tr.insertText(
          "Replacement",
          0,
          editor.state.doc.content.size,
        ),
        { from: 0, to: editor.state.doc.content.size, empty: false },
      );
      expect(intent).not.toBeNull();
      expect(intent!.beforeText).toBe(intent!.beforeMarkdown);
      expect(intent!.startOffset).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("maps repeated text after a link to its serialized selection", () => {
    const content =
      "same\n\n[abcdefghijklmnopqrst](https://example.test/a-very-long-link-path)\n\nsame";
    const editor = createMarkdownEditor(content);
    try {
      let last = 0;
      editor.state.doc.descendants((node, position) => {
        if (node.isText && node.text === "same") last = position;
      });
      const intent = suggestionReplacementIntentForTransaction(
        editor.state.tr.insertText("different", last, last + 4),
        { from: last, to: last + 4, empty: false },
      );
      expect(intent).not.toBeNull();
      expect(intent!.startOffset).toBe(
        intent!.beforeMarkdown.lastIndexOf("same"),
      );
      expect(intent!.beforeText).toBe("same");
    } finally {
      editor.destroy();
    }
  });

  it("captures an exact native selected-text replacement", () => {
    const editor = createMarkdownEditor("Use this workflow today.");
    try {
      const transaction = editor.state.tr.insertText("workflows", 10, 18);

      expect(
        suggestionReplacementIntentForTransaction(transaction, {
          from: 10,
          to: 18,
          empty: false,
        }),
      ).toEqual({
        beforeText: "workflow",
        afterText: "workflows",
        startOffset: 9,
        beforeMarkdown: "Use this workflow today.",
      });
    } finally {
      editor.destroy();
    }
  });

  it("does not reinterpret an ordinary insertion as a replacement", () => {
    const editor = createMarkdownEditor("Use this workflow today.");
    try {
      const transaction = editor.state.tr.insertText("s", 18);
      expect(
        suggestionReplacementIntentForTransaction(transaction, {
          from: 18,
          to: 18,
          empty: true,
        }),
      ).toBeNull();
    } finally {
      editor.destroy();
    }
  });
});

function createMarkdownEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        paragraph: false,
      }),
      CodeBlock,
      EmptyLineParagraph,
      NotionToggle,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: parseNfmForEditor(content),
  });
}

function createFullEditor(content = "") {
  return new Editor({
    extensions: createVisualEditorExtensions(),
    content: content
      ? parseNfmForEditor(content)
      : { type: "doc", content: [{ type: "paragraph" }] },
  });
}

describe("live suggestion presentation", () => {
  function createSuggestionEditor(content: string) {
    return new Editor({
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc(content),
    });
  }
  it.each([
    "**Echo**",
    "*Echo*",
    "~~Echo~~",
    "`Echo`",
    '<span underline="true">Echo</span>',
    "[Echo](https://example.test)",
  ])(
    "anchors a saved and draft formatting change %s to only its text",
    (formatted) => {
      const before = "Echo sample.\nOther paragraph.";
      const after = formatted + before.slice(4);
      for (const presentation of ["draft", "canonical"] as const) {
        const editor = createSuggestionEditor(
          presentation === "draft" ? after : before,
        );
        try {
          const spec = suggestionHighlightSpec(editor.state.doc, {
            id: "format",
            kind: "set_inline_mark",
            beforeText: "Echo",
            afterText: formatted,
            anchor: { from: 0, prefix: "", suffix: before.slice(4) },
            presentation,
          });
          expect(spec).toMatchObject({ kind: "mark", from: 1, to: 5 });
          setSuggestionHighlights(editor.view, { specs: [spec!] });
          expect(
            editor.view.dom.querySelector('[data-suggestion-id="format"]')
              ?.textContent,
          ).toBe("Echo");
          expect(docToNfm(editor.state.doc.toJSON())).toBe(
            presentation === "draft" ? after : before,
          );
        } finally {
          editor.destroy();
        }
      }
    },
  );
  it("leaves stale split context unavailable rather than preferring a partially matching target", () => {
    const editor = createSuggestionEditor("BBBB target x\nC target y");
    try {
      expect(
        suggestionHighlightSpec(editor.state.doc, {
          id: "stale",
          kind: "delete_text",
          beforeText: "target",
          afterText: "",
          anchor: { from: 5, prefix: "BBBB ", suffix: " y" },
          presentation: "canonical",
        }),
      ).toBeNull();
    } finally {
      editor.destroy();
    }
  });
  it.each(["draft", "canonical"] as const)(
    "uses current-source coordinates for a repeated mixed %s hard-break range",
    (presentation) => {
      const content = "x<br>".repeat(20);
      const editor = createSuggestionEditor(content);
      try {
        const spec = suggestionHighlightSpec(editor.state.doc, {
          id: "periodic",
          kind: presentation === "draft" ? "insert_text" : "delete_text",
          beforeText: presentation === "draft" ? "" : "x<br>",
          afterText: presentation === "draft" ? "x<br>" : "",
          anchor: {
            from: 25,
            prefix: content.slice(0, 25),
            suffix: content.slice(30, 62),
          },
          presentation,
        });
        expect(spec).toMatchObject({ from: 11, to: 13 });
      } finally {
        editor.destroy();
      }
    },
  );
  it("maps composed draft offsets from the current source rather than its baseline", () => {
    const content = "Earlier addition. " + "x<br>".repeat(20);
    const from = "Earlier addition. ".length + 25;
    const editor = createSuggestionEditor(content);
    try {
      const spec = suggestionHighlightSpec(editor.state.doc, {
        id: "composed",
        kind: "insert_text",
        beforeText: "",
        afterText: "x<br>",
        anchor: {
          from,
          prefix: content.slice(Math.max(0, from - 32), from),
          suffix: content.slice(from + 5, from + 37),
        },
        presentation: "draft",
      });
      expect(spec).toMatchObject({ from: 29, to: 31 });
      const stale = suggestionHighlightSpec(editor.state.doc, {
        id: "ambiguous",
        kind: "insert_text",
        beforeText: "",
        afterText: "x<br>",
        anchor: { from: 25, prefix: "", suffix: "" },
        presentation: "draft",
      });
      expect(stale).toBeNull();
    } finally {
      editor.destroy();
    }
  });
  it("does not use raw offsets when formatting changes the current source mapping", () => {
    const editor = createSuggestionEditor("**prefix** " + "x<br>".repeat(20));
    try {
      expect(
        suggestionHighlightSpec(editor.state.doc, {
          id: "ambiguous-format",
          kind: "insert_text",
          beforeText: "",
          afterText: "x<br>",
          anchor: { from: 35, prefix: "", suffix: "" },
          presentation: "draft",
        }),
      ).toBeNull();
    } finally {
      editor.destroy();
    }
  });
  it.each(["<br>", "\n"])(
    "gives a draft %j addition a visible anchored marker without changing content",
    (breakText) => {
      const content = `Ec${breakText}ho`;
      const editor = createSuggestionEditor(content);
      try {
        const spec = suggestionHighlightSpec(editor.state.doc, {
          id: "break",
          kind: "insert_text",
          beforeText: "",
          afterText: breakText,
          anchor: { from: 2, prefix: "Ec", suffix: "ho" },
          presentation: "draft",
        });
        expect(spec).toMatchObject({ kind: "insert", from: 3 });
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        expect(
          editor.view.dom.querySelector('[data-suggestion-id="break"]')
            ?.textContent,
        ).toBe("↵");
        expect(docToNfm(editor.state.doc.toJSON())).toBe(content);
      } finally {
        editor.destroy();
      }
    },
  );
  it.each(["draft", "canonical"] as const)(
    "renders a %s hard-break deletion without losing the structural anchor",
    (presentation) => {
      const content = presentation === "draft" ? "Echo" : "Ec<br>ho";
      const editor = createSuggestionEditor(content);
      try {
        const spec = suggestionHighlightSpec(editor.state.doc, {
          id: "break",
          kind: "delete_text",
          beforeText: "<br>",
          afterText: "",
          anchor: { from: 2, prefix: "Ec", suffix: "ho" },
          presentation,
        });
        expect(spec).toMatchObject({ from: 3 });
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        expect(
          editor.view.dom.querySelector(".suggestion-delete-widget")
            ?.textContent,
        ).toBe("↵");
        expect(docToNfm(editor.state.doc.toJSON())).toBe(content);
      } finally {
        editor.destroy();
      }
    },
  );
  it("anchors mixed text and hard breaks to the intended repeated occurrence", () => {
    const editor = createSuggestionEditor("Ec<br>ho and Ec<br>ho");
    try {
      const spec = suggestionHighlightSpec(editor.state.doc, {
        id: "mixed",
        kind: "insert_text",
        beforeText: "",
        afterText: "Ec<br>ho",
        anchor: { from: 13, prefix: "Ec<br>ho and ", suffix: "" },
        presentation: "draft",
      });
      expect(spec).toMatchObject({ from: 11, to: 16, kind: "mark" });
      const missing = suggestionHighlightSpec(editor.state.doc, {
        id: "missing",
        kind: "insert_text",
        beforeText: "",
        afterText: "<br>",
        anchor: { from: 2, prefix: "Wrong", suffix: "context" },
        presentation: "draft",
      });
      expect(missing).toBeNull();
    } finally {
      editor.destroy();
    }
  });
  it("anchors a generated hard break beside an independent paragraph merge", () => {
    const base =
      "Alpha \nbeta gamma.\nRepeat repeat repeat.\nBold italic underline strike code link.";
    const draft =
      "Alpha beta gamma.\nRepeat <br>repeat repeat.\nBold italic underline strike code link.";
    const operations = markdownSuggestionOperations(base, draft);
    expect(operations).toHaveLength(2);
    expect(operations[1]!.after.changedText).toBe("<br>");
    for (const presentation of ["draft", "canonical"] as const) {
      const source = presentation === "draft" ? draft : base;
      const editor = createSuggestionEditor(source);
      try {
        const anchors =
          presentation === "draft"
            ? draftSuggestionAnchors(operations, draft)
            : operations.map((operation) => operation.anchor);
        const specs = operations.map((operation, index) =>
          suggestionHighlightSpec(editor.state.doc, {
            id: `structural-${index}`,
            kind: operation.kind,
            beforeText: operation.before.changedText,
            afterText: operation.after.changedText,
            anchor: anchors[index]!,
            presentation,
          }),
        );
        expect(specs.every(Boolean)).toBe(true);
        setSuggestionHighlights(editor.view, {
          specs: specs.filter((spec) => spec !== null),
        });
        expect(
          editor.view.dom.querySelector('[data-suggestion-id="structural-1"]')
            ?.textContent,
        ).toBe("↵");
        expect(docToNfm(editor.state.doc.toJSON())).toBe(source);
      } finally {
        editor.destroy();
      }
    }
  });
  it("keeps a deletion visible after an earlier draft insertion changes its context", () => {
    const base =
      "Alpha Beta Gamma.\nThe team will publish on Friday.\nThird paragraph stays unchanged.";
    const inserted = base.replace("Gamma.", "Gamma. Added words.");
    const draft = inserted.replace("Alpha", "");
    const editor = createSuggestionEditor(inserted);
    try {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.deleteSelection();
      const operations = markdownSuggestionOperations(base, draft);
      const anchors = draftSuggestionAnchors(operations, draft);
      const specs = operations.map((operation, index) =>
        suggestionHighlightSpec(editor.state.doc, {
          id: `draft-${operation.ordinal}`,
          kind: operation.kind,
          beforeText: operation.before.changedText,
          afterText: operation.after.changedText,
          anchor: anchors[index]!,
          presentation: "draft",
        }),
      );
      expect(specs.every(Boolean)).toBe(true);
      setSuggestionHighlights(editor.view, {
        specs: specs.filter((spec) => spec !== null),
      });
      expect(
        editor.view.dom.querySelector(".suggestion-delete-widget")?.textContent,
      ).toBe("Alpha");
      expect(
        editor.view.dom.querySelector(".suggestion-change")?.textContent,
      ).toBe(" Added words.");
      expect(editor.state.doc.firstChild?.textContent).toBe(
        " Beta Gamma. Added words.",
      );
      expect(editor.state.selection.from).toBe(1);
    } finally {
      editor.destroy();
    }
  });
  it("shows both sides of a draft replacement without changing draft text", () => {
    const editor = createSuggestionEditor("The team will publish on Monday.");
    try {
      const spec = suggestionHighlightSpec(editor.state.doc, {
        id: "replacement",
        kind: "replace_text",
        beforeText: "Fri",
        afterText: "Mon",
        anchor: {
          from: 25,
          prefix: "The team will publish on ",
          suffix: "day.",
        },
        presentation: "draft",
      });
      expect(spec).not.toBeNull();
      setSuggestionHighlights(editor.view, { specs: [spec!] });
      expect(
        editor.view.dom.querySelector(".suggestion-delete-widget")?.textContent,
      ).toBe("Fri");
      expect(
        editor.view.dom.querySelector(".suggestion-change")?.textContent,
      ).toBe("Mon");
      expect(
        editor.view.dom
          .querySelector(".suggestion-change")
          ?.hasAttribute("tabindex"),
      ).toBe(false);
      expect(
        editor.view.dom
          .querySelector(".suggestion-change")
          ?.hasAttribute("role"),
      ).toBe(false);
      expect(editor.state.doc.textContent).toBe(
        "The team will publish on Monday.",
      );
    } finally {
      editor.destroy();
    }
  });

  it.each(["draft", "canonical"] as const)(
    "anchors mixed replacement and insertion operations beside existing marks in %s presentation",
    (presentation) => {
      const canonical = [
        "**Bold** sample.",
        "*Italic* sample.",
        "~~Strike~~ sample.",
        "`Code` sample.",
        '<span underline="true">Underline</span> sample.',
        "[Link](https://example.test) sample.",
      ].join("\n");
      const draft = canonical
        .replace("**Bold**", "*Changed*")
        .replace("*Italic* sample.", "*Italic* sample. Extra.");
      const session = createSuggestionDraftSession({
        id: "mixed-marks",
        baseContent: canonical,
        baseRevision: "revision-one",
        startedAt: "now",
      });
      recordSuggestionReplacementIntent(session, {
        beforeText: "Bold",
        startOffset: canonical.indexOf("Bold"),
      });
      const operations = suggestionDraftOperations(session, draft);
      expect(operations.map((operation) => operation.kind)).toEqual([
        "replace_text",
        "insert_text",
      ]);

      const editor = createSuggestionEditor(
        presentation === "draft" ? draft : canonical,
      );
      const anchors =
        presentation === "draft"
          ? draftSuggestionAnchors(operations, draft)
          : operations.map((operation) => operation.anchor);
      try {
        const specs = operations.map((operation, index) =>
          suggestionHighlightSpec(editor.state.doc, {
            id: `mixed-${index}`,
            kind: operation.kind,
            beforeText: operation.before.changedText,
            afterText: operation.after.changedText,
            anchor: anchors[index]!,
            presentation,
          }),
        );
        expect(specs.every(Boolean)).toBe(true);
        if (presentation === "canonical") {
          const italicParagraphEnd =
            editor.state.doc.child(0).nodeSize +
            1 +
            editor.state.doc.child(1).content.size;
          expect(specs[1]).toMatchObject({
            kind: "insert",
            from: italicParagraphEnd,
          });
        }
      } finally {
        editor.destroy();
      }
    },
  );

  it("preserves zero-width source boundaries around paragraphs and hard breaks", () => {
    const specAt = (source: string, from: number) => {
      const editor = createSuggestionEditor(source);
      const spec = suggestionHighlightSpec(editor.state.doc, {
        id: `boundary-${from}`,
        kind: "insert_text",
        beforeText: "",
        afterText: "added",
        anchor: {
          from,
          prefix: source.slice(Math.max(0, from - 32), from),
          suffix: source.slice(from, from + 32),
        },
        presentation: "canonical",
      });
      return { editor, spec };
    };

    const paragraphSource = "First paragraph.\nSecond paragraph.";
    const beforeParagraph = specAt(
      paragraphSource,
      paragraphSource.indexOf("\n"),
    );
    const afterParagraph = specAt(
      paragraphSource,
      paragraphSource.indexOf("\n") + 1,
    );
    const hardBreakSource = "Ec<br>ho";
    const beforeHardBreak = specAt(
      hardBreakSource,
      hardBreakSource.indexOf("<br>"),
    );
    const afterHardBreak = specAt(
      hardBreakSource,
      hardBreakSource.indexOf("<br>") + "<br>".length,
    );
    try {
      expect(beforeParagraph.spec).toMatchObject({
        kind: "insert",
        from: 1 + beforeParagraph.editor.state.doc.child(0).content.size,
      });
      expect(afterParagraph.spec).toMatchObject({
        kind: "insert",
        from: afterParagraph.editor.state.doc.child(0).nodeSize + 1,
      });
      let hardBreakPosition = -1;
      beforeHardBreak.editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "hardBreak") hardBreakPosition = pos;
      });
      expect(hardBreakPosition).toBeGreaterThan(0);
      expect(beforeHardBreak.spec).toMatchObject({
        kind: "insert",
        from: hardBreakPosition,
      });
      expect(afterHardBreak.spec).toMatchObject({
        kind: "insert",
        from: hardBreakPosition + 1,
      });
    } finally {
      beforeParagraph.editor.destroy();
      afterParagraph.editor.destroy();
      beforeHardBreak.editor.destroy();
      afterHardBreak.editor.destroy();
    }
  });

  it.each([
    {
      name: "marked paragraphs",
      canonical: "**Bold** one.\n*Italic* two.",
    },
    {
      name: "marked hard break",
      canonical: "**Bold** one.<br>*Italic* two.",
    },
  ])(
    "anchors an actual selected replacement across $name in draft and canonical presentation",
    ({ canonical }) => {
      const sourceEditor = createMarkdownEditor(canonical);
      const session = createSuggestionDraftSession({
        id: "cross-structure",
        baseContent: canonical,
        baseRevision: "revision-one",
        startedAt: "now",
      });
      try {
        const from = 1;
        const to = sourceEditor.state.doc.content.size - 1;
        sourceEditor.commands.setTextSelection({ from, to });
        const transaction = sourceEditor.state.tr.insertText("Changed");
        const intent = suggestionReplacementIntentForTransaction(
          transaction,
          sourceEditor.state.selection,
        );
        expect(intent).not.toBeNull();
        expect(
          canonical.slice(
            intent!.startOffset,
            intent!.startOffset + intent!.beforeText.length,
          ),
        ).toBe(intent!.beforeText);
        recordSuggestionReplacementIntent(
          session,
          intent!,
          intent!.beforeMarkdown,
        );
        sourceEditor.view.dispatch(transaction);
        const draft = docToNfm(sourceEditor.state.doc.toJSON());
        const operations = suggestionDraftOperations(session, draft);
        expect(operations).toHaveLength(1);
        expect(operations[0]!.kind).toBe("replace_text");

        for (const presentation of ["draft", "canonical"] as const) {
          const editor = createSuggestionEditor(
            presentation === "draft" ? draft : canonical,
          );
          try {
            const anchor =
              presentation === "draft"
                ? draftSuggestionAnchors(operations, draft)[0]!
                : operations[0]!.anchor;
            expect(
              suggestionHighlightSpec(editor.state.doc, {
                id: `cross-structure-${presentation}`,
                kind: operations[0]!.kind,
                beforeText: operations[0]!.before.changedText,
                afterText: operations[0]!.after.changedText,
                anchor,
                presentation,
              }),
            ).not.toBeNull();
          } finally {
            editor.destroy();
          }
        }
      } finally {
        sourceEditor.destroy();
      }
    },
  );

  it("keeps an exact native replacement across a marked hard break and renders both sides bold", () => {
    const canonical = "**Prefix Upper**<br>**Lower suffix.**";
    const sourceEditor = createMarkdownEditor(canonical);
    const session = createSuggestionDraftSession({
      id: "marked-hardbreak-exact",
      baseContent: canonical,
      baseRevision: "revision-one",
      startedAt: "now",
    });
    try {
      sourceEditor.commands.setTextSelection({ from: 8, to: 19 });
      const transaction = sourceEditor.state.tr.insertText("Across");
      const intent = suggestionReplacementIntentForTransaction(
        transaction,
        sourceEditor.state.selection,
      );
      expect(intent).toMatchObject({
        beforeText: "Upper**<br>**Lower",
        afterText: "Across",
        startOffset: 9,
      });
      recordSuggestionReplacementIntent(
        session,
        intent!,
        intent!.beforeMarkdown,
      );
      sourceEditor.view.dispatch(transaction);
      const draft = docToNfm(sourceEditor.state.doc.toJSON());
      expect(draft).toBe("**Prefix Across suffix.**");
      const [operation] = suggestionDraftOperations(session, draft);
      expect(operation).toMatchObject({
        kind: "replace_text",
        before: { changedText: "Upper**<br>**Lower" },
        after: { changedText: "Across" },
        anchor: { from: 9, to: 27 },
      });

      for (const presentation of ["draft", "canonical"] as const) {
        const editor = createSuggestionEditor(
          presentation === "draft" ? draft : canonical,
        );
        try {
          const anchor =
            presentation === "draft"
              ? draftSuggestionAnchors([operation!], draft)[0]!
              : operation!.anchor;
          const spec = suggestionHighlightSpec(editor.state.doc, {
            id: `marked-hardbreak-${presentation}`,
            kind: operation!.kind,
            beforeText: operation!.before.changedText,
            afterText: operation!.after.changedText,
            beforePresentation: {
              source: operation!.before.markdown,
              from: operation!.anchor.from,
              to: operation!.anchor.to,
            },
            afterPresentation: {
              source: operation!.after.markdown,
              from: operation!.anchor.from,
              to: operation!.anchor.from + operation!.after.changedText.length,
            },
            anchor,
            presentation,
          });
          expect(spec).toMatchObject(
            presentation === "draft"
              ? { from: 8, to: 14, kind: "mark" }
              : { from: 8, to: 19, kind: "replace" },
          );
          setSuggestionHighlights(editor.view, { specs: [spec!] });
          if (presentation === "draft") {
            expect(
              editor.view.dom.querySelector(".suggestion-delete-widget")
                ?.textContent,
            ).toBe("Upper↵Lower");
            expect(
              editor.view.dom.querySelectorAll(
                ".suggestion-delete-widget strong",
              ),
            ).toHaveLength(2);
          } else {
            expect(
              editor.view.dom.querySelector(".suggestion-insert")?.textContent,
            ).toBe("Across");
            expect(
              editor.view.dom.querySelector(".suggestion-insert strong")
                ?.textContent,
            ).toBe("Across");
          }
          expect(editor.view.dom.textContent).not.toContain("**");
        } finally {
          editor.destroy();
        }
      }
    } finally {
      sourceEditor.destroy();
    }
  });

  it("keeps a registered native Tab indent visible on a marked replacement", () => {
    const canonical = [
      "***Changed*** sample.",
      "*Italic* sample.",
      '<span underline="true">Underline</span> sample.',
      "~~Strike~~ sample.",
      "`Code` sample.",
      "[Link](https://example.test) sample.",
      "**Prefix Across suffix.**",
    ].join("\n");
    const editor = createSuggestionEditor(canonical);
    const session = createSuggestionDraftSession({
      id: "native-indent-marked-replacement",
      baseContent: canonical,
      baseRevision: "one",
      startedAt: "now",
    });
    const find = (text: string) => {
      let found = -1;
      editor.state.doc.descendants((node, pos) => {
        if (found < 0 && node.isText && node.text?.includes(text))
          found = pos + node.text.indexOf(text);
      });
      return found;
    };
    try {
      const changed = find("Changed");
      editor.commands.setTextSelection({
        from: changed,
        to: changed + "Changed".length,
      });
      const transaction = editor.state.tr.insertText("Bright");
      const intent = suggestionReplacementIntentForTransaction(
        transaction,
        editor.state.selection,
      )!;
      recordSuggestionReplacementIntent(session, intent, intent.beforeMarkdown);
      editor.view.dispatch(transaction);
      const bright = find("Bright");
      editor.commands.setTextSelection({
        from: bright,
        to: bright + "Bright".length,
      });
      expect(editor.commands.toggleItalic()).toBe(true);
      expect(editor.commands.keyboardShortcut("Tab")).toBe(true);

      const draft = docToNfm(editor.getJSON() as any);
      const [operation] = suggestionDraftOperations(session, draft);
      expect(draft.startsWith("\t**Bright** sample.")).toBe(true);
      expect(operation).toMatchObject({
        before: { changedText: "***Changed***" },
        after: { changedText: "\t**Bright**" },
        anchor: { from: 0, to: 13 },
      });
      const context = {
        source: operation!.after.markdown,
        from: operation!.anchor.from,
        to: operation!.anchor.from + operation!.after.changedText.length,
      };
      expect(operation!.after.markdown.slice(context.from, context.to)).toBe(
        operation!.after.changedText,
      );
      expect(
        suggestionTextPresentationForSource(
          operation!.after.changedText,
          context,
        ),
      ).toMatchObject([
        { type: "indent", value: "⇥" },
        { type: "strong", children: [{ type: "text", value: "Bright" }] },
      ]);
      expect(
        suggestionFormattingSourceRange(
          context.source,
          context.from,
          context.to,
        ),
      ).toMatchObject({ from: 0, to: 6 });
      const anchor = draftSuggestionAnchors([operation!], draft)[0]!;
      expect(
        suggestionHighlightSpec(editor.state.doc, {
          id: "native-indent-marked-replacement",
          kind: operation!.kind,
          beforeText: operation!.before.changedText,
          afterText: operation!.after.changedText,
          beforePresentation: {
            source: operation!.before.markdown,
            from: operation!.anchor.from,
            to: operation!.anchor.to,
          },
          afterPresentation: context,
          anchor,
          presentation: "draft",
        }),
      ).not.toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it.each([
    ["Plain sample.", "Tab", "\tPlain sample.", "after", "paragraph"],
    ["\tPlain sample.", "Shift-Tab", "Plain sample.", "before", "paragraph"],
    ["# Plain heading", "Tab", "\t# Plain heading", "after", "heading"],
    ["\t# Plain heading", "Shift-Tab", "# Plain heading", "before", "heading"],
  ] as const)(
    "renders a registered native %s structural indent change for a %s",
    (canonical, shortcut, draft, comparisonSide, _blockType) => {
      const editor = createSuggestionEditor(canonical);
      try {
        editor.commands.setTextSelection(1);
        expect(editor.commands.keyboardShortcut(shortcut)).toBe(true);
        expect(docToNfm(editor.getJSON() as any)).toBe(draft);
        const [operation] = markdownSuggestionOperations(canonical, draft);
        const comparison = operation![comparisonSide];
        const to =
          comparisonSide === "before"
            ? operation!.anchor.to
            : operation!.anchor.from + comparison.changedText.length;
        expect(
          suggestionFormattingSourceSlice(
            comparison.markdown,
            operation!.anchor.from,
            to,
          ),
        ).toEqual([{ type: "indent", text: "⇥" }]);
        const draftAnchor = draftSuggestionAnchors([operation!], draft)[0]!;
        const spec = suggestionHighlightSpec(editor.state.doc, {
          id: `native-${shortcut}-${comparisonSide}`,
          kind: operation!.kind,
          beforeText: operation!.before.changedText,
          afterText: operation!.after.changedText,
          beforePresentation: {
            source: operation!.before.markdown,
            from: operation!.anchor.from,
            to: operation!.anchor.to,
          },
          afterPresentation: {
            source: operation!.after.markdown,
            from: draftAnchor.from,
            to: draftAnchor.from + operation!.after.changedText.length,
          },
          anchor: draftAnchor,
          presentation: "draft",
        });
        expect(spec).toMatchObject({
          kind: shortcut === "Tab" ? "insert" : "delete",
        });
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        expect(
          editor.view.dom.querySelector(
            `[data-suggestion-id="native-${shortcut}-${comparisonSide}"]`,
          )?.textContent,
        ).toBe("⇥");
      } finally {
        editor.destroy();
      }
    },
  );

  it("uses the registered Tab indent for a marked heading replacement", () => {
    const canonical = "# ***Changed*** heading";
    const editor = createSuggestionEditor(canonical);
    const session = createSuggestionDraftSession({
      id: "native-heading-indent",
      baseContent: canonical,
      baseRevision: "one",
      startedAt: "now",
    });
    try {
      editor.commands.setTextSelection({ from: 1, to: 8 });
      const transaction = editor.state.tr.insertText("Bright");
      const intent = suggestionReplacementIntentForTransaction(
        transaction,
        editor.state.selection,
      )!;
      recordSuggestionReplacementIntent(session, intent, intent.beforeMarkdown);
      editor.view.dispatch(transaction);
      editor.commands.setTextSelection({ from: 1, to: 7 });
      expect(editor.commands.toggleItalic()).toBe(true);
      expect(editor.commands.keyboardShortcut("Tab")).toBe(true);
      const draft = docToNfm(editor.getJSON() as any);
      expect(draft).toBe("\t# **Bright** heading");
      const operations = suggestionDraftOperations(session, draft);
      expect(operations).toHaveLength(2);
      const presentations = operations.map((operation) =>
        suggestionTextPresentationForSource(operation.after.changedText, {
          source: operation.after.markdown,
          from: operation.anchor.from,
          to: operation.anchor.from + operation.after.changedText.length,
        }),
      );
      expect(presentations).toContainEqual([{ type: "indent", value: "⇥" }]);
      expect(presentations).toContainEqual([
        { type: "strong", children: [{ type: "text", value: "Bright" }] },
      ]);
      for (const presentation of presentations) {
        expect(presentation).not.toBeNull();
      }
    } finally {
      editor.destroy();
    }
  });

  it("fails closed when a suggestion presentation context is stale", () => {
    const editor = createSuggestionEditor("**Echo**");
    try {
      expect(
        suggestionHighlightSpec(editor.state.doc, {
          id: "stale-presentation",
          kind: "replace_text",
          beforeText: "Echo",
          afterText: "Other",
          beforePresentation: {
            source: "**Different**",
            from: 2,
            to: 6,
          },
          anchor: { from: 2, prefix: "**", suffix: "**" },
          presentation: "canonical",
        }),
      ).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it.each([
    {
      name: "replacement inside bold text",
      canonical: "**Bold** sample.",
      draft: "**Build** sample.",
      beforeText: "ol",
      afterText: "uil",
      canonicalFrom: 3,
      draftFrom: 3,
      kind: "replace_text",
    },
    {
      name: "deletion inside bold text",
      canonical: "**Bold** sample.",
      draft: "**Bd** sample.",
      beforeText: "ol",
      afterText: "",
      canonicalFrom: 3,
      draftFrom: 3,
      kind: "delete_text",
    },
    {
      name: "insertion inside bold text",
      canonical: "**Bold** sample.",
      draft: "**Bo!ld** sample.",
      beforeText: "",
      afterText: "!",
      canonicalFrom: 4,
      draftFrom: 4,
      kind: "insert_text",
    },
    {
      name: "replacement in the second repeated marked word",
      canonical: "**Echo** and **Echo**",
      draft: "**Echo** and **EOHo**",
      beforeText: "ch",
      afterText: "OH",
      canonicalFrom: 16,
      draftFrom: 16,
      kind: "replace_text",
    },
    {
      name: "replacement of escaped marked text",
      canonical: "**A\\*B**",
      draft: "**AxB**",
      beforeText: "\\*",
      afterText: "x",
      canonicalFrom: 3,
      draftFrom: 3,
      kind: "replace_text",
    },
    {
      name: "replacement of inline-code punctuation",
      canonical: "``a`b``",
      draft: "`axb`",
      beforeText: "`",
      afterText: "x",
      canonicalFrom: 3,
      draftFrom: 2,
      kind: "replace_text",
    },
    {
      name: "replacement in link text that also occurs in its href",
      canonical: "[same](https://same.test) sample.",
      draft: "[sOMe](https://same.test) sample.",
      beforeText: "am",
      afterText: "OM",
      canonicalFrom: 2,
      draftFrom: 2,
      kind: "replace_text",
    },
  ])(
    "anchors a source-exact $name in draft and canonical presentation",
    ({
      canonical,
      draft,
      beforeText,
      afterText,
      canonicalFrom,
      draftFrom,
      kind,
    }) => {
      for (const presentation of ["draft", "canonical"] as const) {
        const source = presentation === "draft" ? draft : canonical;
        const from = presentation === "draft" ? draftFrom : canonicalFrom;
        const quote = presentation === "draft" ? afterText : beforeText;
        const editor = createSuggestionEditor(source);
        try {
          expect(
            suggestionHighlightSpec(editor.state.doc, {
              id: `inside-mark-${presentation}`,
              kind: kind as VisualEditorSuggestion["kind"],
              beforeText,
              afterText,
              anchor: {
                from,
                prefix: source.slice(Math.max(0, from - 32), from),
                suffix: source.slice(
                  from + quote.length,
                  from + quote.length + 32,
                ),
              },
              presentation,
            }),
          ).not.toBeNull();
        } finally {
          editor.destroy();
        }
      }
    },
  );

  it.each(["draft", "canonical"] as const)(
    "makes a %s paragraph-break deletion visible",
    (presentation) => {
      const editor = createSuggestionEditor(
        presentation === "draft" ? "First.Second." : "First.\nSecond.",
      );
      try {
        const spec = suggestionHighlightSpec(editor.state.doc, {
          id: "paragraph-break",
          kind: "delete_text",
          beforeText: "\n",
          afterText: "",
          anchor: { from: 6, prefix: "First.", suffix: "Second." },
          presentation,
        });
        expect(spec).not.toBeNull();
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        expect(
          editor.view.dom.querySelector(".suggestion-delete-widget")
            ?.textContent,
        ).toBe("↵");
        expect(editor.state.doc.childCount).toBe(
          presentation === "draft" ? 1 : 2,
        );
      } finally {
        editor.destroy();
      }
    },
  );
  it("shows the deleted document at the remaining empty paragraph", () => {
    const editor = createSuggestionEditor("");
    try {
      const spec = suggestionHighlightSpec(editor.state.doc, {
        id: "all",
        kind: "delete_text",
        beforeText: "Whole document",
        afterText: "",
        anchor: { from: 0, prefix: "", suffix: "" },
        presentation: "draft",
      });
      expect(spec).not.toBeNull();
      setSuggestionHighlights(editor.view, { specs: [spec!] });
      expect(
        editor.view.dom.querySelector(".suggestion-delete-widget")?.textContent,
      ).toBe("Whole document");
      expect(editor.state.doc.textContent).toBe("");
    } finally {
      editor.destroy();
    }
  });
});

function waitForDeferredCallback() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("placeholder ancestry", () => {
  it("clamps stale collaborative positions to the live document", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Short paragraph</p>",
    });
    try {
      expect(() => hasAncestorType(editor, 180, "blockquote")).not.toThrow();
      expect(hasAncestorType(editor, 180, "blockquote")).toBe(false);
      expect(() => hasAncestorType(editor, -180, "blockquote")).not.toThrow();
    } finally {
      editor.destroy();
    }
  });
});

describe("collaborative update persistence", () => {
  it("does not let an unfocused normalization borrow recent user intent", () => {
    expect(
      isUserInitiatedCollaborativeEditorUpdate({
        editorFocused: false,
        explicitUserEdit: false,
        recentUserEditIntent: true,
        transactionUiEvent: undefined,
      }),
    ).toBe(false);
  });

  it("keeps exact transaction provenance and focused intent persistable", () => {
    expect(
      isUserInitiatedCollaborativeEditorUpdate({
        editorFocused: false,
        explicitUserEdit: true,
        recentUserEditIntent: false,
        transactionUiEvent: undefined,
      }),
    ).toBe(true);
    expect(
      isUserInitiatedCollaborativeEditorUpdate({
        editorFocused: false,
        explicitUserEdit: false,
        recentUserEditIntent: false,
        transactionUiEvent: "input",
      }),
    ).toBe(true);
    expect(
      isUserInitiatedCollaborativeEditorUpdate({
        editorFocused: true,
        explicitUserEdit: false,
        recentUserEditIntent: true,
        transactionUiEvent: undefined,
      }),
    ).toBe(true);
  });

  it("rejects unfocused normalization without user intent", () => {
    expect(
      shouldPersistCollaborativeEditorUpdate({
        collab: true,
        editorFocused: false,
        userInitiated: false,
      }),
    ).toBe(false);
  });

  it("keeps focused commands and explicit user edits persistable", () => {
    expect(
      shouldPersistCollaborativeEditorUpdate({
        collab: true,
        editorFocused: true,
        userInitiated: false,
      }),
    ).toBe(true);
    expect(
      shouldPersistCollaborativeEditorUpdate({
        collab: true,
        editorFocused: false,
        userInitiated: true,
      }),
    ).toBe(true);
  });

  it("does not change non-collaborative persistence", () => {
    expect(
      shouldPersistCollaborativeEditorUpdate({
        collab: false,
        editorFocused: false,
        userInitiated: false,
      }),
    ).toBe(true);
  });
});

describe("slash image picker lifecycle", () => {
  const request = {
    pickerId: "image-picker-test",
    position: 0,
    attrs: { src: null, alt: "", uploadId: "image-picker-test" },
  };

  it("recreates a pending image after collaboration removes its placeholder", () => {
    const editor = createFullEditor();
    try {
      expect(
        ensurePendingImageUpload(editor.view, request, "image-upload-test"),
      ).toBe(true);
      const image = editor
        .getJSON()
        .content?.find((node) => node.type === "image");
      expect(image?.attrs).toMatchObject({
        src: null,
        uploadId: "image-upload-test",
      });
    } finally {
      editor.destroy();
    }
  });

  it("commits the rendered image even if the pending node is reconciled away", () => {
    const editor = createFullEditor();
    try {
      expect(
        commitPendingImageUpload(editor.view, request, "image-upload-test", {
          src: "https://cdn.example.com/diagram.png",
          uploadId: null,
        }),
      ).toBe(true);
      const image = editor
        .getJSON()
        .content?.find((node) => node.type === "image");
      expect(image?.attrs).toMatchObject({
        src: "https://cdn.example.com/diagram.png",
        uploadId: null,
      });
    } finally {
      editor.destroy();
    }
  });

  it("keeps the existing pending node identifiable until render validation completes", () => {
    const editor = createFullEditor();
    try {
      editor.commands.setContent({
        type: "doc",
        content: [{ type: "image", attrs: request.attrs }],
      });
      expect(
        ensurePendingImageUpload(editor.view, request, "image-upload-test"),
      ).toBe(true);
      expect(
        commitPendingImageUpload(editor.view, request, "image-upload-test", {
          src: "https://cdn.example.com/diagram.svg",
          uploadId: "image-upload-test",
        }),
      ).toBe(true);
      expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({
        src: "https://cdn.example.com/diagram.svg",
        uploadId: "image-upload-test",
      });

      expect(
        commitPendingImageUpload(editor.view, request, "image-upload-test", {
          src: "https://cdn.example.com/diagram.svg",
          uploadId: null,
        }),
      ).toBe(true);
      expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({
        src: "https://cdn.example.com/diagram.svg",
        uploadId: null,
      });
    } finally {
      editor.destroy();
    }
  });

  it("restores a usable empty image when the native picker is cancelled", () => {
    const editor = createFullEditor();
    try {
      expect(restorePendingImagePicker(editor.view, request)).toBe(true);
      const image = editor
        .getJSON()
        .content?.find((node) => node.type === "image");
      expect(image?.attrs).toMatchObject({ src: null, uploadId: null });
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    } finally {
      editor.destroy();
    }
  });

  it("removes a staged source when the committed image cannot render", () => {
    const editor = createFullEditor();
    try {
      editor.commands.setContent({
        type: "doc",
        content: [{ type: "image", attrs: request.attrs }],
      });
      expect(
        ensurePendingImageUpload(editor.view, request, "image-upload-test"),
      ).toBe(true);
      expect(
        commitPendingImageUpload(editor.view, request, "image-upload-test", {
          src: "https://cdn.example.com/broken.svg",
          uploadId: "image-upload-test",
        }),
      ).toBe(true);
      expect(
        restorePendingImagePicker(editor.view, request, "image-upload-test"),
      ).toBe(true);
      const image = editor
        .getJSON()
        .content?.find((node) => node.type === "image");
      expect(image?.attrs).toMatchObject({ src: null, uploadId: null });
      expect(
        editor.getJSON().content?.filter((node) => node.type === "image"),
      ).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });
});

describe("media draft persistence", () => {
  it("denies stale media side effects in Suggesting and retains ordinary callbacks", () => {
    const sideEffect = vi.fn();

    expect(runIfMediaCreationAllowed(true, sideEffect)).toBe(false);
    expect(sideEffect).not.toHaveBeenCalled();
    expect(runIfMediaCreationAllowed(false, sideEffect)).toBe(true);
    expect(sideEffect).toHaveBeenCalledTimes(1);
  });

  it("detects a media source enrichment but not unrelated media movement", () => {
    const editor = createFullEditor();
    const transactions: Transaction[] = [];
    editor.on("transaction", ({ transaction }) =>
      transactions.push(transaction),
    );

    try {
      editor.commands.setContent({
        type: "doc",
        content: [{ type: "video", attrs: { src: null } }],
      });
      editor.commands.setNodeSelection(0);
      transactions.length = 0;

      editor.commands.updateAttributes("video", {
        src: "https://cdn.example.com/flower.mp4",
      });
      expect(transactions.some(didCommitMediaSource)).toBe(true);

      transactions.length = 0;
      const paragraph = editor.schema.nodes.paragraph.create(
        null,
        editor.schema.text("Before media"),
      );
      editor.view.dispatch(editor.state.tr.insert(0, paragraph));
      expect(transactions.some(didCommitMediaSource)).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  it.each([
    ["image", "https://cdn.example.com/birds.png"],
    ["video", "https://cdn.example.com/flower.mp4"],
  ] as const)(
    "suppresses the slash %s placeholder commit until its source is set",
    (type, src) => {
      const editor = createFullEditor();
      const persisted: string[] = [];
      const querySelectorAll = (element: Element, selector: string) =>
        Element.prototype.querySelectorAll.call(element, selector);
      const querySelectorAllSpy = vi
        .spyOn(Element.prototype, "querySelectorAll")
        .mockImplementation(function (this: Element, selector: string) {
          try {
            return querySelectorAll(this, selector);
          } catch {
            const matches = selector.split(",").flatMap((part) => {
              try {
                return Array.from(querySelectorAll(this, part));
              } catch {
                return [];
              }
            });
            return matches as unknown as NodeListOf<Element>;
          }
        });
      const persistDraft = () => {
        const draft = serializeEditorDraftForPersistence(editor);
        if (draft !== null) persisted.push(draft);
      };

      try {
        document.body.appendChild(editor.view.dom);
        editor.commands.insertContent("/");
        editor.commands.setTextSelection(2);
        editor.commands.deleteRange({ from: 1, to: 2 });
        insertMediaPlaceholder(editor, type);

        if (type === "video") {
          const video = editor
            .getJSON()
            .content?.find((node) => node.type === "video");
          expect(video?.attrs?.sourcePanelOpen).toBe(true);
        }
        if (type === "image") {
          const image = editor
            .getJSON()
            .content?.find((node) => node.type === "image");
          expect(image?.attrs?.uploadId).toMatch(/^image-picker-/);
        }

        persistDraft();
        expect(persisted).toEqual([]);

        editor.commands.updateAttributes(type, { src, uploadId: null });
        persistDraft();

        expect(persisted).toHaveLength(1);
        expect(persisted[0]).toContain(src);
      } finally {
        querySelectorAllSpy.mockRestore();
        editor.view.dom.remove();
        editor.destroy();
      }
    },
  );

  it("holds a selected empty media placeholder until it has a source", () => {
    const editor = createFullEditor();

    try {
      editor.commands.setContent({
        type: "doc",
        content: [{ type: "image", attrs: { src: null, alt: "" } }],
      });
      editor.commands.setNodeSelection(0);

      expect(shouldSkipMediaDraftPersistence(editor)).toBe(true);
      expect(serializeEditorDraftForPersistence(editor)).toBeNull();

      editor.commands.updateAttributes("image", {
        src: "https://cdn.example.com/diagram.png",
      });
      expect(shouldSkipMediaDraftPersistence(editor)).toBe(false);
      expect(serializeEditorDraftForPersistence(editor)).toBe(
        "![](https://cdn.example.com/diagram.png)",
      );
    } finally {
      editor.destroy();
    }
  });

  it("holds pending drop and paste uploads even when selection moved", () => {
    const editor = createFullEditor();

    try {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "video",
            attrs: { src: null, uploadId: "video-upload-test" },
          },
          { type: "paragraph", content: [{ type: "text", text: "After" }] },
        ],
      });
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);

      expect(shouldSkipMediaDraftPersistence(editor)).toBe(true);

      editor.commands.setNodeSelection(0);
      editor.commands.updateAttributes("video", {
        src: "https://cdn.example.com/demo.mp4",
        uploadId: null,
      });
      expect(shouldSkipMediaDraftPersistence(editor)).toBe(false);
    } finally {
      editor.destroy();
    }
  });
});

function triggerTextInput(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  let handled = false;

  editor.view.someProp("handleTextInput", (handler: any) => {
    if (handled) return true;
    handled = handler(editor.view, from, to, text) === true;
    return handled;
  });

  if (!handled) {
    insertPlainText(editor, text);
  }

  return handled;
}

function triggerKeyDown(editor: Editor, key: string) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  let handled = false;

  editor.view.someProp("handleKeyDown", (handler: any) => {
    if (handled) return true;
    handled = handler(editor.view, event) === true;
    return handled;
  });

  return handled;
}

function insertPlainText(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VisualEditor markdown round-tripping", () => {
  it("renders recent edits as presence markers instead of range boxes", () => {
    const marker = getRecentEditPresenceMarkerRect(
      new DOMRect(120, 240, 680, 22),
    );

    expect(marker.left).toBe(120);
    expect(marker.top).toBe(240);
    expect(marker.width).toBe(2);
    expect(marker.height).toBe(22);
  });

  it("keeps recent edit markers visible for collapsed caret coordinates", () => {
    const marker = getRecentEditPresenceMarkerRect(new DOMRect(120, 240, 0, 0));

    expect(marker.width).toBe(2);
    expect(marker.height).toBe(18);
  });

  it("preserves intentional empty paragraphs through the real TipTap serializer", () => {
    const editor = createMarkdownEditor("A\n<empty-block/>\n<empty-block/>\nB");

    try {
      const markdown = (editor.storage as any).markdown.getMarkdown();
      const stored = serializeEditorToNfm(markdown);
      expect(stored).toBe("A\n<empty-block/>\n<empty-block/>\nB");
    } finally {
      editor.destroy();
    }
  });

  it("does not parse Notion-pulled indented bullets as a code block", () => {
    const editor = createMarkdownEditor(
      [
        "michael onboarding",
        "\t- notion doc",
        "\t- access: amplitude, fullstory, sigma, jira",
      ].join("\n"),
    );

    try {
      const json = editor.getJSON();
      expect(JSON.stringify(json)).not.toContain('"codeBlock"');
      expect(JSON.stringify(json)).toContain('"bulletList"');
    } finally {
      editor.destroy();
    }
  });

  it("renders markdown table header cells as plain table cells", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "A" }],
                      },
                    ],
                  },
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "B" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "1" }],
                      },
                    ],
                  },
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "2" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      expect(editor.view.dom.querySelectorAll("th")).toHaveLength(0);
      expect(editor.view.dom.querySelectorAll("td")).toHaveLength(4);
    } finally {
      editor.destroy();
    }
  });

  it("round-trips a newly inserted empty table through canonical NFM", () => {
    const editor = createFullEditor();

    try {
      expect(
        editor.commands.insertTable({
          rows: 3,
          cols: 3,
          withHeaderRow: false,
        }),
      ).toBe(true);
      const markdown = docToNfm(editor.getJSON() as any);

      expect(markdown).toContain("<table>");
      expect(markdown.match(/<tr>/g)).toHaveLength(3);
      expect(markdown.match(/<td><\/td>/g)).toHaveLength(9);

      const restored = nfmToDoc(markdown);
      const table = restored.content.find((node) => node.type === "table");
      expect(table).toBeDefined();
      expect(table?.content).toHaveLength(3);
      expect(table?.content?.flatMap((row) => row.content ?? [])).toHaveLength(
        9,
      );
    } finally {
      editor.destroy();
    }
  });

  it("normalizes table header cells to the first row and first column only", async () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const table = editor.getJSON().content?.[0] as any;
      const rows = table?.content ?? [];
      expect(rows[0].content?.map((cell: any) => cell.type)).toEqual([
        "tableHeader",
        "tableHeader",
      ]);
      expect(rows[1].content?.map((cell: any) => cell.type)).toEqual([
        "tableHeader",
        "tableCell",
      ]);
      expect(rows[2].content?.map((cell: any) => cell.type)).toEqual([
        "tableHeader",
        "tableCell",
      ]);
      expect(
        editor.view.dom.querySelectorAll(".notion-table-header-cell"),
      ).toHaveLength(4);
    } finally {
      editor.destroy();
    }
  });

  it("renders Notion-pulled plain indents as visual indentation, not blockquotes", () => {
    const editor = createMarkdownEditor(
      ["Deck", "\tpublish vs Fusion discussion topic"].join("\n"),
    );

    try {
      const json = editor.getJSON();
      expect(JSON.stringify(json)).not.toContain('"blockquote"');
      expect(JSON.stringify(json)).toContain(
        `${VISUAL_INDENT}publish vs Fusion discussion topic`,
      );
    } finally {
      editor.destroy();
    }
  });

  it("preserves toggles, bullets, dividers, and following paragraphs", () => {
    const editor = createMarkdownEditor(
      [
        "NOW",
        "",
        "→ brent/josh needs",
        "",
        "→ → work for Milos and Nicholas - make clip",
        "",
        "<details>",
        "<summary>→ → team mtg guidance on hackathon</summary>",
        "</details>",
        "",
        "Let people test creating apps, creating agents, editing apps",
        "",
        "- Make sure works",
        "- Give some docs and guidance",
        '- Get some people testing tmrw (post in general "for brave souls")',
        "- Make sure the agent is good at telling you what makes sense and doesn't",
        "",
        "---",
        "",
        "make sure everyone has access to dispatch",
      ].join("\n"),
    );

    try {
      const json = editor.getJSON();
      const markdown = (editor.storage as any).markdown.getMarkdown();
      const stored = serializeEditorToNfm(markdown);

      expect(JSON.stringify(json)).toContain('"notionToggle"');
      expect(JSON.stringify(json)).toContain('"bulletList"');
      expect(JSON.stringify(json)).toContain('"horizontalRule"');
      expect(stored).toContain("<details>");
      expect(stored).toContain(
        "<summary>→ → team mtg guidance on hackathon</summary>",
      );
      expect(stored).toContain("</details>");
      expect(stored).toContain("- Make sure works");
      expect(stored).toContain("---\n\nmake sure everyone has access");
    } finally {
      editor.destroy();
    }
  });

  it("renders indented Notion toggle blocks as toggles instead of code", () => {
    const editor = createMarkdownEditor(
      [
        "Skill functionality",
        "\t<details>",
        "\t<summary>agents doing</summary>",
        "\t</details>",
        "Framework share skills across apps",
      ].join("\n"),
    );

    try {
      const json = editor.getJSON();
      const serializedJson = JSON.stringify(json);
      const markdown = (editor.storage as any).markdown.getMarkdown();
      const stored = serializeEditorToNfm(markdown);

      expect(serializedJson).toContain('"notionToggle"');
      expect(serializedJson).not.toContain('"codeBlock"');
      expect(json.content?.[1]?.attrs?.summary).toBe("agents doing");
      expect(json.content?.[1]?.attrs?.indent).toBe(1);
      expect(stored).toContain("\t<details>");
      expect(stored).toContain("\t<summary>agents doing</summary>");
      expect(stored).not.toContain("```");
    } finally {
      editor.destroy();
    }
  });

  it("serializes resized images with a persisted width attribute", () => {
    const editor = createFullEditor();

    try {
      editor
        .chain()
        .setContent({
          type: "doc",
          content: [
            {
              type: "image",
              attrs: {
                src: "https://example.com/diagram.png",
                alt: "Architecture diagram",
                width: 420,
              },
            },
          ],
        })
        .run();

      const markdown = (editor.storage as any).markdown.getMarkdown();
      expect(markdown).toContain(
        '<img src="https://example.com/diagram.png" alt="Architecture diagram" width="420" />',
      );
    } finally {
      editor.destroy();
    }
  });

  it("serializes resized videos with a persisted width attribute", () => {
    const editor = createFullEditor();

    try {
      editor
        .chain()
        .setContent({
          type: "doc",
          content: [
            {
              type: "video",
              attrs: {
                src: "https://example.com/demo.mp4",
                width: 640,
              },
            },
          ],
        })
        .run();

      const markdown = (editor.storage as any).markdown.getMarkdown();
      expect(markdown).toContain(
        '<video src="https://example.com/demo.mp4" controls width="640"></video>',
      );
    } finally {
      editor.destroy();
    }
  });

  it("serializes resized audio with a persisted width attribute", () => {
    const editor = createFullEditor();

    try {
      editor
        .chain()
        .setContent({
          type: "doc",
          content: [
            {
              type: "audio",
              attrs: {
                src: "https://example.com/demo.mp3",
                width: 420,
              },
            },
          ],
        })
        .run();

      const markdown = (editor.storage as any).markdown.getMarkdown();
      expect(markdown).toContain(
        '<audio src="https://example.com/demo.mp3" controls width="420"></audio>',
      );
    } finally {
      editor.destroy();
    }
  });

  it("optimistically inserts a pending image block before upload resolves", async () => {
    const editor = createFullEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchCtx: { resolve: any } = { resolve: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            fetchCtx.resolve = resolve;
          }),
      ),
    );

    try {
      document.body.append(editor.view.dom);
      const file = new File(["image-bytes"], "diagram.png", {
        type: "image/png",
      });
      const uploadPromise = uploadAndInsertImageFiles(editor.view, [file], 1);

      let json = editor.getJSON();
      let imageNode = json.content?.find((node) => node.type === "image");
      expect(imageNode?.attrs?.src).toBeNull();
      expect(imageNode?.attrs?.uploadId).toMatch(/^image-upload-/);

      fetchCtx.resolve?.({
        ok: true,
        status: 201,
        json: async () => ({ url: "https://cdn.example.com/diagram.png" }),
      });
      await uploadPromise;

      json = editor.getJSON();
      imageNode = json.content?.find((node) => node.type === "image");
      expect(imageNode?.attrs?.src).toBe("https://cdn.example.com/diagram.png");
      expect(imageNode?.attrs?.uploadId).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("optimistically inserts a pending video block before upload resolves", async () => {
    const editor = createFullEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchCtx: { resolve: any } = { resolve: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            fetchCtx.resolve = resolve;
          }),
      ),
    );

    try {
      document.body.append(editor.view.dom);
      const file = new File(["video-bytes"], "demo.mp4", {
        type: "video/mp4",
      });
      const uploadPromise = uploadAndInsertVideoFiles(editor.view, [file], 1);

      let json = editor.getJSON();
      let videoNode = json.content?.find((node) => node.type === "video");
      expect(videoNode?.attrs?.src).toBeNull();
      expect(videoNode?.attrs?.uploadId).toMatch(/^video-upload-/);

      fetchCtx.resolve?.({
        ok: true,
        status: 201,
        json: async () => ({ url: "https://cdn.example.com/demo.mp4" }),
      });
      await uploadPromise;

      json = editor.getJSON();
      videoNode = json.content?.find((node) => node.type === "video");
      expect(videoNode?.attrs?.src).toBe("https://cdn.example.com/demo.mp4");
      expect(videoNode?.attrs?.uploadId).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("optimistically inserts a pending audio block before upload resolves", async () => {
    const editor = createFullEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchCtx: { resolve: any } = { resolve: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            fetchCtx.resolve = resolve;
          }),
      ),
    );

    try {
      document.body.append(editor.view.dom);
      const file = new File(["audio-bytes"], "demo.mp3", {
        type: "audio/mpeg",
      });
      const uploadPromise = uploadAndInsertAudioFiles(editor.view, [file], 1);

      let json = editor.getJSON();
      let audioNode = json.content?.find((node) => node.type === "audio");
      expect(audioNode?.attrs?.src).toBeNull();
      expect(audioNode?.attrs?.uploadId).toMatch(/^audio-upload-/);

      fetchCtx.resolve?.({
        ok: true,
        status: 201,
        json: async () => ({ url: "https://cdn.example.com/demo.mp3" }),
      });
      await uploadPromise;

      json = editor.getJSON();
      audioNode = json.content?.find((node) => node.type === "audio");
      expect(audioNode?.attrs?.src).toBe("https://cdn.example.com/demo.mp3");
      expect(audioNode?.attrs?.uploadId).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("creates a collaborative empty doc without recursive block filling", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const schema = getSchema(
      createVisualEditorExtensions({
        ydoc,
        localAwareness: awareness,
        user: { name: "Test User", color: "#60a5fa" },
      }),
    );

    try {
      const blockTypes = Object.values(schema.nodes)
        .filter((nodeType) => nodeType.spec.group === "block")
        .map((nodeType) => nodeType.name);

      expect(blockTypes[0]).toBe("paragraph");
      expect(schema.topNodeType.createAndFill()?.type.name).toBe("doc");
    } finally {
      awareness.destroy();
      ydoc.destroy();
    }
  });

  it("seeds saved SQL content over a semantically empty collab fragment", () => {
    expect(
      shouldSeedCollaborativeContent({
        content: "Saved body",
        currentMarkdown: "<empty-block/>",
        fragmentLength: 1,
      }),
    ).toBe(true);
    expect(
      shouldSeedCollaborativeContent({
        content: "Saved body",
        currentMarkdown: "Live body",
        fragmentLength: 1,
      }),
    ).toBe(false);
    expect(
      shouldSeedCollaborativeContent({
        content: "",
        currentMarkdown: "",
        fragmentLength: 1,
      }),
    ).toBe(false);
  });

  it("hydrates a zero-child collaborative Toggle without an invalid TextSelection warning", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root = createRoot(container);
    const ydoc = new Y.Doc();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const content = [
      "<details open>",
      "<summary>Parent</summary>",
      "</details>",
      "",
      "After",
    ].join("\n");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderEditor = () =>
      createElement(
        MemoryRouter,
        null,
        createElement(
          TooltipProviderWithoutChildren,
          { delayDuration: 0 },
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(VisualEditor, {
              content,
              contentUpdatedAt: "2026-08-14T12:00:00.000Z",
              onChange: () => {},
              ydoc,
              collabSynced: true,
              editable: true,
            }),
          ),
        ),
      );

    try {
      act(() => root.render(renderEditor()));
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      act(() => root.unmount());
      root = createRoot(container);

      act(() => root.render(renderEditor()));
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

      expect(
        warning.mock.calls.some((args) =>
          args.some((arg) =>
            String(arg).includes(
              "TextSelection endpoint not pointing into a node with inline content",
            ),
          ),
        ),
      ).toBe(false);
      expect(
        container.querySelector<HTMLInputElement>(".notion-toggle__summary")
          ?.value,
      ).toBe("Parent");
    } finally {
      await act(async () => root.unmount());
      warning.mockRestore();
      queryClient.clear();
      ydoc.destroy();
      container.remove();
    }
  });

  it("keeps adjacent NFM blocks separate in collaborative external reconciles", () => {
    const editor = createFullEditor();
    const incoming = [
      "→ → slack questions",
      '\tmuch simpler "what"',
      "\twhat is it and how different from other app builders",
      "\twhen to engage prospects",
    ].join("\n");

    try {
      const parsed = parseNfmForCollabReconcile(editor, incoming);

      expect(parsed).not.toBeNull();
      expect(parsed?.childCount).toBe(4);
      expect(
        Array.from(
          { length: parsed?.childCount ?? 0 },
          (_, index) => parsed?.child(index).textContent,
        ),
      ).toEqual([
        "→ → slack questions",
        'much simpler "what"',
        "what is it and how different from other app builders",
        "when to engage prospects",
      ]);
    } finally {
      editor.destroy();
    }
  });

  it("uses the NFM parser when a newer SQL snapshot reconciles into a live Y.Doc", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root = createRoot(container);
    const ydoc = new Y.Doc();
    const incoming = [
      "→ → slack questions",
      '\tmuch simpler "what"',
      "\twhat is it and how different from other app builders",
      "\twhen to engage prospects",
    ].join("\n");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const emitted: string[] = [];
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const renderEditor = (content: string, contentUpdatedAt: string) =>
      createElement(
        MemoryRouter,
        null,
        createElement(
          TooltipProviderWithoutChildren,
          { delayDuration: 0 },
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(VisualEditor, {
              content,
              contentUpdatedAt,
              onChange: (markdown) => emitted.push(markdown),
              ydoc,
              collabSynced: true,
              editable: true,
            }),
          ),
        ),
      );

    const editorParagraphs = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(".notion-editor > p"),
        (node) => node.textContent,
      );
    // The seed → reconcile handoff inside useCollabReconcile is a chain of
    // real (unfaked) setTimeout hops — never a fixed number of React ticks —
    // so its wall-clock latency has no tight upper bound under load. Poll for
    // the DOM it actually produces instead of sleeping a guessed duration:
    // that keeps this fast when the machine is idle and merely patient (never
    // silently wrong) when it is not. Confirmed against this exact test with
    // an artificially widened reconcile retry interval: with a blind sleep it
    // fails on stale content; with this poll it converges to the right
    // content every time, proving the reconcile itself is not racy — only a
    // fixed sleep waiting on it was.
    const waitForParagraphs = (expected: string[]) =>
      vi.waitFor(
        () => {
          expect(editorParagraphs()).toEqual(expected);
        },
        { timeout: 5000, interval: 20 },
      );

    try {
      // Match a real reload after an external version was previously live: seed
      // the persisted Y.Doc through the actual VisualEditor, unmount the page,
      // then mount a fresh editor whose SQL snapshot points somewhere else.
      act(() => {
        root.render(renderEditor(incoming, "2026-07-09T19:59:59.000Z"));
      });
      await act(() =>
        waitForParagraphs([
          "→ → slack questions",
          'much simpler "what"',
          "what is it and how different from other app builders",
          "when to engage prospects",
        ]),
      );
      act(() => root.unmount());
      root = createRoot(container);

      act(() => {
        root.render(
          renderEditor("Initial local block", "2026-07-09T20:00:00.000Z"),
        );
      });
      await act(() => waitForParagraphs(["Initial local block"]));

      act(() => {
        root.render(renderEditor(incoming, "2026-07-09T20:00:01.000Z"));
      });
      await act(() =>
        waitForParagraphs([
          "→ → slack questions",
          'much simpler "what"',
          "what is it and how different from other app builders",
          "when to engage prospects",
        ]),
      );
      expect(emitted).not.toContain("<empty-block/>");
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      ydoc.destroy();
      container.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });

  it("renders fifth- and sixth-level headings in the collaborative editor", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const ydoc = new Y.Doc();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    try {
      act(() => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              TooltipProvider,
              null,
              createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(VisualEditor, {
                  content: "##### Verification note\n###### Final edge",
                  contentUpdatedAt: "2026-07-14T00:00:00.000Z",
                  onChange: () => {},
                  ydoc,
                  collabSynced: true,
                  editable: true,
                }),
              ),
            ),
          ),
        );
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

      expect(container.querySelector("h5")?.textContent).toBe(
        "Verification note",
      );
      expect(container.querySelector("h6")?.textContent).toBe("Final edge");
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      ydoc.destroy();
      container.remove();
    }
  });

  it("mounts a fenced code block in the collaborative editor", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const ydoc = new Y.Doc();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    try {
      act(() => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              TooltipProvider,
              null,
              createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(VisualEditor, {
                  content: "```ts\nconst answer = 42\n```",
                  contentUpdatedAt: "2026-07-24T00:00:00.000Z",
                  onChange: () => {},
                  ydoc,
                  collabSynced: true,
                  editable: true,
                }),
              ),
            ),
          ),
        );
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

      expect(
        container.querySelector("pre.notion-code-block code")?.textContent,
      ).toBe("const answer = 42");
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      ydoc.destroy();
      container.remove();
    }
  });

  it("does not clear awareness owned by the shared collab connection on unmount", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const queryClient = new QueryClient();
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const user = {
      name: "Awareness Owner",
      email: "awareness-owner@example.com",
      color: "#60a5fa",
    };

    try {
      act(() => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              TooltipProvider,
              null,
              createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(VisualEditor, {
                  content: "Shared awareness body",
                  contentUpdatedAt: "2026-07-09T20:00:00.000Z",
                  onChange: () => {},
                  ydoc,
                  collabSynced: true,
                  awareness,
                  user,
                  editable: true,
                }),
              ),
            ),
          ),
        );
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(awareness.getLocalState()?.user).toMatchObject({
        email: user.email,
      });

      act(() => root.unmount());

      expect(awareness.getLocalState()?.user).toMatchObject({
        email: user.email,
      });
    } finally {
      queryClient.clear();
      awareness.destroy();
      ydoc.destroy();
      container.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });

  it("does not apply stale SQL snapshots over live collaborative edits", () => {
    expect(
      shouldApplyExternalContentSync({
        docChanged: false,
        content: "Older collaborator snapshot",
        lastEmittedMarkdown: "Merged live content",
        currentMarkdown: "Merged live content",
        nextMarkdown: "Older collaborator snapshot",
        contentUpdatedAt: "2026-05-29T10:00:00.000Z",
        lastAppliedUpdatedAt: "2026-05-29T10:01:00.000Z",
        isLeadClient: true,
        editorFocused: false,
        lastTypedAt: 0,
        now: 10_000,
      }),
    ).toBe(false);
  });

  it("does not persist local-file mount-time normalization transactions", () => {
    expect(
      shouldPersistLocalFileEditorUpdate({
        docChanged: true,
        editorFocused: false,
        recentUserEditIntent: false,
        transactionUiEvent: undefined,
      }),
    ).toBe(false);
    expect(
      shouldPersistLocalFileEditorUpdate({
        docChanged: true,
        editorFocused: true,
        recentUserEditIntent: false,
        transactionUiEvent: undefined,
      }),
    ).toBe(true);
    expect(
      shouldPersistLocalFileEditorUpdate({
        docChanged: false,
        editorFocused: true,
        recentUserEditIntent: true,
        transactionUiEvent: "paste",
      }),
    ).toBe(false);
    expect(
      shouldPersistLocalFileEditorUpdate({
        docChanged: true,
        editorFocused: false,
        explicitLocalFileUserEdit: true,
        recentUserEditIntent: false,
        transactionUiEvent: undefined,
      }),
    ).toBe(true);
  });

  it("rejects a ghost empty transition over a rich saved body", () => {
    expect(
      shouldPersistEffectivelyEmptyEditorUpdate({
        nextContent: "<empty-block/>",
        userInitiated: false,
      }),
    ).toBe(false);
  });

  it("allows a deliberate user clear over a rich saved body", () => {
    expect(
      shouldPersistEffectivelyEmptyEditorUpdate({
        nextContent: "<empty-block/>",
        userInitiated: true,
      }),
    ).toBe(true);
  });

  it("rejects an empty preview remount emission when the render snapshot is also empty", () => {
    // After a server restart, the preview can render an empty list snapshot for
    // one tick while its retained per-document save controller still owns the
    // previously confirmed rich body. The editor must not emit that lifecycle
    // filler into the controller; Open page/unmount would flush it to SQL.
    expect(
      shouldPersistEffectivelyEmptyEditorUpdate({
        nextContent: "<empty-block/>",
        userInitiated: false,
      }),
    ).toBe(false);
  });

  it("allows an intentional clear even when an empty remount snapshot is visible", () => {
    expect(
      shouldPersistEffectivelyEmptyEditorUpdate({
        nextContent: "<empty-block/>",
        userInitiated: true,
      }),
    ).toBe(true);
  });

  it("keeps a retained rich preview controller clean across an empty remount, then permits a deliberate clear", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const controller = createPreviewDocumentSaveController({
      documentId: "builder-preview-remount",
      initial: {
        title: "Quiet Comet",
        content: "Persisted rich Builder body",
      },
      save,
      debounceMs: 0,
    });

    const ghostEmpty = "<empty-block/>";
    if (
      shouldPersistEffectivelyEmptyEditorUpdate({
        nextContent: ghostEmpty,
        userInitiated: false,
      })
    ) {
      controller.changeContent(ghostEmpty);
    }
    await controller.flush();

    expect(controller.pending.content).toBe("Persisted rich Builder body");
    expect(save).not.toHaveBeenCalled();

    if (
      shouldPersistEffectivelyEmptyEditorUpdate({
        nextContent: ghostEmpty,
        userInitiated: true,
      })
    ) {
      controller.changeContent(ghostEmpty);
    }
    await controller.flush();

    expect(save).toHaveBeenCalledExactlyOnceWith(
      "builder-preview-remount",
      {
        title: "Quiet Comet",
        content: ghostEmpty,
      },
      {
        title: "Quiet Comet",
        content: "Persisted rich Builder body",
      },
    );
  });

  it("applies newer external sync through the lead client", () => {
    expect(
      shouldApplyExternalContentSync({
        docChanged: false,
        content: "Pulled from Notion",
        lastEmittedMarkdown: "Local editor state",
        currentMarkdown: "Local editor state",
        nextMarkdown: "Pulled from Notion",
        contentUpdatedAt: "2026-05-29T10:02:00.000Z",
        lastAppliedUpdatedAt: "2026-05-29T10:01:00.000Z",
        isLeadClient: true,
        editorFocused: false,
        lastTypedAt: 0,
        now: 10_000,
      }),
    ).toBe(true);
  });

  it("still applies external content before collaborative edits begin", () => {
    expect(
      shouldApplyExternalContentSync({
        docChanged: false,
        content: "Pulled from Notion",
        lastEmittedMarkdown: "",
        currentMarkdown: "Saved body",
        nextMarkdown: "Pulled from Notion",
        contentUpdatedAt: "2026-05-29T10:00:00.000Z",
        lastAppliedUpdatedAt: null,
        isLeadClient: true,
        editorFocused: false,
        lastTypedAt: 0,
        now: 10_000,
      }),
    ).toBe(true);
  });

  it("labels empty quote blocks with the quote placeholder", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [{ type: "paragraph" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(2);
      expect(
        editor.view.dom
          .querySelector("blockquote p")
          ?.getAttribute("data-placeholder"),
      ).toBe("Empty quote");
    } finally {
      editor.destroy();
    }
  });

  it("only shows the Notion empty-line placeholder while the editor is focused", () => {
    const editor = createFullEditor();
    let editorFocused = false;
    Object.defineProperty(editor, "isFocused", {
      configurable: true,
      get: () => editorFocused,
    });

    try {
      editor.commands.setTextSelection(1);
      expect(
        editor.view.dom.querySelector("p")?.getAttribute("data-placeholder"),
      ).toBe("");

      editorFocused = true;
      editor.commands.setTextSelection(1);

      expect(
        editor.view.dom.querySelector("p")?.getAttribute("data-placeholder"),
      ).toBe("Press ‘/’ for commands");

      editorFocused = false;
      editor.commands.setTextSelection(1);
      expect(
        editor.view.dom.querySelector("p")?.getAttribute("data-placeholder"),
      ).toBe("");
    } finally {
      editor.destroy();
    }
  });

  it("keeps the empty-line placeholder on only the focused block", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "paragraph" },
          { type: "paragraph" },
        ],
      },
    });

    const placeholderParagraphs = () =>
      Array.from(editor.view.dom.querySelectorAll("p"))
        .map((paragraph, index) => ({ paragraph, index }))
        .filter(
          ({ paragraph }) =>
            paragraph.getAttribute("data-placeholder") ===
            "Press ‘/’ for commands",
        )
        .map(({ index }) => index);

    try {
      editor.commands.setTextSelection(1);
      expect(placeholderParagraphs()).toEqual([]);

      editor.view.dom.dispatchEvent(new FocusEvent("focus"));
      expect(placeholderParagraphs()).toEqual([0]);

      editor.commands.setTextSelection(3);
      expect(placeholderParagraphs()).toEqual([1]);

      editor.commands.setTextSelection(5);
      expect(placeholderParagraphs()).toEqual([2]);

      editor.commands.setTextSelection(3);
      expect(placeholderParagraphs()).toEqual([1]);

      editor.commands.setTextSelection(1);
      expect(placeholderParagraphs()).toEqual([0]);

      editor.view.dom.dispatchEvent(new FocusEvent("blur"));
      expect(placeholderParagraphs()).toEqual([]);

      editor.view.dom.dispatchEvent(new FocusEvent("focus"));
      expect(placeholderParagraphs()).toEqual([0]);
    } finally {
      editor.destroy();
    }
  });

  it.each([4, 5, 6] as const)("round-trips heading %s blocks", (level) => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level },
            content: [{ type: "text", text: "A precise subheading" }],
          },
        ],
      },
    });

    try {
      const json = editor.getJSON();
      expect(json.content?.[0]).toMatchObject({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: "A precise subheading" }],
      });
      const marker = "#".repeat(level);
      expect(docToNfm(json as any)).toBe(`${marker} A precise subheading`);
      expect(
        serializeEditorToNfm((editor.storage as any).markdown.getMarkdown()),
      ).toBe(`${marker} A precise subheading`);
      expect(editor.view.dom.querySelector(`h${level}`)?.textContent).toBe(
        "A precise subheading",
      );
    } finally {
      editor.destroy();
    }
  });

  it.each(['"', "|"])(
    "turns %s plus space into a block quote shortcut",
    (marker) => {
      const editor = createFullEditor();

      try {
        expect(triggerTextInput(editor, marker)).toBe(false);
        expect(triggerTextInput(editor, " ")).toBe(true);
        expect(editor.getJSON().content?.[0]).toMatchObject({
          type: "blockquote",
          content: [{ type: "paragraph" }],
        });
      } finally {
        editor.destroy();
      }
    },
  );

  it("moves focus to the title from an empty first body line", async () => {
    let joinedText: string | null = null;
    const editor = new Editor({
      extensions: createVisualEditorExtensions({
        onJoinTitle: (text) => {
          joinedText = text;
        },
      }),
      content: {
        type: "doc",
        content: [
          { type: "paragraph" },
          {
            type: "paragraph",
            content: [{ type: "text", text: "But lately" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(1);

      expect(triggerKeyDown(editor, "Backspace")).toBe(true);
      await waitForDeferredCallback();
      expect(joinedText).toBe("");
      expect(editor.getJSON()).toMatchObject({
        type: "doc",
        content: [
          { type: "paragraph" },
          {
            type: "paragraph",
            content: [{ type: "text", text: "But lately" }],
          },
        ],
      });
    } finally {
      editor.destroy();
    }
  });

  it("moves focus to the title when deleting the only empty body line", async () => {
    let joinedText: string | null = null;
    const editor = new Editor({
      extensions: createVisualEditorExtensions({
        onJoinTitle: (text) => {
          joinedText = text;
        },
      }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });

    try {
      editor.commands.setTextSelection(1);

      expect(triggerKeyDown(editor, "Delete")).toBe(true);
      await waitForDeferredCallback();
      expect(joinedText).toBe("");
      expect(editor.getJSON()).toMatchObject({
        type: "doc",
        content: [{ type: "paragraph" }],
      });
    } finally {
      editor.destroy();
    }
  });

  it("removes a non-empty first body line and passes its text to the title", async () => {
    let joinedText: string | null = null;
    const editor = new Editor({
      extensions: createVisualEditorExtensions({
        onJoinTitle: (text) => {
          joinedText = text;
        },
      }),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Move me up" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Keep me here" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(1);

      expect(triggerKeyDown(editor, "Backspace")).toBe(true);
      await waitForDeferredCallback();
      expect(joinedText).toBe("Move me up");
      expect(editor.getJSON()).toMatchObject({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Keep me here" }],
          },
        ],
      });
    } finally {
      editor.destroy();
    }
  });

  it("reserves the empty-toggle placeholder for zero-child toggles", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "notionToggle",
            attrs: { summary: "Toggle", open: true },
            content: [{ type: "paragraph" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Outside" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);

      expect(
        editor.view.dom.querySelector(".notion-toggle__empty-placeholder"),
      ).toBeNull();
      expect(
        editor.view.dom
          .querySelector(
            "[data-notion-toggle-content] p, .notion-toggle__content p",
          )
          ?.getAttribute("data-placeholder"),
      ).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("uses the normal empty-block placeholder when the toggle body is focused", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "notionToggle",
            attrs: { summary: "Toggle", open: true },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    });
    Object.defineProperty(editor, "isFocused", {
      configurable: true,
      value: true,
    });

    try {
      editor.commands.setTextSelection(2);

      expect(
        editor.view.dom
          .querySelector(
            "[data-notion-toggle-content] p, .notion-toggle__content p",
          )
          ?.getAttribute("data-placeholder"),
      ).toBe("Press ‘/’ for commands");
    } finally {
      editor.destroy();
    }
  });

  it("removes the toggle body placeholder after typing into the body", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "notionToggle",
            attrs: { summary: "Toggle", open: true },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(2);
      insertPlainText(editor, "Body text");

      expect(
        editor.view.dom.querySelector(
          "[data-placeholder='Empty toggle. Click or drop blocks inside.']",
        ),
      ).toBeNull();
      expect(editor.view.dom.textContent).toContain("Body text");
    } finally {
      editor.destroy();
    }
  });

  it("replaces the empty toggle placeholder after dropped content fills the body", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "notionToggle",
            attrs: { summary: "Toggle", open: true },
            content: [],
          },
        ],
      },
    });

    try {
      expect(editor.view.dom.querySelector(".notion-toggle__content p")).toBe(
        null,
      );

      editor.commands.insertContentAt(1, {
        type: "paragraph",
        content: [{ type: "text", text: "Dropped block" }],
      });

      expect(
        editor.view.dom.querySelector(
          "[data-placeholder='Empty toggle. Click or drop blocks inside.']",
        ),
      ).toBeNull();
      expect(editor.getText()).toContain("Dropped block");
    } finally {
      editor.destroy();
    }
  });

  it("turns > space into an empty open toggle without storing placeholder text", () => {
    const editor = createFullEditor();

    try {
      insertPlainText(editor, ">");
      expect(triggerTextInput(editor, " ")).toBe(true);

      const json = editor.getJSON();
      expect(json.content?.[0]?.type).toBe("notionToggle");
      expect(json.content?.[0]?.attrs?.summary).toBe("");
      expect(json.content?.[0]?.attrs?.open).toBe(true);

      const markdown = (editor.storage as any).markdown.getMarkdown();
      expect(markdown).toContain("<summary></summary>");
      expect(markdown).not.toContain("<summary>Toggle</summary>");
    } finally {
      editor.destroy();
    }
  });

  it("handles batched > space text input as an empty open toggle", () => {
    const editor = createFullEditor();

    try {
      expect(triggerTextInput(editor, "> ")).toBe(true);

      const json = editor.getJSON();
      expect(json.content?.[0]?.type).toBe("notionToggle");
      expect(json.content?.[0]?.attrs?.summary).toBe("");
      expect(json.content?.[0]?.attrs?.open).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("turns pipe space into a blockquote shortcut", () => {
    const editor = createFullEditor();

    try {
      insertPlainText(editor, "|");
      expect(triggerTextInput(editor, " ")).toBe(true);

      const json = editor.getJSON();
      expect(json.content?.[0]?.type).toBe("blockquote");
    } finally {
      editor.destroy();
    }
  });
});
