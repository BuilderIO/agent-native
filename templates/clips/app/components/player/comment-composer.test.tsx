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
  ) {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <CommentComposer
          value={value}
          onChange={setValue}
          onSubmit={vi.fn()}
          onMentionAdd={onMentionAdd}
          members={currentMembers}
        />
      );
    }

    act(() => root.render(<Harness />));
    return container.querySelector("textarea")!;
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
      const textarea = renderComposer(matchingMembers, onMentionAdd);

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
});
