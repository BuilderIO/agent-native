// @vitest-environment happy-dom

import { act } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCommentComposer } from "./ReviewCommentComposer.js";

describe("ReviewCommentComposer actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("can expose only a dedicated agent action", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <ReviewCommentComposer
          value="Make the heading concise"
          onChange={() => {}}
          onSubmit={onSubmit}
          showCommentAction={false}
          showAgentAction
          agentLabel="Edit with AI"
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.some((button) => button.textContent?.trim() === "Comment"),
    ).toBe(false);
    const editWithAi = buttons.find(
      (button) => button.textContent?.trim() === "Edit with AI",
    );
    expect(editWithAi).toBeTruthy();

    act(() => editWithAi?.click());
    expect(onSubmit).toHaveBeenCalledWith("agent");
  });

  it("keeps trailing comment tools beside mention controls", () => {
    act(() => {
      root.render(
        <ReviewCommentComposer
          value="A useful reply"
          onChange={() => {}}
          onSubmit={() => {}}
          showCommentTools
          mentionOptions={[{ label: "Alice", email: "alice@example.com" }]}
          commentToolsEnd={<span data-review-tools-end />}
        />,
      );
    });

    const tools = container.querySelector<HTMLElement>(
      "[data-review-comment-tools]",
    );
    const trailingTools = container.querySelector<HTMLElement>(
      "[data-review-comment-tools-end]",
    );
    expect(trailingTools?.parentElement).toBe(tools);
    expect(tools?.querySelector('[aria-label="Add emoji"]')).not.toBeNull();
    expect(
      tools?.querySelector('[aria-label="Mention someone"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[type="submit"]')?.parentElement,
    ).not.toBe(tools);
  });

  it("routes implicit submission to the visible agent action", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <ReviewCommentComposer
          value="Make the heading concise"
          onChange={() => {}}
          onSubmit={onSubmit}
          showCommentAction={false}
          showAgentAction
          submitOnEnter
        />,
      );
    });

    const textarea = container.querySelector("textarea");
    const form = container.querySelector("form");
    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenNthCalledWith(1, "agent");
    expect(onSubmit).toHaveBeenNthCalledWith(2, "agent");
  });

  it("replaces the full typed mention token", () => {
    let submittedMentions: unknown;
    const mention = { label: "Alice", email: "alice@example.com" };
    const otherMention = { label: "Bob", email: "bob@example.com" };
    function Harness() {
      const [value, setValue] = useState("");
      const [mentions, setMentions] = useState([mention]);
      return (
        <ReviewCommentComposer
          value={value}
          onChange={setValue}
          onSubmit={() => {
            submittedMentions = mentions;
          }}
          mentions={mentions}
          onMentionsChange={setMentions}
          mentionOptions={[mention, otherMention]}
          showCommentTools
        />
      );
    }

    act(() => root.render(<Harness />));
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeTruthy();
    act(() => {
      textarea!.setSelectionRange(0, 0);
      textarea!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "@", bubbles: true }),
      );
    });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(textarea!),
        "value",
      )?.set;
      setter?.call(textarea, "@ali");
      textarea!.setSelectionRange(4, 4);
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
      textarea!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const alice = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Alice"));
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).some((item) => item.textContent?.includes("Bob")),
    ).toBe(false);
    expect(alice).toBeTruthy();
    act(() => alice?.click());

    expect(textarea!.value).toBe("@Alice");
    const submit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Comment"),
    );
    act(() => submit?.click());
    expect(submittedMentions).toEqual([mention]);
  });

  it("drops a replaced mention from submitted metadata", () => {
    let submittedMentions: unknown;
    const alice = { label: "Alice", email: "alice@example.com" };
    const bob = { label: "Bob", email: "bob@example.com" };
    function Harness() {
      const [value, setValue] = useState("@Alice");
      const [mentions, setMentions] = useState([alice]);
      return (
        <ReviewCommentComposer
          value={value}
          onChange={setValue}
          onSubmit={() => {
            submittedMentions = mentions;
          }}
          mentions={mentions}
          onMentionsChange={setMentions}
          mentionOptions={[alice, bob]}
          showCommentTools
        />
      );
    }

    act(() => root.render(<Harness />));
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeTruthy();
    act(() => {
      textarea!.setSelectionRange(0, 6);
      textarea!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "@", bubbles: true }),
      );
    });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(textarea!),
        "value",
      )?.set;
      setter?.call(textarea, "@bo");
      textarea!.setSelectionRange(3, 3);
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
      textarea!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const bobOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Bob"));
    expect(bobOption).toBeTruthy();
    act(() => bobOption?.click());

    const submit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Comment"),
    );
    act(() => submit?.click());
    expect(submittedMentions).toEqual([bob]);
  });
});
