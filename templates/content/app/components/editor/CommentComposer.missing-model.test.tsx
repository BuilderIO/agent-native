// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { TiptapComposerHandle } from "@agent-native/toolkit/composer";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messagesByLocale } from "@/i18n-data";

import { typeRichEditorText } from "./comment-composer-test-utils";
import { CommentComposer, type CommentAiDraft } from "./CommentComposer";

vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock("./comment-images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./comment-images")>()),
  useCommentImageStorage: () => true,
}));

const onModelChange = vi.fn();
const onAiSubmit = vi.fn();
const models = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = {
    current: {} as Record<string, unknown>,
    set: (next: Record<string, unknown>) => {
      store.current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return store;
});
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await importOriginal<
      typeof import("@agent-native/core/client/agent-chat")
    >()),
    useChatModels: () =>
      useSyncExternalStore(models.subscribe, () => models.current),
  };
});

const builderGroup = {
  engine: "builder",
  label: "Builder",
  configured: true,
  models: ["gpt-5-6-luna", "claude-sonnet-5"],
};
const claudeGroup = {
  engine: "anthropic",
  label: "Claude",
  configured: true,
  models: ["claude-sonnet-5"],
};

function staleSavedPick(
  configuredModels: (typeof builderGroup)[] = [builderGroup],
  defaultSelection: { model: string; engine: string } | null = {
    model: "claude-sonnet-5",
    engine: "builder",
  },
) {
  models.current = {
    availableModels: configuredModels,
    configuredModels,
    defaultModel: "claude-sonnet-5",
    defaultSelection,
    selectedModel: "",
    selectedEngine: "",
    selectedEffort: "high",
    isLoading: false,
    selectionReady: false,
    unavailableSelection: { model: "claude-opus-5", engine: "anthropic" },
    onModelChange,
    onEffortChange: vi.fn(),
    refreshEngines: vi.fn(),
  };
}

function savedPickReady(
  configuredModels: (typeof builderGroup)[] = [builderGroup],
) {
  staleSavedPick(configuredModels);
  models.current = {
    ...models.current,
    selectedModel: "claude-sonnet-5",
    selectedEngine: "builder",
    selectionReady: true,
    unavailableSelection: null,
  };
}

const opusDraft: CommentAiDraft = {
  selection: {
    model: "claude-opus-5",
    engine: "anthropic",
    provider: "Claude",
  },
  mode: "auto",
};

