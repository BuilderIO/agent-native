// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor, getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";

const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
const reports = vi.hoisted(() => [] as unknown[][]);
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
vi.mock("./live-body-parity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./live-body-parity")>()),
  reportLiveBodyParity: (...args: unknown[]) => reports.push(args),
}));

import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import { LIVE_BODY_PARITY_QUIET_MS } from "./live-body-parity";
import { createVisualEditorExtensions, VisualEditor } from "./VisualEditor";

describe("live body parity in the editor", () => {
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
    prosemirrorJSONToYXmlFragment(
      getSchema(createVisualEditorExtensions()),
      nfmToDoc("Alpha paragraph"),
      ydoc.getXmlFragment("default"),
    );
    reports.length = 0;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    ydoc.destroy();
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function settle(ms: number) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  async function render(observeLiveBody: boolean) {
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
                contentUpdatedAt: "2026-10-06T00:00:00.000Z",
                contentRevision: "parity-0",
                onChange: () => {},
                ydoc,
                observeLiveBody,
                collabSynced: true,
                editable: true,
              }),
            ),
          ),
        ),
      ),
    );
    await settle(100);
  }

  function type(text: string) {
    const editor = captured.editor!;
    act(() => {
      editor.view.dom.focus();
      editor.view.dispatch(
        editor.state.tr
          .insertText(text, editor.state.doc.content.size - 1)
          .setMeta(LOCAL_FILE_USER_EDIT_META, true),
      );
    });
  }

  it("compares the body once the editor goes quiet after an edit", async () => {
    await render(true);
    type(" typed");
    await settle(LIVE_BODY_PARITY_QUIET_MS / 2);
    type(" more");
    await settle(LIVE_BODY_PARITY_QUIET_MS / 2);
    expect(reports).toEqual([]);

    await settle(LIVE_BODY_PARITY_QUIET_MS);
    expect(reports).toEqual([
      ["page", expect.objectContaining({ outcome: "match" })],
    ]);
  });

  it("compares nothing while the shadow check is off", async () => {
    await render(false);
    type(" typed");
    await settle(LIVE_BODY_PARITY_QUIET_MS + 200);
    expect(reports).toEqual([]);
  });

  it("drops a pending comparison when the editor unmounts", async () => {
    await render(true);
    type(" typed");
    await act(async () => root.unmount());
    root = createRoot(container);
    await settle(LIVE_BODY_PARITY_QUIET_MS + 200);
    expect(reports).toEqual([]);
  });
});
