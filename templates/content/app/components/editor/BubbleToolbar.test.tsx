// @vitest-environment happy-dom

import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BubbleToolbar,
  getSelectionNotionSpanAttribute,
  selectionHasColorableText,
  setSelectionNotionSpanAttribute,
  shouldShowBubbleToolbar,
} from "./BubbleToolbar";
import {
  NotionInlineAtom,
  NotionSpanMark,
} from "./extensions/NotionExtensions";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tiptap/react/menus", () => ({
  BubbleMenu: ({
    children,
    className,
    updateDelay,
  }: {
    children: ReactNode;
    className?: string;
    updateDelay?: number;
  }) => (
    <div className={className} data-update-delay={updateDelay}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({
    children,
    onCloseAutoFocus,
    onEscapeKeyDown,
  }: {
    children: ReactNode;
    onCloseAutoFocus?: (event: Event) => void;
    onEscapeKeyDown?: (event: KeyboardEvent) => void;
  }) => (
    <div>
      <button
        data-escape-key-down
        onClick={() => {
          onEscapeKeyDown?.(new KeyboardEvent("keydown", { key: "Escape" }));
        }}
      />
      <button
        data-close-auto-focus
        onClick={(clickEvent) => {
          const closeEvent = new Event("closeAutoFocus", {
            cancelable: true,
          });
          onCloseAutoFocus?.(closeEvent);
          clickEvent.currentTarget.dataset.prevented = String(
            closeEvent.defaultPrevented,
          );
        }}
      />
      {children}
    </div>
  ),
}));