describe("CommentComposer with a saved AI model that is no longer connected", () => {
  let container: HTMLDivElement;
  let root: Root;
  let handle: TiptapComposerHandle | null = null;

  function Owner({
    initialAi = null,
    initialValue = "",
  }: {
    initialAi?: CommentAiDraft | null;
    initialValue?: string;
  }) {
    const [value, setValue] = useState(initialValue);
    const [aiDraft, setAiDraft] = useState<CommentAiDraft | null>(initialAi);
    return (
      <AgentNativeI18nProvider
        initialLocale="en-US"
        persistPreference={false}
        catalog={{ sourceLocale: "en-US", messages: messagesByLocale["en-US"] }}
      >
        <CommentComposer
          ref={(next) => {
            handle = next;
          }}
          value={value}
          onChange={setValue}
          onSubmit={vi.fn()}
          mentions={[]}
          onMentionsChange={vi.fn()}
          onAiSubmit={onAiSubmit}
          aiDraft={aiDraft}
          onAiDraftChange={setAiDraft}
          aiModelStorageKey="comment-ai:test"
        />
      </AgentNativeI18nProvider>
    );
  }

  const settle = () =>
    act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  async function render(element: ReactElement) {
    await act(async () => root.render(element));
    await settle();
  }

  const notice = () =>
    container.querySelector("[data-comment-ai-model-missing]");
  const editor = () => {
    const element = container.querySelector<HTMLElement>(".ProseMirror");
    if (!element) throw new Error("The comment editor didn't render.");
    return element;
  };
  const aiSendSelector = "[data-comment-ai-send-control] [data-comment-send]";
  const aiSends = () => [
    ...container.querySelectorAll<HTMLButtonElement>(aiSendSelector),
  ];
  const aiSend = () => {
    const send = container.querySelector<HTMLButtonElement>(aiSendSelector);
    if (!send) throw new Error("The AI send control didn't render.");
    return send;
  };
  const modelOptions = () =>
    [...document.querySelectorAll('[role="listbox"] [role="option"]')].map(
      (option) => option.textContent,
    );

  async function clickAiPill() {
    const pill = container.querySelector<HTMLElement>(
      '[data-mention-ref-type="content-comment-ai-recipient"]',
    );
    expect(pill).not.toBeNull();
    await act(async () => {
      pill?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await settle();
  }

  async function pickAiAlias() {
    await typeRichEditorText(editor(), "@AI");
    await act(async () => {
      editor().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await settle();
  }

  beforeEach(() => {
    onModelChange.mockReset();
    onAiSubmit.mockReset();
    staleSavedPick();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    handle = null;
    vi.restoreAllMocks();
  });

  it("says nothing on a reply that doesn't address AI", async () => {
    await render(<Owner initialValue="Thanks, looks good" />);

    expect(handle).not.toBeNull();
    expect(notice()).toBeNull();
    expect(
      container.querySelector('[data-comment-composer] [role="status"]'),
    ).toBeNull();
    const send = container.querySelector<HTMLButtonElement>(
      "[data-comment-send]",
    );
    expect(send?.disabled).toBe(false);
  });

  it("names the missing model and lets its name open the one other model", async () => {
    staleSavedPick([{ ...builderGroup, models: ["claude-sonnet-5"] }]);
    await render(
      <Owner initialValue="Ask @Claude Opus 5" initialAi={opusDraft} />,
    );

    expect(notice()?.textContent).toBe(
      "Claude Opus 5 isn’t connected. Click its name to choose another model.",
    );
    expect(aiSend().disabled).toBe(true);
    await clickAiPill();
    expect(modelOptions()).toEqual([
      expect.stringContaining("Claude Sonnet 5"),
    ]);
    expect(onModelChange).not.toHaveBeenCalled();

    const option = document.querySelector<HTMLElement>(
      '[role="listbox"] [role="option"]',
    );
    await act(async () => option?.click());
    await settle();

    expect(notice()).toBeNull();
    expect(editor().textContent).toContain("Claude Sonnet 5");
    expect(aiSend().disabled).toBe(false);
  });

  it("only names the missing model when nothing else is connected", async () => {
    staleSavedPick([], null);
    await render(
      <Owner initialValue="Ask @Claude Opus 5" initialAi={opusDraft} />,
    );

    expect(notice()?.textContent).toBe("Claude Opus 5 isn’t connected.");
    await clickAiPill();
    expect(modelOptions()).toEqual([]);
  });

  const lunaDraft: CommentAiDraft = {
    selection: {
      model: "gpt-5-6-luna",
      engine: "builder",
      provider: "Builder",
    },
    mode: "auto",
  };

  it("sends a restored draft to its connected model and saves it then", async () => {
    await render(
      <Owner initialValue="Ask @GPT-5.6 Luna" initialAi={lunaDraft} />,
    );

    expect(notice()).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(aiSend().disabled).toBe(false);

    await act(async () => aiSend().click());

    expect(onModelChange).toHaveBeenCalledTimes(1);
    expect(onModelChange).toHaveBeenCalledWith("gpt-5-6-luna", "builder");
    expect(onAiSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5-6-luna", engine: "builder" }),
    );
  });

  it("leaves the saved pick alone while restored drafts name different models", async () => {
    await render(
      <>
        <Owner initialValue="Ask @GPT-5.6 Luna" initialAi={lunaDraft} />
        <Owner
          initialValue="Ask @Claude Sonnet 5"
          initialAi={{
            selection: {
              model: "claude-sonnet-5",
              engine: "builder",
              provider: "Builder",
            },
            mode: "auto",
          }}
        />
      </>,
    );

    expect(onModelChange).not.toHaveBeenCalled();
    expect(aiSends().map((send) => send.disabled)).toEqual([false, false]);

    await act(async () => aiSends()[1]?.click());

    expect(onModelChange).toHaveBeenCalledTimes(1);
    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5", "builder");
  });

  it("finds a restored draft's model from the second provider that lists it", async () => {
    staleSavedPick([builderGroup, claudeGroup]);
    await render(
      <Owner
        initialValue="Ask @Claude Sonnet 5"
        initialAi={{
          selection: {
            model: "claude-sonnet-5",
            engine: "anthropic",
            provider: "Claude",
          },
          mode: "auto",
        }}
      />,
    );

    expect(notice()).toBeNull();
    expect(aiSend().disabled).toBe(false);
  });

  it("names a draft's model that isn't connected while the saved pick is", async () => {
    savedPickReady();
    await render(
      <Owner initialValue="Ask @Claude Opus 5" initialAi={opusDraft} />,
    );

    expect(notice()?.textContent).toBe(
      "Claude Opus 5 isn’t connected. Click its name to choose another model.",
    );
    expect(aiSend().disabled).toBe(true);
  });

  it("saves a sent draft's model when the saved pick is another", async () => {
    savedPickReady();
    await render(
      <Owner initialValue="Ask @GPT-5.6 Luna" initialAi={lunaDraft} />,
    );

    expect(notice()).toBeNull();
    await act(async () => aiSend().click());

    expect(onModelChange).toHaveBeenCalledTimes(1);
    expect(onModelChange).toHaveBeenCalledWith("gpt-5-6-luna", "builder");
  });

  it("sends to the saved pick without saving it again", async () => {
    savedPickReady();
    await render(
      <Owner
        initialValue="Ask @Claude Sonnet 5"
        initialAi={{
          selection: {
            model: "claude-sonnet-5",
            engine: "builder",
            provider: "Builder",
          },
          mode: "auto",
        }}
      />,
    );

    await act(async () => aiSend().click());

    expect(onModelChange).not.toHaveBeenCalled();
    expect(onAiSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5", effort: "high" }),
    );
  });

  it("says nothing and can send when the model list didn't load", async () => {
    savedPickReady([]);
    await render(
      <Owner initialValue="Ask @Claude Opus 5" initialAi={opusDraft} />,
    );

    expect(notice()).toBeNull();
    expect(aiSend().disabled).toBe(false);
  });

  it("keeps AI Send off while the model list reloads", async () => {
    await render(
      <Owner initialValue="Ask @GPT-5.6 Luna" initialAi={lunaDraft} />,
    );
    expect(aiSend().disabled).toBe(false);

    act(() => models.set({ ...models.current, isLoading: true }));

    expect(aiSend().disabled).toBe(true);
    await act(async () => aiSend().click());
    expect(onAiSubmit).not.toHaveBeenCalled();
  });

  it("names a restored draft's model once its provider is disconnected", async () => {
    staleSavedPick([builderGroup, claudeGroup]);
    await render(
      <Owner
        initialValue="Ask @Claude Sonnet 5"
        initialAi={{
          selection: {
            model: "claude-sonnet-5",
            engine: "anthropic",
            provider: "Claude",
          },
          mode: "auto",
        }}
      />,
    );
    expect(aiSend().disabled).toBe(false);

    act(() =>
      models.set({
        ...models.current,
        availableModels: [builderGroup],
        configuredModels: [builderGroup],
        selectedModel: "gpt-5-6-luna",
        selectedEngine: "builder",
        selectionReady: true,
        unavailableSelection: null,
      }),
    );

    expect(notice()?.textContent).toBe(
      "Claude Sonnet 5 isn’t connected. Click its name to choose another model.",
    );
    expect(aiSend().disabled).toBe(true);
  });

  it("sends a draft naming an older model version to its newer one", async () => {
    savedPickReady();
    await render(
      <Owner
        initialValue="Ask @GPT-5.5 Luna"
        initialAi={{
          selection: {
            model: "gpt-5-5-luna",
            engine: "builder",
            provider: "Builder",
          },
          mode: "auto",
        }}
      />,
    );

    expect(notice()).toBeNull();
    await act(async () => aiSend().click());

    expect(onModelChange).toHaveBeenCalledWith("gpt-5-6-luna", "builder");
    expect(onAiSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5-6-luna", engine: "builder" }),
    );
  });

  it("sends with automatic effort when the new model can't use the saved one", async () => {
    models.current = { ...models.current, selectedEffort: "max" };
    await render(
      <Owner initialValue="Ask @GPT-5.6 Luna" initialAi={lunaDraft} />,
    );

    await act(async () => aiSend().click());

    expect(onAiSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5-6-luna", effort: "auto" }),
    );
  });

  it("lets @AI find the default model", async () => {
    await render(<Owner />);

    await pickAiAlias();

    expect(editor().textContent).toContain("Claude Sonnet 5");
    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5", "builder");
  });

  it("doesn't offer an older model version's newer one as another model", async () => {
    staleSavedPick([{ ...builderGroup, models: ["gpt-5-6-luna"] }]);
    await render(
      <Owner
        initialValue="Ask @GPT-5.5 Luna"
        initialAi={{
          selection: {
            model: "gpt-5-5-luna",
            engine: "builder",
            provider: "Builder",
          },
          mode: "auto",
        }}
      />,
    );

    expect(notice()).toBeNull();
    expect(container.querySelector("[data-model-switchable]")).toBeNull();
  });

  it("lets @AI keep the default's provider while a draft names the other", async () => {
    staleSavedPick([builderGroup, claudeGroup]);
    await render(
      <Owner
        initialValue="Ask @Claude Sonnet 5"
        initialAi={{
          selection: {
            model: "claude-sonnet-5",
            engine: "anthropic",
            provider: "Claude",
          },
          mode: "auto",
        }}
      />,
    );

    await pickAiAlias();

    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5", "builder");
  });

  it("lets @AI keep the default's provider when two list the model", async () => {
    staleSavedPick([builderGroup, claudeGroup], {
      model: "claude-sonnet-5",
      engine: "anthropic",
    });
    await render(<Owner />);

    await pickAiAlias();

    expect(editor().textContent).toContain("Claude Sonnet 5");
    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5", "anthropic");
  });
});
