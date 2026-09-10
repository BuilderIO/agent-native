// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tabler/icons-react", () => ({
  IconCheck: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-icon-check {...props} />
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-tooltip>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

import { ReactionsTray } from "./reactions-tray";

describe("ReactionsTray", () => {
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

  it("shows reaction counts and marks the latest saved reaction", async () => {
    const onReact = vi.fn().mockResolvedValue(true);

    act(() => {
      root.render(
        <ReactionsTray reactions={[{ emoji: "👀" }]} onReact={onReact} />,
      );
    });

    const eyes = container.querySelector<HTMLButtonElement>(
      '[data-reaction-emoji="👀"]',
    );
    expect(eyes?.getAttribute("data-reaction-count")).toBe("1");
    expect(eyes?.getAttribute("aria-label")).toBe("eyes 1");

    await act(async () => {
      eyes?.click();
      await Promise.resolve();
    });

    expect(onReact).toHaveBeenCalledWith("👀");
    expect(eyes?.getAttribute("data-reaction-saved")).toBe("true");
    expect(eyes?.querySelector("[data-icon-check]")).not.toBeNull();
  });

  it("does not leave a saved cue when persistence fails", async () => {
    const onReact = vi.fn().mockResolvedValue(false);

    act(() => {
      root.render(<ReactionsTray onReact={onReact} />);
    });

    const heart = container.querySelector<HTMLButtonElement>(
      '[data-reaction-emoji="❤️"]',
    );
    await act(async () => {
      heart?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(heart?.getAttribute("data-reaction-saved")).toBe("false");
    expect(heart?.querySelector("[data-icon-check]")).toBeNull();
  });
});
