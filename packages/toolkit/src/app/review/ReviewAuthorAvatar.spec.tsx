// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewAuthorAvatar } from "./ReviewAuthorAvatar.js";

vi.mock("@agent-native/core/client/use-avatar", () => ({
  useAvatarUrl: () => null,
}));

describe("ReviewAuthorAvatar", () => {
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

  async function render(node: ReactNode) {
    await act(async () => root.render(node));
  }

  // The innermost span holding the initials, not the Avatar root that wraps it.
  function initialsElement(initials: string) {
    const element = Array.from(
      container.querySelectorAll<HTMLElement>("span"),
    ).find(
      (node) => node.children.length === 0 && node.textContent === initials,
    );
    if (!element) throw new Error(`no initials ${initials} rendered`);
    return element;
  }

  it("draws 10px initials in the foreground token on the muted fallback", async () => {
    await render(<ReviewAuthorAvatar name="Priya Shah" email={null} />);
    const initials = initialsElement("PS");
    expect(initials.classList.contains("bg-muted")).toBe(true);
    expect(initials.classList.contains("font-semibold")).toBe(true);
    expect(initials.classList.contains("text-[10px]")).toBe(true);
    expect(initials.classList.contains("text-foreground")).toBe(true);
    expect(initials.classList.contains("text-muted-foreground")).toBe(false);
  });

  it("keeps the foreground token at the 32px size", async () => {
    await render(
      <ReviewAuthorAvatar name="Priya Shah" email={null} size={32} />,
    );
    const initials = initialsElement("PS");
    expect(initials.classList.contains("text-xs")).toBe(true);
    expect(initials.classList.contains("bg-muted")).toBe(true);
    expect(initials.classList.contains("text-foreground")).toBe(true);
    expect(initials.classList.contains("text-muted-foreground")).toBe(false);
  });
});
