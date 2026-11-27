// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { toast } from "sonner";
import { describe, expect, it, onTestFinished, vi } from "vitest";

const agentChat = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@agent-native/toolkit/app/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app/chat")>()),
  useSendToAgentChat: () => ({ send: agentChat.send, isGenerating: false }),
}));
vi.mock("@agent-native/toolkit/app/chat/composer/index", async () => {
  const { createElement } = await import("react");
  return {
    PromptComposer: ({ onSubmit }: { onSubmit: (prompt: string) => void }) =>
      createElement(
        "button",
        {
          type: "button",
          "data-prompt-composer": "",
          onClick: () => onSubmit("  outline the launch  "),
        },
        "Submit",
      ),
  };
});
const collections = vi.hoisted(() => ({
  inline: { mutateAsync: vi.fn() },
  fullPage: { mutateAsync: vi.fn() },
  remove: { mutate: vi.fn(), mutateAsync: vi.fn() },
}));
vi.mock("@/hooks/use-content-database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-database")>()),
  useCreateInlineContentDatabase: () => collections.inline,
  useCreateContentDatabase: () => collections.fullPage,
  useDeleteContentDatabase: () => collections.remove,
}));
const rollbackCreated = vi.hoisted(() =>
  vi.fn(async (_input: { id: string; parentId: string }) => ({})),
);
vi.mock("@/hooks/use-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-documents")>()),
  useRollbackCreatedSlashDocument: () => ({ mutateAsync: rollbackCreated }),
}));

import {
  byLabel,
  click,
  nextFrame,
  renderUi,
  typeInto,
} from "@/test-utils/render-ui";

import {
  bodyAfterInsert,
  buildHeadingCommands,
  cleanupFailedSlashCreation,
  CommandButton,
  CONTENT_HEADING_LEVELS,
  equationNodeContent,
  excludeCommandsWithDuplicateTitles,
  getEquationInsertionRange,
  getSlashMenuVerticalPosition,
  inlineDatabaseBlockContent,
  insertColumnSet,
  insertEquation,
  insertInlineDatabaseBlock,
  parseSlashCommandQuery,
  parseInlineGeneratePrompt,
  runGeneratePromptIfAllowed,
  slashCommandAllowedInMode,
  slashCommandStartIndex,
  slashCommandsForDirectoryWidget,
  slashCommandsForMode,
  SlashCommandMenu,
  setCodeBlockFromSlashCommand,
  setPlainTextBlock,
} from "./SlashCommandMenu";
import { createVisualEditorExtensions } from "./VisualEditor";

async function mountSlashMenu(
  props: Partial<Parameters<typeof SlashCommandMenu>[0]> = {},
) {
  const editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  onTestFinished(() => editor.destroy());
  let location = "";
  function LocationProbe() {
    const current = useLocation();
    useEffect(() => {
      location = current.pathname;
    });
    return null;
  }
  renderUi(
    createElement(
      MemoryRouter,
      { initialEntries: ["/page/doc-1"] },
      createElement(LocationProbe),
      createElement(AgentNativeI18nProvider, {
        initialLocale: "en-US",
        persistPreference: false,
        catalog: {
          sourceLocale: "en-US",
          messages: {
            editor: {
              slash: {
                blockEquation: "Block equation",
                collectionFullPage: "Full-page collection",
                collectionInline: "Inline collection",
                equationInputLabel: "LaTeX",
                inlineEquation: "Inline equation",
                insertEquation: "Insert equation",
              },
            },
          },
        },
        children: createElement(
          "div",
          { className: "visual-editor-wrapper" },
          createElement(EditorContent, { editor }),
          createElement(SlashCommandMenu, {
            editor,
            documentId: "doc-1",
            ...props,
          }),
        ),
      }),
    ),
  );
  await act(async () => Promise.resolve());
  return { editor, location: () => location };
}

async function typeSlash(editor: Editor, text: string) {
  act(() => {
    editor.commands.focus("end");
    for (const char of text) {
      const { from, to } = editor.state.selection;
      editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  });
  await act(async () => Promise.resolve());
}

async function pressEnter() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await act(async () => Promise.resolve());
}

function buttonNamed(name: string, scope: ParentNode = document.body) {
  const button = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent.trim().startsWith(name));
  if (!button) throw new Error(`No button named "${name}"`);
  return button;
}

