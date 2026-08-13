// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/use-library", () => ({
  useRecordingSearch: () => ({ data: undefined, isFetching: false }),
}));

import { focusSearchBar, SearchBar } from "./search-bar";

describe("SearchBar", () => {
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

  function render(node: React.ReactElement) {
    act(() => root.render(node));
  }

  it("focuses and selects the search input when a focus request is dispatched", () => {
    render(<SearchBar />);

    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    expect(document.activeElement).not.toBe(input);

    act(() => {
      focusSearchBar();
    });

    expect(document.activeElement).toBe(input);
  });
});
