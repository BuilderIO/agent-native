// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewAuthorAvatar, reviewInitials } from "./ReviewAuthorAvatar.js";

const useAvatarUrl = vi.hoisted(() => vi.fn((_email: unknown) => null));

vi.mock("@agent-native/core/client/use-avatar", () => ({ useAvatarUrl }));

describe("ReviewAuthorAvatar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useAvatarUrl.mockClear();
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

  const backgroundOf = (element: HTMLElement) =>
    Array.from(element.classList).find((name) =>
      name.startsWith("bg-[hsl(var(--review-avatar-"),
    );

  it("draws 10px white initials on the person's own color", async () => {
    await render(<ReviewAuthorAvatar name="Priya Shah" email={null} />);
    const initials = initialsElement("PS");
    expect(backgroundOf(initials)).toMatch(
      /^bg-\[hsl\(var\(--review-avatar-[1-6],0_0%_40%\)\)\]$/,
    );
    expect(initials.classList.contains("font-semibold")).toBe(true);
    expect(initials.classList.contains("text-[10px]")).toBe(true);
    expect(
      initials.classList.contains(
        "text-[hsl(var(--review-avatar-foreground,0_0%_100%))]",
      ),
    ).toBe(true);
    expect(initials.classList.contains("bg-muted")).toBe(false);
  });

  it("scales the type with the size, down to one letter at 16px", async () => {
    await render(
      <ReviewAuthorAvatar name="Priya Shah" email={null} size={32} />,
    );
    expect(initialsElement("PS").classList.contains("text-xs")).toBe(true);

    await render(
      <ReviewAuthorAvatar name="Priya Shah" email={null} size={16} />,
    );
    const small = initialsElement("P");
    expect(small.classList.contains("text-[9px]")).toBe(true);
    expect(small.parentElement?.classList.contains("size-4")).toBe(true);
  });

  it("keeps a person's color wherever and however they are named", async () => {
    await render(
      <ReviewAuthorAvatar name="Priya Shah" email="Priya@example.com" />,
    );
    const first = backgroundOf(initialsElement("PS"));
    await render(
      <ReviewAuthorAvatar
        name="priya@example.com"
        email=" priya@example.com "
        size={16}
      />,
    );
    expect(backgroundOf(initialsElement("P"))).toBe(first);
  });

  it("gives different people more than one color", async () => {
    const colors = new Set<string | undefined>();
    for (const email of [
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "d@example.com",
      "e@example.com",
      "f@example.com",
    ]) {
      await render(<ReviewAuthorAvatar name={email} email={email} />);
      colors.add(backgroundOf(initialsElement(email[0]!.toUpperCase())));
    }
    expect(colors.size).toBeGreaterThan(1);
  });

  it("asks for a photo by email, and for none when the author is an agent", async () => {
    await render(<ReviewAuthorAvatar name="Priya" email="priya@example.com" />);
    expect(useAvatarUrl).toHaveBeenLastCalledWith("priya@example.com");
    await render(
      <ReviewAuthorAvatar
        name="Claude"
        email="owner@example.com"
        agent={{ kind: "claude", label: "Claude" }}
      />,
    );
    expect(useAvatarUrl).toHaveBeenLastCalledWith(null);
  });

  it("shows an agent's mark, named for assistive tech unless decorative", async () => {
    const agent = { kind: "claude" as const, label: "Claude" };
    await render(<ReviewAuthorAvatar name="Claude" agent={agent} />);
    const named = container.querySelector('[role="img"]');
    expect(named?.getAttribute("aria-label")).toBe("Claude");
    expect(named?.querySelector("svg")).not.toBeNull();
    expect(named?.textContent).toBe("");

    await render(<ReviewAuthorAvatar name="Claude" agent={agent} decorative />);
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("hides a mark that has no name to give", async () => {
    await render(
      <ReviewAuthorAvatar name="Claude" agent={{ kind: "claude" }} />,
    );
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("hides a person's avatar from assistive tech only when asked", async () => {
    await render(<ReviewAuthorAvatar name="Priya Shah" email={null} />);
    expect(container.firstElementChild?.hasAttribute("aria-hidden")).toBe(
      false,
    );
    await render(
      <ReviewAuthorAvatar name="Priya Shah" email={null} decorative />,
    );
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("reviewInitials", () => {
  it.each([
    ["Enzo Ames", 2, "EA"],
    ["Enzo Ames", 1, "E"],
    ["Enzo", 2, "E"],
    ["dev@local.test", 2, "D"],
    ["first.last@example.com", 2, "FL"],
    ["first_middle last", 2, "FM"],
    ["élodie brun", 2, "ÉB"],
    ["Person 02", 2, "P"],
    ["02 Person", 2, "P"],
    ["42", 2, "?"],
    ["  ", 2, "?"],
    ["", 1, "?"],
  ] as const)("reads %j (%i letters) as %s", (source, letters, expected) => {
    expect(reviewInitials(source, letters)).toBe(expected);
  });
});
