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

  it("steps once for a held key, ignoring its auto-repeat keydowns", () => {
    // Three slides: a double step must be visible, not clamped at the last one.
    const threeSlides = [
      ...slides,
      { id: "third-slide", content: "", layout: "content" },
    ] as unknown as Slide[];
    render(
      <MemoryRouter>
        <PresentationView slides={threeSlides} deckId="deck-1" />
      </MemoryRouter>,
    );

    fireEvent(
      window,
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    fireEvent(
      window,
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        repeat: true,
        bubbles: true,
      }),
    );
    fireEvent(
      window,
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        repeat: true,
        bubbles: true,
      }),
    );

    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("keeps Space as a deck shortcut after a mouse-focused button", () => {
    const threeSlides = [
      ...slides,
      { id: "third-slide", content: "", layout: "content" },
    ] as unknown as Slide[];
    render(
      <MemoryRouter>
        <PresentationView slides={threeSlides} deckId="deck-1" />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 3")).toBeTruthy();

    const previous = screen.getByRole("button", {
      name: "presentation.previousSlide",
    });
    fireEvent.click(previous);
    previous.focus();
    expect(screen.getByText("1 / 3")).toBeTruthy();

    const nativeMatches = previous.matches.bind(previous);
    const focusVisible = vi
      .spyOn(previous, "matches")
      .mockImplementation((selector) =>
        selector === ":focus-visible" ? false : nativeMatches(selector),
      );
    const space = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, space);

    expect(space.defaultPrevented).toBe(true);
    expect(screen.getByText("2 / 3")).toBeTruthy();
    focusVisible.mockRestore();
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

  it("preserves focused select and combobox keyboard behavior", () => {
    const openPresenter = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      const view = render(
        <MemoryRouter initialEntries={["/presentation"]}>
          <PresentationView slides={slides} deckId="deck-1" />
          <CurrentLocation />
        </MemoryRouter>,
      );
      const select = document.createElement("select");
      const combobox = document.createElement("div");
      combobox.setAttribute("role", "combobox");
      combobox.tabIndex = 0;
      view.container.append(select, combobox);

      for (const control of [select, combobox]) {
        control.focus();
        for (const key of ["f", "s", "Escape"]) {
          const keyEvent = new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          });
          control.dispatchEvent(keyEvent);

          expect(keyEvent.defaultPrevented).toBe(false);
          expect(screen.getByTestId("current-location").textContent).toBe(
            "/presentation",
          );
        }
      }
      expect(openPresenter).not.toHaveBeenCalled();
      expect(screen.getByText("1 / 2")).toBeTruthy();
    } finally {
      openPresenter.mockRestore();
    }
  });

  it("keeps Escape-to-exit available while a presentation button is focused", () => {
    render(
      <MemoryRouter initialEntries={["/presentation"]}>
        <PresentationView slides={slides} deckId="deck-1" />
        <CurrentLocation />
      </MemoryRouter>,
    );

    screen.getByRole("button", { name: "presentation.nextSlide" }).focus();
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
    const revealed = () =>
      Array.from(rendered.querySelectorAll("[data-pstep]")).map(
        (step) => step.getAttribute("data-pstep-state") !== "hidden",
      );
    const previous = screen.getByRole("button", {
      name: "presentation.previousSlide",
    }) as HTMLButtonElement;
    const next = () =>
      screen.getByRole("button", {
        name: "presentation.nextSlide",
      }) as HTMLButtonElement;
    expect(revealed()).toEqual([false, false, false, false]);
    expect(previous.disabled).toBe(true);

    fireEvent.click(next());
    expect(revealed()).toEqual([true, false, false, false]);

    fireEvent.click(next());
    expect(revealed()).toEqual([true, true, false, false]);
    expect(next().disabled).toBe(false);

    fireEvent.click(next());
    expect(revealed()).toEqual([true, true, true, false]);
    expect(previous.disabled).toBe(false);

    fireEvent.click(next());
    expect(revealed()).toEqual([true, true, true, true]);

    fireEvent.click(previous);
    expect(revealed()).toEqual([true, true, true, false]);

    fireEvent.click(previous);
    expect(revealed()).toEqual([true, true, false, false]);
  });
});
