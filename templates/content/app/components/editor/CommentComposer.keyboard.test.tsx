// @vitest-environment happy-dom

import {
  findExactMentionItem,
  type MentionItem,
  type TiptapComposerHandle,
} from "@agent-native/toolkit/composer";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { typeRichEditorText } from "./comment-composer-test-utils";
import { CommentComposer, type CommentAiDraft } from "./CommentComposer";

const onModelChange = vi.fn();
const onAiDraftChange = vi.fn();
vi.mock("@agent-native/core/client/agent-chat", () => ({
  useChatModels: () => ({
    configuredModels: [
      {
        engine: "builder",
        label: "Builder",
        configured: true,
        models: ["gpt-5-6-luna"],
      },
      {
        engine: "anthropic",
        label: "Anthropic",
        configured: true,
        models: ["claude-sonnet-5"],
      },
    ],
    selectedModel: "gpt-5-6-luna",
    selectedEngine: "builder",
    selectedEffort: "high",
    selectionReady: true,
    unavailableSelection: null,
    onModelChange,
    onEffortChange: vi.fn(),
  }),
}));

describe("CommentComposer rich recipient", () => {
  it.each(["AI", "Luna", "Sonnet"])(
    "commits the exact @%s alias while leaving prose unmatched",
    (alias) => {
      const item: MentionItem = {
        id: alias,
        label: `Provider · ${alias}`,
        aliases: [alias],
        source: "content",
        refType: "content-comment-ai-recipient",
      };
      expect(findExactMentionItem([item], alias)).toBe(item);
      expect(findExactMentionItem([item], `${alias} please`)).toBeUndefined();
    },
  );
  let container: HTMLDivElement;
  let root: Root;
  const submit = vi.fn();
  const escape = vi.fn();
  const aiSubmit = vi.fn();
  let handle: TiptapComposerHandle | null = null;

  function Owner({
    initialAi = null,
    initialValue = "Review this",
  }: {
    initialAi?: CommentAiDraft | null;
    initialValue?: string;
  }) {
    const [value, setValue] = useState(initialValue);
    const [aiDraft, setAiDraft] = useState<CommentAiDraft | null>(initialAi);
    const composer = useRef<TiptapComposerHandle>(null);
    handle = composer.current;
    return (
      <CommentComposer
        ref={(next) => {
          composer.current = next;
          handle = next;
        }}
        value={value}
        onChange={setValue}
        onSubmit={submit}
        onEscape={escape}
        onMentionAdd={vi.fn()}
        onAiSubmit={aiSubmit}
        aiDraft={aiDraft}
        onAiDraftChange={(next) => {
          onAiDraftChange(next);
          setAiDraft(next);
        }}
        aiModelStorageKey="comment-ai:test"
        members={[{ name: "Alice", email: "alice@example.test" }]}
      />
    );
  }

  beforeEach(async () => {
    onModelChange.mockClear();
    onAiDraftChange.mockClear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Owner />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const editor = () => container.querySelector<HTMLElement>(".ProseMirror")!;

  it("opens the mention menu from the @ button", async () => {
    await act(async () => {
      editor().focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const [, mentionButton] = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[data-comment-composer-tools] button",
      ),
    ];
    expect(mentionButton).toBeDefined();
    await act(async () => {
      mentionButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // "Review this" ends in a word, so the button adds a space before the @.
    expect(editor().textContent).toContain("Review this @");
    const options = [
      ...document.querySelectorAll(
        '[data-agent-native-composer-popover="true"] [data-mention-index]',
      ),
    ].map((option) => option.textContent);
    expect(options.some((option) => option?.includes("Claude Sonnet 5"))).toBe(
      true,
    );
    expect(options.some((option) => option?.includes("Alice"))).toBe(true);
  });

  it("renders the controlled AI recipient as a selectable inline atom", async () => {
    await act(async () =>
      root.render(
        <Owner
          key="with-ai"
          initialAi={{
            selection: {
              model: "gpt-5-6-luna",
              engine: "builder",
              provider: "Builder",
            },
            mode: "auto",
          }}
        />,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(editor().textContent).toContain("GPT-5.6 Luna");
    expect(handle?.getSelection()).not.toBeNull();
  });

  it("shows comment recipients with AI first and omits workspace mention search", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await act(async () =>
      root.render(<Owner key="mentions" initialValue="" />),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    fetchSpy.mockClear();

    await typeRichEditorText(editor(), "@");

    const popover = document.querySelector(
      '[data-agent-native-composer-popover="true"]',
    );
    const options = [...(popover?.querySelectorAll("button") ?? [])];
    // Each row is its label then its description; people carry a decorative
    // initial avatar until their photo loads.
    expect(options.map((option) => option.textContent)).toEqual([
      "AIGPT-5.6 Luna",
      "GPT-5.6 LunaBuilder",
      "Claude Sonnet 5Anthropic",
      "AAlicealice@example.test",
    ]);
    expect(options[0]?.querySelector("img")).not.toBeNull();
    expect(popover?.textContent).toContain("Alice");
    expect(popover?.textContent).not.toContain("Files");
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(input).includes("/_agent-native/agent-chat/mentions"),
      ),
    ).toBe(false);

    await typeRichEditorText(editor(), "AI ");
    expect(editor().textContent).toContain("GPT-5.6 Luna");
    expect(onModelChange).toHaveBeenCalledWith("gpt-5-6-luna", "builder");
  });

  it("keeps the composer settled after clicking the AI mention", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await act(async () =>
      root.render(<Owner key="click-ai" initialValue="" />),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    await typeRichEditorText(editor(), "@");
    const aiOption = document.querySelector<HTMLButtonElement>(
      '[data-agent-native-composer-popover="true"] [data-mention-index="0"]',
    );
    expect(aiOption?.textContent).toContain("AI");
    onAiDraftChange.mockClear();

    await act(async () => aiOption?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));

    expect(onAiDraftChange.mock.calls).toEqual([
      [
        {
          selection: {
            model: "gpt-5-6-luna",
            engine: "builder",
            provider: "Builder",
          },
          mode: "auto",
        },
      ],
    ]);
    expect(editor().textContent).toContain("GPT-5.6 Luna");
    // The model is changed on the pill itself, not a separate toolbar picker.
    expect(
      container.querySelector('[data-agent-composer-slot="model-button"]'),
    ).toBeNull();
    expect(
      container.querySelector("[data-comment-ai-send-control]"),
    ).not.toBeNull();
    const pill = container.querySelector<HTMLElement>(
      '[data-mention-ref-type="content-comment-ai-recipient"]',
    );
    expect(pill).not.toBeNull();
    await act(async () => pill?.click());
    expect(
      document.querySelector("[data-comment-ai-model-list]")?.textContent,
    ).toContain("Claude Sonnet 5");
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("Maximum update depth exceeded"),
      ),
    ).toBe(false);
  });

  it("preserves the AI recipient while controlled text is restored", async () => {
    const initialAi: CommentAiDraft = {
      selection: {
        model: "gpt-5-6-luna",
        engine: "builder",
        provider: "Builder",
      },
      mode: "suggest",
    };
    function ControlledOwner({ value }: { value: string }) {
      const [aiDraft, setAiDraft] = useState<CommentAiDraft | null>(initialAi);
      return (
        <CommentComposer
          value={value}
          onChange={vi.fn()}
          onSubmit={submit}
          onEscape={escape}
          onMentionAdd={vi.fn()}
          onAiSubmit={aiSubmit}
          aiDraft={aiDraft}
          onAiDraftChange={setAiDraft}
          aiModelStorageKey="comment-ai:controlled"
          members={[]}
        />
      );
    }

    await act(async () =>
      root.render(<ControlledOwner value="Original request" />),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(async () =>
      root.render(<ControlledOwner value="Restored request" />),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(editor().textContent).toContain("Restored request");
    expect(editor().textContent).toContain("GPT-5.6 Luna");
    expect(editor().textContent?.match(/GPT-5.6 Luna/g)).toHaveLength(1);
    expect(
      container.querySelector("[data-comment-ai-send-control]"),
    ).not.toBeNull();
  });

  it("replaces an existing AI recipient when another model is selected", async () => {
    await act(async () =>
      root.render(
        <Owner
          key="replace-ai"
          initialAi={{
            selection: {
              model: "gpt-5-6-luna",
              engine: "builder",
              provider: "Builder",
            },
            mode: "suggest",
          }}
        />,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    onAiDraftChange.mockClear();

    await typeRichEditorText(editor(), "@");
    const sonnetOption = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-agent-native-composer-popover="true"] [data-mention-index]',
      ),
    ].find((option) => option.textContent?.includes("Claude Sonnet 5"));
    expect(sonnetOption).toBeDefined();
    await act(async () => {
      sonnetOption?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      sonnetOption?.click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(editor().textContent).toContain("Claude Sonnet 5");
    expect(editor().textContent).not.toContain("GPT-5.6 Luna");
    expect(editor().textContent?.match(/Claude Sonnet 5/g)).toHaveLength(1);
    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5", "anthropic");
    expect(onAiDraftChange).toHaveBeenLastCalledWith({
      selection: {
        model: "claude-sonnet-5",
        engine: "anthropic",
        provider: "Anthropic",
      },
      mode: "suggest",
    });
  });

  it("replaces the AI recipient when a model is typed and chosen with Enter", async () => {
    await act(async () =>
      root.render(
        <Owner
          key="typed-ai"
          initialAi={{
            selection: {
              model: "gpt-5-6-luna",
              engine: "builder",
              provider: "Builder",
            },
            mode: "auto",
          }}
        />,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    await typeRichEditorText(editor(), " @");
    await typeRichEditorText(editor(), "Sonnet");
    const options = [
      ...document.querySelectorAll(
        '[data-agent-native-composer-popover="true"] [data-mention-index]',
      ),
    ].map((option) => option.textContent);
    expect(options[0]).toContain("Claude Sonnet 5");
    await act(async () => {
      editor().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    const pills = container.querySelectorAll(
      '[data-mention-ref-type="content-comment-ai-recipient"]',
    );
    expect(pills).toHaveLength(1);
    expect(pills[0]?.textContent).toContain("Claude Sonnet 5");
    expect(editor().textContent).not.toContain("@Sonnet");
    expect(aiSubmit).not.toHaveBeenCalled();
  });

  it("keeps one AI recipient when a second model pill is inserted", async () => {
    await act(async () =>
      root.render(
        <Owner
          key="single-ai"
          initialAi={{
            selection: {
              model: "gpt-5-6-luna",
              engine: "builder",
              provider: "Builder",
            },
            mode: "reply",
          }}
        />,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(
      container
        .querySelector("[data-comment-composer]")
        ?.hasAttribute("data-model-switchable"),
    ).toBe(true);

    // Paste, drafts, and handle calls skip the mention menu's replacement.
    await act(async () =>
      handle?.insertReference({
        label: "Claude Sonnet 5",
        source: "content",
        refType: "content-comment-ai-recipient",
        refId: "anthropic:claude-sonnet-5",
        metadata: {
          selection: {
            model: "claude-sonnet-5",
            engine: "anthropic",
            provider: "Anthropic",
          },
        },
      }),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    const pills = container.querySelectorAll(
      '[data-mention-ref-type="content-comment-ai-recipient"]',
    );
    expect(pills).toHaveLength(1);
    expect(pills[0]?.textContent).toContain("Claude Sonnet 5");
    expect(onAiDraftChange).toHaveBeenLastCalledWith({
      selection: {
        model: "claude-sonnet-5",
        engine: "anthropic",
        provider: "Anthropic",
      },
      mode: "reply",
    });
  });

  it("supports caret selection and controlled recipient removal", async () => {
    await act(async () =>
      handle?.replaceReference("content-comment-ai-recipient", {
        label: "GPT-5.6 Luna",
        source: "content",
        refType: "content-comment-ai-recipient",
        refId: "builder:gpt-5-6-luna",
      }),
    );
    expect(
      [...container.querySelectorAll("span")].find((node) =>
        node.textContent?.includes("GPT-5.6 Luna"),
      ),
    ).not.toBeNull();
    const selection = handle?.getSelection();
    expect(selection).not.toBeNull();
    await act(async () =>
      handle?.replaceReference("content-comment-ai-recipient", null),
    );
    expect(
      [...container.querySelectorAll("span")].find((node) =>
        node.textContent?.includes("GPT-5.6 Luna"),
      ),
    ).toBeUndefined();
  });

  it.each([
    { isComposing: true, keyCode: 0 },
    { isComposing: false, keyCode: 229 },
  ])(
    "does not submit or dismiss during IME candidate keys %#",
    async ({ isComposing, keyCode }) => {
      editor().dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true, data: "あ" }),
      );
      for (const key of ["Enter", " ", "Escape"]) {
        editor().dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            keyCode,
            bubbles: true,
            cancelable: true,
            isComposing,
          }),
        );
      }
      expect(submit).not.toHaveBeenCalled();
      expect(aiSubmit).not.toHaveBeenCalled();
      expect(escape).not.toHaveBeenCalled();
      editor().dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "あ" }),
      );
    },
  );
});
