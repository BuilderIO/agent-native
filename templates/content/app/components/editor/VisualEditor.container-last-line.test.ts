// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { suggestionPresentation } from "./DocumentEditor";
import {
  setSuggestionHighlights,
  suggestionHighlightKey,
} from "./extensions/SuggestionHighlight";
import { markdownSuggestionOperations } from "./suggestions/markdown-operation";
import {
  createVisualEditorExtensions,
  suggestionHighlightSpec,
} from "./VisualEditor";

function mountedEditor(content: string) {
  const mount = document.createElement("div");
  document.body.append(mount);
  const editor = new Editor({
    element: mount,
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(content),
  });
  editor.view.dispatch(editor.state.tr);
  return {
    editor,
    dispose: () => {
      editor.destroy();
      mount.remove();
    },
  };
}

describe("a saved line added at the end of a callout or toggle", () => {
  it.each([
    [
      "callout",
      '<callout icon="💡">\n\tCallout alpha text\n</callout>\n\nClosing paragraph.',
      '<callout icon="💡">\n\tCallout alpha text\n\tAdded callout line.\n</callout>\n\nClosing paragraph.',
      "Callout alpha text",
      "Added callout line.",
    ],
    [
      "toggle",
      "<details>\n<summary>Toggle title</summary>\n\tToggle alpha text\n</details>\n\nClosing paragraph.",
      "<details>\n<summary>Toggle title</summary>\n\tToggle alpha text\n\tAdded toggle line.\n</details>\n\nClosing paragraph.",
      "Toggle alpha text",
      "Added toggle line.",
    ],
  ])(
    "is drawn as its own line inside the %s",
    (_, canonical, suggested, above, line) => {
      const operations = markdownSuggestionOperations(canonical, suggested);
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({ kind: "add_text_block" });
      const presentation = suggestionPresentation(
        { id: "last-line", status: "pending", operations },
        canonical,
      );
      expect(presentation).not.toBeNull();
      const { editor, dispose } = mountedEditor(canonical);
      try {
        const spec = suggestionHighlightSpec(editor.state.doc, presentation!);
        expect(spec).toMatchObject({ kind: "add_block" });
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        // The container's node view doesn't render here, so read the widget
        // from the decorations rather than the page.
        let after = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent === above)
            after = pos + node.nodeSize;
        });
        expect(editor.state.doc.resolve(after).depth).toBeGreaterThan(0);
        const widgets = suggestionHighlightKey
          .getState(editor.state)!
          .decorations.find()
          .map((decoration) => ({
            at: decoration.from,
            dom: (decoration as any).type.toDOM() as HTMLElement,
          }));
        expect(widgets).toHaveLength(1);
        expect(widgets[0]!.at).toBe(after);
        expect(widgets[0]!.dom.classList).toContain("suggestion-block-widget");
        expect(widgets[0]!.dom.textContent).toBe(line);
      } finally {
        dispose();
      }
    },
  );
});
