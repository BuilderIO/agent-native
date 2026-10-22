// @vitest-environment happy-dom

import { docToNfm, nfmToDoc, type PMDoc, type PMNode } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type Editor, getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { act, type ComponentProps, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
const hydration = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
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
vi.mock("@shared/nfm-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/nfm-registry")>();
  return {
    ...actual,
    parseRegistryBlockData: async (
      ...args: Parameters<typeof actual.parseRegistryBlockData>
    ) => {
      await hydration.hold;
      return actual.parseRegistryBlockData(...args);
    },
  };
});
vi.mock("@/local-components", async () => {
  const { createElement } = await import("react");
  return {
    localContentComponents: {
      Hero: ({ title }: { title?: string }) =>
        createElement("section", null, title),
    },
    localContentComponentInputs: { Hero: { title: { type: "string" } } },
  };
});

import {
  createVisualEditorExtensions,
  runPersistableHistoryCommand,
  VisualEditor,
  type VisualEditorHistoryController,
} from "./VisualEditor";

type VisualEditorProps = ComponentProps<typeof VisualEditor>;

const mermaid = '<Mermaid id="mermaid-1" source="graph TD; A --> B" />';

function cell(type: "tableHeader" | "tableCell", text: string): PMNode {
  return {
    type,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function tableDoc(headerRow: boolean): PMDoc {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { headerRow, headerColumn: false },
        content: [
          {
            type: "tableRow",
            content: [cell("tableHeader", "Name"), cell("tableHeader", "Role")],
          },
          {
            type: "tableRow",
            content: [cell("tableCell", "Ada"), cell("tableCell", "Author")],
          },
        ],
      },
    ],
  };
}

// An older Y.Doc can hold header cells whose table attributes say otherwise,
// which the editor repairs as soon as it opens the page.
const tableWithStaleHeaders = tableDoc(false);
const savedTable = docToNfm(tableDoc(true));

