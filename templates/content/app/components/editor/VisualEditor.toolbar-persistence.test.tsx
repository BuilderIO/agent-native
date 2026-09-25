// @vitest-environment happy-dom

import { docToNfm } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
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
  getSelectionNotionSpanAttribute,
  setSelectionNotionSpanAttribute,
} from "./BubbleToolbar";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import { createVisualEditorExtensions, VisualEditor } from "./VisualEditor";

describe("collaborative toolbar persistence", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let ydoc: Y.Doc;
  const baseline = "Indent sample.\n*Heading* sample.";

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

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }

  async function mount(initialContent = baseline) {
    let authoritativeContent = initialContent;
    let revision = 0;
    const onChange = vi.fn((value: string) => {
      authoritativeContent = value;
      revision += 1;
      render();
    });
    const onSaveContent = vi.fn(() => true);
    const render = () =>
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
                content: authoritativeContent,
                contentUpdatedAt: "2026-09-09T00:00:00.000Z",
                contentRevision: `toolbar-${revision}`,
                onChange,
                onSaveContent,
                ydoc,
                collabSynced: true,
                editable: true,
              }),
            ),
          ),
        ),
      );
    await act(async () => render());
    await settle();
    const editor = captured.editor!;
    expect(docToNfm(editor.getJSON())).toBe(initialContent);
    let headingFrom = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === "Heading") headingFrom = position;
    });
    expect(headingFrom).toBeGreaterThan(0);
    act(() => {
      editor.commands.setTextSelection({
        from: headingFrom,
        to: headingFrom + 7,
      });
      editor.view.dom.focus();
    });
    await settle();
    expect(editor.isFocused).toBe(true);
    onChange.mockClear();
    onSaveContent.mockClear();
    const updates: Array<{
      focused: boolean;
      explicit: boolean;
      remote: boolean;
      uiEvent: unknown;
      markdown: string;
    }> = [];
    editor.on("update", ({ transaction }) => {
      updates.push({
        focused: editor.isFocused,
        explicit: transaction.getMeta(LOCAL_FILE_USER_EDIT_META) === true,
        remote: isChangeOrigin(transaction),
        uiEvent: transaction.getMeta("uiEvent"),
        markdown: docToNfm(editor.getJSON()),
      });
    });
    return {
      editor,
      onChange,
      onSaveContent,
      updates,
      headingFrom,
      savedContent: () => authoritativeContent,
    };
  }

  it.each(["paragraph", 1, 2, 3, 4] as const)(
    "persists %s chosen while the real text-style popover owns focus",
    async (style) => {
      const { editor, onChange, onSaveContent, updates, savedContent } =
        await mount(
          style === "paragraph"
            ? "Indent sample.\n## *Heading* sample."
            : baseline,
        );
      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label^="editor.slash.turnInto:"]',
      )!;
      const trailingBlock = editor.state.doc.lastChild?.toJSON();
      if (style === "paragraph") {
        expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
        expect(editor.state.doc.lastChild?.content.size).toBe(0);
      }
      expect(trigger).not.toBeNull();
      act(() => trigger.click());
      await settle();
      const menu = container.querySelector<HTMLElement>(
        '[role="menu"][aria-label="editor.slash.turnInto"]',
      )!;
      expect(menu).not.toBeNull();
      expect(menu.contains(document.activeElement)).toBe(true);
      expect(editor.isFocused).toBe(false);
      const choice = Array.from(
        menu.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) =>
        button.textContent?.includes(
          style === "paragraph"
            ? "editor.slash.text"
            : `editor.heading${style}`,
        ),
      )!;
      act(() => {
        choice.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerType: "mouse",
            button: 0,
          }),
        );
      });
      expect(
        style === "paragraph"
          ? editor.isActive("paragraph")
          : editor.isActive("heading", { level: style }),
      ).toBe(true);
      expect(editor.isActive("italic")).toBe(true);
      await settle();
      const expected = `Indent sample.\n${style === "paragraph" ? "" : "#".repeat(style) + " "}*Heading* sample.${style === "paragraph" ? "\n<empty-block/>" : ""}`;
      if (style === "paragraph")
        expect(editor.state.doc.lastChild?.toJSON()).toEqual(trailingBlock);
      expect(docToNfm(editor.getJSON())).toBe(expected);
      expect(
        updates.some(
          (update) => !update.focused && update.markdown === expected,
        ),
      ).toBe(true);
      expect(onSaveContent).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledWith(expected);
      expect(onChange).toHaveBeenCalledOnce();
      expect(savedContent()).toBe(expected);
      expect(
        updates.find((update) => update.markdown === expected)?.explicit,
      ).toBe(true);
    },
  );

  it.each(["bold", "italic", "underline", "strikethrough", "code"])(
    "persists keyboard-activated %s while its actual toolbar button owns focus",
    async (mark) => {
      const { editor, onChange, updates, savedContent } = await mount();
      const button = container.querySelector<HTMLButtonElement>(
        `button[aria-label="editor.${mark}"]`,
      )!;
      expect(button).not.toBeNull();
      act(() => button.focus());
      expect(editor.isFocused).toBe(false);
      act(() => button.click());
      await settle();
      const expected = docToNfm(editor.getJSON());
      expect(expected.startsWith("Indent sample.\n")).toBe(true);
      expect(editor.state.doc.textContent).toBe(
        "Indent sample.Heading sample.",
      );
      if (mark === "underline")
        expect(getSelectionNotionSpanAttribute(editor, "underline")).toBe(
          "true",
        );
      else
        expect(
          editor.isActive(mark === "strikethrough" ? "strike" : mark),
        ).toBe(mark !== "italic");
      expect(onChange).toHaveBeenCalledWith(expected);
      expect(onChange).toHaveBeenCalledOnce();
      expect(savedContent()).toBe(expected);
      expect(
        updates.find((update) => update.markdown === expected)?.explicit,
      ).toBe(true);
    },
  );

  it("still emits ordinary focused typing", async () => {
    const { editor, onChange, headingFrom } = await mount();
    act(() => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "x",
          code: "KeyX",
          keyCode: 88,
          bubbles: true,
        }),
      );
      editor.view.dispatch(
        editor.state.tr.insertText("x", headingFrom, headingFrom),
      );
    });
    await settle();
    expect(onChange).toHaveBeenCalledWith(docToNfm(editor.getJSON()));
  });

  it.each(["color", "bgColor"] as const)(
    "persists explicit %s from the real color popover",
    async (attribute) => {
      const { editor, onChange, updates, savedContent } = await mount();
      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="editor.color.label"]',
      )!;
      act(() => trigger.click());
      await settle();
      expect(editor.isFocused).toBe(false);
      const label =
        attribute === "color" ? "editor.textColor" : "editor.backgroundColor";
      const choice = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}: editor.color.red"]`,
      )!;
      expect(choice).not.toBeNull();
      act(() =>
        choice.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerType: "mouse",
            button: 0,
          }),
        ),
      );
      await settle();
      expect(getSelectionNotionSpanAttribute(editor, attribute)).toBe(
        attribute === "color" ? "red" : "red_bg",
      );
      const expected = docToNfm(editor.getJSON());
      expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
      expect(savedContent()).toBe(expected);
      expect(updates.some((update) => !update.focused && update.explicit)).toBe(
        true,
      );
    },
  );

  it.each(["heading", "bold", "color"])(
    "ignores stale %s callbacks after editability is revoked",
    async (kind) => {
      const { editor, onChange } = await mount();
      let target: HTMLButtonElement;
      if (kind === "heading") {
        act(() =>
          container
            .querySelector<HTMLButtonElement>(
              'button[aria-label^="editor.slash.turnInto:"]',
            )!
            .click(),
        );
        await settle();
        target = Array.from(
          container.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemradio"]',
          ),
        ).find((button) => button.textContent?.includes("editor.heading2"))!;
      } else if (kind === "color") {
        act(() =>
          container
            .querySelector<HTMLButtonElement>(
              'button[aria-label="editor.color.label"]',
            )!
            .click(),
        );
        await settle();
        target = container.querySelector<HTMLButtonElement>(
          'button[aria-label="editor.textColor: editor.color.red"]',
        )!;
      } else
        target = container.querySelector<HTMLButtonElement>(
          'button[aria-label="editor.bold"]',
        )!;
      const before = editor.getJSON();
      const selection = editor.state.selection.toJSON();
      act(() => {
        editor.setEditable(false, false);
        expect(editor.isEditable).toBe(false);
        target.click();
        expect(
          setSelectionNotionSpanAttribute(editor, "underline", "true"),
        ).toBe(false);
      });
      await settle();
      expect(editor.getJSON()).toEqual(before);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each(["heading", "mark"])(
    "emits explicitly attributed %s intent while toolbar focus is delayed",
    async (kind) => {
      const { editor, onChange, updates } = await mount();
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="editor.bold"]',
      )!;
      act(() => button.focus());
      expect(editor.isFocused).toBe(false);
      act(() => {
        const chain = editor.chain().command(({ tr }) => {
          tr.setMeta(LOCAL_FILE_USER_EDIT_META, true);
          return true;
        });
        if (kind === "heading") chain.setHeading({ level: 2 }).focus().run();
        else chain.toggleBold().focus().run();
      });
      await settle();
      expect(onChange).toHaveBeenCalledWith(docToNfm(editor.getJSON()));
      expect(updates.some((update) => !update.focused && update.explicit)).toBe(
        true,
      );
    },
  );

  it("does not emit passive metadata or a real remote Yjs update", async () => {
    const { editor, onChange } = await mount();
    const peerDoc = new Y.Doc();
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(ydoc));
    const peerMount = document.createElement("div");
    document.body.append(peerMount);
    const peer = new Editor({
      element: peerMount,
      extensions: createVisualEditorExtensions({ ydoc: peerDoc }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    peerDoc.on("update", (update) => Y.applyUpdate(ydoc, update, "peer"));
    try {
      act(() => {
        editor.view.dom.blur();
        editor.view.dispatch(editor.state.tr.setMeta("toolbar-control", true));
        peer.view.dispatch(peer.state.tr.insertText("Remote ", 1));
      });
      await settle();
      expect(editor.state.doc.textContent).toContain("Remote Indent");
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      peer.destroy();
      peerDoc.destroy();
      peerMount.remove();
    }
  });
});
