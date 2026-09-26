import { Editor, type JSONContent } from "@tiptap/core";

import { createSharedEditorExtensions } from "./extensions.js";
import { RunId } from "./RunId.js";

let sharedEditor: Editor | null = null;

function getSharedEditor(): Editor {
  if (sharedEditor) return sharedEditor;
  if (typeof document === "undefined") {
    throw new Error(
      "gfmDoc requires a DOM (document). It runs in the browser and in jsdom/happy-dom tests, not in a bare Node server context.",
    );
  }
  sharedEditor = new Editor({
    element: document.createElement("div"),
    extensions: createSharedEditorExtensions({
      dialect: "gfm",
      features: { image: true },
      extraExtensions: [RunId],
    }),
    content: "",
  });
  return sharedEditor;
}

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as {
    markdown?: { getMarkdown?: () => string };
  };
  return storage.markdown?.getMarkdown?.() ?? "";
}

export function gfmToProseJSON(markdown: string): JSONContent[] {
  const editor = getSharedEditor();
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor.getJSON().content ?? [];
}

export function proseJSONToGfm(nodes: JSONContent[]): string {
  const editor = getSharedEditor();
  const content = nodes.length > 0 ? nodes : [{ type: "paragraph" }];
  editor.commands.setContent({ type: "doc", content }, { emitUpdate: false });
  return getMarkdown(editor);
}
