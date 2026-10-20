// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({
    slide,
    slidePosition,
  }: {
    slide: Slide;
    slidePosition: { number: number; count: number };
  }) => (
    <div
      data-testid={`rendered-${slide.id}`}
      data-position={`${slidePosition.number}/${slidePosition.count}`}
    />
  ),
}));

import {
  SlideTransitionPreview,
  transitionPreviewPair,
} from "./SlideTransitionStage";

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

    fireEvent.click(screen.getByRole("button", { name: "comments.close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the outgoing layer from assistive technology and focus, so the slide is read once and its controls cannot take focus", () => {
    render(
      <SlideTransitionPreview slides={slides} index={1} onClose={() => {}} />,
    );

    const outgoing = screen.getByTestId("rendered-slide-1").parentElement;
    expect(outgoing?.getAttribute("aria-hidden")).toBe("true");
    expect(outgoing?.hasAttribute("inert")).toBe(true);
    const incoming = screen.getByTestId("rendered-slide-2").parentElement;
    expect(incoming?.getAttribute("aria-hidden")).toBeNull();
    expect(incoming?.hasAttribute("inert")).toBe(false);
  });

  it("hides the back face of both layers of a flip", () => {
    const flipSlides = [
      { id: "slide-1", content: "", notes: "", layout: "content" },
      {
        id: "slide-2",
        content: "",
        notes: "",
        layout: "content",
        transition: "flip",
        transitionSpeed: 0,
      },
    ] as unknown as Slide[];
    render(
      <SlideTransitionPreview
        slides={flipSlides}
        index={1}
        onClose={() => {}}
      />,
    );

    for (const id of ["slide-1", "slide-2"]) {
      const layer = screen.getByTestId(`rendered-${id}`).parentElement;
      expect(layer?.style.backfaceVisibility).toBe("hidden");
    }
  });
});

// slide-1 is skipped, so playback goes straight from nothing to slide-2.
const withSkippedPrevious = [
  {
    id: "slide-1",
    content: "",
    notes: "",
    layout: "content",
    skipped: true,
  },
  { id: "slide-2", content: "", notes: "", layout: "content" },
  {
    id: "slide-3",
    content: "",
    notes: "",
    layout: "content",
    transition: "dissolve",
    transitionSpeed: 0,
  },
] as unknown as Slide[];

describe("transitionPreviewPair", () => {
  it("pairs a slide with the visible slide before it, not the raw one", () => {
    const pair = transitionPreviewPair(withSkippedPrevious, 2);

    expect(pair?.outgoing.id).toBe("slide-2");
    expect(pair?.incoming.id).toBe("slide-3");
    expect(pair?.position).toBe(1);
    expect(pair?.count).toBe(2);
  });

  it("has no pair for the first visible slide, even with a skipped slide before it", () => {
    expect(transitionPreviewPair(withSkippedPrevious, 1)).toBeNull();
  });

  it("has no pair for a skipped slide, which playback never shows", () => {
    expect(transitionPreviewPair(withSkippedPrevious, 0)).toBeNull();
  });
});

describe("SlideTransitionPreview with a skipped previous slide", () => {
  it("plays from the visible slide before it, numbered among the visible slides", () => {
    render(
      <SlideTransitionPreview
        slides={withSkippedPrevious}
        index={2}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByTestId("rendered-slide-1")).toBeNull();
    expect(screen.getByTestId("rendered-slide-2").dataset.position).toBe("1/2");
    expect(screen.getByTestId("rendered-slide-3").dataset.position).toBe("2/2");
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("renders nothing on the first visible slide", () => {
    render(
      <SlideTransitionPreview
        slides={withSkippedPrevious}
        index={1}
        onClose={() => {}}
      />,
    );

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });
});
