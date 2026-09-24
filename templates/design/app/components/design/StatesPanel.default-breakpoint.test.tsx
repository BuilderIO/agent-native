// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: { count: 0, states: [] },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
}));

import { StatesPanel } from "./StatesPanel";

describe("StatesPanel default breakpoint shortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("offers Desktop first and selects its breakpoint", async () => {
    const onBreakpointSelect = vi.fn();
    await act(async () => {
      root.render(
        <TooltipProvider>
          <StatesPanel
            designId="design"
            activeStateId={null}
            activeBreakpointId="auto"
            breakpoints={[]}
            onStateSelect={vi.fn()}
            onBreakpointSelect={onBreakpointSelect}
          />
        </TooltipProvider>,
      );
    });

    const section = container.querySelector('[aria-label="Breakpoints"]');
    const shortcuts = Array.from(
      section?.querySelectorAll<HTMLButtonElement>("button[title]") ?? [],
    )
      .filter((button) => button.title.endsWith("px)"))
      .map((button) => button.title);
    expect(shortcuts).toEqual([
      "Desktop (1280px)",
      "Tablet (768px)",
      "Mobile (390px)",
    ]);

    await act(async () => {
      section
        ?.querySelector<HTMLButtonElement>('[title="Desktop (1280px)"]')
        ?.click();
    });
    expect(onBreakpointSelect).toHaveBeenCalledWith("bp-desktop");
  });
});
