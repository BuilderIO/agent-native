// @vitest-environment happy-dom

import { COLLAB_MAX_UPDATE_BYTES } from "@agent-native/core/client/collab";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { prosemirrorToYDoc, yUndoPluginKey } from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";

const encodes = vi.hoisted(() => ({ count: 0 }));
vi.mock("yjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("yjs")>();
  return {
    ...actual,
    encodeStateAsUpdate: (
      ...args: Parameters<typeof actual.encodeStateAsUpdate>
    ) => {
      encodes.count += 1;
      return actual.encodeStateAsUpdate(...args);
    },
  };
});
const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      captured.editor = editor;
      return editor;
    },
  };
});
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import {
  getContentEditorSchema,
  runPersistableHistoryCommand,
  VisualEditor,
  type VisualEditorPersistenceController,
} from "./VisualEditor";

// Larger than one update the collab server takes.
const PASTED = "x".repeat(1_600_000);

const href = (length: number) => `https://example.com/${"x".repeat(length)}`;

// One-character text nodes, every other one italic, so each is its own run.
function alternatingItalics(
  runs: number,
  schema = getContentEditorSchema(),
): ProseMirrorNode[] {
  return Array.from({ length: runs }, (_, index) =>
    schema.text("a", index % 2 ? [schema.marks.italic.create()] : []),
  );
}

function paragraph(content: ProseMirrorNode[]): ProseMirrorNode {
  const schema = getContentEditorSchema();
  return schema.node("doc", null, [schema.node("paragraph", null, content)]);
}

