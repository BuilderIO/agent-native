// @vitest-environment happy-dom

import { requestAgentChatThreadOpen } from "@agent-native/core/client/agent-chat";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommentRow } from "./CommentRow";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: () => "Oct 11, 2026, 9:37 AM" }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  requestAgentChatThreadOpen: vi.fn(),
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      // Like a thread card, whose click focuses its reply box once it renders.
      <div
        onClick={() =>
          setTimeout(() => host.querySelector("textarea")!.focus(), 0)
        }
      >
        <textarea />
        <CommentRow
          avatar={<span />}
          name="Claude Sonnet 4.6"
          identity={{
            kind: "agent",
            model: "claude-sonnet-4-6",
            engine: "anthropic",
            run: {
              effort: "high",
              ranAt: "2026-10-11T13:37:00.000Z",
              threadId: "thread-1",
              canOpen: true,
            },
          }}
        />
      </div>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const authorName = () =>
  host.querySelector<HTMLElement>("[data-comment-author-name]")!;
const card = () => document.querySelector("[data-comment-identity-card]");

const nextTask = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function hoverName() {
  act(() => {
    authorName().dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
    );
    vi.advanceTimersByTime(300);
  });
}

function press(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("comment identity card", () => {
  it("opens from the keyboard with its run link reachable, and Escape returns focus", async () => {
    authorName().focus();
    press(authorName(), "Enter");
    await nextTask();

    const openRun = document.querySelector<HTMLButtonElement>(
      "[data-comment-identity-open-run]",
    );
    expect(openRun).not.toBeNull();
    expect(openRun!.getAttribute("tabindex")).not.toBe("-1");
    expect(card()!.contains(document.activeElement)).toBe(true);

    act(() => openRun!.click());
    expect(requestAgentChatThreadOpen).toHaveBeenCalledWith({
      threadId: "thread-1",
    });

    press(document.activeElement!, "Escape");
    // Radix returns focus to the trigger on the task after it unmounts.
    await nextTask();
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(authorName());
  });

  it("opens on hover without taking focus from the comment being typed", () => {
    vi.useFakeTimers();
    const composer = host.querySelector("textarea")!;
    composer.focus();

    hoverName();

    expect(card()).not.toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("moves focus into a hover-opened card when Enter pins it, and Escape returns it", () => {
    vi.useFakeTimers();
    hoverName();
    // Tabbing onto the name while the pointer holds its card open.
    act(() => authorName().focus());

    press(authorName(), "Enter");
    act(() => vi.runOnlyPendingTimers());
    expect(card()).not.toBeNull();
    expect(card()!.contains(document.activeElement)).toBe(true);

    press(document.activeElement!, "Escape");
    act(() => vi.runOnlyPendingTimers());
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(authorName());
  });
});