function menuItem(title: string) {
  const menu = document.body.querySelector(".slash-command-menu");
  if (!menu) throw new Error("The slash menu is closed.");
  return buttonNamed(title, menu);
}

async function waitFor(done: () => boolean) {
  await vi.waitFor(async () => {
    await act(async () => Promise.resolve());
    if (!done()) throw new Error("Timed out waiting.");
  });
}

describe("failed slash creation cleanup", () => {
  it("trashes the new resource even if removing its editor reference fails", async () => {
    const removeError = new Error("editor is unavailable");
    const trash = vi.fn().mockResolvedValue(undefined);

    const errors = await cleanupFailedSlashCreation(() => {
      throw removeError;
    }, trash);

    expect(errors).toEqual([removeError]);
    expect(trash).toHaveBeenCalledOnce();
  });
});

describe("inline slash generate command parsing", () => {
  it("extracts the prompt from /generate text", () => {
    expect(parseInlineGeneratePrompt("/generate outline this PRD")).toBe(
      "outline this PRD",
    );
  });

  it("trims extra whitespace around the prompt", () => {
    expect(parseInlineGeneratePrompt("/generate   summarize this   ")).toBe(
      "summarize this",
    );
  });

  it("ignores incomplete or different slash commands", () => {
    expect(parseInlineGeneratePrompt("/generate")).toBeNull();
    expect(parseInlineGeneratePrompt("/image hero")).toBeNull();
    expect(parseInlineGeneratePrompt("prefix /generate text")).toBeNull();
  });
});

