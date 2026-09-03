// @vitest-environment happy-dom

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type AttachmentAdapter,
} from "@assistant-ui/react";
import { Editor } from "@tiptap/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

import { TooltipProvider } from "../ui/tooltip.js";
import { getComposerDraftKey } from "./draft-key.js";
import {
  canSubmitComposerContent,
  canRemoveVoicePreview,
  compactComposerModelName,
  compactComposerReasoningEffortLabel,
  composerModelCostTier,
  createTiptapComposerExtensions,
  displayableComposerModeMessage,
  getComposerSendTooltipKey,
  getComposerSubmitIntentForEnterKey,
  getComposerPopoverPosition,
  getComposerReasoningEffortOptions,
  getOversizedDocumentAttachmentError,
  handleComposerFileDrop,
  insertComposerHardBreakAndScrollIntoView,
  isOpenAiModelProviderGroup,
  isComposerEditorUsable,
  formatVoiceTranscriptForComposer,
  hasConfiguredCloudProvider,
  MODEL_SELECTOR_POPOVER_STYLE,
  resolveContextChipBackspaceAction,
  resolveComposerPrimaryAction,
  shouldRenderModelSelector,
  shouldShowModelSelectorSkeleton,
  shouldShowOnlyConnectPath,
  TiptapComposer,
  type TiptapComposerHandle,
} from "./TiptapComposer.js";

