// @vitest-environment happy-dom

import { canonicalizeNfm, docToNfm } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
const report = vi.hoisted(() => vi.fn());
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
vi.mock("./editor-merge-telemetry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-merge-telemetry")>();
  return {
    ...actual,
    reportEditorMerge: actual.createEditorMergeReporter(report),
  };
});

import { VisualEditor } from "./VisualEditor";

interface Snapshot {
  content: string;
  revision: string;
  updatedAt: string;
}

const opened: Snapshot = {
  content: "Intro.\n\n1. One\n2. Two",
  revision: "rev-1",
  updatedAt: new Date(1_000).toISOString(),
};

const agentAppended: Snapshot = {
  content: "Intro.\n\n1. One\n2. Two\n3. Three",
  revision: "rev-2",
  updatedAt: new Date(2_000).toISOString(),
};

describe("VisualEditor merge counts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let merges: Array<{ status: string; content: string }>;

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
    merges = [];
    report.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    captured.editor = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function settle(ms: number) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  async function show(snapshot: Snapshot) {
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
                content: snapshot.content,
                contentUpdatedAt: snapshot.updatedAt,
                contentRevision: snapshot.revision,
                onChange: () => {},
                onBaseAwareReconcile: (result) =>
                  merges.push({
                    status: result.status,
                    content: result.content,
                  }),
                ydoc: null,
                editable: true,
              }),
            ),
          ),
        ),
      ),
    );
    await settle(100);
  }

  function editor(): Editor {
    if (!captured.editor) throw new Error("The editor did not mount.");
    return captured.editor;
  }

  function shownBody(): string {
    return canonicalizeNfm(docToNfm(editor().getJSON() as never));
  }

  it("counts an agent's item added to a closing list once, as kept_all, while delivery hangs", async () => {
    report.mockReturnValue(new Promise(() => {}));
    await show(opened);
    act(() => {
      editor().commands.setTextSelection(1);
    });
    expect(editor().state.doc.lastChild!.content.size, "the filler line").toBe(
      0,
    );

    await show(agentAppended);
    await show(agentAppended);

    expect(shownBody()).toBe(canonicalizeNfm(agentAppended.content));
    expect(report.mock.calls.map(([event]) => event)).toEqual([
      { id: "page", outcome: "kept_all" },
    ]);
  });

  it("counts a change set aside for the tab's own edit, and saves the same when delivery throws", async () => {
    report.mockImplementation(() => {
      throw new Error("telemetry failed");
    });
    await show(opened);
    const { doc } = editor().state;
    act(() => {
      editor().view.dispatch(
        editor().state.tr.insertText(
          " local",
          doc.child(0).nodeSize + doc.child(1).nodeSize - 3,
        ),
      );
    });
    const local = shownBody();

    await show(agentAppended);

    expect(shownBody()).toBe(local);
    expect(merges.map((merge) => merge.status)).toEqual(["merged"]);
    expect(canonicalizeNfm(merges[0]!.content)).toBe(local);
    expect(report.mock.calls.map(([event]) => event)).toEqual([
      { id: "page", outcome: "set_aside" },
    ]);
  });
});
