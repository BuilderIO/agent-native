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
import type { MentionEntry } from "./comment-drafts";
import { CommentComposer, type CommentAiDraft } from "./CommentComposer";

const mentionMembers = vi.hoisted(() => ({
  current: {
    data: [{ name: "Alice", email: "alice@example.test" }] as
      | { name: string; email: string }[]
      | undefined,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => mentionMembers.current,
}));
const onModelChange = vi.fn();
const onAiDraftChange = vi.fn();
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
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
    mentions = [],
  }: {
    initialAi?: CommentAiDraft | null;
    initialValue?: string;
    mentions?: MentionEntry[];
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
        mentions={mentions}
        onMentionsChange={vi.fn()}
        onAiSubmit={aiSubmit}
        aiDraft={aiDraft}
        onAiDraftChange={(next) => {
          onAiDraftChange(next);
          setAiDraft(next);
        }}
        aiModelStorageKey="comment-ai:test"
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

    // A recipient comes only from an explicit pick, not from typing past it.
    await typeRichEditorText(editor(), "AI");
    await act(async () => {
      editor().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(editor().textContent).toContain("GPT-5.6 Luna");
    expect(onModelChange).toHaveBeenCalledWith("gpt-5-6-luna", "builder");
  });

  it("says when people could not load and retries from the mention menu", async () => {
    const people = mentionMembers.current;
    const refetch = vi.fn();
    mentionMembers.current = { data: undefined, isError: true, refetch };
    try {
      await act(async () =>
        root.render(<Owner key="members-failed" initialValue="" />),
      );
      await typeRichEditorText(editor(), "@");

      const popover = document.querySelector(
        '[data-agent-native-composer-popover="true"]',
      );
      const alert = popover?.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(popover?.textContent).toContain("Claude Sonnet 5");
      expect(popover?.textContent).not.toContain("alice@example.test");

      await act(async () => alert?.querySelector("button")?.click());
      expect(refetch).toHaveBeenCalledTimes(1);
    } finally {
      mentionMembers.current = people;
    }
  });

  it("reaches Retry from the keyboard when people could not load", async () => {
    const people = mentionMembers.current;
    const refetch = vi.fn();
    mentionMembers.current = { data: undefined, isError: true, refetch };
    try {
      await act(async () =>
        root.render(<Owner key="members-failed-keyboard" initialValue="" />),
      );
      await typeRichEditorText(editor(), "@");
      const press = (key: string) =>
        act(async () => {
          editor().dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
        });

      await press("ArrowUp");
      const retry = document.querySelector(
        '[data-agent-native-composer-popover="true"] [role="alert"] button',
      );
      expect(retry?.getAttribute("data-mention-index")).toBe("-1");
      expect(retry?.className).toContain("bg-muted");

      await press("Enter");
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(submit).not.toHaveBeenCalled();
      expect(aiSubmit).not.toHaveBeenCalled();
      expect(
        document.querySelector('[data-agent-native-composer-popover="true"]'),
      ).not.toBeNull();
    } finally {
      mentionMembers.current = people;
    }
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
          mentions={[]}
          onMentionsChange={vi.fn()}
          onAiSubmit={aiSubmit}
          aiDraft={aiDraft}
          onAiDraftChange={setAiDraft}
          aiModelStorageKey="comment-ai:controlled"
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

  it("restores a saved AI draft with one recipient chip", async () => {
    await act(async () =>
      root.render(
        <Owner
          key="restored"
          initialValue="Ask @GPT-5.6 Luna"
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

    expect(editor().textContent?.match(/GPT-5.6 Luna/g)).toHaveLength(1);
    expect(
      editor().querySelectorAll(
        '[data-mention-ref-type="content-comment-ai-recipient"]',
      ),
    ).toHaveLength(1);
  });

  it("restores a saved AI draft's chip past an @model in inline code", async () => {
    await act(async () =>
      root.render(
        <Owner
          key="restored-code"
          initialValue="See `@GPT-5.6 Luna`, then ask @GPT-5.6 Luna"
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

    const chips = editor().querySelectorAll(
      '[data-mention-ref-type="content-comment-ai-recipient"]',
    );
    expect(chips).toHaveLength(1);
    const before = document.createRange();
    before.setStart(editor(), 0);
    before.setEndBefore(chips[0]!);
    expect(before.toString()).toBe("See `@GPT-5.6 Luna`, then ask ");
  });

  it("restores a saved AI draft's chip at its whole name, after a longer name", async () => {
    await act(async () =>
      root.render(
        <Owner
          key="restored-prefix"
          initialValue="Compare @GPT-5.6 Lunar, then ask @GPT-5.6 Luna"
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

    const chips = editor().querySelectorAll(
      '[data-mention-ref-type="content-comment-ai-recipient"]',
    );
    expect(chips).toHaveLength(1);
    const before = document.createRange();
    before.setStart(editor(), 0);
    before.setEndBefore(chips[0]!);
    expect(before.toString()).toBe("Compare @GPT-5.6 Lunar, then ask ");
  });

  it("restores a saved AI draft's chip only where a mention can start", async () => {
    await act(async () =>
      root.render(
        <Owner
          key="restored-leading"
          initialValue="Write to bob@GPT-5.6 Luna today, then ask @GPT-5.6 Luna"
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

    const chips = editor().querySelectorAll(
      '[data-mention-ref-type="content-comment-ai-recipient"]',
    );
    expect(chips).toHaveLength(1);
    const before = document.createRange();
    before.setStart(editor(), 0);
    before.setEndBefore(chips[0]!);
    expect(before.toString()).toBe(
      "Write to bob@GPT-5.6 Luna today, then ask ",
    );
  });

  it("restores a saved AI draft's chip after a person chip with the same name", async () => {
    await act(async () =>
      root.render(
        <Owner
          key="restored-shared-name"
          initialValue="Ask @GPT-5.6 Luna to check this@GPT-5.6 Luna"
          mentions={[{ email: "luna@example.test", name: "GPT-5.6 Luna" }]}
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

    const person = editor().querySelectorAll(
      '[data-mention-ref-type="content-comment-member"]',
    );
    const ai = editor().querySelectorAll(
      '[data-mention-ref-type="content-comment-ai-recipient"]',
    );
    expect(person).toHaveLength(1);
    expect(ai).toHaveLength(1);
    const between = document.createRange();
    between.setStartAfter(person[0]!);
    between.setEndBefore(ai[0]!);
    expect(between.toString()).toBe(" to check this");
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
