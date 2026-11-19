// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Popover, PopoverContent, PopoverTrigger } from "./popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.js";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * jsdom has no input modality, so the test says whether focus comes from the
 * keyboard (the focused element matches `:focus-visible`) or is handed back
 * after a click (it doesn't).
 */
function focusComesFrom(source: "keyboard" | "click") {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    if (selector === ":focus-visible") {
      return source === "keyboard" && this === document.activeElement;
    }
    return matches.call(this, selector);
  });
}

function focus(element: HTMLElement) {
  act(() => element.focus());
}

function renderHeader() {
  render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <button type="button">Look again on</button>
          </div>
        </TooltipTrigger>
        <TooltipContent>Look again on</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
  return screen.getByRole("button");
}

function renderButton() {
  render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>Rank</TooltipTrigger>
        <TooltipContent>Rank order</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
  return screen.getByRole("button");
}

describe("TooltipTrigger", () => {
  it("opens when the keyboard focuses a control inside the trigger", () => {
    focusComesFrom("keyboard");
    focus(renderHeader());

    expect(screen.getByRole("tooltip").textContent).toBe("Look again on");
  });

  it("stays closed when a click hands focus back to a control inside the trigger", () => {
    focusComesFrom("click");
    focus(renderHeader());

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens when the keyboard focuses the trigger itself", () => {
    focusComesFrom("keyboard");
    focus(renderButton());

    expect(screen.getByRole("tooltip").textContent).toBe("Rank order");
  });

  it("stays closed when a click hands focus back to the trigger itself", () => {
    focusComesFrom("click");
    focus(renderButton());

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays closed while the keyboard moves through a menu opened from inside the trigger", () => {
    focusComesFrom("keyboard");
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Popover open>
                <PopoverTrigger>Look again on</PopoverTrigger>
                <PopoverContent>
                  <button type="button">Sort ascending</button>
                </PopoverContent>
              </Popover>
            </div>
          </TooltipTrigger>
          <TooltipContent>Look again on</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    focus(screen.getByRole("button", { name: "Sort ascending" }));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