describe("generate command affordances", () => {
  it("denies a stale Generate popover submission after Suggesting starts", () => {
    const send = vi.fn();

    expect(runGeneratePromptIfAllowed(true, send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(runGeneratePromptIfAllowed(false, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps inline Generate text intact while Suggesting", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>/generate rewrite this</p>",
    });
    editor.commands.focus("end");

    try {
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(
                "div",
                { className: "visual-editor-wrapper" },
                createElement(EditorContent, { editor }),
                createElement(SlashCommandMenu, {
                  editor,
                  suggesting: true,
                }),
              ),
            ),
          ),
        );
        await Promise.resolve();
      });

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await act(async () => Promise.resolve());

      expect(editor.getText()).toBe("/generate rewrite this");
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
      queryClient.clear();
      container.remove();
    }
  });

  // oracle-change: the SlashCommandMenu.tsx grep became the rendered Generate prompt below, which reaches the command by its title; the removed Space shortcut guarded nothing a writer can use
  it("sends a prompt written in the Generate popover to the agent", async () => {
    agentChat.send.mockClear();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p></p>",
    });
    Object.assign(editor.storage, { markdown: { getMarkdown: () => "" } });

    try {
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(
                "div",
                { className: "visual-editor-wrapper" },
                createElement(EditorContent, { editor }),
                createElement(SlashCommandMenu, {
                  editor,
                  documentId: "doc-1",
                }),
              ),
            ),
          ),
        );
        await Promise.resolve();
      });
      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("/generate");
      });
      await act(async () => Promise.resolve());
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      const composer = await vi.waitFor(async () => {
        await act(async () => Promise.resolve());
        const opened = document.body.querySelector<HTMLElement>(
          "[data-prompt-composer]",
        );
        if (!opened) throw new Error("The Generate popover did not open.");
        return opened;
      });
      expect(composer.closest('[role="dialog"]')).not.toBeNull();

      act(() => composer.click());

      expect(agentChat.send).toHaveBeenCalledOnce();
      expect(agentChat.send.mock.calls[0]?.[0]).toMatchObject({
        message: "outline the launch",
        submit: true,
      });
      expect(agentChat.send.mock.calls[0]?.[0].context).toContain("doc-1");
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
      queryClient.clear();
      container.remove();
    }
  });

  it("types a space at the start of an empty line instead of opening Generate", async () => {
    const { editor } = await mountSlashMenu();
    act(() => {
      editor.commands.focus("end");
      editor.view.dom.focus();
    });
    expect(editor.isFocused).toBe(true);

    for (const key of " plan b") {
      act(() => {
        const typed = editor.view.dom.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            code: key === " " ? "Space" : `Key${key.toUpperCase()}`,
            bubbles: true,
            cancelable: true,
          }),
        );
        if (!typed) return;
        const { from, to } = editor.state.selection;
        editor.view.dispatch(editor.state.tr.insertText(key, from, to));
      });
    }
    await act(async () => Promise.resolve());

    expect(editor.getText()).toBe(" plan b");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("slash command menu trigger", () => {
  it("fails closed to the supported suggestion operation grammar", () => {
    const safeAction = vi.fn();
    const unsafeAction = vi.fn();
    const commands = [
      {
        title: "Paragraph",
        suggestionSafe: true,
        action: safeAction,
      },
      { title: "Database", action: unsafeAction },
    ];

    expect(slashCommandsForMode(commands, true)).toEqual([commands[0]]);
    expect(slashCommandsForMode(commands, false)).toEqual(commands);
    expect(slashCommandAllowedInMode(commands[0]!, true)).toBe(true);
    expect(slashCommandAllowedInMode(commands[1]!, true)).toBe(false);
    expect(slashCommandAllowedInMode(commands[1]!, false)).toBe(true);
    expect(safeAction).not.toHaveBeenCalled();
    expect(unsafeAction).not.toHaveBeenCalled();
    expect(
      buildHeadingCommands("toggle").every(
        (item) => item.suggestionSafe === true,
      ),
    ).toBe(true);
  });

  it("finds a heading by its short name", () => {
    expect(
      buildHeadingCommands("set")
        .slice(0, 3)
        .map((item) => item.searchText),
    ).toEqual(["h1", "h2", "h3"]);
  });

  it("limits a writable directory widget to local document-formatting commands", () => {
    const commands = [
      { title: "Bulleted list", directoryWidgetSafe: true },
      { title: "Create database", directoryWidgetSafe: false },
    ];

    expect(slashCommandsForDirectoryWidget(commands, true)).toEqual([
      commands[0],
    ]);
    expect(slashCommandsForDirectoryWidget(commands, false)).toEqual(commands);
  });

  // oracle-change: the SlashCommandMenu.tsx scroll-listener grep became this rendered scroll
  it("repositions after an ancestor scroll moves the caret", async () => {
    const { editor } = await mountSlashMenu();
    let caretTop = 200;
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => ({
      top: caretTop,
      bottom: caretTop + 20,
      left: 40,
      right: 40,
    }));
    await typeSlash(editor, "/");
    await nextFrame();
    const menuTop = () =>
      Number.parseFloat(
        document.body.querySelector<HTMLElement>(".slash-command-menu")?.style
          .top ?? "",
      );
    const before = menuTop();
    expect(Number.isFinite(before)).toBe(true);

    caretTop = 300;
    const scroller = document.createElement("div");
    document.body.appendChild(scroller);
    onTestFinished(() => scroller.remove());
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    await nextFrame();

    expect(menuTop() - before).toBe(100);
  });
  it("opens above a caret near the viewport bottom", () => {
    expect(
      getSlashMenuVerticalPosition(
        { top: 760, bottom: 780 },
        { top: 100, bottom: 1200 },
        840,
      ),
    ).toEqual({ bottom: 444 });
  });

  it("opens below a caret when the viewport has room", () => {
    expect(
      getSlashMenuVerticalPosition(
        { top: 200, bottom: 220 },
        { top: 100, bottom: 1200 },
        840,
      ),
    ).toEqual({ top: 124 });
  });

  it("keeps native commands when registry commands have the same visible title", () => {
    const native = [
      { title: "Callout" },
      { title: "Table" },
      { title: "Code block" },
    ];
    const registry = [
      { title: " callout " },
      { title: "TABLE" },
      { title: "API endpoint" },
    ];

    expect(excludeCommandsWithDuplicateTitles(native, registry)).toEqual([
      { title: "API endpoint" },
    ]);
  });

  it("starts on a command named by the query before one matched only by its description", () => {
    const commands = [
      { title: "To-do list", description: "Checklist items" },
      { title: "Add check", description: "Mark the parts that don't pass" },
    ];

    expect(slashCommandStartIndex(commands, "check")).toBe(1);
    expect(slashCommandStartIndex(commands, "Check")).toBe(1);
    expect(slashCommandStartIndex(commands, "")).toBe(0);
    expect(slashCommandStartIndex(commands, "items")).toBe(0);
  });

  // oracle-change: the SlashCommandMenu.tsx save-call grep became these rendered saves
  it.each([
    { saved: true, toasts: 0 },
    { saved: false, toasts: 1 },
  ])(
    "saves a structural command's result at once (saved: $saved)",
    async ({ saved, toasts }) => {
      const onDraftCommitted = vi.fn(async () => saved);
      const toastError = vi.spyOn(toast, "error").mockReturnValue("");
      onTestFinished(() => toastError.mockRestore());
      const { editor } = await mountSlashMenu({ onDraftCommitted });

      await typeSlash(editor, "/code");
      await pressEnter();
      await act(async () => Promise.resolve());

      const [first] = editor.getJSON().content;
      expect(first).toMatchObject({ type: "codeBlock" });
      expect(onDraftCommitted).toHaveBeenCalledOnce();
      expect(toastError).toHaveBeenCalledTimes(toasts);
    },
  );
  it("opens for slash commands at the start of a block", () => {
    expect(parseSlashCommandQuery("/")).toBe("");
    expect(parseSlashCommandQuery("/heading")).toBe("heading");
    expect(parseSlashCommandQuery("/heading 2")).toBe("heading 2");
    expect(parseSlashCommandQuery("/numbered list")).toBe("numbered list");
    expect(parseSlashCommandQuery("  /table")).toBe("table");
  });

  it("still yields multi-word generate prompts to inline submission", () => {
    expect(parseSlashCommandQuery("/generate outline this PRD")).toBeNull();
  });

  it("does not open for slashes embedded in normal prose", () => {
    expect(parseSlashCommandQuery("hello/world")).toBeNull();
    expect(parseSlashCommandQuery("hello /world")).toBeNull();
    expect(parseSlashCommandQuery("open https://example.com/path")).toBeNull();
  });

  it("reopens in a trailing paragraph after a code block", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<pre><code>const answer = 42;</code></pre><p></p>",
    });

    try {
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(
                "div",
                { className: "visual-editor-wrapper" },
                createElement(EditorContent, { editor }),
                createElement(SlashCommandMenu, { editor }),
              ),
            ),
          ),
        );
        await Promise.resolve();
      });

      vi.spyOn(editor.view, "coordsAtPos").mockImplementationOnce(() => {
        throw new RangeError("DOM position is reconciling");
      });
      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("/");
      });
      await act(async () => Promise.resolve());

      expect(container.querySelector(".slash-command-menu")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
      queryClient.clear();
      container.remove();
    }
  });

  it("executes an exact slash command on Enter when the menu is not visible", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const editor = new Editor({
      extensions: [StarterKit, Table, TableRow, TableHeader, TableCell],
      content: "<p>/table</p>",
    });
    editor.commands.focus("end");

    try {
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(
                "div",
                { className: "visual-editor-wrapper" },
                createElement(EditorContent, { editor }),
                createElement(SlashCommandMenu, { editor }),
              ),
            ),
          ),
        );
        await Promise.resolve();
      });

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await act(async () => Promise.resolve());

      expect(editor.getText()).not.toContain("/table");
      expect(editor.view.dom.querySelectorAll("table")).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
      queryClient.clear();
      container.remove();
    }
  });

  it("rechecks suggestion policy before a queued unsupported command can run", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>/database</p>",
    });
    editor.commands.focus("end");
    const renderMenu = (suggesting: boolean) =>
      createElement(
        MemoryRouter,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            "div",
            { className: "visual-editor-wrapper" },
            createElement(EditorContent, { editor }),
            createElement(SlashCommandMenu, { editor, suggesting }),
          ),
        ),
      );

    try {
      await act(async () => {
        root.render(renderMenu(false));
        await Promise.resolve();
        root.render(renderMenu(true));
        await Promise.resolve();
      });

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await act(async () => Promise.resolve());

      expect(editor.getText()).toBe("/database");
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
      queryClient.clear();
      container.remove();
    }
  });

  it("keeps supported text-block commands executable while suggesting", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>/code</p>",
    });
    editor.commands.focus("end");

    try {
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(
                "div",
                { className: "visual-editor-wrapper" },
                createElement(EditorContent, { editor }),
                createElement(SlashCommandMenu, {
                  editor,
                  suggesting: true,
                }),
              ),
            ),
          ),
        );
        await Promise.resolve();
      });

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await act(async () => Promise.resolve());

      expect(editor.getText()).not.toContain("/code");
      expect(editor.getJSON().content?.[0]?.type).toBe("codeBlock");
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
      queryClient.clear();
      container.remove();
    }
  });

  it("executes the highlighted native command on Enter when the menu is visible", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p></p>",
    });

    try {
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(
                "div",
                { className: "visual-editor-wrapper" },
                createElement(EditorContent, { editor }),
                createElement(SlashCommandMenu, { editor }),
              ),
            ),
          ),
        );
        await Promise.resolve();
      });

      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("/code");
      });
      await act(async () => Promise.resolve());

      expect(container.querySelector(".slash-command-menu")).not.toBeNull();
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await act(async () => Promise.resolve());

      expect(editor.getText()).not.toContain("/code");
      expect(editor.getJSON().content?.[0]?.type).toBe("codeBlock");
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
      queryClient.clear();
      container.remove();
    }
  });

  it("adds a check from /check on Enter", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p></p>",
    });
    const onAddCheck = vi.fn();

    try {
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(
                "div",
                { className: "visual-editor-wrapper" },
                createElement(EditorContent, { editor }),
                createElement(SlashCommandMenu, { editor, onAddCheck }),
              ),
            ),
          ),
        );
        await Promise.resolve();
      });

      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("/check");
      });
      await act(async () => Promise.resolve());

      expect(container.querySelector(".slash-command-menu")).not.toBeNull();
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await act(async () => Promise.resolve());

      expect(onAddCheck).toHaveBeenCalledOnce();
      expect(editor.getJSON().content[0]).toMatchObject({ type: "paragraph" });
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
      queryClient.clear();
      container.remove();
    }
  });
});