describe("BubbleToolbar", () => {
  let editor: Editor | null = null;
  let root: Root | null = null;
  let editorElement: HTMLDivElement | null = null;
  let toolbarElement: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    editor?.destroy();
    editorElement?.remove();
    toolbarElement?.remove();
    editor = null;
    root = null;
    editorElement = null;
    toolbarElement = null;
  });

  it("opens the link input for selected editor text on Mod+K", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Builder link</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    expect(
      toolbarElement.querySelector('.bubble-toolbar[data-update-delay="0"]'),
    ).not.toBeNull();
    expect(
      toolbarElement.querySelector('button[aria-label="editor.link"]'),
    ).not.toBeNull();
    act(() => {
      editor!.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      toolbarElement.querySelector('input[placeholder="editor.pasteLink"]'),
    ).not.toBeNull();
    expect(
      toolbarElement.querySelector('input[aria-label="editor.pasteLink"]'),
    ).not.toBeNull();

    const menu = toolbarElement.querySelector<HTMLElement>(".bubble-toolbar");
    expect(document.activeElement).toBe(
      toolbarElement.querySelector('input[placeholder="editor.pasteLink"]'),
    );
    expect(
      shouldShowBubbleToolbar({
        editor,
        element: menu!,
        state: editor.state,
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      }),
    ).toBe(true);

    const input = toolbarElement.querySelector<HTMLInputElement>(
      'input[aria-label="editor.pasteLink"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "https://www.builder.io/");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const applyButton = [...toolbarElement.querySelectorAll("button")].find(
      (button) => button.textContent === "editor.apply",
    );
    act(() => applyButton!.click());

    expect(editor.getHTML()).toContain(
      '<a target="_blank" rel="noopener noreferrer nofollow" href="https://www.builder.io/">Builder</a>',
    );
  });

  it("opens the link input on pointer-down before the menu can reconcile", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Builder link</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    const linkButton = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.link"]',
    )!;
    act(() => {
      linkButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(
      toolbarElement.querySelector('input[aria-label="editor.pasteLink"]'),
    ).not.toBeNull();
  });

  it("shows the active text style and converts a heading to Text by keyboard", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<h2>Selected heading</h2>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const trigger = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.slash.turnInto: editor.heading2"]',
    );
    expect(trigger?.textContent).toContain("H2");

    const textOption = [
      ...toolbarElement.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent?.includes("editor.slash.text"));
    act(() => {
      textOption!.dispatchEvent(
        new MouseEvent("click", {
          detail: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(editor.getHTML()).toContain("<p>Selected heading</p>");
    expect(editor.getHTML()).not.toContain("<h2>Selected heading</h2>");
  });

  it("converts every block in a mixed paragraph and heading selection to Text", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>First block</p><h2>Second block</h2>",
    });
    editor.commands.setTextSelection({
      from: 1,
      to: editor.state.doc.content.size - 2,
    });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const textOption = [
      ...toolbarElement.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent?.includes("editor.slash.text"));
    act(() => textOption!.click());

    expect(editor.getHTML()).toContain("<p>First block</p><p>Second block</p>");
    expect(editor.getHTML()).not.toContain("<h2>");
  });

  it("allows close autofocus to restore focus when no style was applied", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Selected paragraph</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const closeAutoFocus = toolbarElement.querySelector<HTMLButtonElement>(
      "button[data-close-auto-focus]",
    )!;
    act(() => closeAutoFocus.click());

    expect(closeAutoFocus.dataset.prevented).toBe("false");
  });

  it("returns focus to the editor when Escape closes the text-style menu", async () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Selected paragraph</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    const trigger = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.slash.turnInto: editor.slash.text"]',
    )!;
    trigger.focus();

    const escapeKeyDown = toolbarElement.querySelector<HTMLButtonElement>(
      "button[data-escape-key-down]",
    )!;
    const closeAutoFocus = toolbarElement.querySelector<HTMLButtonElement>(
      "button[data-close-auto-focus]",
    )!;
    await act(async () => {
      escapeKeyDown.click();
      closeAutoFocus.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(closeAutoFocus.dataset.prevented).toBe("true");
    expect(editor.isFocused).toBe(true);
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it.each([5, 6] as const)(
    "identifies an H%s block and converts it to Text",
    (level) => {
      editorElement = document.createElement("div");
      toolbarElement = document.createElement("div");
      document.body.append(editorElement, toolbarElement);
      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: `<h${level}>Selected heading</h${level}>`,
      });
      editor.commands.setTextSelection({ from: 1, to: 9 });

      root = createRoot(toolbarElement);
      act(() => root!.render(<BubbleToolbar editor={editor!} />));

      const trigger = toolbarElement.querySelector<HTMLButtonElement>(
        `button[aria-label="editor.slash.turnInto: editor.heading${level}"]`,
      );
      expect(trigger?.textContent).toContain(`H${level}`);

      const textOption = [
        ...toolbarElement.querySelectorAll<HTMLButtonElement>(
          'button[role="menuitemradio"]',
        ),
      ].find((button) => button.textContent?.includes("editor.slash.text"));
      act(() => textOption!.click());

      expect(editor.getHTML()).toContain("<p>Selected heading</p>");
      expect(editor.getHTML()).not.toContain(
        `<h${level}>Selected heading</h${level}>`,
      );
    },
  );

  it("updates the selector when the active block becomes an H5", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Selected heading</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    act(() => editor!.commands.setHeading({ level: 5 }));

    const trigger = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.slash.turnInto: editor.heading5"]',
    );
    expect(trigger?.textContent).toContain("H5");
  });

  it("sets an exact heading level without toggling the current style off", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<h3>Stable heading</h3>",
    });
    editor.commands.setTextSelection({ from: 1, to: 7 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const headingOption = [
      ...toolbarElement.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent?.includes("editor.heading3"));
    expect(headingOption?.getAttribute("aria-checked")).toBe("true");
    act(() => headingOption!.click());

    expect(editor.getHTML()).toContain("<h3>Stable heading</h3>");
    expect(editor.getHTML()).not.toContain("<p>Stable heading</p>");
    const closeAutoFocus = toolbarElement.querySelector<HTMLButtonElement>(
      "button[data-close-auto-focus]",
    )!;
    act(() => closeAutoFocus.click());
    expect(closeAutoFocus.dataset.prevented).toBe("true");
  });

  it("sets a heading from a pointer click", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Selected paragraph</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const headingOption = [
      ...toolbarElement.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent?.includes("editor.heading3"));
    editor.commands.blur();
    act(() => {
      headingOption!.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(editor.getHTML()).toContain("<h3>Selected paragraph</h3>");
    expect(editor.getHTML()).not.toContain("<p>Selected paragraph</p>");
  });

  it("applies foreground and background colors without losing other marks", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content:
        '<p><a href="https://www.builder.io/"><strong><span underline="true">Palette</span></strong></a> text</p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const textRed = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.textColor: editor.color.red"]',
    )!;
    const backgroundYellow = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.backgroundColor: editor.color.yellow"]',
    )!;
    act(() => textRed.click());
    act(() => backgroundYellow.click());

    const selected = editor.state.doc.nodeAt(1)!;
    expect(selected.marks.some((mark) => mark.type.name === "bold")).toBe(true);
    expect(selected.marks.some((mark) => mark.type.name === "link")).toBe(true);
    expect(
      selected.marks.find((mark) => mark.type.name === "notionSpan")?.attrs,
    ).toMatchObject({
      color: "red",
      bgColor: "yellow_bg",
      underline: true,
    });
    expect(editor.getHTML()).toContain(
      'class="notion-block-color--red notion-block-bg--yellow"',
    );
    expect(editor.state.selection).toMatchObject({ from: 1, to: 8 });
  });

  it("defaults one color attribute without clearing the other", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content:
        '<p><span color="red" bg_color="yellow_bg" underline="true">Palette</span></p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const defaultBackground = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.backgroundColor: editor.defaultColor"]',
    )!;
    act(() => defaultBackground.click());

    expect(
      editor.state.doc
        .nodeAt(1)!
        .marks.find((mark) => mark.type.name === "notionSpan")?.attrs,
    ).toMatchObject({ color: "red", bgColor: null, underline: true });

    const backgroundYellow = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.backgroundColor: editor.color.yellow"]',
    )!;
    const defaultForeground = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.textColor: editor.defaultColor"]',
    )!;
    act(() => backgroundYellow.click());
    act(() => defaultForeground.click());

    expect(
      editor.state.doc
        .nodeAt(1)!
        .marks.find((mark) => mark.type.name === "notionSpan")?.attrs,
    ).toMatchObject({ color: null, bgColor: "yellow_bg", underline: true });
  });

  it("reports a mixed color selection without claiming an active swatch", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content:
        '<p><span color="red">Red</span><span color="blue">Blue</span></p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    expect(getSelectionNotionSpanAttribute(editor, "color")).toBe("mixed");
    expect(
      toolbarElement
        .querySelector(
          'button[aria-label="editor.textColor: editor.color.red"]',
        )
        ?.getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      toolbarElement
        .querySelector(
          'button[aria-label="editor.textColor: editor.color.blue"]',
        )
        ?.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("ignores unmarkable code-block text when resolving the active color", () => {
    editorElement = document.createElement("div");
    document.body.append(editorElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content:
        '<p><span color="red">Red</span></p><pre><code>Code</code></pre>',
    });
    editor.commands.setTextSelection({
      from: 1,
      to: editor.state.doc.content.size,
    });

    expect(getSelectionNotionSpanAttribute(editor, "color")).toBe("red");
  });

  it("skips unmarkable code-block text when applying a color", () => {
    editorElement = document.createElement("div");
    document.body.append(editorElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content: "<p>Text</p><pre><code>Code</code></pre>",
    });
    editor.commands.setTextSelection({
      from: 1,
      to: editor.state.doc.content.size,
    });

    expect(setSelectionNotionSpanAttribute(editor, "color", "red")).toBe(true);
    expect(editor.state.doc.nodeAt(1)?.marks[0]?.attrs.color).toBe("red");
    let codeMarkCount: number | undefined;
    editor.state.doc.descendants((node, _position, parent) => {
      if (node.isText && parent?.type.name === "codeBlock") {
        codeMarkCount = node.marks.length;
      }
    });
    expect(codeMarkCount).toBe(0);
  });

  it("hides the color control when a selection contains no text", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark, NotionInlineAtom],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "notionInlineAtom",
                attrs: { tagName: "math", attrsJson: "{}", label: "x" },
              },
            ],
          },
        ],
      },
    });
    editor.commands.setTextSelection({ from: 1, to: 2 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    expect(selectionHasColorableText(editor.state, 1, 2)).toBe(false);
    expect(
      toolbarElement.querySelector('button[aria-label="editor.color.label"]'),
    ).toBeNull();
  });

  it("hides the color control for text in a code block", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content: "<pre><code>const answer = 42;</code></pre>",
    });
    editor.commands.setTextSelection({ from: 1, to: 19 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    expect(selectionHasColorableText(editor.state, 1, 19)).toBe(false);
    expect(
      toolbarElement.querySelector('button[aria-label="editor.color.label"]'),
    ).toBeNull();
  });
});
