// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommentComposer, type MentionEntry } from "./comment-composer";

const members = [
  { email: "mcastillo@example.com", name: "Michael Castillo" },
  { email: "mwang@example.com", name: "Michael Wang" },
  { email: "mjohnson@example.com", name: "Michael Johnson" },
];

describe("CommentComposer mention autocomplete", () => {
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

  function renderComposer(
    currentMembers: typeof members,
    onMentionAdd = vi.fn<(entry: MentionEntry) => void>(),
    onSubmit = vi.fn(),
    onEscape = vi.fn(),
  ) {
    let updateMembers!: (nextMembers: typeof members) => void;

    function Harness() {
      const [value, setValue] = useState("");
      const [availableMembers, setAvailableMembers] = useState(currentMembers);
      updateMembers = setAvailableMembers;
      return (
        <CommentComposer
          value={value}
          onChange={setValue}
          onSubmit={onSubmit}
          onEscape={onEscape}
          onMentionAdd={onMentionAdd}
          members={availableMembers}
        />
      );
    }

    act(() => root.render(<Harness />));
    return {
      textarea: container.querySelector("textarea")!,
      setMembers: (nextMembers: typeof members) =>
        act(() => updateMembers(nextMembers)),
    };
  }

  function typeInto(textarea: HTMLTextAreaElement, value: string) {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setValue?.call(textarea, value);
    textarea.setSelectionRange(value.length, value.length);
    textarea.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: value }),
    );
  }

  function press(
    textarea: HTMLTextAreaElement,
    type: "keydown" | "keyup",
    key: string,
  ) {
    textarea.dispatchEvent(
      new KeyboardEvent(type, { key, bubbles: true, cancelable: true }),
    );
  }

  it.each([2, 3])(
    "keeps the next option selected after ArrowDown keyup with %i matches",
    async (matchCount) => {
      const onMentionAdd = vi.fn<(entry: MentionEntry) => void>();
      const matchingMembers = members.slice(0, matchCount);
      const { textarea } = renderComposer(matchingMembers, onMentionAdd);

      act(() => typeInto(textarea, "@m"));
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(
        matchCount,
      );

      await act(async () => {
        press(textarea, "keydown", "ArrowDown");
        await Promise.resolve();
      });
      await act(async () => {
        press(textarea, "keyup", "ArrowDown");
        await Promise.resolve();
      });

      const options =
        container.querySelectorAll<HTMLElement>('[role="option"]');
      expect(options[0]?.getAttribute("aria-selected")).toBe("false");
      expect(options[1]?.getAttribute("aria-selected")).toBe("true");

      if (matchCount === 3) {
        await act(async () => {
          press(textarea, "keydown", "ArrowDown");
          await Promise.resolve();
        });
        await act(async () => {
          press(textarea, "keyup", "ArrowDown");
          await Promise.resolve();
        });
        expect(options[2]?.getAttribute("aria-selected")).toBe("true");

        await act(async () => {
          press(textarea, "keydown", "Enter");
          await Promise.resolve();
        });
        expect(onMentionAdd).toHaveBeenCalledWith({
          email: matchingMembers[2]?.email,
          name: matchingMembers[2]?.name,
        });
      } else {
        await act(async () => {
          press(textarea, "keydown", "Enter");
          await Promise.resolve();
        });
        expect(onMentionAdd).toHaveBeenCalledWith({
          email: matchingMembers[1]?.email,
          name: matchingMembers[1]?.name,
        });
      }
    },
  );

  it("clamps the selected option when matching members shrink", async () => {
    const onMentionAdd = vi.fn<(entry: MentionEntry) => void>();
    const { textarea, setMembers } = renderComposer(members, onMentionAdd);

    act(() => typeInto(textarea, "@m"));
    await act(async () => {
      press(textarea, "keydown", "ArrowDown");
      press(textarea, "keydown", "ArrowDown");
      await Promise.resolve();
    });

    expect(
      container
        .querySelectorAll<HTMLElement>('[role="option"]')[2]
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    setMembers(members.slice(0, 2));

    const options = container.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      press(textarea, "keydown", "Enter");
      await Promise.resolve();
    });
    expect(onMentionAdd).toHaveBeenCalledWith({
      email: members[1]?.email,
      name: members[1]?.name,
    });
  });

  it("sends on Enter and Cmd/Ctrl+Enter, but not on Shift+Enter or while composing", () => {
    const onSubmit = vi.fn();
    const onMentionAdd = vi.fn<(entry: MentionEntry) => void>();
    const { textarea } = renderComposer(members, onMentionAdd, onSubmit);
    const keydown = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...init,
      });
      act(() => {
        textarea.dispatchEvent(event);
      });
      return event;
    };

    act(() => typeInto(textarea, "@m"));
    keydown({ isComposing: true });
    expect(onMentionAdd).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => typeInto(textarea, "Looks good"));
    expect(keydown({ shiftKey: true }).defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    expect(keydown({}).defaultPrevented).toBe(true);
    keydown({ metaKey: true });
    keydown({ ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(3);
  });

  it("leaves Escape to an input method that is composing", () => {
    const onEscape = vi.fn();
    const { textarea } = renderComposer(
      members,
      undefined,
      undefined,
      onEscape,
    );
    const escape = (init: KeyboardEventInit) =>
      act(() => {
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        );
      });

    act(() => typeInto(textarea, "にほん"));
    escape({ isComposing: true });
    expect(onEscape).not.toHaveBeenCalled();

    escape({});
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