describe("slash command pointer activation", () => {
  function renderCommandButton(onExecute: () => void) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    act(() => {
      root.render(
        createElement(CommandButton, {
          cmd: {
            title: "Code Block",
            description: "Insert a code block",
            action: vi.fn(),
          },
          isSelected: true,
          onExecute,
          onHover: vi.fn(),
        }),
      );
    });
    return {
      button: container.querySelector("button"),
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      },
    };
  }

  it("executes on mouse down while preserving selection and deduplicating click", () => {
    const onExecute = vi.fn();
    const { button, cleanup } = renderCommandButton(onExecute);

    try {
      const mouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        button?.dispatchEvent(mouseDown);
      });
      expect(mouseDown.defaultPrevented).toBe(true);
      expect(onExecute).toHaveBeenCalledTimes(1);

      act(() => {
        button?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            detail: 1,
          }),
        );
      });
      expect(onExecute).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("runs before a pointer selection closes and unmounts the menu", () => {
    const onExecute = vi.fn();
    const { button, cleanup } = renderCommandButton(onExecute);

    act(() => {
      button?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    expect(onExecute).toHaveBeenCalledTimes(1);
    cleanup();
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard-generated button clicks", () => {
    const onExecute = vi.fn();
    const { button, cleanup } = renderCommandButton(onExecute);

    try {
      act(() => {
        button?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            detail: 0,
          }),
        );
      });
      expect(onExecute).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe("code block slash command", () => {
  it("deletes the slash query and converts the block in one command chain", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>/code</p>",
    });

    try {
      editor.commands.setTextSelection(6);
      expect(setCodeBlockFromSlashCommand(editor, { from: 1, to: 6 })).toBe(
        true,
      );
      expect(editor.getJSON()).toEqual({
        type: "doc",
        content: [
          { type: "codeBlock", attrs: { language: null } },
          { type: "paragraph" },
        ],
      });
    } finally {
      editor.destroy();
    }
  });
});

