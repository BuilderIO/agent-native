// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: Slide }) =>
    slide.id === "video-slide" ? (
      <video data-testid="presentation-video" controls />
    ) : (
      <div
        data-testid={`rendered-${slide.id}`}
        dangerouslySetInnerHTML={{ __html: slide.content }}
      />
    ),
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));
vi.mock("./present-channel", () => ({ openPresentChannel: () => null }));

import PresentationView from "./PresentationView";

function CurrentLocation() {
  const location = useLocation();
  return (
    <div data-testid="current-location">
      {location.pathname}
      {location.search}
    </div>
  );
}

const slides = [
  { id: "video-slide", content: "", layout: "content" },
  { id: "next-slide", content: "", layout: "content" },
] as unknown as Slide[];

afterEach(() => cleanup());

describe("PresentationView keyboard shortcuts", () => {
  it("leaves focused video controls usable and keeps deck shortcuts elsewhere", () => {
    render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );

    const video = screen.getByTestId("presentation-video");
    video.focus();
    for (const key of [" ", "ArrowRight", "ArrowDown"]) {
      const mediaKey = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(mediaKey);

      expect(mediaKey.defaultPrevented).toBe(false);
      expect(screen.getByText("1 / 2")).toBeTruthy();
    }

    video.blur();
    const presentationKey = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, presentationKey);

    expect(presentationKey.defaultPrevented).toBe(true);
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  it("keeps fullscreen, presenter, and exit shortcuts available to focused video", () => {
    render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
        <CurrentLocation />
      </MemoryRouter>,
    );

    const video = screen.getByTestId("presentation-video");
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const fullscreenDescriptor = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "requestFullscreen",
    );
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    const openPresenter = vi.spyOn(window, "open").mockReturnValue(null);

    try {
      video.focus();

      const fullscreenKey = new KeyboardEvent("keydown", {
        key: "f",
        bubbles: true,
        cancelable: true,
      });
      fireEvent(window, fullscreenKey);
      expect(fullscreenKey.defaultPrevented).toBe(true);
      expect(requestFullscreen).toHaveBeenCalledTimes(1);

      const presenterKey = new KeyboardEvent("keydown", {
        key: "s",
        bubbles: true,
        cancelable: true,
      });
      fireEvent(window, presenterKey);
      expect(presenterKey.defaultPrevented).toBe(true);
      expect(openPresenter).toHaveBeenCalledTimes(1);

      const exitKey = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      fireEvent(window, exitKey);
      expect(exitKey.defaultPrevented).toBe(false);
      expect(screen.getByTestId("current-location").textContent).toBe(
        "/deck/deck-1?slide=1",
      );
    } finally {
      openPresenter.mockRestore();
      if (fullscreenDescriptor) {
        Object.defineProperty(
          document.documentElement,
          "requestFullscreen",
          fullscreenDescriptor,
        );
      } else {
        Reflect.deleteProperty(document.documentElement, "requestFullscreen");
      }
    }
  });
});

describe("PresentationView paragraph animations", () => {
  it("reveals and reverses mixed list-item text and paragraph steps", () => {
    const slide = {
      id: "wrapped-list-slide",
      content: `<div class="fmd-slide"><div><ul>
        <li>Intro<div>Section intro<p>First</p><p>Second</p></div></li>
      </ul></div></div>`,
      layout: "content",
      animations: [
        {
          id: "animation-1",
          elementIndex: 0,
          elementPath: [0, 0, 0],
          byParagraph: true,
          type: "slide-up",
        },
      ],
    } as unknown as Slide;
    render(
      <MemoryRouter>
        <PresentationView slides={[slide]} deckId="deck-1" />
      </MemoryRouter>,
    );

    const rendered = screen.getByTestId("rendered-wrapped-list-slide");
    const steps = rendered.querySelectorAll("[data-pstep]");
    expect(Array.from(steps).map((step) => step.textContent)).toEqual([
      "IntroSection introFirstSecond",
      "Section introFirstSecond",
      "First",
      "Second",
    ]);
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="0"] { opacity: 0; pointer-events: none; }',
    );

    const previous = screen.getByRole("button", {
      name: "presentation.previousSlide",
    });
    const clickNext = () =>
      fireEvent.click(
        screen.getByRole("button", { name: "presentation.nextSlide" }),
      );
    expect((previous as HTMLButtonElement).disabled).toBe(true);

    clickNext();

    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="0"] { opacity: 1; pointer-events: auto; animation: elem-slide-up 300ms',
    );
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="1"] { opacity: 0; pointer-events: none; }',
    );

    clickNext();
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="1"] { opacity: 1; pointer-events: auto; animation: elem-slide-up 300ms',
    );
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="2"] { opacity: 0; pointer-events: none; }',
    );

    expect(
      (
        screen.getByRole("button", {
          name: "presentation.nextSlide",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    clickNext();
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="2"] { opacity: 1; pointer-events: auto; animation: elem-slide-up 300ms',
    );
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="3"] { opacity: 0; pointer-events: none; }',
    );
    expect((previous as HTMLButtonElement).disabled).toBe(false);

    clickNext();
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="3"] { opacity: 1; pointer-events: auto; animation: elem-slide-up 300ms',
    );

    fireEvent.click(previous);
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="3"] { opacity: 0; pointer-events: none; }',
    );
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="2"] { opacity: 1; pointer-events: auto; animation: elem-slide-up 300ms',
    );

    fireEvent.click(previous);
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="2"] { opacity: 0; pointer-events: none; }',
    );
    expect(rendered.querySelector("style")?.textContent).toContain(
      '[data-pstep="1"] { opacity: 1; pointer-events: auto; animation: elem-slide-up 300ms',
    );
  });
});
