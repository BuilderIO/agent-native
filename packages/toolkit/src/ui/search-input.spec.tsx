// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchInput } from "./search-input.js";

function ControlledSearch(props: { initialValue?: string }) {
  const [value, setValue] = useState(props.initialValue ?? "");
  return (
    <SearchInput
      value={value}
      onValueChange={setValue}
      placeholder="Search settings"
      aria-label="Search settings"
      clearLabel="Clear search"
    />
  );
}

describe("SearchInput", () => {
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

  it("renders exactly one clear control while the field has a value", () => {
    act(() => {
      root.render(<ControlledSearch initialValue="WDWD" />);
    });

    expect(
      container.querySelectorAll('button[aria-label="Clear search"]'),
    ).toHaveLength(1);
  });

  it("suppresses the WebKit cancel button so it cannot double up", () => {
    act(() => {
      root.render(<ControlledSearch initialValue="WDWD" />);
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    expect(input?.className).toContain(
      "[&::-webkit-search-cancel-button]:appearance-none",
    );
  });

  it("renders no clear control while the field is empty", () => {
    act(() => {
      root.render(<ControlledSearch />);
    });

    expect(container.querySelector("button")).toBeNull();
  });

  it("clears the value from the button and from Escape", () => {
    act(() => {
      root.render(<ControlledSearch initialValue="WDWD" />);
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    act(() => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(input.value).toBe("");

    act(() => {
      root.render(<ControlledSearch key="reopened" initialValue="WDWD" />);
    });
    const reopened = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    expect(reopened.value).toBe("WDWD");

    act(() => {
      reopened.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(reopened.value).toBe("");
  });
});
