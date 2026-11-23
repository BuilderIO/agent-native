// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Popover, PopoverContent, PopoverTrigger } from "../popover.js";
import { Button } from "./button.js";
import {
  normalizeTooltipText,
  Tooltip,
  TooltipPopup,
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

const popup = () => document.querySelector("[data-agent-native-tooltip]");

function renderButton() {
  render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>Rank</TooltipTrigger>
        <TooltipPopup>Rank order</TooltipPopup>
      </Tooltip>
    </TooltipProvider>,
  );
  return screen.getByRole("button");
}

// oracle-change(packages/toolkit/src/ui/tooltip.spec.tsx): the Radix trigger focus cases now run on Base UI's trigger in the TooltipTrigger focus tests below
describe("TooltipTrigger focus", () => {
  it("opens when the keyboard focuses the trigger", () => {
    focusComesFrom("keyboard");
    focus(renderButton());

    expect(popup()?.textContent).toBe("Rank order");
  });

  it("stays closed when a click hands focus back to the trigger", () => {
    focusComesFrom("click");
    focus(renderButton());

    expect(popup()).toBeNull();
  });

  it("stays closed while the keyboard moves through a popover opened from inside the trigger", () => {
    focusComesFrom("keyboard");
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={<div />}>
            <Popover open>
              <PopoverTrigger>Look again on</PopoverTrigger>
              <PopoverContent>
                <button type="button">Sort ascending</button>
              </PopoverContent>
            </Popover>
          </TooltipTrigger>
          <TooltipPopup>Look again on</TooltipPopup>
        </Tooltip>
      </TooltipProvider>,
    );
    focus(screen.getByRole("button", { name: "Sort ascending" }));

    expect(popup()).toBeNull();
  });
});

describe("Tooltip", () => {
  it("merges classes from live popup state when kept mounted", async () => {
    const view = (open: boolean) => (
      <TooltipProvider>
        <Tooltip open={open}>
          <TooltipTrigger>Rank</TooltipTrigger>
          <TooltipPopup
            keepMounted
            className={(state) => (state.open ? "is-open" : "is-closed")}
          >
            Rank order
          </TooltipPopup>
        </Tooltip>
      </TooltipProvider>
    );
    const { rerender } = render(view(true));
    await waitFor(() =>
      expect(popup()?.classList.contains("is-open")).toBe(true),
    );
    rerender(view(false));
    await waitFor(() =>
      expect(popup()?.classList.contains("is-closed")).toBe(true),
    );
    expect(popup()?.classList.contains("tooltip-popup")).toBe(true);
    expect(popup()?.classList.contains("is-open")).toBe(false);
  });

  it("renders the part classes and marks the popup", () => {
    focusComesFrom("keyboard");
    const trigger = renderButton();
    expect(trigger.hasAttribute("data-popup-open")).toBe(false);

    focus(trigger);

    const tooltip = popup() as HTMLElement;
    expect(tooltip.classList.contains("tooltip-popup")).toBe(true);
    expect(tooltip.hasAttribute("data-open")).toBe(true);
    expect(
      tooltip.parentElement?.classList.contains("tooltip-positioner"),
    ).toBe(true);
    expect(trigger.hasAttribute("data-popup-open")).toBe(true);
  });

  it("renders the trigger through render", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="outline" data-testid="trigger" />}
          >
            Docs
          </TooltipTrigger>
          <TooltipPopup>Open the docs</TooltipPopup>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = screen.getByTestId("trigger");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.classList.contains("button")).toBe(true);
  });

  it("normalizes escaped shortcut text in string content", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>New</TooltipTrigger>
          <TooltipPopup>{"new chat(\\u2318K)"}</TooltipPopup>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(popup()?.textContent).toBe("New chat (⌘K)");
    expect(normalizeTooltipText("new chat(⌘K)")).toBe("New chat (⌘K)");
  });

  it("passes side and sideOffset to the positioner", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>New</TooltipTrigger>
          <TooltipPopup side="right" sideOffset={12}>
            Rank order
          </TooltipPopup>
        </Tooltip>
      </TooltipProvider>,
    );
    expect((popup() as HTMLElement).dataset.side).toBe("right");
  });

  it("opens on hover after the provider's delay", async () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger>Rank</TooltipTrigger>
          <TooltipPopup>Rank order</TooltipPopup>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button");
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);

    await waitFor(() => expect(popup()?.textContent).toBe("Rank order"));
  });

  it("lets onOpenChange cancel an Escape dismissal", () => {
    focusComesFrom("keyboard");
    render(
      <TooltipProvider>
        <Tooltip
          onOpenChange={(open, details) => {
            if (!open && details.reason === "escape-key") details.cancel();
          }}
        >
          <TooltipTrigger>Rank</TooltipTrigger>
          <TooltipPopup>Rank order</TooltipPopup>
        </Tooltip>
      </TooltipProvider>,
    );
    focus(screen.getByRole("button"));
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    expect(popup()).not.toBeNull();
  });

  it("reports open changes to a controlled owner and follows its state", () => {
    focusComesFrom("keyboard");
    const onOpenChange = vi.fn();
    render(
      <TooltipProvider>
        <Tooltip open={false} onOpenChange={onOpenChange}>
          <TooltipTrigger>Rank</TooltipTrigger>
          <TooltipPopup>Rank order</TooltipPopup>
        </Tooltip>
      </TooltipProvider>,
    );
    focus(screen.getByRole("button"));

    expect(onOpenChange.mock.calls[0]?.[0]).toBe(true);
    expect(popup()).toBeNull();
  });
});
