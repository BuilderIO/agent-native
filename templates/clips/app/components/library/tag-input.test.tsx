// @vitest-environment happy-dom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { TagInput } from "./tag-input";

it("keeps focus when the tag group padding or a chip is pressed", () => {
  const dismiss = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <TagInput
        value={["one"]}
        onChange={() => {}}
        onDismiss={dismiss}
        aria-label="Tags"
      />,
    ),
  );
  const group = container.querySelector<HTMLElement>('[role="group"]');
  const input = container.querySelector<HTMLInputElement>("input");
  const chip = group?.querySelector("span");
  if (!group || !input || !chip) throw new Error("Tag editor unavailable");
  act(() => input.focus());
  for (const target of [group, chip]) {
    const press = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      target.dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(dismiss).not.toHaveBeenCalled();
  }
  act(() => root.unmount());
  container.remove();
});

it("keeps editing when a focused tag is removed", () => {
  const dismiss = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Editor() {
    const [tags, setTags] = useState(["one", "two"]);
    return (
      <TagInput
        value={tags}
        onChange={setTags}
        onDismiss={dismiss}
        aria-label="Tags"
      />
    );
  }
  act(() => root.render(<Editor />));
  const remove = container.querySelector<HTMLButtonElement>("button");
  if (!remove) throw new Error("Remove button unavailable");
  act(() => {
    remove.focus();
    remove.click();
  });
  expect(container.textContent).toContain("two");
  expect(container.textContent).not.toContain("one");
  expect(document.activeElement).toBe(container.querySelector("input"));
  expect(dismiss).not.toHaveBeenCalled();
  act(() => root.unmount());
  container.remove();
});
