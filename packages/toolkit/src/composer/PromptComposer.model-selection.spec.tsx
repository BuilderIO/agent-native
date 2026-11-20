// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptComposer, type PromptComposerProps } from "./PromptComposer.js";
import type { TiptapComposerHandle } from "./TiptapComposer.js";

let container: HTMLDivElement;
let root: Root;
let composerRef: React.RefObject<TiptapComposerHandle | null>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  composerRef = React.createRef<TiptapComposerHandle>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type ModelSelectionProps = Partial<PromptComposerProps> & {
  modelSelectionState?: "pending" | "failed" | "ready";
};

function element(props: ModelSelectionProps) {
  return (
    <PromptComposer
      composerRef={composerRef}
      onSubmit={vi.fn()}
      initialText="Quarterly revenue by region"
      initialTextKey="stable"
      draftScope="model-selection-test"
      showModelSelector
      availableModels={[]}
      modelStatusChecksEnabled={false}
      includeDefaultMentionSearch={false}
      includeDefaultSlashSkills={false}
      voiceEnabled={false}
      {...(props as Partial<PromptComposerProps>)}
    />
  );
}

async function render(props: ModelSelectionProps) {
  await act(async () => root.render(element(props)));
}

function text() {
  return container.querySelector(".ProseMirror")?.textContent;
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected composer element is missing");
  return value;
}

function press(key: string, init: KeyboardEventInit = {}) {
  required(container.querySelector(".ProseMirror")).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
  );
}

function sendButton() {
  return required(
    container.querySelector<HTMLElement>(
      '[data-agent-composer-slot="send-button"]',
    ),
  );
}

describe("Enter while the model catalog is still loading", () => {
  it("acknowledges Enter at once, keeps the draft, and sends exactly once when the model resolves", async () => {
    const onSubmit = vi.fn();
    await render({ onSubmit, modelSelectionState: "pending" });

    await act(async () => press("Enter"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(sendButton().getAttribute("aria-busy")).toBe("true");
    expect(text()).toBe("Quarterly revenue by region");

    await render({
      onSubmit,
      modelSelectionState: "ready",
      selectedModel: "resolved-model",
      selectedEngine: "resolved-engine",
    });

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[0]).toBe("Quarterly revenue by region");
    expect(onSubmit.mock.calls[0]?.[3]).toMatchObject({
      model: "resolved-model",
      engine: "resolved-engine",
    });
    expect(sendButton().getAttribute("aria-busy")).not.toBe("true");

    await render({
      onSubmit,
      modelSelectionState: "ready",
      selectedModel: "resolved-model",
      selectedEngine: "resolved-engine",
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does not resend on a repeated Enter or a click while the Enter is held", async () => {
    const onSubmit = vi.fn();
    await render({ onSubmit, modelSelectionState: "pending" });

    await act(async () => press("Enter"));
    await act(async () => press("Enter"));
    await act(async () => sendButton().click());
    expect(onSubmit).not.toHaveBeenCalled();

    await render({ onSubmit, modelSelectionState: "ready" });

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does not hold for Shift+Enter or an empty draft", async () => {
    const onSubmit = vi.fn();
    await render({
      onSubmit,
      initialText: "",
      initialTextKey: "empty",
      modelSelectionState: "pending",
    });

    await act(async () => press("Enter"));
    await act(async () => press("Enter", { shiftKey: true }));
    expect(sendButton().getAttribute("aria-busy")).not.toBe("true");

    await render({
      onSubmit,
      initialText: "",
      initialTextKey: "empty",
      modelSelectionState: "ready",
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the draft and sends nothing when the catalog fails", async () => {
    const onSubmit = vi.fn();
    await render({ onSubmit, modelSelectionState: "pending" });
    await act(async () => press("Enter"));
    expect(sendButton().getAttribute("aria-busy")).toBe("true");

    await render({ onSubmit, modelSelectionState: "failed" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(text()).toBe("Quarterly revenue by region");
    expect(sendButton().getAttribute("aria-busy")).not.toBe("true");

    await render({ onSubmit, modelSelectionState: "ready" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("drops the held Enter when the draft is edited before the model resolves", async () => {
    const onSubmit = vi.fn();
    await render({ onSubmit, modelSelectionState: "pending" });
    await act(async () => press("Enter"));

    await act(async () =>
      required(composerRef.current).setText("Something else"),
    );
    await render({ onSubmit, modelSelectionState: "ready" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(text()).toBe("Something else");
  });

  it("drops the held Enter when the composer stops being the active one", async () => {
    const onSubmit = vi.fn();
    await render({ onSubmit, modelSelectionState: "pending" });
    await act(async () => press("Enter"));

    await render({
      onSubmit,
      modelSelectionState: "pending",
      isReferenceTarget: false,
    });
    await render({
      onSubmit,
      modelSelectionState: "ready",
      isReferenceTarget: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(text()).toBe("Quarterly revenue by region");
  });

  it("drops the held Enter when the draft scope changes", async () => {
    const onSubmit = vi.fn();
    await render({ onSubmit, modelSelectionState: "pending" });
    await act(async () => press("Enter"));

    await render({
      onSubmit,
      draftScope: "another-thread",
      modelSelectionState: "ready",
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