describe("heading slash commands", () => {
  it("offers all six HTML heading levels for insert and turn-into flows", () => {
    expect(CONTENT_HEADING_LEVELS).toEqual([1, 2, 3, 4, 5, 6]);

    const toggleCommands = buildHeadingCommands("toggle");
    const setCommands = buildHeadingCommands("set");

    expect(toggleCommands.map((command) => command.titleKey)).toEqual([
      "editor.heading1",
      "editor.heading2",
      "editor.heading3",
      "editor.heading4",
      "editor.heading5",
      "editor.heading6",
    ]);
    expect(toggleCommands.map((command) => command.shortcut)).toEqual([
      "#",
      "##",
      "###",
      "####",
      "#####",
      "######",
    ]);
    expect(setCommands.map((command) => command.titleKey)).toEqual(
      toggleCommands.map((command) => command.titleKey),
    );
  });

  it("runs the matching heading command for levels five and six", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      toggleHeading: vi.fn(() => chain),
      setHeading: vi.fn(() => chain),
      run: vi.fn(() => true),
    };
    const editor = { chain: () => chain } as any;

    void buildHeadingCommands("toggle")[4]?.action(editor, {
      slashRange: null,
    });
    void buildHeadingCommands("set")[5]?.action(editor, { slashRange: null });

    expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 5 });
    expect(chain.setHeading).toHaveBeenCalledWith({ level: 6 });
  });
});

