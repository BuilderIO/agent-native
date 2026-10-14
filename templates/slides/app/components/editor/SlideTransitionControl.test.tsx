// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Slide } from "@/context/DeckContext";

import { SlideTransitionControl } from "./SlideTransitionControl";

const slide: Slide = {
  id: "slide-2",
  content: "",
  notes: "",
  layout: "blank",
  transition: "fade",
  transitionSpeed: 30,
};

function renderControl(index: number) {
  const handlers = {
    onChange: vi.fn(),
    onApplyToAll: vi.fn(),
    onPlay: vi.fn(),
  };
  const ui = (at: number) => (
    <TooltipProvider>
      <SlideTransitionControl
        currentSlide={slide}
        currentSlideIndex={at}
        canEdit
        {...handlers}
      />
    </TooltipProvider>
  );
  const result = render(ui(index));
  fireEvent.click(
    screen.getByRole("button", { name: "editorToolbar.transition_panel" }),
  );
  return { handlers, rerenderAt: (at: number) => result.rerender(ui(at)) };
}

afterEach(() => {
  cleanup();
});

describe("<SlideTransitionControl>", () => {
  it("disables Play on the first slide and previews later slides", () => {
    const { handlers, rerenderAt } = renderControl(0);

    const play = screen.getByRole("button", {
      name: "editorToolbar.transition_play",
    }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);

    rerenderAt(1);
    const enabled = screen.getByRole("button", {
      name: "editorToolbar.transition_play",
    }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);
    expect(handlers.onPlay).toHaveBeenCalledOnce();
  });

  it("applies the slide's type and speed to every slide in one write", () => {
    const { handlers } = renderControl(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: "editorToolbar.transition_apply_all",
      }),
    );

    expect(handlers.onApplyToAll).toHaveBeenCalledOnce();
    expect(handlers.onApplyToAll).toHaveBeenCalledWith({
      transition: "fade",
      transitionSpeed: 30,
    });
    expect(handlers.onChange).not.toHaveBeenCalled();
  });

  it("stacks action buttons so their labels fit inside the popover", () => {
    renderControl(1);

    const apply = screen.getByRole("button", {
      name: "editorToolbar.transition_apply_all",
    });
    const play = screen.getByRole("button", {
      name: "editorToolbar.transition_play",
    });

    expect(apply.parentElement).toBe(play.parentElement);
    expect(apply.parentElement?.className).toContain("flex-col");
    for (const button of [apply, play]) {
      expect(button.className).toContain("w-full");
      expect(button.className).toContain("whitespace-normal");
      expect(button.querySelector("span")?.className).toContain("min-w-0");
    }
  });

  it("writes a changed speed once when the slider commits", () => {
    const { handlers } = renderControl(1);

    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });

    expect(handlers.onChange).toHaveBeenCalledOnce();
    expect(handlers.onChange).toHaveBeenCalledWith({ transitionSpeed: 31 });
    expect(handlers.onApplyToAll).not.toHaveBeenCalled();
  });
});
