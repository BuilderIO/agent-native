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

  it("keeps a keyboard @ in the textarea while opening the picker", () => {
    const mention = { label: "Alice", email: "alice@example.com" };
    function Harness() {
      const [value, setValue] = useState("");
      const [mentions, setMentions] = useState<(typeof mention)[]>([]);
      return (
        <ReviewCommentComposer
          value={value}
          onChange={setValue}
          onSubmit={() => {}}
          mentions={mentions}
          onMentionsChange={setMentions}
          mentionOptions={[mention]}
        />
      );
    }

    act(() => root.render(<Harness />));
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeTruthy();
    textarea!.setSelectionRange(0, 0);
    const event = new KeyboardEvent("keydown", {
      key: "@",
      bubbles: true,
      cancelable: true,
    });
    act(() => textarea!.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(textarea!.value).toBe("@");
    expect(textarea!.selectionStart).toBe(1);
    expect(container.querySelector("[data-review-comment-tools]")).toBeNull();
    expect(
      container.querySelector('button[aria-label="Add emoji"]'),
    ).toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(textarea!),
        "value",
      )?.set;
      setter?.call(textarea, "@Ali");
      textarea!.setSelectionRange(4, 4);
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="Mention someone"]',
      )?.value,
    ).toBe("Ali");
    expect(textarea!.value).toBe("@Ali");
    const aliceOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Alice"));
    expect(aliceOption).toBeTruthy();
    act(() => aliceOption?.click());
  });

  it("ignores composing @ keys and email address boundaries", () => {
    const mention = { label: "Alice", email: "alice@example.com" };
    const onChange = vi.fn();
    act(() => {
      root.render(
        <ReviewCommentComposer
          value=""
          onChange={onChange}
          onSubmit={() => {}}
          mentionOptions={[mention]}
        />,
      );
    });

    const composingTextarea =
      container.querySelector<HTMLTextAreaElement>("textarea");
    expect(composingTextarea).toBeTruthy();
    const composingEvent = new KeyboardEvent("keydown", {
      key: "@",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composingEvent, "isComposing", { value: true });
    act(() => composingTextarea!.dispatchEvent(composingEvent));
    expect(composingEvent.defaultPrevented).toBe(false);
    expect(composingTextarea!.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    const legacyComposingEvent = new KeyboardEvent("keydown", {
      key: "@",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(legacyComposingEvent, "keyCode", { value: 229 });
    act(() => composingTextarea!.dispatchEvent(legacyComposingEvent));
    expect(legacyComposingEvent.defaultPrevented).toBe(false);
    expect(composingTextarea!.value).toBe("");

    act(() => {
      root.render(
        <ReviewCommentComposer
          value="email"
          onChange={onChange}
          onSubmit={() => {}}
          showCommentTools
          mentionOptions={[mention]}
        />,
      );
    });
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeTruthy();
    textarea!.setSelectionRange(5, 5);
    const emailEvent = new KeyboardEvent("keydown", {
      key: "@",
      bubbles: true,
      cancelable: true,
    });
    act(() => textarea!.dispatchEvent(emailEvent));
    expect(emailEvent.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <ReviewCommentComposer
          value={"cafe\u0301"}
          onChange={onChange}
          onSubmit={() => {}}
          showCommentTools
          mentionOptions={[mention]}
        />,
      );
    });
    const combiningMarkTextarea =
      container.querySelector<HTMLTextAreaElement>("textarea");
    combiningMarkTextarea!.setSelectionRange(5, 5);
    const combiningMarkEvent = new KeyboardEvent("keydown", {
      key: "@",
      bubbles: true,
      cancelable: true,
    });
    act(() => combiningMarkTextarea!.dispatchEvent(combiningMarkEvent));
    expect(combiningMarkEvent.defaultPrevented).toBe(false);

    act(() => {
      root.render(
        <ReviewCommentComposer
          value="𝒜"
          onChange={onChange}
          onSubmit={() => {}}
          showCommentTools
          mentionOptions={[mention]}
        />,
      );
    });
    const astralLetterTextarea =
      container.querySelector<HTMLTextAreaElement>("textarea");
    astralLetterTextarea!.setSelectionRange(2, 2);
    const astralLetterEvent = new KeyboardEvent("keydown", {
      key: "@",
      bubbles: true,
      cancelable: true,
    });
    act(() => astralLetterTextarea!.dispatchEvent(astralLetterEvent));
    expect(astralLetterEvent.defaultPrevented).toBe(false);

    act(() => {
      root.render(
        <ReviewCommentComposer
          value="Hi,"
          onChange={onChange}
          onSubmit={() => {}}
          showCommentTools
          mentionOptions={[mention]}
        />,
      );
    });
    const punctuationTextarea =
      container.querySelector<HTMLTextAreaElement>("textarea");
    punctuationTextarea!.setSelectionRange(3, 3);
    const punctuationEvent = new KeyboardEvent("keydown", {
      key: "@",
      bubbles: true,
      cancelable: true,
    });
    act(() => punctuationTextarea!.dispatchEvent(punctuationEvent));
    expect(punctuationEvent.defaultPrevented).toBe(true);
    act(() =>
      document.querySelector<HTMLElement>('[role="menuitem"]')?.click(),
    );

    act(() => {
      root.render(
        <ReviewCommentComposer
          value="alice+"
          onChange={onChange}
          onSubmit={() => {}}
          showCommentTools
          mentionOptions={[mention]}
        />,
      );
    });
    const emailLocalPartTextarea =
      container.querySelector<HTMLTextAreaElement>("textarea");
    emailLocalPartTextarea!.setSelectionRange(6, 6);
    const emailLocalPartEvent = new KeyboardEvent("keydown", {
      key: "@",
      bubbles: true,
      cancelable: true,
    });
    act(() => emailLocalPartTextarea!.dispatchEvent(emailLocalPartEvent));
    expect(emailLocalPartEvent.defaultPrevented).toBe(false);
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
