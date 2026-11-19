// @vitest-environment happy-dom

import type { TiptapComposerHandle } from "@agent-native/toolkit/composer";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const models = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  useChatModels: () => models.current,
}));

const builderGroup = {
  engine: "builder",
  label: "Builder",
  configured: true,
  models: ["gpt-5-6-luna", "claude-sonnet-5"],
};

// The saved pick names a model that is no longer connected.
function staleSavedPick(configuredModels = [builderGroup]) {
  models.current = {
    availableModels: configuredModels,
    configuredModels,
    defaultModel: "claude-sonnet-5",
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
      <CommentComposer
        ref={(next) => {
          handle = next;
        }}
        value={value}
        onChange={setValue}
        onSubmit={vi.fn()}
        mentions={[]}
        onMentionsChange={vi.fn()}
        onAiSubmit={vi.fn()}
        aiDraft={aiDraft}
        onAiDraftChange={setAiDraft}
        aiModelStorageKey="comment-ai:test"
      />
    );
  }

  async function render(element: ReactElement) {
    await act(async () => root.render(element));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  const notice = () =>
    container.querySelector("[data-comment-ai-model-missing]");
  const editor = () => container.querySelector<HTMLElement>(".ProseMirror")!;

  beforeEach(() => {
    onModelChange.mockClear();
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

  it("names the missing model on a draft that addresses it", async () => {
    await render(
      <Owner initialValue="Ask @Claude Opus 5" initialAi={opusDraft} />,
    );

    expect(notice()).not.toBeNull();
    // The pill can switch to a connected model, so the model menu opens.
    expect(
      container
        .querySelector("[data-comment-composer]")
        ?.hasAttribute("data-model-switchable"),
    ).toBe(true);
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it("can't offer another model when none is connected", async () => {
    staleSavedPick([]);
    await render(
      <Owner initialValue="Ask @Claude Opus 5" initialAi={opusDraft} />,
    );

    expect(notice()).not.toBeNull();
    expect(
      container
        .querySelector("[data-comment-composer]")
        ?.hasAttribute("data-model-switchable"),
    ).toBe(false);
  });

  it("makes a restored draft's connected model the pick", async () => {
    await render(
      <Owner
        initialValue="Ask @GPT-5.6 Luna"
        initialAi={{
          selection: {
            model: "gpt-5-6-luna",
            engine: "builder",
            provider: "Builder",
          },
          mode: "auto",
        }}
      />,
    );

    expect(notice()).toBeNull();
    expect(onModelChange).toHaveBeenCalledWith("gpt-5-6-luna", "builder");
  });

  it("lets @AI find the default model", async () => {
    await render(<Owner />);

    await typeRichEditorText(editor(), "@AI");
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

    expect(editor().textContent).toContain("Claude Sonnet 5");
    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5", "builder");
  });
});
