// @vitest-environment happy-dom

import type { useT } from "@agent-native/core/client/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import esES from "../../i18n/es-ES";
import { InlineTextEditor } from "./inline-text-editor";
import type { ElementSnapshot } from "./types";

afterEach(cleanup);

const t = ((key: string) => {
  const [namespace, entry] = key.split(".");
  if (!namespace || !entry) return key;
  const messages = esES[namespace as keyof typeof esES] as
    | Record<string, string>
    | undefined;
  return messages?.[entry] ?? key;
}) as ReturnType<typeof useT>;

describe("InlineTextEditor formatting controls", () => {
  it("keeps selected-text formatting offsets relative to the slide text", async () => {
    const node: ElementSnapshot = {
      nodeId: "text-1",
      line: 1,
      column: 1,
      tagName: "h1",
      bounds: { x: 100, y: 120, width: 400, height: 80 },
      text: "Hello",
      styles: { fontSize: "24px" },
    };
    const onCommit = vi.fn(async () => true);

    render(
      <InlineTextEditor
        node={node}
        disabled={false}
        t={t}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: t("styleInspector.text"),
    });
    const textNode = editor.firstChild;
    if (!textNode) throw new Error("Expected the editable slide text");
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.click(
      screen.getByRole("button", { name: t("slideTextMenu.bold") }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("designSystemSetup.saveChanges"),
      }),
    );

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith([
      {
        line: 1,
        column: 1,
        ops: [
          {
            kind: "set-text-range-style",
            start: 1,
            end: 4,
            key: "fontWeight",
            value: "700",
            prevText: "Hello",
          },
        ],
      },
    ]);
  });

  it("saves edited text from the contenteditable slide surface", async () => {
    const node: ElementSnapshot = {
      nodeId: "text-1",
      line: 1,
      column: 1,
      tagName: "h1",
      bounds: { x: 100, y: 120, width: 400, height: 80 },
      text: "Hello",
      styles: { fontSize: "24px" },
    };
    const onCommit = vi.fn(async () => true);

    render(
      <InlineTextEditor
        node={node}
        disabled={false}
        t={t}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: t("styleInspector.text"),
    });
    editor.textContent = "Edited text";
    fireEvent.input(editor);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("designSystemSetup.saveChanges"),
      }),
    );

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith([
      {
        line: 1,
        column: 1,
        ops: [{ kind: "set-text", value: "Edited text", prevText: "Hello" }],
      },
    ]);
  });

  it("commits text and closes inline editing when Escape is pressed", async () => {
    const node: ElementSnapshot = {
      nodeId: "text-1",
      line: 1,
      column: 1,
      tagName: "h1",
      bounds: { x: 100, y: 120, width: 400, height: 80 },
      text: "Hello",
      styles: { fontSize: "24px" },
    };
    const onCommit = vi.fn(async () => true);
    const onCancel = vi.fn();

    render(
      <InlineTextEditor
        node={node}
        disabled={false}
        t={t}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: t("styleInspector.text"),
    });
    editor.textContent = "Edited text";
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith([
      {
        line: 1,
        column: 1,
        ops: [{ kind: "set-text", value: "Edited text", prevText: "Hello" }],
      },
    ]);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps inline editing open when the source commit fails", async () => {
    const node: ElementSnapshot = {
      nodeId: "text-1",
      line: 1,
      column: 1,
      tagName: "h1",
      bounds: { x: 100, y: 120, width: 400, height: 80 },
      text: "Hello",
      styles: { fontSize: "24px" },
    };
    const onCommit = vi.fn(async () => false);
    const onCancel = vi.fn();

    render(
      <InlineTextEditor
        node={node}
        disabled={false}
        t={t}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: t("styleInspector.text"),
    });
    editor.textContent = "Edited text";
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeNull();
  });

  it("does not consume Escape while an IME composition is active", () => {
    const node: ElementSnapshot = {
      nodeId: "text-1",
      line: 1,
      column: 1,
      tagName: "h1",
      bounds: { x: 100, y: 120, width: 400, height: 80 },
      text: "Hello",
      styles: { fontSize: "24px" },
    };
    const onCommit = vi.fn(async () => true);
    const onCancel = vi.fn();

    render(
      <InlineTextEditor
        node={node}
        disabled={false}
        t={t}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: t("styleInspector.text"),
    });
    const composingEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      isComposing: true,
    });
    Object.defineProperty(composingEscape, "keyCode", { value: 229 });
    fireEvent(editor, composingEscape);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("uses the last text selection when a formatting control takes focus", async () => {
    const node: ElementSnapshot = {
      nodeId: "text-1",
      line: 1,
      column: 1,
      tagName: "h1",
      bounds: { x: 100, y: 120, width: 400, height: 80 },
      text: "Hello",
      styles: { fontSize: "24px" },
    };
    const onCommit = vi.fn(async () => true);

    render(
      <InlineTextEditor
        node={node}
        disabled={false}
        t={t}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: t("styleInspector.text"),
    });
    const textNode = editor.firstChild;
    if (!textNode) throw new Error("Expected the editable slide text");
    const selectedRange = document.createRange();
    selectedRange.setStart(textNode, 1);
    selectedRange.setEnd(textNode, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectedRange);
    fireEvent(document, new Event("selectionchange"));

    const outsideRange = document.createRange();
    outsideRange.selectNodeContents(document.body);
    outsideRange.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(outsideRange);
    fireEvent(document, new Event("selectionchange"));

    fireEvent.change(document.querySelector('input[type="color"]')!, {
      target: { value: "#123456" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("designSystemSetup.saveChanges"),
      }),
    );

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith([
      {
        line: 1,
        column: 1,
        ops: [
          {
            kind: "set-text-range-style",
            start: 1,
            end: 4,
            key: "color",
            value: "#123456",
            prevText: "Hello",
          },
        ],
      },
    ]);
  });

  it("maps the bold keyboard shortcut to a source range edit", async () => {
    const node: ElementSnapshot = {
      nodeId: "text-1",
      line: 1,
      column: 1,
      tagName: "h1",
      bounds: { x: 100, y: 120, width: 400, height: 80 },
      text: "Hello",
      styles: { fontSize: "24px" },
    };
    const onCommit = vi.fn(async () => true);

    render(
      <InlineTextEditor
        node={node}
        disabled={false}
        t={t}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: t("styleInspector.text"),
    });
    const textNode = editor.firstChild;
    if (!textNode) throw new Error("Expected the editable slide text");
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("designSystemSetup.saveChanges"),
      }),
    );

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith([
      {
        line: 1,
        column: 1,
        ops: [
          {
            kind: "set-text-range-style",
            start: 1,
            end: 4,
            key: "fontWeight",
            value: "700",
            prevText: "Hello",
          },
        ],
      },
    ]);
  });

  it("places and selects the word under the double-click point", () => {
    const node: ElementSnapshot = {
      nodeId: "text-1",
      line: 1,
      column: 1,
      tagName: "h1",
      bounds: { x: 100, y: 120, width: 400, height: 80 },
      text: "Hello world",
      styles: { fontSize: "24px" },
    };
    const pointCaret = vi.fn((x: number, y: number) => {
      const editor = document.querySelector('[role="textbox"]');
      const textNode = editor?.firstChild;
      if (!textNode) throw new Error("Expected the editable slide text");
      const range = document.createRange();
      range.setStart(textNode, 7);
      range.collapse(true);
      return range;
    });
    const originalCaret = Object.getOwnPropertyDescriptor(
      document,
      "caretRangeFromPoint",
    );
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: pointCaret,
    });
    const editorRect = {
      left: 10,
      top: 20,
      width: 200,
      height: 40,
      right: 210,
      bottom: 60,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect;
    const modify = vi.fn();
    const originalModify = window.getSelection()
      ? Object.getOwnPropertyDescriptor(window.getSelection()!, "modify")
      : undefined;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(editorRect);

    try {
      const selection = window.getSelection();
      if (!selection) throw new Error("Expected a browser selection");
      Object.defineProperty(selection, "modify", {
        configurable: true,
        value: modify,
      });
      render(
        <InlineTextEditor
          node={node}
          disabled={false}
          t={t}
          initialPoint={{ x: 300, y: 140 }}
          onCommit={async () => true}
          onCancel={() => {}}
        />,
      );

      expect(pointCaret).toHaveBeenCalledWith(110, 30);
      expect(modify).toHaveBeenNthCalledWith(1, "move", "backward", "word");
      expect(modify).toHaveBeenNthCalledWith(2, "extend", "forward", "word");
    } finally {
      rectSpy.mockRestore();
      const selection = window.getSelection();
      if (selection) {
        if (originalModify)
          Object.defineProperty(selection, "modify", originalModify);
        else Reflect.deleteProperty(selection, "modify");
      }
      if (originalCaret)
        Object.defineProperty(document, "caretRangeFromPoint", originalCaret);
      else Reflect.deleteProperty(document, "caretRangeFromPoint");
    }
  });

  it("exposes localized accessible names and titles for selected-text alignment", () => {
    const node: ElementSnapshot = {
      nodeId: "text-1",
      line: 1,
      column: 1,
      tagName: "h1",
      bounds: { x: 100, y: 120, width: 400, height: 80 },
      text: "Hello",
      styles: { fontSize: "24px", textAlign: "center" },
    };

    render(
      <InlineTextEditor
        node={node}
        disabled={false}
        t={t}
        onCommit={async () => true}
        onCancel={() => {}}
      />,
    );

    const textbox = screen.getByRole("textbox", {
      name: t("styleInspector.text"),
    }) as HTMLDivElement;
    expect(textbox.getAttribute("contenteditable")).toBe("true");
    expect(textbox.getAttribute("spellcheck")).toBe("false");
    const range = document.createRange();
    range.selectNodeContents(textbox);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe("Hello");

    const alignmentLabels = [
      ["styleInspector.textAlignLeft", "Alinear el texto a la izquierda"],
      ["styleInspector.textAlignCenter", "Centrar el texto"],
      ["styleInspector.textAlignRight", "Alinear el texto a la derecha"],
    ] as const;
    for (const [key, label] of alignmentLabels) {
      expect(t(key)).toBe(label);
      expect(
        screen.getByRole("button", { name: label }).getAttribute("title"),
      ).toBe(label);
    }

    expect(
      screen
        .getByRole("button", {
          name: t("styleInspector.textAlignCenter"),
        })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
