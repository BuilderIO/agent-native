// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  useT: () => (key: string) =>
    key === "designEditor.stopPinningComments"
      ? "Stop pinning comments"
      : "Pin comment",
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => children,
  TooltipContent: ({ children }: { children?: ReactNode }) => children,
}));

import { ReadOnlyDesignBanner } from "./ReadOnlyDesignBanner";

describe("ReadOnlyDesignBanner", () => {
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

  it("stays informational when commenting is unavailable", () => {
    act(() => root.render(<ReadOnlyDesignBanner />));

    expect(container.textContent).toContain(
      "You don't have access to edit this design",
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("integrates the viewer comment toggle into the notice", () => {
    const onCommentPin = vi.fn();
    act(() =>
      root.render(<ReadOnlyDesignBanner onCommentPin={onCommentPin} />),
    );

    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Pin comment");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    act(() => button?.click());
    expect(onCommentPin).toHaveBeenCalledOnce();

    act(() =>
      root.render(<ReadOnlyDesignBanner pinMode onCommentPin={onCommentPin} />),
    );
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Stop pinning comments",
    );
    expect(
      container.querySelector("button")?.getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