describe("column slash commands", () => {
  it("puts a set of empty columns where the slash was and the caret in the first", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc("Before\n<empty-block/>\nAfter"),
    });

    try {
      editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 1);
      expect(insertColumnSet(editor, 3)).toBe(true);

      const set = editor.state.doc.child(1);
      expect(set.type.name).toBe("notionColumns");
      expect(set.childCount).toBe(3);
      expect(editor.state.doc.child(2).textContent).toBe("After");
      const { $from } = editor.state.selection;
      expect($from.node(-1)).toBe(set.child(0));
      expect($from.parent.type.name).toBe("paragraph");
    } finally {
      editor.destroy();
    }
  });
});

describe("equation slash commands", () => {
  it("builds the canonical inline and block atom payloads", () => {
    expect(equationNodeContent("E = mc^2", false)).toEqual({
      type: "notionInlineAtom",
      attrs: { tagName: "math", attrsJson: "{}", label: "E = mc^2" },
    });
    expect(equationNodeContent("E = mc^2", true)).toEqual({
      type: "notionBlockAtom",
      attrs: { tagName: "equation", attrsJson: "{}", label: "E = mc^2" },
    });
  });

  it("replaces only the slash range for inline equations", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      insertContentAt: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(
      insertEquation({ chain: () => chain } as any, "x^2", false, {
        from: 4,
        to: 11,
      }),
    ).toBe(true);
    expect(chain.insertContentAt).toHaveBeenCalledWith(
      { from: 4, to: 11 },
      equationNodeContent("x^2", false),
    );
  });

  it("replaces the paragraph and leaves a trailing paragraph for block equations", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      insertContentAt: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(
      insertEquation({ chain: () => chain } as any, "x^2", true, {
        from: 0,
        to: 9,
      }),
    ).toBe(true);
    expect(chain.insertContentAt).toHaveBeenCalledWith({ from: 0, to: 9 }, [
      equationNodeContent("x^2", true),
      { type: "paragraph" },
    ]);
  });

  it("expands block insertion to the containing paragraph", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "/equation" }] },
        ],
      },
    });

    try {
      expect(
        getEquationInsertionRange(editor as any, { from: 1, to: 10 }, true),
      ).toEqual({ from: 0, to: 11 });
      expect(
        getEquationInsertionRange(editor as any, { from: 1, to: 10 }, false),
      ).toEqual({ from: 1, to: 10 });
    } finally {
      editor.destroy();
    }
  });

  // oracle-change: the SlashCommandMenu.tsx equation greps became this rendered equation
  it("finds both equations by LaTeX and inserts only one that renders", async () => {
    const onDraftCommitted = vi.fn();
    const { editor } = await mountSlashMenu({ onDraftCommitted });

    await typeSlash(editor, "/latex");
    expect(() => menuItem("Inline equation")).not.toThrow();
    await click(menuItem("Block equation"));
    const latex = byLabel<HTMLTextAreaElement>("LaTeX");
    await typeInto(latex, "\\frac{");
    expect(buttonNamed("Insert equation").disabled).toBe(true);
    await typeInto(latex, "x^2");
    expect(buttonNamed("Insert equation").disabled).toBe(false);
    await click(buttonNamed("Insert equation"));

    expect(JSON.stringify(editor.getJSON())).toContain("x^2");
    expect(editor.getText()).not.toContain("/latex");
    expect(onDraftCommitted).toHaveBeenCalledOnce();
  });
});

describe("plain text slash command", () => {
  it("uses the paragraph command when the editor registers it", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      setParagraph: vi.fn(() => chain),
      setNode: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(setPlainTextBlock({ chain: () => chain } as any)).toBe(true);
    expect(chain.setParagraph).toHaveBeenCalled();
    expect(chain.setNode).not.toHaveBeenCalled();
  });

  it("falls back to the paragraph node when setParagraph is unavailable", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      setNode: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(setPlainTextBlock({ chain: () => chain } as any)).toBe(true);
    expect(chain.setNode).toHaveBeenCalledWith("paragraph");
  });
});

