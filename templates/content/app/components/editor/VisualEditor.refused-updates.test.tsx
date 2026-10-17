// @vitest-environment happy-dom

import { COLLAB_MAX_UPDATE_BYTES } from "@agent-native/core/client/collab";
import { nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { prosemirrorToYDoc } from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";

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
  VisualEditor,
  type VisualEditorPersistenceController,
} from "./VisualEditor";

// Larger than one update the collab server takes.
const PASTED = "x".repeat(1_600_000);

describe("a switched page's editor", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let ydoc: Y.Doc;
  let sentBytes: number[];

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
    ydoc = prosemirrorToYDoc(
      getContentEditorSchema().nodeFromJSON(nfmToDoc("Alpha paragraph")),
      "default",
    );
    sentBytes = [];
    ydoc.on("update", (update: Uint8Array) => sentBytes.push(update.length));
    captured.editor = null;
  });

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
                content: "Alpha paragraph",
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
