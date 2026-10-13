// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeftPanelSearchField } from "./LeftPanelSearchField";

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function render(props: Partial<Parameters<typeof LeftPanelSearchField>[0]>) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <LeftPanelSearchField
        value=""
        placeholder="Search layers"
        onValueChange={() => {}}
        onEscapeWhenEmpty={() => {}}
        {...props}
      />,
    );
  });
  return host.querySelector("input") as HTMLInputElement;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe("LeftPanelSearchField", () => {
  it("names the input for assistive tech instead of relying on the placeholder", () => {
    const input = render({ placeholder: "Search tokens" });
    expect(input.getAttribute("aria-label")).toBe("Search tokens");
  });

  it("closes only when Escape is pressed on an empty field", () => {
    const onEscapeWhenEmpty = vi.fn();
    const empty = render({ onEscapeWhenEmpty });
    act(() => {
      empty.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onEscapeWhenEmpty).toHaveBeenCalledTimes(1);

    act(() => root?.unmount());
    host?.remove();
    const filled = render({ value: "accent", onEscapeWhenEmpty });
    act(() => {
      filled.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onEscapeWhenEmpty).toHaveBeenCalledTimes(1);
  });
});