function press(editor: Editor, key: string, shiftKey = false) {
  const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      shiftKey,
      metaKey: mac,
      ctrlKey: !mac,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("a switched page's editor", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let ydoc: Y.Doc;
  let sentBytes: number[];
  let body: string;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    startWith("Alpha paragraph");
    captured.editor = null;
  });

  function startWith(text: string) {
    startWithDoc(getContentEditorSchema().nodeFromJSON(nfmToDoc(text)), text);
  }

  function startWithDoc(doc: ProseMirrorNode, text = docToNfm(doc.toJSON())) {
    ydoc?.destroy();
    body = text;
    ydoc = prosemirrorToYDoc(doc, "default");
    sentBytes = [];
    ydoc.on("update", (update: Uint8Array) => sentBytes.push(update.length));
  }

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    ydoc.destroy();
    vi.unstubAllGlobals();
  });

  async function renderEditor(
    onChangeTooLargeToSave?: () => void,
    onPersistenceControllerChange?: (
      controller: VisualEditorPersistenceController | null,
    ) => void,
  ) {
    await act(async () =>
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
                documentId: "page",
                content: body,
                onChange: () => {},
                ydoc,
                collabSynced: true,
                editable: true,
                onChangeTooLargeToSave,
                onPersistenceControllerChange,
              }),
            ),
          ),
        ),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const editor = captured.editor!;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    return editor;
  }

  const bodyText = () => ydoc.getXmlFragment("default").toString();

  it("refuses a paste too large to save before it applies, and later typing still reaches the doc", async () => {
    const refused = vi.fn();
    const editor = await renderEditor(refused);
    sentBytes = [];

    await act(async () => {
      editor.view.pasteText(PASTED);
    });

    expect(refused).toHaveBeenCalledTimes(1);
    expect(editor.getText()).not.toContain("xxx");
    expect(bodyText()).not.toContain("xxx");
    expect(sentBytes).toEqual([]);

    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText(" typed"));
    });

    expect(editor.getText()).toContain("Alpha paragraph typed");
    expect(bodyText()).toContain("Alpha paragraph typed");
    expect(sentBytes.length).toBeGreaterThan(0);
    expect(Math.max(...sentBytes)).toBeLessThan(1024);
  });

  it("refuses a node whose attributes are too large, though it is one position wide", async () => {
    const refused = vi.fn();
    const editor = await renderEditor(refused);
    const image = editor.schema.nodes.image.create({
      src: "https://example.com/image.png",
      alt: PASTED,
    });

    await act(async () => {
      editor.view.dispatch(editor.state.tr.replaceSelectionWith(image));
    });

    expect(refused).toHaveBeenCalledTimes(1);
    expect(bodyText()).not.toContain("xxx");
  });

  it("applies a large change that still fits in one update", async () => {
    const refused = vi.fn();
    const editor = await renderEditor(refused);
    const fits = "y".repeat(Math.floor(COLLAB_MAX_UPDATE_BYTES / 2));

    await act(async () => {
      editor.view.pasteText(fits);
    });

    expect(refused).not.toHaveBeenCalled();
    expect(bodyText()).toContain(fits);
  });

  it("refuses wrapping a selection too large to save, though its step names only the wrapper", async () => {
    startWith(PASTED);
    const refused = vi.fn();
    const editor = await renderEditor(refused);
    expect(editor.getText()).toBe(PASTED);
    sentBytes = [];

    await act(async () => {
      editor.chain().selectAll().toggleBlockquote().run();
    });

    expect(refused).toHaveBeenCalledTimes(1);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(sentBytes).toEqual([]);
  });

  it("applies a change to a long paragraph's structure that still fits", async () => {
    const long = "y".repeat(Math.floor(COLLAB_MAX_UPDATE_BYTES / 4));
    startWith(long);
    const refused = vi.fn();
    const editor = await renderEditor(refused);

    await act(async () => {
      editor.chain().selectAll().toggleBlockquote().run();
    });
    await act(async () => {
      editor.commands.setTextSelection(Math.floor(long.length / 2));
      editor.commands.splitBlock();
    });

    expect(refused).not.toHaveBeenCalled();
    expect(editor.state.doc.firstChild?.type.name).toBe("blockquote");
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(bodyText()).toContain("<blockquote>");
  });

  it.each([
    { runs: 500, hrefLength: 8_000 },
    { runs: 24, hrefLength: 70_000 },
  ])(
    "refuses a link the doc would write once per run of $runs, and applies one that fits",
    async ({ runs, hrefLength }) => {
      startWithDoc(paragraph(alternatingItalics(runs)));
      const refused = vi.fn();
      const editor = await renderEditor(refused);
      const linkHref = () =>
        editor.state.doc.firstChild?.firstChild?.marks.find(
          (mark) => mark.type.name === "link",
        )?.attrs.href;

      await act(async () => {
        editor
          .chain()
          .selectAll()
          .setLink({ href: href(1_000) })
          .run();
      });

      expect(refused).not.toHaveBeenCalled();
      expect(linkHref()).toBe(href(1_000));
      sentBytes = [];

      await act(async () => {
        editor
          .chain()
          .selectAll()
          .setLink({ href: href(hrefLength) })
          .run();
      });

      expect(refused).toHaveBeenCalledTimes(1);
      expect(linkHref()).toBe(href(1_000));
      expect(sentBytes).toEqual([]);
    },
  );

  it("refuses text that takes a neighbour's large link on each of its runs", async () => {
    const schema = getContentEditorSchema();
    const link = schema.marks.link.create({ href: href(8_000) });
    startWithDoc(paragraph([schema.text("linked text", [link])]));
    const refused = vi.fn();
    const editor = await renderEditor(refused);
    sentBytes = [];

    await act(async () => {
      editor.view.dispatch(
        editor.state.tr.insert(4, alternatingItalics(500, editor.schema)),
      );
    });

    expect(refused).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe("linked text");
    expect(sentBytes).toEqual([]);
  });

  it("refuses a character the doc would write as a link on every run after it", async () => {
    const schema = getContentEditorSchema();
    const link = schema.marks.link.create({ href: href(8_000) });
    startWithDoc(
      paragraph(
        Array.from({ length: 500 }, (_, index) =>
          schema.text("a", index % 2 ? [link] : []),
        ),
      ),
    );
    const refused = vi.fn();
    const editor = await renderEditor(refused);
    sentBytes = [];

    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText("a", 1));
    });

    expect(refused).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe("a".repeat(500));
    expect(sentBytes).toEqual([]);
  });

  it("types and undoes inside a link without encoding the doc", async () => {
    startWith("Alpha [link](https://example.com/page) *beta* **gamma**");
    const refused = vi.fn();
    const editor = await renderEditor(refused);
    const history = yUndoPluginKey.getState(editor.state)!.undoManager;
    encodes.count = 0;

    await act(async () => {
      editor.commands.setTextSelection(9);
      editor.view.dispatch(editor.state.tr.insertText("x"));
    });
    history.stopCapturing();
    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText("y"));
    });
    await act(async () => {
      runPersistableHistoryCommand(editor, "undo");
    });

    expect(editor.getText()).toBe("Alpha lixnk beta gamma");
    expect(encodes.count).toBe(0);
    expect(refused).not.toHaveBeenCalled();
  });

  it("refuses undoing a deletion too large to save, and keeps it to undo later", async () => {
    startWith(PASTED);
    const refused = vi.fn();
    const editor = await renderEditor(refused);
    const history = yUndoPluginKey.getState(editor.state)!.undoManager;
    await act(async () => {
      editor.chain().selectAll().deleteSelection().run();
    });
    history.stopCapturing();
    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText("typed"));
    });
    history.stopCapturing();

    await act(async () => press(editor, "z"));

    expect(refused).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("");
    const deleted = bodyText();
    sentBytes = [];

    await act(async () => press(editor, "z"));

    expect(refused).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe("");
    expect(bodyText()).toBe(deleted);
    expect(sentBytes).toEqual([]);
    expect(history.undoStack).toHaveLength(1);

    await renderEditor();
    await act(async () => {
      runPersistableHistoryCommand(editor, "undo");
    });

    expect(editor.getText()).toBe(PASTED);
  });

  it("refuses redoing a paste too large to save, and keeps it to redo later", async () => {
    const editor = await renderEditor();
    await act(async () => {
      editor.view.pasteText(PASTED);
    });
    const refused = vi.fn();
    await renderEditor(refused);
    const history = yUndoPluginKey.getState(editor.state)!.undoManager;
    sentBytes = [];

    await act(async () => {
      runPersistableHistoryCommand(editor, "undo");
    });

    expect(refused).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("Alpha paragraph");
    expect(Math.max(...sentBytes)).toBeLessThan(1024);
    const undone = bodyText();
    sentBytes = [];

    await act(async () => press(editor, "y"));
    await act(async () => press(editor, "z", true));

    expect(refused).toHaveBeenCalledTimes(2);
    expect(editor.getText()).toBe("Alpha paragraph");
    expect(bodyText()).toBe(undone);
    expect(sentBytes).toEqual([]);
    expect(history.redoStack).toHaveLength(1);

    await renderEditor();
    await act(async () => press(editor, "z", true));

    expect(editor.getText()).toContain(PASTED);
  });

  it("applies everything on a page whose body does not save through the doc", async () => {
    const editor = await renderEditor();

    await act(async () => {
      editor.view.pasteText(PASTED);
    });

    expect(editor.getText()).toContain(PASTED);
  });

  it("writes only what changed onto the server's copy, and takes no edits once frozen", async () => {
    let controller: VisualEditorPersistenceController | null = null;
    const editor = await renderEditor(vi.fn(), (next) => {
      controller = next;
    });
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(ydoc));
    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText(" typed"));
    });

    const vector = Y.encodeStateVector(server);
    controller!.writeBodyTo(server);
    const update = Y.encodeStateAsUpdate(server, vector);

    expect(server.getXmlFragment("default").toString()).toBe(bodyText());
    expect(update.length).toBeLessThan(1024);

    await act(async () => controller!.freeze());
    expect(editor.isEditable).toBe(false);
    server.destroy();
  });
});
