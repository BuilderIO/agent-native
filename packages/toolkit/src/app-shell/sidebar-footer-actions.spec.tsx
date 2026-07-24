// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarFooterActions } from "./sidebar-footer-actions.js";

describe("SidebarFooterActions", () => {
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
  });

  it("keeps the footer controls in feedback, translate, search, collapse order", () => {
    act(() => {
      root.render(
        <SidebarFooterActions
          feedback={<span>feedback</span>}
          translate={<span>translate</span>}
          search={<span>search</span>}
          collapse={<span>collapse</span>}
        />,
      );
    });

    expect(
      Array.from(
        container.querySelectorAll(
          "[data-sidebar-footer-feedback], [data-sidebar-footer-translate], [data-sidebar-footer-search], [data-sidebar-footer-collapse]",
        ),
      ).map((element) => element.textContent),
    ).toEqual(["feedback", "translate", "search", "collapse"]);
  });

  it("stacks the same controls when the sidebar is collapsed", () => {
    act(() => {
      root.render(
        <SidebarFooterActions
          collapsed
          feedback={<span>feedback</span>}
          translate={<span>translate</span>}
          search={<span>search</span>}
          collapse={<span>collapse</span>}
        />,
      );
    });

    expect(
      container
        .querySelector("[data-sidebar-footer-actions]")
        ?.className.includes("flex-col"),
    ).toBe(true);
  });
});
