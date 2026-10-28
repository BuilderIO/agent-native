// @vitest-environment happy-dom

import { act, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/use-avatar", () => ({
  useAvatarUrl: () => null,
}));

import { ReviewPinBadge, uniqueReviewPinAuthors } from "./ReviewPinBadge";

const AUTHORS = [
  { email: "reviewer@example.com" },
  { email: "second@example.com" },
];

describe("ReviewPinBadge", () => {
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

  const render = (element: ReactElement) => act(() => root.render(element));
  const pin = () => container.querySelector<HTMLButtonElement>("button");
  const dot = () =>
    container.querySelector<HTMLElement>("[data-review-pin-unread-dot]");

  it("stacks the authors and shows the comment count", () => {
    render(<ReviewPinBadge authors={AUTHORS} count={3} ariaLabel="Thread" />);

    expect(pin()?.getAttribute("aria-label")).toBe("Thread");
    expect(pin()?.textContent).toBe("RS3");
  });

  it("rings the selected pin in the darker pin token, offset 2px from the pin", () => {
    render(
      <ReviewPinBadge authors={AUTHORS} ariaLabel="Thread" selected={false} />,
    );
    expect(pin()?.className).not.toContain("ring-2");

    render(<ReviewPinBadge authors={AUTHORS} ariaLabel="Thread" selected />);

    const classes = pin()?.className.split(/\s+/) ?? [];
    expect(classes).toContain("ring-2");
    expect(classes).toContain("ring-[hsl(var(--review-pin-ring))]");
    expect(classes).toContain("ring-offset-2");
    expect(classes).toContain("ring-offset-popover");
    expect(pin()?.className).not.toContain("design-editor-accent-color");
  });

  it("marks an unread pin with a dot that screen readers skip", () => {
    render(<ReviewPinBadge authors={AUTHORS} ariaLabel="Thread" />);
    expect(dot()).toBeNull();

    render(<ReviewPinBadge authors={AUTHORS} ariaLabel="Thread" unread />);

    expect(dot()).not.toBeNull();
    expect(dot()?.getAttribute("aria-hidden")).toBe("true");
    expect(pin()?.contains(dot())).toBe(true);
  });

  it("keeps the avatars and count when the pin is unread", () => {
    render(
      <ReviewPinBadge authors={AUTHORS} count={3} ariaLabel="Thread" unread />,
    );

    expect(pin()?.textContent).toBe("RS3");
  });

  it("shows the dot with the selected ring, so unread is not told apart by color alone", () => {
    render(
      <ReviewPinBadge authors={AUTHORS} ariaLabel="Thread" unread selected />,
    );

    expect(dot()).not.toBeNull();
    expect(pin()?.className).toContain("ring-[hsl(var(--review-pin-ring))]");
  });

  it("hides the dot while a pin is pending", () => {
    render(
      <ReviewPinBadge authors={AUTHORS} ariaLabel="Thread" unread pending />,
    );

    expect(dot()).toBeNull();
  });

  describe("resolved", () => {
    const check = () =>
      container.querySelector<SVGElement>("[data-review-pin-resolved-check]");
    // Opacity anywhere on the pin or its parts would dim the initials.
    const dimmed = () =>
      [pin(), ...Array.from(pin()?.querySelectorAll("*") ?? [])].filter(
        (element) =>
          /(^|\s)opacity-/.test(element?.getAttribute("class") ?? "") ||
          /opacity/.test(element?.getAttribute("style") ?? ""),
      );

    it("keeps the initials and avatars at full opacity instead of dimming the pin", () => {
      render(
        <ReviewPinBadge
          authors={AUTHORS}
          count={3}
          ariaLabel="Thread, resolved"
          resolved
        />,
      );

      expect(dimmed()).toEqual([]);
      expect(pin()?.textContent).toBe("RS3");
    });

    it("shows a check that screen readers skip, in the muted token that clears 3:1 on the pill", () => {
      render(<ReviewPinBadge authors={AUTHORS} ariaLabel="Thread" resolved />);

      expect(check()).not.toBeNull();
      expect(check()?.getAttribute("aria-hidden")).toBe("true");
      expect(check()?.getAttribute("class")).toContain("text-muted-foreground");
      expect(pin()?.contains(check())).toBe(true);
      expect(pin()?.getAttribute("aria-label")).toBe("Thread");
    });

    it("places the check after the avatars and the count", () => {
      render(
        <ReviewPinBadge
          authors={AUTHORS}
          count={3}
          ariaLabel="Thread"
          resolved
        />,
      );

      expect(
        Array.from(pin()?.children ?? []).map((child) =>
          child.hasAttribute("data-review-pin-resolved-check")
            ? "check"
            : child.textContent,
        ),
      ).toEqual(["R", "S", "3", "check"]);
    });

    it("leaves an open pin without the check", () => {
      render(<ReviewPinBadge authors={AUTHORS} ariaLabel="Thread" />);

      expect(check()).toBeNull();
    });

    it("keeps the unread dot, the selected ring and the count beside the check", () => {
      render(
        <ReviewPinBadge
          authors={AUTHORS}
          count={2}
          ariaLabel="Thread"
          resolved
          unread
          selected
        />,
      );

      expect(check()).not.toBeNull();
      expect(dot()).not.toBeNull();
      expect(pin()?.className).toContain("ring-[hsl(var(--review-pin-ring))]");
      expect(pin()?.textContent).toBe("RS2");
    });

    it("hides the check while a pin is pending", () => {
      render(
        <ReviewPinBadge
          authors={AUTHORS}
          ariaLabel="Thread"
          resolved
          pending
        />,
      );

      expect(check()).toBeNull();
    });
  });

  it("passes the ref and button attributes through to the button", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <ReviewPinBadge
        ref={ref}
        authors={AUTHORS}
        ariaLabel="Thread"
        aria-expanded={true}
        aria-haspopup="dialog"
      />,
    );

    expect(ref.current).toBe(pin());
    expect(pin()?.getAttribute("aria-expanded")).toBe("true");
    expect(pin()?.getAttribute("aria-haspopup")).toBe("dialog");
  });
});

describe("uniqueReviewPinAuthors", () => {
  it("keeps the first of each author by email, name, or agent kind", () => {
    expect(
      uniqueReviewPinAuthors([
        { email: "A@example.com" },
        { email: "a@example.com", name: "Alex" },
        { name: "Sam" },
        { name: "sam" },
        { name: "Claude", agent: { kind: "claude" } },
        { name: "Claude", agent: { kind: "claude" } },
      ]),
    ).toEqual([
      { email: "A@example.com" },
      { name: "Sam" },
      { name: "Claude", agent: { kind: "claude" } },
    ]);
  });

  it("tells agents that share their owner's email apart, and from the owner", () => {
    const owner = { name: "Alex", email: "alex@example.com" };
    const claude = {
      name: "Claude",
      email: "alex@example.com",
      agent: { kind: "claude" as const },
    };
    const codex = {
      name: "Codex",
      email: "alex@example.com",
      agent: { kind: "codex" as const },
    };
    expect(
      uniqueReviewPinAuthors([owner, claude, codex, { ...claude }]),
    ).toEqual([owner, claude, codex]);
  });
});
