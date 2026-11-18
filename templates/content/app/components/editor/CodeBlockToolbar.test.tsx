// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeBlockToolbar } from "./CodeBlockToolbar";
import { CodeBlock } from "./extensions/CodeBlockNode";

const clipboard = vi.hoisted(() => ({ writeClipboardText: vi.fn() }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/clipboard", () => clipboard);

vi.mock("sonner", () => ({ toast: { error: toastError } }));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children, open }: { children: ReactNode; open?: boolean }) => (
    <span data-tooltip-open={open ? "" : undefined}>{children}</span>
  ),
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div data-language-menu="">{children}</div>
  ),
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: () => <input />,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: () => null,
  CommandGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandItem: ({
    children,
    value,
    onSelect,
  }: {
    children: ReactNode;
    value: string;
    onSelect: (value: string) => void;
  }) => (
    <button
      type="button"
      data-command-value={value}
      onClick={() => onSelect(value)}
    >
      {children}
    </button>
  ),
}));

describe("CodeBlockToolbar", () => {
  let editor: Editor | null = null;
  let root: Root | null = null;
  let wrapper: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    editor?.destroy();
    wrapper?.remove();
    editor = null;
    root = null;
    wrapper = null;
    clipboard.writeClipboardText.mockReset();
    toastError.mockReset();
  });

  function mount(markdown: string, canEdit = true) {
    wrapper = document.createElement("div");
    wrapper.className = "visual-editor-wrapper";
    const editorElement = document.createElement("div");
    const toolbarHost = document.createElement("div");
    wrapper.append(editorElement, toolbarHost);
    document.body.append(wrapper);
    const mounted = new Editor({
      element: editorElement,
      extensions: [StarterKit.configure({ codeBlock: false }), CodeBlock],
      content: nfmToDoc(markdown),
      editable: canEdit,
    });
    editor = mounted;
    root = createRoot(toolbarHost);
    act(() =>
      root?.render(<CodeBlockToolbar editor={mounted} canEdit={canEdit} />),
    );
    return mounted;
  }

  function hoverCodeBlock(index = 0) {
    const pre = wrapper?.querySelectorAll("pre.content-code-block")[index];
    if (!pre) throw new Error("Expected a code block");
    act(() => {
      pre.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    });
  }

  const bar = () => wrapper?.querySelector("[data-code-block-toolbar]");
  const button = (label: string) =>
    bar()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const languageChoice = (label: string) =>
    wrapper?.querySelector<HTMLButtonElement>(
      `button[data-command-value="${label}"]`,
    );

  it("shows the bar only over a code block", () => {
    mount(["Intro", "```", "x", "```"].join("\n"));
    expect(bar()).toBeNull();
    hoverCodeBlock();
    expect(bar()).not.toBeNull();

    act(() => {
      wrapper?.querySelector("p")?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    });
    expect(bar()).toBeNull();
  });

  it("saves the language picked for the block", () => {
    const mounted = mount(["```", "print(1)", "```"].join("\n"));
    hoverCodeBlock();
    expect(button("editor.codeLanguage")?.textContent).toBe(
      "editor.codeLanguageAuto",
    );

    act(() => languageChoice("Python")?.click());

    expect(mounted.state.doc.firstChild?.attrs.language).toBe("python");
    expect(docToNfm(mounted.getJSON() as never)).toBe(
      ["```python", "print(1)", "```"].join("\n"),
    );
    expect(button("editor.codeLanguage")?.textContent).toBe("Python");
  });

  it("shows a fence shorthand as the language it stands for", () => {
    mount(["```ts", "const a = 1;", "```"].join("\n"));
    hoverCodeBlock();
    expect(button("editor.codeLanguage")?.textContent).toBe("TypeScript");
    expect(languageChoice("TypeScript")?.querySelector("svg")).not.toBeNull();
    expect(languageChoice("JavaScript")?.querySelector("svg")).toBeNull();
  });

  it("goes back to Auto", () => {
    const mounted = mount(["```ts", "x", "```"].join("\n"));
    hoverCodeBlock();
    act(() => languageChoice("editor.codeLanguageAuto")?.click());
    expect(mounted.state.doc.firstChild?.attrs.language).toBeNull();
    expect(docToNfm(mounted.getJSON() as never)).toBe(
      ["```", "x", "```"].join("\n"),
    );
  });

  it("wraps the block's long lines and saves it", () => {
    const mounted = mount(["```ts", "x", "```"].join("\n"));
    hoverCodeBlock();
    expect(button("editor.wrapCodeLines")?.getAttribute("aria-pressed")).toBe(
      "false",
    );

    act(() => button("editor.wrapCodeLines")?.click());

    expect(mounted.state.doc.firstChild?.attrs.wrap).toBe(true);
    expect(
      wrapper
        ?.querySelector("pre.content-code-block")
        ?.getAttribute("data-wrap"),
    ).toBe("true");
    expect(docToNfm(mounted.getJSON() as never)).toBe(
      ['```ts {wrap="true"}', "x", "```"].join("\n"),
    );
    expect(button("editor.wrapCodeLines")?.getAttribute("aria-pressed")).toBe(
      "true",
    );

    act(() => button("editor.wrapCodeLines")?.click());
    expect(mounted.state.doc.firstChild?.attrs.wrap).toBe(false);
  });

  it("copies the whole block", async () => {
    clipboard.writeClipboardText.mockResolvedValue(true);
    mount(["```ts", "const a = 1;", "const b = 2;", "```"].join("\n"));
    hoverCodeBlock();

    await act(async () => button("editor.copyCode")?.click());

    expect(clipboard.writeClipboardText).toHaveBeenCalledWith(
      "const a = 1;\nconst b = 2;",
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(
      button("editor.codeCopied")?.closest("[data-tooltip-open]"),
    ).toBeTruthy();
  });

  it("says so when the browser won't let it copy", async () => {
    clipboard.writeClipboardText.mockResolvedValue(false);
    mount(["```", "x", "```"].join("\n"));
    hoverCodeBlock();

    await act(async () => button("editor.copyCode")?.click());

    expect(toastError).toHaveBeenCalledWith(
      "editor.toolbar.clipboardAccessUnavailable",
    );
    expect(
      button("editor.copyCode")?.closest("[data-tooltip-open]"),
    ).toBeNull();
  });

  it("follows its block through several edits in one event", () => {
    const mounted = mount(["```", "a", "```", "```", "b", "```"].join("\n"));
    hoverCodeBlock(1);

    act(() => {
      mounted.view.dispatch(mounted.state.tr.insertText("x".repeat(1000), 2));
      mounted.view.dispatch(mounted.state.tr.insertText("y".repeat(2000), 2));
      mounted.view.dispatch(mounted.state.tr.delete(2, 3002));
    });
    act(() => button("editor.wrapCodeLines")?.click());

    expect(mounted.state.doc.firstChild?.attrs.wrap).toBe(false);
    expect(mounted.state.doc.child(1).attrs.wrap).toBe(true);
  });

  it("goes away with its block, not onto the next one", () => {
    const mounted = mount(["```", "a", "```", "```", "b", "```"].join("\n"));
    hoverCodeBlock(0);
    expect(bar()).not.toBeNull();

    act(() => {
      const first = mounted.state.doc.firstChild;
      if (!first) throw new Error("Expected a code block");
      mounted.view.dispatch(mounted.state.tr.delete(0, first.nodeSize));
    });

    expect(bar()).toBeNull();
    expect(languageChoice("Python")).toBeNull();
    expect(mounted.state.doc.firstChild?.attrs.language).toBeNull();
  });

  it("goes away with its editor", () => {
    const mounted = mount(["```", "x", "```"].join("\n"));
    hoverCodeBlock();
    expect(bar()).not.toBeNull();

    act(() => mounted.destroy());
    editor = null;

    expect(bar()).toBeNull();
  });

  it("gives readers Copy and the language, and nothing to change", () => {
    mount(["```ts", "x", "```"].join("\n"), false);
    hoverCodeBlock();

    expect(button("editor.copyCode")).not.toBeNull();
    expect(button("editor.codeLanguage")).toBeNull();
    expect(button("editor.wrapCodeLines")).toBeNull();
    expect(bar()?.textContent).toBe("TypeScript");
  });
});