describe("inline database slash command", () => {
  const block = {
    databaseId: "database-alpha",
    databaseDocumentId: "document-database-alpha",
    ownerBlockId: "inline-database-owner-alpha",
  };

  it("builds the inline database registry block payload", () => {
    expect(inlineDatabaseBlockContent(block)).toMatchObject({
      type: "registryBlock",
      attrs: {
        blockType: "inline-database",
        blockId: block.ownerBlockId,
        title: null,
        summary: null,
      },
    });
    expect(inlineDatabaseBlockContent(block).attrs.__raw).toContain(
      '<InlineDatabase id="inline-database-owner-alpha"',
    );
    expect(inlineDatabaseBlockContent(block).attrs.__raw).toContain(
      'databaseId="database-alpha"',
    );
  });

  it("inserts the inline database block through the editor chain", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      insertContent: vi.fn(() => chain),
      insertContentAt: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(
      insertInlineDatabaseBlock({ chain: () => chain } as any, block),
    ).toBe(true);
    expect(chain.insertContent).toHaveBeenCalledWith(
      inlineDatabaseBlockContent(block),
    );
  });

  it("can replace the preserved slash command range with the inline database", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      insertContent: vi.fn(() => chain),
      insertContentAt: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(
      insertInlineDatabaseBlock({ chain: () => chain } as any, block, {
        from: 7,
        to: 16,
      }),
    ).toBe(true);
    expect(chain.insertContentAt).toHaveBeenCalledWith(
      { from: 7, to: 16 },
      inlineDatabaseBlockContent(block),
    );
    expect(chain.insertContent).not.toHaveBeenCalled();
  });

  // oracle-change: the SlashCommandMenu.tsx collection greps became the two rendered creations below
  it("makes an inline collection where the slash was and saves the page with it", async () => {
    collections.inline.mutateAsync.mockReset();
    collections.inline.mutateAsync.mockResolvedValue({ block });
    const onDraftPersisted = vi.fn(async (_body: string) => true);
    const { editor } = await mountSlashMenu({ onDraftPersisted });

    await typeSlash(editor, "/database");
    await click(menuItem("Inline collection"));
    await waitFor(() => onDraftPersisted.mock.calls.length > 0);

    expect(collections.inline.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ hostDocumentId: "doc-1" }),
    );
    const body = onDraftPersisted.mock.calls[0]?.[0] ?? "";
    expect(body).toContain(block.ownerBlockId);
    expect(body).not.toContain("/database");
    expect(editor.getText()).not.toContain("/database");
  });

  it("makes a full-page collection under the page, retrying once, and opens it", async () => {
    collections.fullPage.mutateAsync.mockReset();
    collections.fullPage.mutateAsync
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce({ database: { documentId: "collection-page" } });
    const onDraftPersisted = vi.fn(async (_body: string) => true);
    const { editor, location } = await mountSlashMenu({
      contentSpaceId: "space-1",
      onDraftPersisted,
    });

    await typeSlash(editor, "/database");
    await click(menuItem("Full-page collection"));
    await waitFor(() => location() === "/page/collection-page");

    expect(collections.fullPage.mutateAsync).toHaveBeenCalledTimes(2);
    const [[requested], [retried]] = collections.fullPage.mutateAsync.mock
      .calls as [[{ newDocumentId: string }], [unknown]];
    expect(requested).toMatchObject({ parentId: "doc-1", spaceId: "space-1" });
    expect(retried).toEqual(requested);
    const body = onDraftPersisted.mock.calls[0]?.[0] ?? "";
    expect(body).toContain('id="collection-page"');
    expect(body).not.toContain("/database");
    expect(editor.getText()).not.toContain("/database");
    expect(rollbackCreated).not.toHaveBeenCalled();
  });

  it("takes a full-page collection back and stays on the page when the page can't save the link to it", async () => {
    collections.fullPage.mutateAsync.mockReset();
    collections.fullPage.mutateAsync
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce({ database: { documentId: "collection-page" } });
    rollbackCreated.mockClear();
    collections.remove.mutate.mockClear();
    collections.remove.mutateAsync.mockClear();
    const toastError = vi.spyOn(toast, "error").mockReturnValue("");
    onTestFinished(() => toastError.mockRestore());
    const onDraftPersisted = vi.fn(async (_body: string) => false);
    const { editor, location } = await mountSlashMenu({
      contentSpaceId: "space-1",
      onDraftPersisted,
    });

    await typeSlash(editor, "/database");
    await click(menuItem("Full-page collection"));
    await waitFor(() => toastError.mock.calls.length > 0);

    expect(onDraftPersisted.mock.calls[0]?.[0]).toContain(
      'id="collection-page"',
    );
    expect(rollbackCreated.mock.calls).toEqual([
      [{ id: "collection-page", parentId: "doc-1" }],
    ]);
    expect(collections.remove.mutate).not.toHaveBeenCalled();
    expect(collections.remove.mutateAsync).not.toHaveBeenCalled();
    expect(JSON.stringify(editor.getJSON())).not.toContain("collection-page");
    expect(location()).toBe("/page/doc-1");
  });

  it("takes back the collection it asked for when neither create answers", async () => {
    collections.fullPage.mutateAsync.mockReset();
    collections.fullPage.mutateAsync.mockRejectedValue(new Error("timed out"));
    rollbackCreated.mockClear();
    collections.remove.mutate.mockClear();
    collections.remove.mutateAsync.mockClear();
    const toastError = vi.spyOn(toast, "error").mockReturnValue("");
    onTestFinished(() => toastError.mockRestore());
    const onDraftPersisted = vi.fn(async (_body: string) => true);
    const { editor, location } = await mountSlashMenu({
      contentSpaceId: "space-1",
      onDraftPersisted,
    });

    await typeSlash(editor, "/database");
    await click(menuItem("Full-page collection"));
    await waitFor(() => toastError.mock.calls.length > 0);

    const [[requested], [retried]] = collections.fullPage.mutateAsync.mock
      .calls as [[{ newDocumentId: string }], [unknown]];
    expect(retried).toEqual(requested);
    expect(rollbackCreated.mock.calls).toEqual([
      [{ id: requested.newDocumentId, parentId: "doc-1" }],
    ]);
    expect(collections.remove.mutate).not.toHaveBeenCalled();
    expect(collections.remove.mutateAsync).not.toHaveBeenCalled();
    expect(onDraftPersisted).not.toHaveBeenCalled();
    expect(location()).toBe("/page/doc-1");
  });
});

