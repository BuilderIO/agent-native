// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommentComposer } from "./CommentComposer";

describe("comment mention full keyboard sequences", () => {
  let container: HTMLDivElement;
  let root: Root;
  const submit = vi.fn();
  const escape = vi.fn();
  const mention = vi.fn();
  function Owner() {
    const [value, setValue] = useState("");
    return (
      <CommentComposer
        value={value}
        onChange={setValue}
        onSubmit={submit}
        onEscape={escape}
        onMentionAdd={mention}
        members={[
          { name: "Alpha", email: "alpha@example.test" },
          { name: "Beta", email: "beta@example.test" },
          { name: "Gamma", email: "gamma@example.test" },
        ]}
      />
    );
  }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    submit.mockReset();
    escape.mockReset();
    mention.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Owner />));
    input().focus();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const input = () => container.querySelector("textarea")!;
  const buttons = () => [...container.querySelectorAll("button")];
  const active = () =>
    buttons().find((button) =>
      button.className.split(/\s+/).includes("bg-accent"),
    )?.textContent;
  const key = async (type: "keydown" | "keyup", name: string) =>
    act(async () => {
      input().dispatchEvent(
        new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }),
      );
    });
  const press = async (name: string) => {
    await key("keydown", name);
    await key("keyup", name);
  };
  const text = async (value: string) => {
    await act(async () => {
      const node = input();
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(node, value);
      node.setSelectionRange(value.length, value.length);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await key("keyup", value.slice(-1));
  };
  const settle = async () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

  it("keeps a mention picker dismissed after Escape keyup and routes the next Escape outward", async () => {
    await text("Reply @");
    expect(buttons()).toHaveLength(3);
    await press("Escape");
    await settle();
    expect(buttons()).toHaveLength(0);
    expect(input().value).toBe("Reply @");
    expect(escape).not.toHaveBeenCalled();
    await press("Escape");
    expect(escape).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["ArrowDown", "Beta"],
    ["ArrowUp", "Gamma"],
  ] as const)(
    "keeps %s menu selection through keyup",
    async (arrow, expected) => {
      await text("Reply @");
      await press(arrow);
      expect(active()).toContain(expected);
    },
  );
  it.each([
    ["Enter", false],
    ["Enter", true],
    ["Tab", false],
    ["Tab", true],
  ] as const)(
    "chooses the navigated member once with %s (RAF before keyup %s)",
    async (accept, frameFirst) => {
      await text("Reply @");
      await press("ArrowDown");
      await key("keydown", accept);
      if (frameFirst) await settle();
      await key("keyup", accept);
      await settle();
      expect(input().value).toBe("Reply @Beta ");
      expect(mention).toHaveBeenCalledExactlyOnceWith({
        name: "Beta",
        email: "beta@example.test",
      });
      expect(submit).not.toHaveBeenCalled();
      expect(buttons()).toHaveLength(0);
      expect([input().selectionStart, input().selectionEnd]).toEqual([
        "Reply @Beta ".length,
        "Reply @Beta ".length,
      ]);
    },
  );
  it("retains repeated menu navigation and wraps in both directions", async () => {
    await text("Reply @");
    for (const expected of ["Beta", "Gamma", "Alpha", "Beta"]) {
      await press("ArrowDown");
      expect(active()).toContain(expected);
    }
    for (const expected of ["Alpha", "Gamma", "Beta", "Alpha"]) {
      await press("ArrowUp");
      expect(active()).toContain(expected);
    }
    await press("Shift");
    expect(active()).toContain("Alpha");
  });
  it("refreshes a query when ordinary text input or caret navigation changes its source", async () => {
    await text("Reply @");
    await press("Escape");
    await text("Reply @G");
    expect(active()).toContain("Gamma");
    await text("Reply @Alpha later");
    expect(buttons()).toHaveLength(0);
    await key("keydown", "ArrowLeft");
    input().setSelectionRange("Reply @Alpha".length, "Reply @Alpha".length);
    await key("keyup", "ArrowLeft");
    expect(active()).toContain("Alpha");
    await key("keydown", "End");
    input().setSelectionRange(input().value.length, input().value.length);
    await key("keyup", "End");
    expect(buttons()).toHaveLength(0);
  });
});
