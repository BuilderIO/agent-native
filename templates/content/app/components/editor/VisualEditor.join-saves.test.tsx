// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor, getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";

const captured = vi.hoisted(() => ({
  editor: null as Editor | null,
  slash: null as {
    onDraftCommitted?: () => unknown;
    onDraftPersisted?: (markdown: string) => unknown;
  } | null,
  realSlashMenu: false,
}));
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
vi.mock("./SlashCommandMenu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./SlashCommandMenu")>();
  return {
    ...actual,
    SlashCommandMenu: (
      props: Parameters<typeof actual.SlashCommandMenu>[0],
    ) => {
      captured.slash = props;
      return captured.realSlashMenu
        ? createElement(actual.SlashCommandMenu, props)
        : null;
    },
  };
});

import { createVisualEditorExtensions, VisualEditor } from "./VisualEditor";

// The live doc holds a word another tab has not saved yet; the stored body
// holds an agent edit the live doc lacks. Saving the live doc deletes the edit.
const LIVE = "Alpha paragraph\n\nBravo paragraph live";
const STORED = "Alpha paragraph agent\n\nBravo paragraph";
interface StoredBody {
  content: string;
  contentRevision: string;
  contentUpdatedAt: string;
}
const STORED_BODY: StoredBody = {
  content: STORED,
  contentRevision: "body:2:stored",
  contentUpdatedAt: "2026-10-16T00:00:00.000Z",
};
// The editor refuses any change that removes a source component's block.
const LOCKED_SOURCE = {
  type: "registryBlock",
  attrs: {
    blockType: "source-component",
    blockId: "locked",
    __raw: '<SourceComponent id="locked" />',
  },
};

