// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";

import {
  createSuggestionHighlightPlugin,
  suggestionHighlightKey,
  type SuggestionHighlightSpec,
} from "./SuggestionHighlight";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
  marks: {
    strong: { toDOM: () => ["strong", 0] },
    emphasis: { toDOM: () => ["em", 0] },
    underline: { toDOM: () => ["u", 0] },
    strike: { toDOM: () => ["s", 0] },
  },
});

function doc(text: string): ProseMirrorNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? schema.text(text) : undefined),
  ]);
}

function state(text = "Before after"): EditorState {
  return EditorState.create({
    doc: doc(text),
    plugins: [createSuggestionHighlightPlugin()],
  });
}

function setSpecs(
  editorState: EditorState,
  specs: SuggestionHighlightSpec[],
  activeId: string | null = null,
): EditorState {
  return editorState.apply(
    editorState.tr.setMeta(suggestionHighlightKey, { specs, activeId }),
  );
}

describe("SuggestionHighlight", () => {
  it("keeps deletions quiet at rest and readable on hover, focus, or selection", () => {
    const css = readFileSync(resolve(process.cwd(), "app/global.css"), {
      encoding: "utf8",
    });

    expect(css).toMatch(
      /\.notion-editor \.suggestion-delete\s*\{[^}]*color: hsl\(var\(--muted-foreground\)\);[^}]*text-decoration: line-through;/,
    );
    expect(css).toMatch(
      /\.notion-editor \.suggestion-delete:hover,[\s\S]*?\.notion-editor \.suggestion-delete-widget:focus-visible\s*\{[^}]*color: hsl\(var\(--foreground\)\);[^}]*text-decoration: none;/,
    );
    expect(css).toMatch(
      /\.notion-editor \.suggestion-delete\.suggestion-highlight--active,[\s\S]*?\.notion-editor \.suggestion-delete-widget\.suggestion-highlight--active\s*\{[^}]*color: hsl\(var\(--foreground\)\);[^}]*text-decoration: none;/,
    );

    const pointerAndFocusState = css.match(
      /\.notion-editor \.suggestion-delete:hover,[\s\S]*?\.notion-editor \.suggestion-delete-widget:focus-visible\s*\{([^}]*)\}/,
    )?.[1];
    const selectedState = css.match(
      /\.notion-editor \.suggestion-delete\.suggestion-highlight--active,[\s\S]*?\.notion-editor \.suggestion-delete-widget\.suggestion-highlight--active\s*\{([^}]*)\}/,
    )?.[1];
    expect(`${pointerAndFocusState}\n${selectedState}`).not.toMatch(
      /(?:font-size|line-height|margin|padding|border-width):/,
    );
  });

  it("makes paragraph boundaries visible in saved insertion widgets", () => {
    const editorState = setSpecs(state(), [
      {
        suggestionId: "paragraph",
        kind: "insert",
        from: 1,
        to: 1,
        insertedText: "New paragraph\n\n",
      },
    ]);
    const mount = document.createElement("div");
    const view = new EditorView(mount, { state: editorState });
    expect(mount.querySelector("[data-suggestion-widget]")?.textContent).toBe(
      "New paragraph↵↵",
    );
    view.destroy();
  });

  it("preserves boundary whitespace in insertion and deletion widgets", () => {
    const css = readFileSync(resolve(process.cwd(), "app/global.css"), {
      encoding: "utf8",
    });
    expect(css).toMatch(
      /\.notion-editor \.suggestion-inline-widget\[data-suggestion-widget\]\s*\{[^}]*white-space: break-spaces;/,
    );

    const editorState = setSpecs(state(), [
      {
        suggestionId: "insert-space",
        kind: "insert",
        from: 1,
        to: 1,
        insertedText: " extra ",
      },
      {
        suggestionId: "delete-space",
        kind: "delete",
        from: 7,
        to: 7,
        deletedText: " removed ",
      },
    ]);
    const decorations = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find();
    const insert = decorations.find(
      (decoration) => decoration.spec.key === "insert-space:inserted",
    ) as any;
    const deletion = decorations.find((decoration) =>
      decoration.spec.key.includes("delete-space"),
    ) as any;

    expect(insert.type.toDOM().textContent).toBe(" extra ");
    expect(insert.type.toDOM().hasAttribute("data-suggestion-widget")).toBe(
      true,
    );
    expect(deletion.type.toDOM().textContent).toBe(" removed ");
    expect(deletion.type.toDOM().hasAttribute("data-suggestion-widget")).toBe(
      true,
    );
  });

  it("makes contextual whitespace-only insertion and deletion widgets visible", () => {
    const source = "a \tb";
    const context = { source, from: 1, to: 3 };
    const editorState = setSpecs(state(), [
      {
        suggestionId: "context-insert-space",
        kind: "insert",
        from: 1,
        to: 1,
        insertedText: " \t",
        insertedPresentation: context,
      },
      {
        suggestionId: "context-delete-space",
        kind: "delete",
        from: 7,
        to: 7,
        deletedText: " \t",
        deletedPresentation: context,
      },
    ]);
    const decorations = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find();
    const insert = decorations.find(
      (decoration) => decoration.spec.key === "context-insert-space:inserted",
    ) as any;
    const deletion = decorations.find((decoration) =>
      decoration.spec.key.includes("context-delete-space"),
    ) as any;

    expect(insert.type.toDOM().textContent).toBe("·⇥");
    expect(deletion.type.toDOM().textContent).toBe("·⇥");
  });

  it("makes contextual marked newlines visible in widgets", () => {
    const source = "`Ec<br>ho`";
    const editorState = setSpecs(state(), [
      {
        suggestionId: "context-code-break",
        kind: "insert",
        from: 1,
        to: 1,
        insertedText: source,
        insertedPresentation: {
          source,
          from: 0,
          to: source.length,
        },
      },
    ]);
    const widget = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find()[0] as any;
    const dom = widget.type.toDOM();
    expect(dom.querySelector("code")?.textContent).toBe("Ec↵ho");
  });

  it("makes structural indentation visible in a zero-width widget", () => {
    const source = "\tParagraph";
    const editorState = setSpecs(state(), [
      {
        suggestionId: "context-indent",
        kind: "insert",
        from: 1,
        to: 1,
        insertedText: "\t",
        insertedPresentation: { source, from: 0, to: 1 },
      },
    ]);
    const widget = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find()[0] as any;
    expect(widget.type.toDOM().textContent).toBe("⇥");
  });

  it("uses text geometry and an I-beam for every suggestion presentation", () => {
    const css = readFileSync(resolve(process.cwd(), "app/global.css"), {
      encoding: "utf8",
    });
    expect(css).toMatch(
      /\.notion-editor \.suggestion-proposed-text,[\s\S]*?\.notion-editor \.suggestion-deleted-text\s*\{[^}]*cursor: text;/,
    );
    expect(css).toMatch(
      /\.notion-editor \.suggestion-inline-widget\[data-suggestion-widget\]\s*\{[^}]*margin: 0;[^}]*padding: 0;[^}]*font: inherit;[^}]*letter-spacing: inherit;[^}]*line-height: inherit;[^}]*vertical-align: baseline;/,
    );

    const editorState = setSpecs(state(), [
      {
        suggestionId: "saved-insert",
        kind: "insert",
        from: 7,
        to: 7,
        insertedText: "added",
      },
    ]);
    const widget = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find()[0] as any;
    const dom = widget.type.toDOM();
    expect(dom.tagName).toBe("SPAN");
    expect(dom.className).toContain("suggestion-proposed-text");
    expect(dom.className).toContain("suggestion-inline-widget");
    expect(dom.getAttribute("role")).toBe("button");
    expect(dom.getAttribute("tabindex")).toBe("0");
  });

  it("renders deletion, replacement, insertion, block, and mark decorations without document marks", () => {
    const editorState = setSpecs(
      state(),
      [
        { suggestionId: "delete", kind: "delete", from: 1, to: 7 },
        {
          suggestionId: "replace",
          kind: "replace",
          from: 8,
          to: 13,
          insertedText: "new",
        },
        {
          suggestionId: "insert",
          kind: "insert",
          from: 1,
          to: 1,
          insertedText: "added",
        },
        {
          suggestionId: "block",
          kind: "add_block",
          from: 13,
          to: 13,
          insertedText: "New block",
        },
        { suggestionId: "mark", kind: "mark", from: 1, to: 7 },
      ],
      "replace",
    );
    const decorations = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find();

    expect(editorState.doc.textContent).toBe("Before after");
    expect(decorations).toHaveLength(6);
    expect(
      decorations.find((deco) => deco.spec.key === "replace:inserted")?.from,
    ).toBe(13);
    expect(
      decorations.find((deco) => deco.spec.key === "insert:inserted")?.from,
    ).toBe(1);
    const deleted = decorations.find((deco) =>
      (deco as any).type.attrs?.class?.includes("suggestion-delete"),
    ) as any;
    const changed = decorations.find((deco) =>
      (deco as any).type.attrs?.class?.includes("suggestion-change"),
    ) as any;
    expect(deleted.type.attrs).toMatchObject({
      class: "suggestion-delete suggestion-deleted-text",
      "data-suggestion-id": "delete",
      role: "button",
      tabindex: "0",
    });
    expect(changed.type.attrs).toMatchObject({
      class: "suggestion-change suggestion-proposed-text",
      "data-suggestion-id": "mark",
    });
    const replacement = decorations.find(
      (deco) => deco.spec.key === "replace:inserted",
    ) as any;
    expect(replacement.type.toDOM().className).toContain(
      "suggestion-highlight--active",
    );
  });

  it("maps persisted ranges across document transactions and preserves stable ids", () => {
    let editorState = setSpecs(state("Hello world"), [
      { suggestionId: "stable", kind: "delete", from: 7, to: 12 },
      {
        suggestionId: "insert",
        kind: "insert",
        from: 6,
        to: 6,
        insertedText: "brave ",
      },
    ]);
    editorState = editorState.apply(editorState.tr.insertText("big ", 1));
    const highlight = suggestionHighlightKey.getState(editorState)!;

    expect(highlight.specs).toEqual([
      { suggestionId: "stable", kind: "delete", from: 11, to: 16 },
      {
        suggestionId: "insert",
        kind: "insert",
        from: 10,
        to: 10,
        insertedText: "brave ",
      },
    ]);
  });

  it("clamps invalid ranges and keeps widget proposal text DOM-safe", () => {
    const editorState = setSpecs(state("Safe"), [
      { suggestionId: "bad", kind: "delete", from: -10, to: 99 },
      {
        suggestionId: "safe",
        kind: "insert",
        from: 999,
        to: 999,
        insertedText: "<img src=x>",
      },
    ]);
    const decorations = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find();
    const widget = decorations.find(
      (deco) => deco.spec.key === "safe:inserted",
    )!;
    const dom = (widget as any).type.toDOM();

    expect(
      decorations.find(
        (deco) => (deco as any).type.attrs?.["data-suggestion-id"] === "bad",
      )?.from,
    ).toBe(0);
    expect(widget.from).toBe(editorState.doc.content.size);
    expect(dom.textContent).toBe("<img src=x>");
    expect(dom.querySelector("img")).toBeNull();
    expect(dom.getAttribute("data-suggestion-id")).toBe("safe");
  });

  it("renders inserted and deleted NFM with the same safe formatting as the sidebar", () => {
    const css = readFileSync(resolve(process.cwd(), "app/global.css"), {
      encoding: "utf8",
    });
    const marked =
      '**Bold** *Italic* ~~Strike~~ `Code` <span underline="true">Underline</span> [Link](https://example.test)';
    const editorState = setSpecs(state("Keep"), [
      {
        suggestionId: "marked-insert",
        kind: "insert",
        from: 1,
        to: 1,
        insertedText: marked,
      },
      {
        suggestionId: "marked-delete",
        kind: "delete",
        from: 1,
        to: 1,
        deletedText: marked,
      },
    ]);
    const decorations = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find();
    const inserted = (
      decorations.find(
        (decoration) => decoration.spec.key === "marked-insert:inserted",
      ) as any
    ).type.toDOM() as HTMLElement;
    const deleted = (
      decorations.find((decoration) =>
        String(decoration.spec.key).includes("marked-delete"),
      ) as any
    ).type.toDOM() as HTMLElement;

    for (const widget of [inserted, deleted]) {
      expect(widget.textContent).toBe(
        "Bold Italic Strike Code Underline Link (https://example.test)",
      );
      expect(widget.querySelector("strong")?.textContent).toBe("Bold");
      expect(widget.querySelector("em")?.textContent).toBe("Italic");
      expect(widget.querySelector("s")?.textContent).toBe("Strike");
      expect(widget.querySelector("code")?.textContent).toBe("Code");
      expect(widget.querySelector("u")?.textContent).toBe("Underline");
      expect(widget.querySelector("a")).toBeNull();
      expect(widget.innerHTML).not.toContain("**");
    }
    expect(inserted.className).toContain("suggestion-proposed-text");
    expect(deleted.className).toContain("suggestion-deleted-text");
    expect(css).toMatch(
      /\.notion-editor \.suggestion-inline-widget\[data-suggestion-widget\] code\s*\{[^}]*color: inherit;/,
    );
  });

  it.each([
    ["# heading", "# heading"],
    ["> quote", "> quote"],
    ["- one\n- two", "- one↵- two"],
    ["- [ ] task", "- [ ] task"],
    ["```ts\nconst x = 1;\n```", "```ts↵const x = 1;↵```"],
  ])(
    "preserves block-leading fragment %j in insertion and deletion widgets",
    (content, expected) => {
      const editorState = setSpecs(state("Keep"), [
        {
          suggestionId: "literal-insert",
          kind: "insert",
          from: 1,
          to: 1,
          insertedText: content,
        },
        {
          suggestionId: "literal-delete",
          kind: "delete",
          from: 1,
          to: 1,
          deletedText: content,
        },
      ]);
      const decorations = suggestionHighlightKey
        .getState(editorState)!
        .decorations.find();
      const inserted = (
        decorations.find(
          (decoration) => decoration.spec.key === "literal-insert:inserted",
        ) as any
      ).type.toDOM() as HTMLElement;
      const deleted = (
        decorations.find((decoration) =>
          String(decoration.spec.key).includes("literal-delete"),
        ) as any
      ).type.toDOM() as HTMLElement;

      expect(inserted.textContent).toBe(expected);
      expect(deleted.textContent).toBe(expected);
    },
  );

  it("keeps widget formatting independent from adjacent document marks", () => {
    const nativeMarks = [
      schema.marks.strong.create(),
      schema.marks.emphasis.create(),
      schema.marks.underline.create(),
      schema.marks.strike.create(),
    ];
    let editorState = EditorState.create({
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("Before "),
          schema.text("Changed", nativeMarks),
        ]),
      ]),
      plugins: [createSuggestionHighlightPlugin()],
    });
    editorState = setSpecs(editorState, [
      {
        suggestionId: "marked-insert",
        kind: "insert",
        from: 8,
        to: 8,
        insertedText: "*Inserted*",
      },
      {
        suggestionId: "marked-delete",
        kind: "delete",
        from: 8,
        to: 8,
        deletedText: "**Deleted**",
      },
    ]);
    const mount = document.createElement("div");
    const view = new EditorView(mount, { state: editorState });
    const inserted = mount.querySelector<HTMLElement>(
      '[data-suggestion-id="marked-insert"][data-suggestion-widget]',
    )!;
    const deleted = mount.querySelector<HTMLElement>(
      '[data-suggestion-id="marked-delete"][data-suggestion-widget]',
    )!;

    for (const widget of [inserted, deleted]) {
      expect(widget.closest("strong, em, u, s")).toBeNull();
    }
    expect(inserted.querySelector("em")?.textContent).toBe("Inserted");
    expect(deleted.querySelector("strong")?.textContent).toBe("Deleted");
    expect(mount.querySelector("strong em u s")?.textContent).toBe("Changed");

    view.destroy();
  });

  it("renders draft deletion ghosts as non-focusable editable boundaries", () => {
    const editorState = setSpecs(state("Keep this"), [
      {
        suggestionId: "draft-delete",
        kind: "delete",
        from: 5,
        to: 5,
        deletedText: "removed",
        editableBoundary: true,
      },
    ]);
    const decoration = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find()[0] as any;
    const dom = decoration.type.toDOM();

    expect(dom.className).toContain("suggestion-delete-widget");
    expect(dom.textContent).toBe("removed");
    expect(dom.getAttribute("data-suggestion-id")).toBe("draft-delete");
    expect(dom.tagName).toBe("SPAN");
    expect(dom.hasAttribute("tabindex")).toBe(false);
    expect(dom.getAttribute("data-suggestion-edit-boundary")).toBe("true");
    expect(dom.getAttribute("data-suggestion-position")).toBe("5");
    expect(dom.className).toContain("suggestion-deleted-text");
    expect(dom.className).toContain("suggestion-inline-widget");
  });

  it("marks saved and draft deletions active without changing their text", () => {
    const savedState = setSpecs(
      state("Keep this"),
      [
        {
          suggestionId: "saved-delete",
          kind: "delete",
          from: 1,
          to: 5,
        },
      ],
      "saved-delete",
    );
    const draftState = setSpecs(
      state("Keep this"),
      [
        {
          suggestionId: "draft-delete",
          kind: "delete",
          from: 5,
          to: 5,
          deletedText: "removed",
        },
      ],
      "draft-delete",
    );
    const saved = suggestionHighlightKey
      .getState(savedState)!
      .decorations.find()[0] as any;
    const draft = suggestionHighlightKey
      .getState(draftState)!
      .decorations.find();

    expect(saved.type.attrs.class).toBe(
      "suggestion-delete suggestion-deleted-text suggestion-highlight--active",
    );
    expect((draft[0] as any).type.toDOM().className).toContain(
      "suggestion-delete-widget",
    );
    expect((draft[0] as any).type.toDOM().className).toContain(
      "suggestion-highlight--active",
    );
    expect((draft[0] as any).type.toDOM().textContent).toBe("removed");
  });

  it("keeps draft deletion widgets while typing without modifying document or selection", () => {
    const editorState = setSpecs(state("Keep this"), [
      {
        suggestionId: "draft-delete",
        kind: "delete",
        from: 5,
        to: 5,
        deletedText: "removed",
      },
    ]);
    const transaction = editorState.tr.insertText("!", 2);
    const next = editorState.apply(transaction);
    const decorations = suggestionHighlightKey
      .getState(next)!
      .decorations.find();
    expect(decorations).toHaveLength(1);
    expect(decorations[0]!.from).toBe(6);
    expect(next.doc.textContent).toBe("K!eep this");
    expect(next.selection.eq(transaction.selection)).toBe(true);
  });

  it("updates the visible deleted text for successive edits in the same draft", () => {
    const spec: SuggestionHighlightSpec = {
      suggestionId: "draft-0",
      kind: "delete",
      from: 1,
      to: 1,
      deletedText: "A",
    };
    const view = new EditorView(document.createElement("div"), {
      state: setSpecs(state("remaining"), [spec]),
    });
    try {
      expect(
        view.dom.querySelector(".suggestion-delete-widget")?.textContent,
      ).toBe("A");
      view.updateState(
        setSpecs(view.state, [{ ...spec, deletedText: "Alpha" }]),
      );
      expect(
        view.dom.querySelector(".suggestion-delete-widget")?.textContent,
      ).toBe("Alpha");
      expect(view.state.doc.textContent).toBe("remaining");
    } finally {
      view.destroy();
    }
  });
});
