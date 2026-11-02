// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCommentMenu } from "./ReviewCommentMenu.js";

describe("ReviewCommentMenu", () => {
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const trigger = () => container.querySelector<HTMLButtonElement>("button");
  async function open() {
    await act(async () => {
      trigger()?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
  }
  const menuLabels = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="separator"]',
      ),
    ).map((item) =>
      item.getAttribute("role") === "separator"
        ? "---"
        : (item.textContent?.trim() ?? ""),
    );
  const item = (label: string) =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) => candidate.textContent?.trim() === label);

  it("renders nothing when it has no handler to offer", () => {
    act(() => root.render(<ReviewCommentMenu />));
    expect(container.innerHTML).toBe("");
  });

  it("lists Edit, a separator, then a destructive Delete", async () => {
    act(() =>
      root.render(<ReviewCommentMenu onEdit={vi.fn()} onDelete={vi.fn()} />),
    );
    await open();
    expect(menuLabels()).toEqual(["Edit comment", "---", "Delete comment"]);
    expect(item("Delete comment")?.className).toContain("text-destructive");
  });

  it("draws no separator around a single item", async () => {
    act(() => root.render(<ReviewCommentMenu onEdit={vi.fn()} />));
    await open();
    expect(menuLabels()).toEqual(["Edit comment"]);
  });

  it("calls the handler of the chosen item", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    act(() =>
      root.render(<ReviewCommentMenu onEdit={onEdit} onDelete={onDelete} />),
    );
    await open();
    await act(async () => item("Delete comment")?.click());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("names the button for assistive tech without changing its tooltip", () => {
    act(() =>
      root.render(
        <ReviewCommentMenu
          onEdit={vi.fn()}
          moreActionsLabel="More actions"
          ariaLabel="More actions for Maya"
        />,
      ),
    );
    expect(trigger()?.getAttribute("aria-label")).toBe("More actions for Maya");
  });

  it("falls back to the tooltip text as the button's name", () => {
    act(() =>
      root.render(
        <ReviewCommentMenu onEdit={vi.fn()} moreActionsLabel="More actions" />,
      ),
    );
    expect(trigger()?.getAttribute("aria-label")).toBe("More actions");
  });

  it("marks the portaled menu as review UI", async () => {
    act(() => root.render(<ReviewCommentMenu onEdit={vi.fn()} />));
    await open();
    expect(
      document
        .querySelector('[role="menu"]')
        ?.hasAttribute("data-review-popover"),
    ).toBe(true);
  });

  it("shows a tooltip naming the button on hover", async () => {
    vi.useFakeTimers();
    act(() => root.render(<ReviewCommentMenu onEdit={vi.fn()} />));
    await act(async () => {
      trigger()?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await vi.advanceTimersByTimeAsync(400);
    });
    const tooltip = document.querySelector("[data-agent-native-tooltip]");
    expect(tooltip?.textContent).toContain("More actions");
    expect(tooltip?.hasAttribute("data-review-popover")).toBe(true);
  });
});
