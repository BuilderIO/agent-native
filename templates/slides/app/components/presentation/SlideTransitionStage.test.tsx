// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: Slide }) => (
    <div data-testid={`rendered-${slide.id}`} />
  ),
}));

import { SlideTransitionPreview } from "./SlideTransitionStage";

const animate = vi.fn(
  (_keyframes: Keyframe[], _options?: KeyframeEffectOptions) => ({
    finished: new Promise<void>(() => {}),
    cancel: () => {},
  }),
);

beforeEach(() => {
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: animate,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(Element.prototype, "animate");
});

const slides = [
  { id: "slide-1", content: "", notes: "", layout: "content" },
  {
    id: "slide-2",
    content: "",
    notes: "",
    layout: "content",
    transition: "dissolve",
    transitionSpeed: 0,
  },
] as unknown as Slide[];

describe("SlideTransitionPreview", () => {
  it("renders nothing for the first slide, which has no incoming transition", () => {
    render(
      <SlideTransitionPreview slides={slides} index={0} onClose={() => {}} />,
    );

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("plays the incoming transition from the previous slide, at its speed", () => {
    render(
      <SlideTransitionPreview slides={slides} index={1} onClose={() => {}} />,
    );

    expect(screen.getByTestId("rendered-slide-1")).toBeTruthy();
    expect(screen.getByTestId("rendered-slide-2")).toBeTruthy();
    expect(animate).toHaveBeenCalledTimes(2);
    // Speed 0 is the slowest setting: 5 s, which is what the layers get.
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 5000 });
  });

  it("calls onClose from its close button", () => {
    const onClose = vi.fn();
    render(
      <SlideTransitionPreview slides={slides} index={1} onClose={onClose} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "presentation.exitPresentation" }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