describe("a joining editor's saves", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let ydoc: Y.Doc;
  let awareness: Awareness;

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
    awareness = new Awareness(ydoc);
    captured.slash = null;
    captured.realSlashMenu = false;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => root.unmount());
    queryClient.clear();
    awareness.destroy();
    ydoc.destroy();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function settle(ms = 100) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  const discovery = {
    pending: () => new Promise<never>(() => {}),
    ready: async () => ({ status: "ready" as const }),
    failed: async () => ({
      status: "failed" as const,
      error: new Error("presence failed"),
    }),
  };

  async function mount(
    join: keyof typeof discovery,
    live = LIVE,
    extraBlocks: object[] = [],
    stored = STORED_BODY,
  ) {
    const liveDoc = nfmToDoc(live);
    prosemirrorJSONToYXmlFragment(
      getSchema(createVisualEditorExtensions()),
      { ...liveDoc, content: [...(liveDoc.content ?? []), ...extraBlocks] },
      ydoc.getXmlFragment("default"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSaveContent = vi.fn(async () => "persisted" as const);
    const onChange = vi.fn();
    const render = (body: StoredBody) =>
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
                ...body,
                onChange,
                onSaveContent,
                ydoc,
                awareness,
                collabSynced: true,
                editable: true,
                discoverCollabPeers: discovery[join],
                requestCollabSync: async () => ({ status: "synced" as const }),
                flushCollabUpdates: async () => true,
              }),
            ),
          ),
        ),
      );
    await act(async () => render(stored));
    return {
      onSaveContent,
      onChange,
      show: (body: StoredBody) => act(() => render(body)),
    };
  }

  async function open(join: "pending" | "failed", live = LIVE) {
    const saves = await mount(join, live);
    await settle();
    const editor = captured.editor!;
    expect(editor.isEditable).toBe(false);
    return { editor, ...saves };
  }

  it.each(["pending", "failed"] as const)(
    "refuses a slash command's body while the join is %s",
    async (join) => {
      const { editor, onSaveContent, onChange } = await open(join);
      // A command edits the doc without the update the join's guards see.
      act(() =>
        editor.view.dispatch(
          editor.state.tr.insertText(
            " mine",
            editor.state.doc.content.size - 1,
          ),
        ),
      );
      let persisted: unknown;
      let committed: unknown;
      await act(async () => {
        persisted = await captured.slash!.onDraftPersisted!(`${LIVE} mine`);
        committed = await captured.slash!.onDraftCommitted!();
      });
      await settle(10);
      expect(persisted).toBe(false);
      expect(committed).toBe(false);
      expect(onSaveContent).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("saves nothing typed or received between its seed and its first reconcile", async () => {
    vi.useFakeTimers();
    const { onSaveContent, onChange } = await mount("pending");
    // The seed's timer fires; the first reconcile runs 25 ms later.
    await act(async () => vi.advanceTimersByTimeAsync(1));
    const editor = captured.editor!;
    const editableInGap = editor.isEditable;
    act(() =>
      editor.view.dispatch(
        editor.state.tr
          .insertText(" mine", editor.state.doc.content.size - 1)
          .setMeta("uiEvent", "input"),
      ),
    );
    act(() =>
      ydoc.transact(() => {
        const paragraph = ydoc.getXmlFragment("default").get(0) as Y.XmlElement;
        (paragraph.get(0) as Y.XmlText).insert(0, "remote ");
      }, "peer"),
    );
    expect(editor.getText()).toContain("remote Alpha");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(onSaveContent).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(editableInGap).toBe(false);
  });

  it("saves nothing typed before it applies a stored body no collaborator holds", async () => {
    vi.useFakeTimers();
    // It leads, and applies once the other open tab settles.
    ydoc.clientID = 1;
    awareness.setLocalState({ user: { name: "C" } });
    awareness.getStates().set(42, { user: { name: "Peer" } });
    const { onSaveContent, onChange } = await mount("ready");
    await act(async () => vi.advanceTimersByTimeAsync(100));
    const editor = captured.editor!;
    expect(editor.getText()).not.toContain("agent");
    const editableBeforeApply = editor.isEditable;
    act(() =>
      editor.view.dispatch(
        editor.state.tr
          .insertText(" mine", editor.state.doc.content.size - 1)
          .setMeta("uiEvent", "input"),
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(onSaveContent).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(editableBeforeApply).toBe(false);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(editor.getText()).toContain("agent");
    expect(editor.isEditable).toBe(true);
  });

  it("saves nothing when the doc matches an older stored body than one it saw", async () => {
    vi.useFakeTimers();
    // It opens on an older body, sees the agent edit while it waits, then
    // gets the older body again, as a delayed response delivers it.
    const older: StoredBody = {
      content: "Alpha paragraph\n\nBravo paragraph",
      contentRevision: "body:1:older",
      contentUpdatedAt: "2026-10-15T00:00:00.000Z",
    };
    const { onSaveContent, onChange, show } = await mount(
      "pending",
      LIVE,
      [],
      older,
    );
    await act(async () => vi.advanceTimersByTimeAsync(100));
    show(STORED_BODY);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    // The other tab takes its word back.
    act(() =>
      ydoc.transact(() => {
        const paragraph = ydoc.getXmlFragment("default").get(1) as Y.XmlElement;
        const text = paragraph.get(0) as Y.XmlText;
        text.delete(text.length - " live".length, " live".length);
      }, "peer"),
    );
    const editor = captured.editor!;
    expect(editor.getText()).not.toContain("live");
    show(older);
    await act(async () => vi.advanceTimersByTimeAsync(100));

    let persisted: unknown;
    await act(async () => {
      persisted = await captured.slash!.onDraftPersisted!(older.content);
    });
    expect(persisted).toBe(false);
    expect(editor.isEditable).toBe(false);
    expect(awareness.getLocalState()?.reconciledRevision).toBeUndefined();
    expect(onSaveContent).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("saves nothing, and says so, when a locked block refuses the stored body", async () => {
    vi.useFakeTimers();
    ydoc.clientID = 1;
    awareness.setLocalState({ user: { name: "C" } });
    awareness.getStates().set(42, { user: { name: "Peer" } });
    const { onSaveContent, onChange } = await mount("ready", LIVE, [
      LOCKED_SOURCE,
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    const editor = captured.editor!;

    expect(editor.getText()).not.toContain("agent");
    expect(editor.isEditable).toBe(false);
    expect(awareness.getLocalState()?.reconciledRevision).toBeUndefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "empty.genericError",
    );
    let persisted: unknown;
    await act(async () => {
      persisted = await captured.slash!.onDraftPersisted!(LIVE);
    });
    expect(persisted).toBe(false);
    expect(onSaveContent).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed"] as const)(
    "keeps the slash menu shut while the join is %s",
    async (join) => {
      captured.realSlashMenu = true;
      const { editor, onSaveContent, onChange } = await open(
        join,
        `${LIVE}\n\n/`,
      );
      act(() =>
        editor.commands.setTextSelection(editor.state.doc.content.size - 1),
      );
      await settle(20);
      expect(
        Array.from(container.querySelectorAll("button")).some((button) =>
          button.textContent?.includes("editor.heading1"),
        ),
      ).toBe(false);
      expect(onSaveContent).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    },
  );
});
