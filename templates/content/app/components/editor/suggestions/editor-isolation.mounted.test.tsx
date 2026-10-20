// @vitest-environment happy-dom

import { docToNfm } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
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

import { visualEditorInstanceKey } from "../DocumentEditor";
import { VisualEditor } from "../VisualEditor";
import { suggestedEditorIsolation } from "./editor-isolation";

// Mounts the editor the way DocumentEditor does in Suggesting mode. Every
// route from the editor to `update-document` goes through one of the canonical
// callbacks, so none of them may fire while the author is suggesting.
describe("a Suggesting session when the Page changes elsewhere", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let ydoc: Y.Doc;

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
    ydoc = new Y.Doc();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    ydoc.destroy();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function settle(ms = 50) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  async function mountSuggesting(base: string, { canEdit = true } = {}) {
    const page = {
      draft: base,
      draftUpdatedAt: "2026-10-05T12:00:00.000Z",
      revision: "body:1",
      updatedAt: "2026-10-05T12:00:00.000Z",
    };
    const canonical = {
      save: vi.fn(() => true),
      reconcile: vi.fn(),
      snapshot: vi.fn(),
    };
    const render = () => {
      const isolation = suggestedEditorIsolation({
        suggesting: true,
        canSuggest: true,
        canEdit,
        collaborationReady: canEdit,
        canonicalUpdatedAt: page.updatedAt,
        draftUpdatedAt: page.draftUpdatedAt,
      });
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
                key: visualEditorInstanceKey({
                  documentId: "page-suggesting",
                  documentUpdatedAt: isolation.contentUpdatedAt,
                  isLocalFileDocument: false,
                  canEdit,
                  collabEditorEnabled: canEdit,
                  hasYDoc: isolation.bindCanonicalYDoc,
                }),
                documentId: "page-suggesting",
                content: page.draft,
                contentUpdatedAt: isolation.contentUpdatedAt,
                contentRevision: isolation.reconcileCanonical
                  ? page.revision
                  : null,
                onBaseAwareReconcile: isolation.reconcileCanonical
                  ? canonical.reconcile
                  : undefined,
                onRemoteSnapshotChange: isolation.reconcileCanonical
                  ? canonical.snapshot
                  : undefined,
                onSaveContent: isolation.persistCanonical
                  ? canonical.save
                  : undefined,
                ydoc: isolation.bindCanonicalYDoc ? ydoc : null,
                collabSynced: true,
                editable: isolation.editable,
                suggesting: true,
                onChange: (markdown: string) => {
                  page.draft = markdown;
                  render();
                },
              }),
            ),
          ),
        ),
      );
    };
    await act(async () => render());
    await settle();
    const editor = captured.editor!;
    expect(docToNfm(editor.getJSON())).toBe(base);
    const changeElsewhere = async (revision: string, updatedAt: string) => {
      page.revision = revision;
      page.updatedAt = updatedAt;
      await act(async () => render());
      // Past the editor's typing deferral and its retry.
      await settle(2_600);
    };
    const typeAtEnd = async (text: string, newParagraph = false) => {
      act(() => {
        const chain = editor
          .chain()
          .focus()
          .setTextSelection(editor.state.doc.content.size - 1);
        (newParagraph ? chain.splitBlock() : chain)
          .command(({ tr }) => {
            tr.insertText(text);
            return true;
          })
          .run();
      });
      await settle();
    };
    return { editor, page, canonical, changeElsewhere, typeAtEnd };
  }

  it("keeps a saved draft out of the Page", async () => {
    const { editor, page, canonical, changeElsewhere, typeAtEnd } =
      await mountSuggesting("First paragraph.\nSecond paragraph.");

    await typeAtEnd(" Suggested.");
    expect(page.draft).toBe("First paragraph.\nSecond paragraph. Suggested.");

    await changeElsewhere("body:2", "2026-10-05T12:00:05.000Z");

    expect(canonical.save).not.toHaveBeenCalled();
    expect(canonical.reconcile).not.toHaveBeenCalled();
    expect(canonical.snapshot).not.toHaveBeenCalled();
    expect(docToNfm(editor.getJSON())).toBe(page.draft);
  });

  it.each([
    ["an editor", true],
    ["a commenter", false],
  ])("keeps text the draft has not received yet for %s", async (_, canEdit) => {
    const { editor, page, canonical, changeElsewhere, typeAtEnd } =
      await mountSuggesting("First paragraph.\nSecond paragraph.", {
        canEdit,
      });

    // A slash-command draft is held back from onChange until it resolves.
    await typeAtEnd("/quo", true);
    expect(page.draft).toBe("First paragraph.\nSecond paragraph.");
    // The author looks away, so the editor no longer defers for typing.
    act(() => {
      editor.commands.blur();
    });
    await settle(1_700);

    await changeElsewhere("body:2", "2026-10-05T12:00:05.000Z");

    expect(canonical.save).not.toHaveBeenCalled();
    expect(canonical.reconcile).not.toHaveBeenCalled();
    expect(canonical.snapshot).not.toHaveBeenCalled();
    expect(captured.editor).toBe(editor);
    expect(editor.getText()).toContain("/quo");
  });
});