describe("opening a page", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let ydoc: Y.Doc;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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
    captured.editor = null;
    hydration.hold = null;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => root.unmount());
    queryClient.clear();
    ydoc.destroy();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function settle(ms = 150) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  async function open(props: Partial<VisualEditorProps> & { content: string }) {
    const opened = mount(props);
    await settle(300);
    return opened;
  }

  // Renders without letting timers run, so the live copy's seed check, which
  // waits for a timer, hasn't finished yet.
  function mount(props: Partial<VisualEditorProps> & { content: string }) {
    const onChange = vi.fn();
    const onSaveContent = vi.fn(() => true);
    const render = (next: Partial<VisualEditorProps> = {}) =>
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
                contentUpdatedAt: "2026-10-21T00:00:00.000Z",
                contentRevision: "open-1",
                onChange,
                onSaveContent,
                editable: true,
                ...props,
                ...next,
              }),
            ),
          ),
        ),
      );
    act(() => render());
    const editor = captured.editor!;
    expect(editor).not.toBeNull();
    return { editor, onChange, onSaveContent, render };
  }

  function writeLiveCopy(doc: Y.Doc, markdown: string) {
    prosemirrorJSONToYXmlFragment(
      getSchema(createVisualEditorExtensions()),
      nfmToDoc(markdown),
      doc.getXmlFragment("default"),
    );
  }

  function livePage(markdown: string) {
    writeLiveCopy(ydoc, markdown);
    return {
      content: markdown,
      documentId: "page-1",
      ydoc,
      collabSynced: true,
    };
  }

  // Another tab's change, arriving over the live copy.
  function receive(markdown: string) {
    act(() => {
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(ydoc));
      writeLiveCopy(remote, markdown);
      Y.applyUpdate(
        ydoc,
        Y.encodeStateAsUpdate(remote, Y.encodeStateVector(ydoc)),
        "remote",
      );
      remote.destroy();
    });
  }

  function registrySources(editor: Editor) {
    const raws: string[] = [];
    editor.state.doc.forEach((node) => {
      if (node.type.name === "registryBlock") raws.push(node.attrs.__raw);
    });
    return raws;
  }

  // A person's input that lands before the live copy's seed check finishes.
  function editBeforeSeedCheck(
    editor: Editor,
    inputType: string,
    edit: (editor: Editor) => void,
  ) {
    act(() => {
      editor.view.dom.focus();
      editor.view.dom.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType,
        }),
      );
      edit(editor);
    });
  }

  // Focus, clicks and selection changes run every selection-only path the
  // editor has, including the trailing paragraph it appends after media.
  async function clickAround(editor: Editor) {
    act(() => {
      editor.view.dom.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
      editor.commands.focus("start");
      editor.view.dom.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true }),
      );
      editor.view.dom.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    act(() => {
      editor.commands.focus("end");
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      editor.commands.blur();
    });
    await settle();
  }

  function expectNoSave({
    onChange,
    onSaveContent,
  }: {
    onChange: ReturnType<typeof vi.fn>;
    onSaveContent: ReturnType<typeof vi.fn>;
  }) {
    expect(onChange).not.toHaveBeenCalled();
    expect(onSaveContent).not.toHaveBeenCalled();
  }

  it("does not save the header repair on a table from the live document", async () => {
    prosemirrorJSONToYXmlFragment(
      getSchema(createVisualEditorExtensions()),
      tableWithStaleHeaders,
      ydoc.getXmlFragment("default"),
    );
    const opened = await open({
      content: savedTable,
      ydoc,
      collabSynced: true,
    });
    expect(opened.editor.state.doc.firstChild?.type.name).toBe("table");
    expect(opened.editor.state.doc.firstChild?.attrs.headerRow).toBe(true);
    await clickAround(opened.editor);
    expectNoSave(opened);
  });

  it("does not save a local-file page with a table", async () => {
    const opened = await open({
      content: savedTable,
      localFileMode: true,
      localFilePath: "docs/team.md",
    });
    expect(opened.editor.state.doc.firstChild?.attrs.headerRow).toBe(true);
    await clickAround(opened.editor);
    expectNoSave(opened);
  });

  it("does not save the source it rewrites for registry blocks that share an id", async () => {
    const opened = await open({
      content: `${mermaid}\n\n${mermaid}`,
      ydoc,
      collabSynced: true,
    });
    await vi.waitFor(() => {
      const raws = registrySources(opened.editor);
      expect(raws).toHaveLength(2);
      expect(raws[1]).not.toBe(mermaid);
    });
    await clickAround(opened.editor);
    expectNoSave(opened);
  });

  it("saves the source it rewrites for a block the user duplicates with the next edit", async () => {
    const opened = await open({ content: mermaid, ydoc, collabSynced: true });
    act(() => {
      const block = opened.editor.state.doc.firstChild!;
      opened.editor.view.dispatch(
        opened.editor.state.tr.insert(block.nodeSize, block),
      );
    });
    await vi.waitFor(() => {
      const raws = registrySources(opened.editor);
      expect(raws).toHaveLength(2);
      expect(raws[1]).not.toBe(mermaid);
    });
    await settle();
    expect(opened.onChange).toHaveBeenCalledOnce();
    act(() => {
      const { schema, tr, doc } = opened.editor.state;
      opened.editor.view.dispatch(
        tr.insert(
          doc.content.size,
          schema.nodes.paragraph.create(null, schema.text("Note.")),
        ),
      );
    });
    await settle();
    expect(opened.onChange).toHaveBeenCalledTimes(2);
    const saved: string = opened.onChange.mock.lastCall?.[0];
    expect(saved).toBe(docToNfm(opened.editor.getJSON() as PMDoc));
    expect(saved.match(/id="mermaid-1"/g)).toHaveLength(1);
  });

  // Hydration is held, so this tab's copy is still waiting for its rewrite
  // when another tab's copy of the block arrives.
  it("does not save the source it rewrites for another tab's copy of a block", async () => {
    let release!: () => void;
    hydration.hold = new Promise((resolve) => {
      release = resolve;
    });
    const opened = await open(livePage(mermaid));
    act(() => {
      const block = opened.editor.state.doc.firstChild!;
      opened.editor.view.dispatch(
        opened.editor.state.tr.insert(block.nodeSize, block),
      );
    });
    await settle();
    expect(opened.onChange).toHaveBeenCalledOnce();
    const copyId = String(opened.editor.state.doc.child(1).attrs.blockId);
    const repairedCopy = mermaid.replace("mermaid-1", copyId);
    receive(`${mermaid}\n\n${mermaid}\n\n${repairedCopy}`);
    release();
    await vi.waitFor(() => {
      const raws = registrySources(opened.editor);
      expect(raws).toHaveLength(3);
      expect(new Set(raws).size).toBe(3);
    });
    await settle();
    expect(opened.onChange).toHaveBeenCalledOnce();
  });

  it("does not save a local-file page with MDX components", async () => {
    const opened = await open({
      content: 'Intro.\n\n<Hero title="Launch" />',
      localFileMode: true,
      localFilePath: "docs/launch.mdx",
    });
    expect(
      container.querySelector('[data-local-mdx-component="Hero"] section')
        ?.textContent,
    ).toBe("Launch");
    await clickAround(opened.editor);
    expectNoSave(opened);
  });

  // The editor adds a paragraph after a page that ends in media, during the
  // load of a live page and with the first selection change in a local file.
  it.each([
    [
      "a live page",
      "an image",
      "Intro.\n\n![Diagram](https://example.com/diagram.png)",
    ],
    [
      "a live page",
      "a video",
      'Intro.\n\n<video src="https://example.com/demo.mp4"></video>',
    ],
    [
      "a local file",
      "an image",
      "Intro.\n\n![Diagram](https://example.com/diagram.png)",
    ],
    [
      "a local file",
      "a video",
      'Intro.\n\n<video src="https://example.com/demo.mp4"></video>',
    ],
  ])("does not save %s that ends in %s", async (kind, _media, content) => {
    const opened = await open(
      kind === "a live page"
        ? { content, ydoc, collabSynced: true }
        : { content, localFileMode: true, localFilePath: "docs/media.md" },
    );
    await clickAround(opened.editor);
    expect(opened.editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expectNoSave(opened);
  });

  // Whether a video's source panel is open is stored on the video, so a page
  // can open with one left open.
  it("does not save or undo a click that closes a video's source panel", async () => {
    prosemirrorJSONToYXmlFragment(
      getSchema(createVisualEditorExtensions()),
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Intro." }] },
          {
            type: "video",
            attrs: {
              src: "https://example.com/demo.mp4",
              sourcePanelOpen: true,
            },
          },
          { type: "paragraph" },
        ],
      },
      ydoc.getXmlFragment("default"),
    );
    const opened = await open({
      content: 'Intro.\n\n<video src="https://example.com/demo.mp4"></video>',
      ydoc,
      collabSynced: true,
    });
    const panelOpen = () => {
      let open = false;
      opened.editor.state.doc.forEach((node) => {
        if (node.type.name === "video") open = node.attrs.sourcePanelOpen;
      });
      return open;
    };
    expect(panelOpen()).toBe(true);
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    await settle();
    expect(panelOpen()).toBe(false);
    expectNoSave(opened);
    act(() => {
      runPersistableHistoryCommand(opened.editor, "undo");
    });
    await settle();
    expect(panelOpen()).toBe(false);
    expectNoSave(opened);
  });

  // The block's menu, not the editor, has focus, and a save that leaves the
  // page empty needs evidence that a person made the change.
  it.each([
    [
      "image",
      "![Diagram](https://example.com/diagram.png)",
      "editor.media.moreImageActions",
    ],
    [
      "video",
      '<video src="https://example.com/demo.mp4"></video>',
      "editor.media.moreVideoActions",
    ],
    [
      "audio",
      '<audio src="https://example.com/demo.mp3"></audio>',
      "editor.media.moreAudioActions",
    ],
  ])(
    "saves the empty page left by deleting its only %s from the block's menu",
    async (_kind, markdown, moreLabel) => {
      const opened = await open(livePage(markdown));
      const more = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${moreLabel}"]`,
      );
      expect(more).not.toBeNull();
      act(() => {
        more!.focus();
        more!.click();
      });
      const remove = [
        ...document.body.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]',
        ),
      ].find((item) => item.textContent?.includes("editor.media.delete"));
      expect(remove).toBeDefined();
      act(() => {
        remove!.focus();
        remove!.click();
      });
      await settle();
      expect(opened.editor.isFocused).toBe(false);
      const saved = docToNfm(opened.editor.getJSON() as PMDoc);
      expect(saved).not.toContain("example.com");
      expect(opened.onChange).toHaveBeenCalledExactlyOnceWith(saved);
    },
  );

  it("does not save comment and suggestion highlights", async () => {
    const thread: CommentThread = {
      threadId: "t1",
      quotedText: "ships every Friday",
      prefix: null,
      suffix: null,
      startOffset: null,
      resolved: false,
      comments: [],
    };
    const opened = await open({
      content: "The release ships every Friday afternoon.",
      ydoc,
      collabSynced: true,
      commentThreads: [thread],
      showCommentIndicators: true,
      suggestions: [
        {
          id: "s1",
          kind: "replace_text",
          beforeText: "Friday",
          afterText: "Monday",
          anchor: {
            from: 0,
            prefix: "The release ships every ",
            suffix: " afternoon.",
          },
          presentation: "canonical",
        },
      ],
    });
    await act(async () =>
      opened.render({ activeThreadId: "t1", hoveredThreadId: "t1" }),
    );
    await settle();
    await act(async () =>
      opened.render({ activeSuggestionId: "s1", hoveredThreadId: null }),
    );
    await settle();
    await clickAround(opened.editor);
    expectNoSave(opened);
  });

  it("saves typing that lands before the live copy's seed check finishes", async () => {
    const opened = mount(livePage("Alpha paragraph."));
    editBeforeSeedCheck(opened.editor, "insertText", (editor) =>
      editor.view.dispatch(editor.state.tr.insertText("New ", 1)),
    );
    expect(opened.onChange).not.toHaveBeenCalled();
    await settle();
    expect(opened.onChange).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("New Alpha paragraph."),
    );
  });

  it("saves a block duplicated before the seed check finishes with the source it rewrites", async () => {
    const opened = mount({ ...livePage(mermaid), collabSynced: false });
    act(() => {
      const block = opened.editor.state.doc.firstChild!;
      opened.editor.view.dispatch(
        opened.editor.state.tr
          .insert(block.nodeSize, block)
          .setMeta("uiEvent", "dragHandle"),
      );
    });
    await vi.waitFor(() => {
      const raws = registrySources(opened.editor);
      expect(raws).toHaveLength(2);
      expect(raws[1]).not.toBe(mermaid);
    });
    const edited = docToNfm(opened.editor.getJSON() as PMDoc);
    expect(edited.match(/id="mermaid-1"/g)).toHaveLength(1);
    expect(opened.onChange).not.toHaveBeenCalled();
    act(() => opened.render({ collabSynced: true }));
    // The save goes out before the editor next reconciles with the stored
    // page, a timer later.
    await settle(0);
    await settle(0);
    expect(opened.onChange).toHaveBeenCalledExactlyOnceWith(edited);
  });

  it("does not save another tab's change that replaces an edit made before the seed check", async () => {
    const opened = mount(livePage("Alpha paragraph."));
    editBeforeSeedCheck(opened.editor, "insertText", (editor) =>
      editor.view.dispatch(editor.state.tr.insertText("New ", 1)),
    );
    receive("Replaced in another tab.");
    await settle();
    expect(opened.editor.state.doc.textContent).toBe(
      "Replaced in another tab.",
    );
    expectNoSave(opened);
  });

  it("does not save the seed that replaces a page emptied before the seed check", async () => {
    const stored = new Y.Doc();
    writeLiveCopy(stored, "Alpha paragraph.");
    const stateBase64 = btoa(
      String.fromCharCode(...Y.encodeStateAsUpdate(stored)),
    );
    stored.destroy();
    vi.mocked(fetch).mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).includes("seed-document-collab")
              ? { stateBase64 }
              : {},
          ),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const opened = mount(livePage("Alpha paragraph."));
    editBeforeSeedCheck(opened.editor, "deleteContentBackward", (editor) =>
      editor.view.dispatch(
        editor.state.tr.delete(1, editor.state.doc.content.size - 1),
      ),
    );
    await vi.waitFor(() =>
      expect(opened.editor.state.doc.textContent).toBe("Alpha paragraph."),
    );
    await settle();
    expectNoSave(opened);
  });

  it("does not save a restore that replaces an edit made before the seed check", async () => {
    let history: VisualEditorHistoryController | null = null;
    const opened = mount({
      ...livePage("Alpha paragraph."),
      collabSynced: false,
      onHistoryControllerChange: (controller) => {
        history = controller;
      },
    });
    editBeforeSeedCheck(opened.editor, "insertText", (editor) =>
      editor.view.dispatch(editor.state.tr.insertText("New ", 1)),
    );
    act(() => {
      expect(
        history!.replaceWithAuthoritativeContent({
          content: "Restored paragraph.",
          contentUpdatedAt: "2026-10-21T00:01:00.000Z",
          contentRevision: "restored-1",
        }),
      ).toBe(true);
    });
    act(() => opened.render({ collabSynced: true }));
    await settle();
    expect(opened.editor.state.doc.textContent).toBe("Restored paragraph.");
    expectNoSave(opened);
  });

  it("does not save a change made before the seed check without a person's input", async () => {
    const opened = mount(livePage("Alpha paragraph."));
    act(() => {
      opened.editor.view.dispatch(opened.editor.state.tr.insertText("New ", 1));
    });
    await settle();
    expectNoSave(opened);
  });

  it("saves the first real edit after opening", async () => {
    const opened = await open({
      content: "Alpha paragraph.",
      ydoc,
      collabSynced: true,
    });
    await clickAround(opened.editor);
    expectNoSave(opened);
    act(() => {
      opened.editor.view.dispatch(opened.editor.state.tr.insertText("New ", 1));
    });
    await settle();
    expect(opened.onChange).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("New Alpha paragraph."),
    );
  });
});