describe("the body saved after a page insert", () => {
  const pageReference = {
    type: "notionBlockAtom",
    attrs: {
      tagName: "page",
      attrsJson: JSON.stringify({ id: "page-alpha" }),
      label: "Untitled",
    },
  };
  const required = 'id="page-alpha"';

  // The insert leaves an empty paragraph after the reference, which the body
  // omits only at its end.
  function editorWithBody(repeated: boolean) {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc("Intro paragraph"),
    });
    const intro = editor.getJSON().content;
    const once = [...intro, pageReference];
    editor.commands.setContent({
      type: "doc",
      content: [...once, ...(repeated ? once : []), { type: "paragraph" }],
    });
    return editor;
  }

  function bodyOnce() {
    const editor = editorWithBody(false);
    try {
      return docToNfm(editor.getJSON() as Parameters<typeof docToNfm>[0]);
    } finally {
      editor.destroy();
    }
  }

  it("collapses a repeated live copy in the editor, once", () => {
    const editor = editorWithBody(true);
    const once = bodyOnce();
    try {
      expect(bodyAfterInsert(editor, required, true)).toBe(once);
      expect(docToNfm(editor.getJSON() as Parameters<typeof docToNfm>[0])).toBe(
        once,
      );
      expect(bodyAfterInsert(editor, required, true)).toBe(once);
      expect(docToNfm(editor.getJSON() as Parameters<typeof docToNfm>[0])).toBe(
        once,
      );
    } finally {
      editor.destroy();
    }
  });

  it("leaves the editor alone when the page saves its body", () => {
    const editor = editorWithBody(true);
    const repeated = docToNfm(
      editor.getJSON() as Parameters<typeof docToNfm>[0],
    );
    try {
      expect(bodyAfterInsert(editor, required, false)).toBe(bodyOnce());
      expect(docToNfm(editor.getJSON() as Parameters<typeof docToNfm>[0])).toBe(
        repeated,
      );
    } finally {
      editor.destroy();
    }
  });

  it("leaves a body that does not repeat as it is", () => {
    const editor = editorWithBody(false);
    const body = docToNfm(editor.getJSON() as Parameters<typeof docToNfm>[0]);
    try {
      expect(bodyAfterInsert(editor, required, true)).toBe(body);
      expect(docToNfm(editor.getJSON() as Parameters<typeof docToNfm>[0])).toBe(
        body,
      );
    } finally {
      editor.destroy();
    }
  });
});