const emptyChatModelAdapter: ChatModelAdapter = {
  async *run() {},
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("createTiptapComposerExtensions", () => {
  it("refreshes the rendered placeholder after a locale change", () => {
    let placeholder = "Ask the agent...";
    const element = document.createElement("div");
    const editor = new Editor({
      element,
      extensions: createTiptapComposerExtensions(() => placeholder),
    });

    expect(
      element
        .querySelector(".is-editor-empty")
        ?.getAttribute("data-placeholder"),
    ).toBe("Ask the agent...");

    placeholder = "Frag den Agenten...";
    editor.view.dispatch(editor.state.tr.setSelection(editor.state.selection));

    expect(
      element
        .querySelector(".is-editor-empty")
        ?.getAttribute("data-placeholder"),
    ).toBe("Frag den Agenten...");
    editor.destroy();
  });

  it("rejects a truthy editor after BFCache/remount destruction", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createTiptapComposerExtensions(() => "Message agent..."),
    });

    expect(isComposerEditorUsable(editor)).toBe(true);
    editor.destroy();
    expect(editor).toBeTruthy();
    expect(editor.isDestroyed).toBe(true);
    expect(isComposerEditorUsable(editor)).toBe(false);
    expect(() => {
      if (isComposerEditorUsable(editor)) editor.commands.clearContent();
    }).not.toThrow();
  });

  it("offers explicit effort levels without legacy Auto", () => {
    expect(getComposerReasoningEffortOptions("auto")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(getComposerReasoningEffortOptions("claude-sonnet-5")).not.toContain(
      "auto",
    );
  });

  it("uses compact GPT-5.6 model and effort names in the collapsed trigger", () => {
    expect(compactComposerModelName("gpt-5.6-sol")).toBe("GPT-5.6 Sol");
    expect(compactComposerModelName("gpt-5-6-terra")).toBe("GPT-5.6 Terra");
    expect(compactComposerModelName("openai/gpt-5.6-luna")).toBe(
      "GPT-5.6 Luna",
    );
    expect(compactComposerModelName("claude-sonnet-5")).toBe("Sonnet 5");
    expect(compactComposerModelName("codex-cli")).toBe("Codex");
    expect(compactComposerReasoningEffortLabel("medium")).toBe("Med");
    expect(compactComposerReasoningEffortLabel("minimal")).toBe("Min");
    expect(compactComposerReasoningEffortLabel("xhigh")).toBe("XHigh");

    const translate = (key: string, options?: Record<string, unknown>) =>
      key === "agentChat.composer.defaultModel"
        ? "Standardmodell"
        : key === "agentChat.composer.reasoningMediumShort"
          ? "Mittel"
          : String(options?.defaultValue ?? key);
    expect(compactComposerModelName("auto", translate)).toBe("Standardmodell");
    expect(compactComposerReasoningEffortLabel("medium", translate)).toBe(
      "Mittel",
    );
  });

  it("limits Codex to OpenAI model providers", () => {
    expect(
      isOpenAiModelProviderGroup({
        engine: "builder",
        label: "OpenAI",
        models: ["gpt-5.6-luna"],
      }),
    ).toBe(true);
    expect(
      isOpenAiModelProviderGroup({
        engine: "ai-sdk:google",
        label: "Gemini",
        models: ["gemini-3.5-flash"],
      }),
    ).toBe(false);
    expect(
      isOpenAiModelProviderGroup({
        engine: "custom-gateway",
        label: "Custom",
        models: ["gpt-5.6-luna"],
      }),
    ).toBe(true);
    expect(
      isOpenAiModelProviderGroup({
        engine: "ai-sdk:openrouter",
        label: "OpenRouter",
        models: ["openai/gpt-5.6-luna"],
      }),
    ).toBe(true);
    expect(
      isOpenAiModelProviderGroup({
        engine: "codex-cli",
        label: "OpenAI",
        models: ["gpt-5.6-luna"],
      }),
    ).toBe(true);
    expect(
      isOpenAiModelProviderGroup({
        engine: "codex-cli",
        label: "OpenAI",
        models: ["codex-cli"],
      }),
    ).toBe(false);
  });

  it("keeps the prompt composer schema minimal and restores legacy draft HTML", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createTiptapComposerExtensions(() => "Message agent..."),
    });

    expect(Object.keys(editor.schema.marks)).toEqual([]);
    expect(Object.keys(editor.schema.nodes).sort()).toEqual([
      "doc",
      "fileReference",
      "hardBreak",
      "mentionReference",
      "paragraph",
      "skillReference",
      "text",
    ]);

    expect(() => {
      editor.commands.setContent(`
        <h1>Legacy heading</h1>
        <ul><li>Legacy list item</li></ul>
        <p><a href="https://example.com">Legacy link</a></p>
        <p><span data-type="file-reference" path="/tmp/example.ts"></span></p>
      `);
    }).not.toThrow();

    expect(editor.getText()).toContain("Legacy heading");
    expect(editor.getText()).toContain("Legacy list item");
    expect(editor.getText()).toContain("Legacy link");
    expect(editor.getHTML()).toContain('data-type="file-reference"');

    editor.destroy();
  });

  it("restores a scoped draft before a seeded prompt without crossing scopes", async () => {
    const scope = "draft-recovery:test";
    const draftEditor = new Editor({
      element: document.createElement("div"),
      extensions: createTiptapComposerExtensions(() => "Message agent..."),
    });
    draftEditor.commands.setContent("<p>Saved prompt</p>");
    localStorage.setItem(getComposerDraftKey(scope), draftEditor.getHTML());
    draftEditor.destroy();
    expect(localStorage.getItem(getComposerDraftKey(scope))).toContain(
      "Saved prompt",
    );

    const focusRef = React.createRef<TiptapComposerHandle>();
    const onTextChange = vi.fn();
    let harnessRuntime: ReturnType<typeof useLocalRuntime> | undefined;

    function Harness({
      currentScope,
      plusMenuMode = "hidden",
    }: {
      currentScope?: string;
      plusMenuMode?: "full" | "hidden";
    }) {
      const runtime = useLocalRuntime(emptyChatModelAdapter);
      harnessRuntime = runtime;
      return React.createElement(
        AssistantRuntimeProvider,
        { runtime },
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(TiptapComposer, {
            focusRef,
            draftScope: currentScope,
            initialText: "Seed prompt",
            initialTextKey: "seed",
            includeDefaultSlashSkills: false,
            onTextChange,
            plusMenuMode,
            voiceEnabled: false,
          }),
        ),
      );
    }

    await act(async () => {
      localStorage.setItem(getComposerDraftKey(), "<p>Legacy prompt</p>");
      root.render(React.createElement(Harness, { currentScope: undefined }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector(".agent-composer-prosemirror")?.textContent,
    ).toBe("Seed prompt");
    expect(localStorage.getItem(getComposerDraftKey())).toContain(
      "Legacy prompt",
    );

    await act(async () => {
      root.render(React.createElement(Harness, { currentScope: scope }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector(".agent-composer-prosemirror")?.textContent,
    ).toBe("Saved prompt");
    expect(onTextChange).toHaveBeenCalledWith("Saved prompt");

    act(() => focusRef.current?.setText("Typed prompt"));
    expect(localStorage.getItem(getComposerDraftKey(scope))).toContain(
      "Typed prompt",
    );

    act(() =>
      focusRef.current?.insertReference({
        label: "Pending reference",
        refType: "file",
        refPath: "/tmp/pending.txt",
      }),
    );
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(localStorage.getItem(getComposerDraftKey(scope))).toContain(
      "Pending reference",
    );

    await act(async () => {
      await harnessRuntime?.thread.composer.addAttachment({
        id: "scope-a-attachment",
        type: "document",
        name: "scope-a.txt",
        content: [],
      });
    });
    expect(harnessRuntime?.thread.composer.getState().attachments).toHaveLength(
      1,
    );

    await act(async () => {
      root.render(
        React.createElement(Harness, {
          currentScope: scope,
          plusMenuMode: "full",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Add..."]')
        ?.click();
    });
    act(() => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Schedule Task")
        ?.click();
    });
    expect(
      container.querySelector('[data-agent-composer-slot="mode-row"]'),
    ).not.toBeNull();

    await act(async () => {
      root.render(
        React.createElement(Harness, {
          currentScope: "draft-recovery:other",
          plusMenuMode: "full",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector(".agent-composer-prosemirror")?.textContent,
    ).toBe("Seed prompt");
    expect(harnessRuntime?.thread.composer.getState().attachments).toHaveLength(
      0,
    );
    expect(
      container.querySelector('[data-agent-composer-slot="mode-row"]'),
    ).toBeNull();
  });

  it("syncs identical text after switching draft scopes", async () => {
    const runs: Array<ReadonlyArray<{ content?: unknown }>> = [];
    const recordingAdapter: ChatModelAdapter = {
      async *run({ messages }) {
        runs.push(messages);
      },
    };
    const focusRef = React.createRef<TiptapComposerHandle>();

    function Harness({ currentScope }: { currentScope: string }) {
      const runtime = useLocalRuntime(recordingAdapter);
      return React.createElement(
        AssistantRuntimeProvider,
        { runtime },
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(TiptapComposer, {
            focusRef,
            draftScope: currentScope,
            includeDefaultSlashSkills: false,
            plusMenuMode: "hidden",
            voiceEnabled: false,
          }),
        ),
      );
    }

    const submit = async () => {
      const editor = container.querySelector(
        ".agent-composer-prosemirror",
      ) as HTMLElement;
      await act(async () => {
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    await act(async () => {
      root.render(React.createElement(Harness, { currentScope: "scope-a" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => focusRef.current?.setText("hello"));
    await submit();

    await act(async () => {
      root.render(React.createElement(Harness, { currentScope: "scope-b" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => focusRef.current?.setText("hello"));
    await submit();

    expect(runs).toHaveLength(2);
    expect(runs[1]?.at(-1)?.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("waits for old attachment cleanup before accepting a new-scope upload", async () => {
    let releaseCleanup!: () => void;
    const cleanupDone = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const removeAttachment = vi.fn(() => cleanupDone);
    const attachmentAdapter: AttachmentAdapter = {
      accept: "*",
      add: async ({ file }) => ({
        id: file.name,
        type: "document",
        name: file.name,
        contentType: file.type,
        file,
        status: { type: "requires-action", reason: "composer-send" },
      }),
      remove: removeAttachment,
      send: async (attachment) => ({
        ...attachment,
        status: { type: "complete" },
        content: [],
      }),
    };
    const focusRef = React.createRef<TiptapComposerHandle>();
    let harnessRuntime: ReturnType<typeof useLocalRuntime> | undefined;

    function Harness({ currentScope }: { currentScope: string }) {
      const runtime = useLocalRuntime(emptyChatModelAdapter, {
        adapters: { attachments: attachmentAdapter },
      });
      harnessRuntime = runtime;
      return React.createElement(
        AssistantRuntimeProvider,
        { runtime },
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(TiptapComposer, {
            focusRef,
            draftScope: currentScope,
            includeDefaultSlashSkills: false,
            plusMenuMode: "upload-only",
            voiceEnabled: false,
          }),
        ),
      );
    }

    await act(async () => {
      root.render(React.createElement(Harness, { currentScope: "scope-a" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await harnessRuntime?.thread.composer.addAttachment(
        new File(["old"], "same.txt", { type: "text/plain" }),
      );
    });

    await act(async () => {
      root.render(React.createElement(Harness, { currentScope: "scope-b" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(harnessRuntime?.thread.composer.getState().attachments).toHaveLength(
      0,
    );

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["new"], "same.txt", { type: "text/plain" })],
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(removeAttachment).toHaveBeenCalledTimes(1);
    expect(harnessRuntime?.thread.composer.getState().attachments).toHaveLength(
      0,
    );

    await act(async () => {
      releaseCleanup();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(harnessRuntime?.thread.composer.getState().attachments).toHaveLength(
      1,
    );
  });

  it.each([
    [
      "text",
      {
        type: "text",
        text: "PK",
        backgroundColor: "#4f46e5",
      },
    ],
    [
      "image",
      {
        type: "image",
        src: "/agents/property.png",
        fit: "cover",
        backgroundColor: "#ffffff",
      },
    ],
    ["none", { type: "none" }],
  ] as const)(
    "preserves %s mention media through HTML drafts",
    (_type, media) => {
      const first = new Editor({
        element: document.createElement("div"),
        extensions: createTiptapComposerExtensions(() => "Message agent..."),
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "mentionReference",
                  attrs: {
                    label: "Property agent",
                    media,
                  },
                },
              ],
            },
          ],
        },
      });
      const html = first.getHTML();
      first.destroy();

      expect(html).toContain("data-media=");
      expect(html).not.toContain("[object Object]");

      const restored = new Editor({
        element: document.createElement("div"),
        extensions: createTiptapComposerExtensions(() => "Message agent..."),
        content: html,
      });
      const mentionNode = restored.getJSON().content?.[0]?.content?.[0] as
        | { attrs?: Record<string, unknown> }
        | undefined;
      restored.destroy();

      expect(mentionNode?.attrs?.media).toEqual(media);
    },
  );

  it("allows sending an attachment-only prompt", () => {
    expect(
      canSubmitComposerContent({
        hasEditorContent: false,
        attachmentCount: 1,
      }),
    ).toBe(true);
    expect(
      canSubmitComposerContent({
        hasEditorContent: false,
        attachmentCount: 1,
        disabled: true,
      }),
    ).toBe(false);
  });

  it("uses one primary action while a response is running", () => {
    expect(
      resolveComposerPrimaryAction({
        canSubmit: false,
        hasStopButton: true,
      }),
    ).toBe("stop");
    expect(
      resolveComposerPrimaryAction({
        canSubmit: true,
        hasStopButton: true,
      }),
    ).toBe("send");
    expect(
      resolveComposerPrimaryAction({
        canSubmit: false,
        hasStopButton: false,
      }),
    ).toBe("send");
  });

  it("uses the queue tooltip when the submit will wait", () => {
    expect(getComposerSendTooltipKey(true)).toBe("composer.queueMessage");
    expect(getComposerSendTooltipKey(false)).toBe("composer.sendMessage");
  });

  it("selects and removes context chips one Backspace at a time", () => {
    let contextItemKeys = ["dashboard", "panel"];
    let selectedKey: string | null = null;

    const selectPanel = resolveContextChipBackspaceAction({
      contextItemKeys,
      selectedKey,
      cursorAtStart: true,
    });
    expect(selectPanel).toEqual({ type: "select", key: "panel" });
    selectedKey = selectPanel?.key ?? null;

    const removePanel = resolveContextChipBackspaceAction({
      contextItemKeys,
      selectedKey,
      cursorAtStart: true,
    });
    expect(removePanel).toEqual({ type: "remove", key: "panel" });
    contextItemKeys = contextItemKeys.filter((key) => key !== removePanel?.key);
    selectedKey = null;

    const selectDashboard = resolveContextChipBackspaceAction({
      contextItemKeys,
      selectedKey,
      cursorAtStart: true,
    });
    expect(selectDashboard).toEqual({ type: "select", key: "dashboard" });
    selectedKey = selectDashboard?.key ?? null;

    expect(
      resolveContextChipBackspaceAction({
        contextItemKeys,
        selectedKey,
        cursorAtStart: true,
      }),
    ).toEqual({ type: "remove", key: "dashboard" });
  });

  it("leaves context chips alone when the caret is not at the start", () => {
    expect(
      resolveContextChipBackspaceAction({
        contextItemKeys: ["dashboard"],
        selectedKey: null,
        cursorAtStart: false,
      }),
    ).toBeNull();
  });

  it("uses a visible fallback for attachment-only composer mode prompts", () => {
    expect(
      displayableComposerModeMessage({
        messagePrefix: "Create an extension: ",
        trimmedText: "",
        attachmentCount: 1,
      }),
    ).toBe("Create an extension: Use the attached context.");
    expect(
      displayableComposerModeMessage({
        messagePrefix: "Erstelle eine Erweiterung: ",
        trimmedText: "",
        attachmentCount: 1,
        attachedContextFallback: "Verwende den angehängten Kontext.",
      }),
    ).toBe("Erstelle eine Erweiterung: Verwende den angehängten Kontext.");
  });

  it("detects oversized PDF attachments before submit", () => {
    const file = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.pdf", {
      type: "application/pdf",
    });

    expect(
      getOversizedDocumentAttachmentError([
        {
          type: "document",
          name: "large.pdf",
          contentType: "application/pdf",
          file,
        },
      ]),
    ).toContain('"large.pdf" is 4.0 MB. PDFs are capped at 4 MB');
    expect(
      getOversizedDocumentAttachmentError([
        {
          type: "image",
          name: "large.png",
          contentType: "image/png",
          file,
        },
      ]),
    ).toBeNull();
  });

  it("allows hosts to use a larger multipart document cap", () => {
    const file = new File(
      [new Uint8Array(4 * 1024 * 1024 + 1)],
      "reference.pdf",
      { type: "application/pdf" },
    );

    expect(
      getOversizedDocumentAttachmentError(
        [
          {
            type: "document",
            name: "reference.pdf",
            contentType: "application/pdf",
            file,
          },
        ],
        {
          maxBytes: 50 * 1024 * 1024,
          label: "Slides reference files",
        },
      ),
    ).toBeNull();
  });

  it("localizes a custom multipart document cap", () => {
    const file = new File(
      [new Uint8Array(4 * 1024 * 1024 + 1)],
      "reference.pdf",
      { type: "application/pdf" },
    );
    let translatedOptions: Record<string, unknown> | undefined;

    const error = getOversizedDocumentAttachmentError(
      [
        {
          type: "document",
          name: "reference.pdf",
          contentType: "application/pdf",
          file,
        },
      ],
      {
        maxBytes: 4 * 1024 * 1024,
        label: "Präsentationsdateien",
        translate: (key, options) => {
          expect(key).toBe("agentChat.composer.documentTooLarge");
          translatedOptions = options;
          return `„${String(options?.name)}“ ist ${String(options?.size)} MB groß. ${String(options?.label)} sind auf ${String(options?.maxSize)} MB begrenzt.`;
        },
      },
    );

    expect(error).toBe(
      "„reference.pdf“ ist 4.0 MB groß. Präsentationsdateien sind auf 4 MB begrenzt.",
    );
    expect(translatedOptions).toEqual(
      expect.objectContaining({
        name: "reference.pdf",
        size: "4.0",
        label: "Präsentationsdateien",
        maxSize: "4",
      }),
    );
  });

  it("maps Enter keybindings to immediate and queued submit intents", () => {
    const enter = {
      key: "Enter",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
    };

    expect(getComposerSubmitIntentForEnterKey(enter, true)).toBe("immediate");
    expect(getComposerSubmitIntentForEnterKey(enter, false)).toBe("immediate");
    expect(
      getComposerSubmitIntentForEnterKey({ ...enter, metaKey: true }, true),
    ).toBe("queued");
    expect(
      getComposerSubmitIntentForEnterKey({ ...enter, ctrlKey: true }, false),
    ).toBe("queued");
    expect(
      getComposerSubmitIntentForEnterKey(
        { ...enter, shiftKey: true, metaKey: true },
        true,
      ),
    ).toBeNull();
    expect(
      getComposerSubmitIntentForEnterKey({ ...enter, ctrlKey: true }, true),
    ).toBeNull();
    expect(
      getComposerSubmitIntentForEnterKey({ ...enter, metaKey: true }, false),
    ).toBeNull();
  });

  it("scrolls the composer caret into view for Shift+Enter line breaks", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createTiptapComposerExtensions(() => "Message agent..."),
      content: "<p>Hello</p>",
    });
    editor.commands.setTextSelection(editor.state.doc.content.size);

    const view = editor.view;
    const scrolledTransactions: boolean[] = [];
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (transaction) => {
      scrolledTransactions.push(transaction.scrolledIntoView);
      dispatch(transaction);
    };

    expect(insertComposerHardBreakAndScrollIntoView(view)).toBe(true);
    expect(scrolledTransactions).toEqual([true]);
    expect(editor.getText()).toBe("Hello\n");

    editor.destroy();
  });

  it("guards popover positioning when the editor cannot resolve coordinates", () => {
    expect(
      getComposerPopoverPosition(
        {
          coordsAtPos: () => ({ top: 12, bottom: 20, left: 34, right: 34 }),
        },
        1,
      ),
    ).toEqual({ top: 12, left: 34 });
    expect(
      getComposerPopoverPosition(
        {
          coordsAtPos: () => {
            throw new TypeError("node.getBoundingClientRect is not a function");
          },
        },
        1,
      ),
    ).toBeNull();
    expect(
      getComposerPopoverPosition(
        {
          coordsAtPos: () => ({
            top: Number.NaN,
            bottom: 20,
            left: 34,
            right: 34,
          }),
        },
        1,
      ),
    ).toBeNull();
  });

  it("consumes composer file drops so parent drop targets do not attach duplicates", () => {
    const file = new File(["fake"], "image.png", { type: "image/png" });
    const added: File[] = [];
    let prevented = false;
    let stopped = false;
    const handled = handleComposerFileDrop({
      event: {
        dataTransfer: { files: [file] },
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      } as unknown as DragEvent,
      addAttachment: async (attachment) => {
        added.push(attachment);
      },
    });

    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0]?.name).toMatch(/^\d+-[a-z0-9]+-image\.png$/);
  });

  it("caps the model picker height without forcing empty vertical space", () => {
    expect(MODEL_SELECTOR_POPOVER_STYLE).toMatchObject({
      fontSize: 13,
      maxHeight:
        "min(500px, var(--radix-popover-content-available-height, 500px))",
    });
    expect(MODEL_SELECTOR_POPOVER_STYLE).not.toHaveProperty("height");
  });

  it("shows the model picker skeleton only while the initial list is loading", () => {
    expect(shouldShowModelSelectorSkeleton(true, 0)).toBe(true);
    expect(shouldShowModelSelectorSkeleton(true, 2)).toBe(false);
    expect(shouldShowModelSelectorSkeleton(false, 0)).toBe(false);
  });

  it("replaces the model list with connect CTAs only when nothing is configured", () => {
    const unconfigured = [{ configured: false }, { configured: false }];
    expect(shouldShowOnlyConnectPath(true, unconfigured)).toBe(true);
    expect(
      shouldShowOnlyConnectPath(true, [
        { configured: true },
        { configured: false },
      ]),
    ).toBe(false);
    // No CTA to fall back on — keep the list rather than empty the popover.
    expect(shouldShowOnlyConnectPath(false, unconfigured)).toBe(false);
  });

  it("keeps cloud setup readiness separate from local runtime readiness", () => {
    expect(
      hasConfiguredCloudProvider([
        { engine: "pi-cli", configured: true },
        { engine: "opencode-cli", configured: true },
      ]),
    ).toBe(false);
    expect(
      hasConfiguredCloudProvider([
        { engine: "pi-cli", configured: true },
        { engine: "builder", configured: true },
      ]),
    ).toBe(true);
    expect(
      hasConfiguredCloudProvider([{ engine: "builder", configured: false }]),
    ).toBe(false);
  });

  it("still renders the picker when nothing is configured, even though that leaves selectedModel empty", () => {
    // Nothing routable yet means useChatModels() resolves selectedModel to
    // "" (never null/undefined) so it can't be pre-selected — that must not
    // read as "no picker to show": the connect-provider CTAs still live
    // inside the picker itself.
    const unconfigured = [
      {
        engine: "openai",
        label: "OpenAI",
        models: ["gpt-5"],
        configured: false,
      },
    ];
    expect(shouldRenderModelSelector(unconfigured, () => {})).toBe(true);
    // Genuinely nothing to show: no engines, or no way to change the model.
    expect(shouldRenderModelSelector([], () => {})).toBe(false);
    expect(shouldRenderModelSelector(unconfigured, undefined)).toBe(false);
    expect(shouldRenderModelSelector(undefined, () => {})).toBe(false);
  });

  it("resets a hidden model when switching to Claude Code", async () => {
    const onModelChange = vi.fn();

    function Harness() {
      const runtime = useLocalRuntime(emptyChatModelAdapter);
      return React.createElement(
        AssistantRuntimeProvider,
        { runtime },
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(TiptapComposer, {
            availableModels: [
              {
                engine: "openai",
                label: "OpenAI",
                models: ["gpt-5.6-sol"],
                configured: true,
              },
              {
                engine: "claude-cli",
                label: "Claude Code",
                models: ["claude-sonnet-5"],
                configured: true,
              },
            ],
            selectedModel: "gpt-5.6-sol",
            selectedEngine: "openai",
            selectedAgent: "claude-code",
            onModelChange,
            includeDefaultSlashSkills: false,
            plusMenuMode: "hidden",
            voiceEnabled: false,
          }),
        ),
      );
    }

    act(() => root.render(React.createElement(Harness)));

    await act(async () => {});

    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5", "claude-cli");
  });
});

describe("TiptapComposer slash commands", () => {
  it("submits a slash-prefixed prompt when no command handler is provided", async () => {
    const onSubmit = vi.fn();
    const focusRef = React.createRef<TiptapComposerHandle>();

    function Harness() {
      const runtime = useLocalRuntime(emptyChatModelAdapter);
      return React.createElement(
        AssistantRuntimeProvider,
        { runtime },
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(TiptapComposer, {
            focusRef,
            onSubmit,
            clearOnSubmit: false,
            includeDefaultSlashSkills: false,
            plusMenuMode: "hidden",
            voiceEnabled: false,
          }),
        ),
      );
    }

    act(() => root.render(React.createElement(Harness)));
    act(() => focusRef.current?.setText("/act"));

    const editor = container.querySelector(
      ".agent-composer-prosemirror",
    ) as HTMLElement;
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });

    expect(onSubmit).toHaveBeenCalledWith(
      "/act",
      [],
      [],
      expect.objectContaining({ intent: "immediate" }),
    );
    expect(editor.textContent).toBe("/act");
  });

  it("acknowledges an executed slash command", async () => {
    const onSlashCommand = vi.fn();
    const focusRef = React.createRef<TiptapComposerHandle>();

    function Harness() {
      const runtime = useLocalRuntime(emptyChatModelAdapter);
      return React.createElement(
        AssistantRuntimeProvider,
        { runtime },
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(TiptapComposer, {
            focusRef,
            onSlashCommand,
            includeDefaultSlashSkills: false,
            plusMenuMode: "hidden",
            voiceEnabled: false,
          }),
        ),
      );
    }

    act(() => root.render(React.createElement(Harness)));
    act(() => focusRef.current?.setText("/act"));

    const editor = container.querySelector(
      ".agent-composer-prosemirror",
    ) as HTMLElement;
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });

    expect(onSlashCommand).toHaveBeenCalledWith("act");
    expect(toast.success).toHaveBeenCalledWith(
      "/act",
      expect.objectContaining({
        description: "Switch back to acting",
        duration: 1800,
      }),
    );
  });
});

describe("composerModelCostTier", () => {
  it("tiers each provider's entry, mid, and flagship models", () => {
    expect(composerModelCostTier("gpt-5-6-luna")).toBe(1);
    expect(composerModelCostTier("gpt-5.6-terra")).toBe(2);
    expect(composerModelCostTier("openai/gpt-5.6-sol")).toBe(3);
    expect(composerModelCostTier("claude-haiku-4-5")).toBe(1);
    expect(composerModelCostTier("claude-sonnet-5")).toBe(2);
    expect(composerModelCostTier("anthropic/claude-opus-4.8")).toBe(3);
    expect(composerModelCostTier("claude-fable-5")).toBe(3);
    expect(composerModelCostTier("gemini-3-1-flash-lite")).toBe(1);
    expect(composerModelCostTier("gemini-3-1-pro")).toBe(3);
  });

  it("returns undefined for unmapped models so no cost label renders", () => {
    // A guessed tier is worse than none — these render without a `$` label.
    expect(composerModelCostTier("auto")).toBeUndefined();
    expect(composerModelCostTier("z-ai/glm-5.2")).toBeUndefined();
    expect(composerModelCostTier("kimi-k2-5")).toBeUndefined();
    expect(composerModelCostTier("")).toBeUndefined();
  });
});

describe("voice composer insertion", () => {
  it("adds sentence punctuation and a trailing separator to dictated text", () => {
    expect(formatVoiceTranscriptForComposer("  First sentence  ")).toBe(
      "First sentence. ",
    );
    expect(formatVoiceTranscriptForComposer("Already done? ")).toBe(
      "Already done? ",
    );
    expect(formatVoiceTranscriptForComposer("   ")).toBe("");
  });

  it("only removes a live preview when its range still contains the preview", () => {
    expect(
      canRemoveVoicePreview({
        documentSize: 20,
        anchor: 4,
        previewText: "draft",
        currentText: "draft",
      }),
    ).toBe(true);
    expect(
      canRemoveVoicePreview({
        documentSize: 6,
        anchor: 4,
        previewText: "draft",
        currentText: "",
      }),
    ).toBe(false);
    expect(
      canRemoveVoicePreview({
        documentSize: 20,
        anchor: 4,
        previewText: "draft",
        currentText: "sent",
      }),
    ).toBe(false);
  });
});

describe("ModeSelector Act/Plan toggle", () => {
  function Harness(props: {
    execMode: "build" | "plan";
    onExecModeChange: (mode: "build" | "plan") => void;
  }) {
    const runtime = useLocalRuntime(emptyChatModelAdapter);
    return React.createElement(
      AssistantRuntimeProvider,
      { runtime },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(TiptapComposer, {
          includeDefaultSlashSkills: false,
          plusMenuMode: "hidden",
          voiceEnabled: false,
          execMode: props.execMode,
          onExecModeChange: props.onExecModeChange,
        }),
      ),
    );
  }

  function getModeButton() {
    return container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="mode-button"]',
    );
  }

  function getPopoverOptionButton(label: "Act" | "Plan") {
    const popover = document.querySelector(
      '[data-agent-native-composer-popover="true"]',
    );
    return Array.from(popover?.querySelectorAll("button") ?? []).find(
      (button) => button.querySelector("span")?.textContent?.trim() === label,
    );
  }

  it("switches mode from a single click on the popover option, with no extra click needed", async () => {
    const onExecModeChange = vi.fn();
    await act(async () => {
      root.render(
        React.createElement(Harness, { execMode: "build", onExecModeChange }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => getModeButton()?.click());
    expect(
      document.querySelector('[data-agent-native-composer-popover="true"]'),
    ).not.toBeNull();

    act(() => getPopoverOptionButton("Plan")?.click());

    expect(onExecModeChange).toHaveBeenCalledTimes(1);
    expect(onExecModeChange).toHaveBeenCalledWith("plan");
    expect(
      document.querySelector('[data-agent-native-composer-popover="true"]'),
    ).toBeNull();
  });

  it("toggles mode with the Shift+Tab shortcut while the editor is focused", async () => {
    const onExecModeChange = vi.fn();
    await act(async () => {
      root.render(
        React.createElement(Harness, { execMode: "build", onExecModeChange }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const editor = container.querySelector(
      ".agent-composer-prosemirror",
    ) as HTMLElement;
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Tab",
          shiftKey: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onExecModeChange).toHaveBeenCalledTimes(1);
    expect(onExecModeChange).toHaveBeenCalledWith("plan");
  });

  it("does not change mode on focus/blur alone, only on an explicit selection", async () => {
    const onExecModeChange = vi.fn();
    await act(async () => {
      root.render(
        React.createElement(Harness, { execMode: "build", onExecModeChange }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const modeButton = getModeButton()!;
    act(() => modeButton.click());
    expect(
      document.querySelector('[data-agent-native-composer-popover="true"]'),
    ).not.toBeNull();

    act(() => {
      modeButton.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
      document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(onExecModeChange).not.toHaveBeenCalled();
  });
});
