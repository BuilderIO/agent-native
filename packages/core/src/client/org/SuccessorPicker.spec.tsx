// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("../sharing/share-controller-helpers.js", () => ({
  useShareOrgMemberSearch: (query: string, enabled: boolean) =>
    mocks.search(query, enabled),
}));

import { SuccessorPicker } from "./SuccessorPicker.js";

describe("SuccessorPicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // cmdk measures with ResizeObserver and scrolls the active item into view.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.search.mockReturnValue({
      members: [
        { email: "leaving@example.test" },
        { email: "far-page@example.test", name: "Far Page" },
      ],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      error: false,
      loadMore: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("searches the whole organization and never offers the member being removed", async () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <SuccessorPicker
          value={{ email: "me@example.test" }}
          onChange={onChange}
          excludeEmail="leaving@example.test"
          currentUser={{ email: "me@example.test" }}
        />,
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[role="combobox"]',
    )!;
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      trigger.click();
    });

    expect(mocks.search).toHaveBeenLastCalledWith("", true);
    const options = Array.from(
      document.body.querySelectorAll('[role="option"]'),
    ).map((option) => option.textContent);
    expect(options).toEqual(["me@example.test", "Far Page"]);

    const farPage = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent === "Far Page")!;
    await act(async () => farPage.click());

    expect(onChange).toHaveBeenCalledWith({
      email: "far-page@example.test",
      name: "Far Page",
    });
  });
});
