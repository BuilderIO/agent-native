// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { markdownSuggestionOperations } from "@shared/suggestion-diff";
import {
  suggestionTextPresentation,
  suggestionTextPresentationForSource,
} from "@shared/suggestion-text";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { suggestionPresentations } from "./DocumentEditor";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import { SUPPORTED_SUGGESTION_BLOCKS } from "./suggestions/model";
import {
  createVisualEditorExtensions,
  suggestionHighlightSpec,
} from "./VisualEditor";

// One of each block Suggesting mode lets a person change. A saved suggestion
// that removes or replaces one must still be reviewable: its card reads what
// it changes, and the page marks it where it can. One the page can't mark
// stays in the margin under "Highlight unavailable" (CommentsSidebar).
const page = [
  "Opening words.",
  "# A heading",
  "> A quote",
  "- A bullet",
  "1. A number",
  "- [ ] A task",
  "```",
  "code line",
  "```",
  "---",
  "Closing words.",
].join("\n");

type Side = { markdown?: string; changedText?: string };

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function review(before: string, after: string) {
  editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(before),
  });
  const suggestions = markdownSuggestionOperations(before, after).map(
    (operation, index) => ({
      id: `suggestion-${index}`,
      status: "pending" as const,
      operations: [operation],
    }),
  );
  const presentations = suggestions.flatMap((suggestion) =>
    suggestionPresentations(suggestion, before),
  );
  const specs = presentations.map((presentation) =>
    suggestionHighlightSpec(editor!.state.doc, presentation),
  );
  setSuggestionHighlights(editor.view, {
    specs: specs.filter((spec) => spec !== null),
  });
  // What each card shows, read the way its card reads it: each side of the
  // edit against the Page it came from.
  const previews = suggestions.flatMap(({ operations: [operation] }) => {
    const sides = operation as unknown as {
      kind: string;
      before?: Side;
      after?: Side;
      anchor?: { from?: number; to?: number };
    };
    const { from, to } = sides.anchor ?? {};
    const preview = (side: Side | undefined, end: number | undefined) => {
      const text = side?.changedText;
      if (!text || text === "<empty-block/>") return [];
      return [
        side.markdown !== undefined &&
        typeof from === "number" &&
        typeof end === "number"
          ? suggestionTextPresentationForSource(text, {
              source: side.markdown,
              from,
              to: end,
            })
          : suggestionTextPresentation(text),
      ];
    };
    return [
      ...preview(sides.before, to),
      ...preview(
        sides.after,
        typeof from === "number"
          ? from + (sides.after?.changedText?.length ?? 0)
          : undefined,
      ),
    ];
  });
  return {
    ids: suggestions.map((suggestion) => suggestion.id),
    presented: [
      ...new Set(presentations.map((presentation) => presentation.id)),
    ],
    previews,
    drawn: [
      ...new Set(
        [...editor.view.dom.querySelectorAll("[data-suggestion-id]")].map(
          (node) => node.getAttribute("data-suggestion-id"),
        ),
      ),
    ],
  };
}

describe("saved suggestions to whole blocks", () => {
  const before = docToNfm(nfmToDoc(page));
  const blocks = nfmToDoc(before).content ?? [];
  // A block with no text of its own, or text beside one, has no text position
  // the page can mark yet.
  const markedInText = (index: number) =>
    !["codeBlock", "horizontalRule"].includes(blocks[index]!.type) &&
    blocks[index - 1]?.type !== "horizontalRule";

  it("covers every top-level block Suggesting mode can change", () => {
    const covered = new Set(blocks.map((block) => block.type));
    for (const type of SUPPORTED_SUGGESTION_BLOCKS) {
      if (type === "listItem" || type === "taskItem") continue;
      expect(covered, type).toContain(type);
    }
  });

  it.each(blocks.map((block, index) => [block.type, index] as const))(
    "shows a saved deletion of a %s",
    (_type, index) => {
      const after = docToNfm({
        type: "doc",
        content: blocks.filter((_, other) => other !== index),
      });
      const result = review(before, after);
      expect(result.ids.length).toBeGreaterThan(0);
      expect(result.presented).toEqual(result.ids);
      expect(result.previews.length).toBeGreaterThan(0);
      expect(result.previews).not.toContain(null);
      if (markedInText(index)) expect(result.drawn).toEqual(result.ids);
    },
  );

  it("shows a saved replacement of a divider with text", () => {
    const result = review(before, before.replace("\n---\n", "\nx\n"));
    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.presented).toEqual(result.ids);
    expect(result.previews.length).toBeGreaterThan(0);
    expect(result.previews).not.toContain(null);
  });
});
