// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MentionPopover } from "./MentionPopover.js";
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
  document.body
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((element) => element.remove());
  vi.unstubAllGlobals();
});

async function render(props: Partial<PromptComposerProps> = {}) {
  await act(async () => {
    root.render(
      <PromptComposer
        composerRef={composerRef}
        onSubmit={vi.fn()}
        draftScope="placeholder-recall-test"
        showModelSelector={false}
        modelStatusChecksEnabled={false}
        includeDefaultMentionSearch={false}
        includeDefaultSlashSkills={false}
        voiceEnabled={false}
        {...props}
      />,
    );
  });
}

const editor = () => container.querySelector<HTMLElement>(".ProseMirror")!;

function keydown(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  editor().dispatchEvent(event);
  return event;
}

describe("composer placeholder", () => {
  it("invites any question in a new chat", async () => {
    await render();
    expect(editor().getAttribute("aria-label")).toBe("Ask anything");
  });

  it("reads as a reply once the conversation has started", async () => {
    await render({ conversationStarted: true, placeholder: "Ask the agent" });
    expect(editor().getAttribute("aria-label")).toBe("Reply…");
  });

  it("uses the host's reply copy and keeps a lone placeholder unchanged", async () => {
    await render({ conversationStarted: true, replyPlaceholder: "Follow up…" });
    expect(editor().getAttribute("aria-label")).toBe("Follow up…");

    await render({ placeholder: "Queue a follow-up…" });
    expect(editor().getAttribute("aria-label")).toBe("Queue a follow-up…");
  });
});

describe("ArrowUp recall", () => {
  it("edits the last message from an empty composer", async () => {
    const onRecallLastMessage = vi.fn(() => true);
    await render({ onRecallLastMessage });

    const event = keydown({ key: "ArrowUp" });
    expect(onRecallLastMessage).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the key alone when the host has nothing to recall", async () => {
    const onRecallLastMessage = vi.fn(() => false);
    await render({ onRecallLastMessage });

    const event = keydown({ key: "ArrowUp" });
    expect(onRecallLastMessage).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it("never captures ArrowUp inside a draft or with a modifier", async () => {
    const onRecallLastMessage = vi.fn(() => true);
    await render({ onRecallLastMessage, initialText: "Draft" });

    await act(async () => {
      composerRef.current!.focus?.();
    });
    expect(keydown({ key: "ArrowUp" }).defaultPrevented).toBe(false);

    await act(async () => composerRef.current!.setText(""));
    expect(keydown({ key: "ArrowUp", shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(keydown({ key: "ArrowUp", metaKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(onRecallLastMessage).not.toHaveBeenCalled();
  });
});

describe("mode picker", () => {
  it("is gone, and Shift+Tab is left to the browser", async () => {
    await render({ planCommand: true });

    expect(
      container.querySelector('[data-agent-composer-slot="mode-button"]'),
    ).toBeNull();
    expect(keydown({ key: "Tab", shiftKey: true }).defaultPrevented).toBe(
      false,
    );
  });
});

describe("slash menu empty state", () => {
  const renderPopover = (query: string) =>
    act(() => {
      root.render(
        <MentionPopover
          type="/"
          position={{ top: 400, left: 0, width: 320 }}
          mentionItems={[]}
          skills={[]}
          commands={[]}
          isLoading={false}
          query={query}
          onSelectMention={() => undefined}
          onSelectSkill={() => undefined}
          onClose={() => undefined}
        />,
      );
    });

  it("says there are no commands, or no matches for a query", () => {
    renderPopover("");
    const popover = () =>
      document.querySelector("[data-agent-native-mention-popover]");
    expect(popover()?.textContent).toBe("No commands");
    renderPopover("deploy");
    expect(popover()?.textContent).toBe("No matches");
  });
});
