import { Editor, type JSONContent } from "@tiptap/core";

import { createSharedEditorExtensions } from "./extensions.js";
import { RunId } from "./RunId.js";

/**
 * The GFM ↔ ProseMirror primitive for the plan single-doc editor.
 *
 * Plans keep `PlanContent.blocks[]` as the source of truth, but the editor is
 * ONE ProseMirror/Tiptap document. The `doc ↔ blocks[]` serializer
 * (`templates/plan/shared/plan-doc.ts`) needs to turn a `rich-text` block's GFM
 * markdown into prose nodes and back. This module is that primitive.
 *
 * Both directions go through a SINGLE headless Tiptap {@link Editor} built from
 * the exact same `createSharedEditorExtensions` config the live plan editor
 * uses (`dialect: "gfm"`, `features.image: true`) plus the {@link RunId}
 * extension, so the schema and the GFM serializer can never drift from the live
 * editor. The instance is created lazily on first use and reused across calls.
 *
 * The headless editor needs a DOM (ProseMirror's `EditorView`). It works under
 * `happy-dom` in vitest (see `gfmDoc.spec.ts`) and under the real browser DOM
 * in production. `createElement` is used rather than mounting into the page so
 * nothing is ever attached to the document.
 */

let sharedEditor: Editor | null = null;

/**
 * Lazily build (and memoize) the single headless editor. Throws if no DOM is
 * available — this primitive is for the client / jsdom-style test envs only.
 */
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

/** Reads the GFM markdown out of the tiptap-markdown storage. */
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as {
    markdown?: { getMarkdown?: () => string };
  };
  return storage.markdown?.getMarkdown?.() ?? "";
}

/**
 * Parse a GFM markdown string into an array of top-level ProseMirror node JSON
 * (paragraph / heading / list / table / code block / etc.), matching the live
 * plan editor schema (`createSharedEditorExtensions({ dialect: "gfm",
 * features: { image: true } })`) plus the {@link RunId} attribute.
 *
 * `tiptap-markdown` registers the markdown parser, so handing the raw markdown
 * string to `setContent` deserializes it (the same path the live editor uses
 * when it seeds `content: markdown`). Returns the doc's child nodes; an empty
 * string yields a single empty paragraph.
 */
export function gfmToProseJSON(markdown: string): JSONContent[] {
  const editor = getSharedEditor();
  // `emitUpdate: false` keeps this a pure transform with no side effects on any
  // (non-existent) consumers of the headless editor's update stream.
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor.getJSON().content ?? [];
}

/**
 * Serialize an array of top-level ProseMirror node JSON into GFM markdown. The
 * `runId` attribute is omitted by GFM (the {@link RunId} extension registers no
 * markdown serializer), so it never leaks into the saved markdown.
 *
 * The nodes are wrapped in a `doc` and set on the shared editor, then the GFM
 * markdown is read from the tiptap-markdown storage — the exact serializer the
 * live editor persists with, so output is byte-stable with the live save path.
 */
export function proseJSONToGfm(nodes: JSONContent[]): string {
  const editor = getSharedEditor();
  const content = nodes.length > 0 ? nodes : [{ type: "paragraph" }];
  editor.commands.setContent({ type: "doc", content }, { emitUpdate: false });
  return getMarkdown(editor);
}
