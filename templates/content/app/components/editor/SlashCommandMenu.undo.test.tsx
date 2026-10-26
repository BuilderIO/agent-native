// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { prosemirrorToYDoc, yUndoPluginKey } from "@tiptap/y-tiptap";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { SlashCommandMenu } from "./SlashCommandMenu";
import {
  createVisualEditorExtensions,
  runPersistableHistoryCommand,
} from "./VisualEditor";

const PARAGRAPH = "Paragraph block for the block menu.";

function collabEditor() {
  const seed = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(`${PARAGRAPH}

### Heading three`),
  });
  const ydoc = new Y.Doc();
  Y.applyUpdate(
    ydoc,
    Y.encodeStateAsUpdate(prosemirrorToYDoc(seed.state.doc, "default")),
  );
  seed.destroy();
  return new Editor({
    extensions: createVisualEditorExtensions({ ydoc }),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

function firstBlock(editor: Editor) {
  const node = editor.state.doc.firstChild;
  if (!node) throw new Error("the document has no blocks");
  return `${node.type.name}: ${node.textContent}`;
}

/** Renders the slash menu beside a collaborative editor. */
async function mountSlashMenu() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const editor = collabEditor();
  await act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider
            initialLocale="en-US"
            persistPreference={false}
            catalog={{
              sourceLocale: "en-US",
              messages: { editor: { heading3: "Heading 3" } },
            }}
          >
            <div className="visual-editor-wrapper">
              <EditorContent editor={editor} />
              <SlashCommandMenu editor={editor} />
            </div>
          </AgentNativeI18nProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  return {
    container,
    editor,
    unmount: async () => {
      await act(async () => root.unmount());
      editor.destroy();
      queryClient.clear();
      container.remove();
    },
  };
}

function typeAt(editor: Editor, pos: number, text: string) {
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
    );
    editor.commands.focus();
    for (const char of text) {
      const { from, to } = editor.state.selection;
      editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  });
}

async function pressEnter() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await act(async () => Promise.resolve());
}

function undo(editor: Editor) {
  act(() => {
    runPersistableHistoryCommand(editor, "undo");
  });
}

describe("slash command undo", () => {
  it("undoes a block type change in one step and keeps the block's text", async () => {
    const { container, editor, unmount } = await mountSlashMenu();
    try {
      typeAt(editor, 1, "/heading 3");
      await act(async () => Promise.resolve());
      expect(container.querySelector(".slash-command-menu")).not.toBeNull();
      // A person pauses before picking the command, which ends the undo
      // step that holds the typed query.
      const undoState = yUndoPluginKey.getState(editor.state);
      if (!undoState) throw new Error("the editor has no Yjs undo history");
      undoState.undoManager.stopCapturing();

      await pressEnter();
      expect(firstBlock(editor)).toBe(`heading: ${PARAGRAPH}`);

      undo(editor);
      expect(firstBlock(editor)).toBe(`paragraph: ${PARAGRAPH}`);
      expect(editor.state.selection.head).toBe(1);

      undo(editor);
      expect(firstBlock(editor)).toBe(`paragraph: ${PARAGRAPH}`);
      expect(editor.state.selection.head).toBe(1);
    } finally {
      await unmount();
    }
  });

  it("keeps the typing just before a command picked without a pause", async () => {
    const { editor, unmount } = await mountSlashMenu();
    try {
      typeAt(editor, 1, "Intro ");
      typeAt(editor, 1, "/heading 3");
      await act(async () => Promise.resolve());
      await pressEnter();
      expect(firstBlock(editor)).toBe(`heading: Intro ${PARAGRAPH}`);

      undo(editor);
      expect(firstBlock(editor)).toBe(`paragraph: Intro ${PARAGRAPH}`);
      expect(editor.state.selection.head).toBe(1);

      undo(editor);
      expect(firstBlock(editor)).toBe(`paragraph: ${PARAGRAPH}`);
    } finally {
      await unmount();
    }
  });
});
