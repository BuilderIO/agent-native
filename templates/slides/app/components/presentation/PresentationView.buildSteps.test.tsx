// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

// The real SlideRenderer sanitizes and injects the stored HTML. This stand-in
// injects it as-is, so the build attributes reach the DOM the runtime queries.
vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: Slide }) => (
    <div
      data-testid={`rendered-${slide.id}`}
      dangerouslySetInnerHTML={{ __html: slide.content }}
    />
  ),
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));
vi.mock("./present-channel", () => ({ openPresentChannel: () => null }));

import PresentationView from "./PresentationView";

const revealSlide = `<div class="fmd-slide"><div class="text-box"><p>One</p><p>Two</p><p>Three</p></div></div>`;

const slides = [
  { id: "plain", content: "", layout: "content" },
  {
    id: "reveal",
    content: revealSlide,
    layout: "content",
    animations: [
      {
        id: "body",
        elementIndex: 0,
        elementPath: [0],
        byParagraph: true,
        type: "fade",
      },
    ],
  },
  { id: "after", content: "", layout: "content" },
] as unknown as Slide[];

function revealParagraphs(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-pstep]"),
  ).sort(
    (a, b) =>
      Number(a.getAttribute("data-pstep")) -
      Number(b.getAttribute("data-pstep")),
  );
}

function press(key = "ArrowRight") {
  fireEvent(
    window,
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

afterEach(() => cleanup());

describe("PresentationView deep-linked builds", () => {
  it("mounts a deep-linked slide with every build hidden and no reveal running", () => {
    render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" startIndex={1} />
      </MemoryRouter>,
    );

    const paragraphs = revealParagraphs();
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) {
      expect(paragraph.getAttribute("data-pstep-state")).toBe("hidden");
      expect(paragraph.style.animation).toBe("");
    }
  });

  it("reveals a deep-linked slide's builds one per press, in order", () => {
    render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" startIndex={1} />
      </MemoryRouter>,
    );

    press();
    let [one, two, three] = revealParagraphs();
    expect(one?.getAttribute("data-pstep-state")).toBe("entering");
    expect(one?.style.animation).toContain("elem-appear");
    expect(two?.getAttribute("data-pstep-state")).toBe("hidden");
    expect(three?.getAttribute("data-pstep-state")).toBe("hidden");

    press();
    [one, two, three] = revealParagraphs();
    expect(one?.getAttribute("data-pstep-state")).toBe("shown");
    expect(one?.style.animation).toBe("");
    expect(two?.getAttribute("data-pstep-state")).toBe("entering");
    expect(three?.getAttribute("data-pstep-state")).toBe("hidden");
  });
  it("reveals a deep-linked slide's builds under reduced motion in the same order, without motion", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      render(
        <MemoryRouter>
          <PresentationView slides={slides} deckId="deck-1" startIndex={1} />
        </MemoryRouter>,
      );

      press();
      let [one, two, three] = revealParagraphs();
      expect(one?.getAttribute("data-pstep-state")).toBe("entering");
      expect(one?.style.animation).toBe("");
      expect(two?.getAttribute("data-pstep-state")).toBe("hidden");
      expect(three?.getAttribute("data-pstep-state")).toBe("hidden");

      press();
      [one, two, three] = revealParagraphs();
      expect(one?.getAttribute("data-pstep-state")).toBe("shown");
      expect(two?.getAttribute("data-pstep-state")).toBe("entering");
      expect(two?.style.animation).toBe("");
      expect(three?.getAttribute("data-pstep-state")).toBe("hidden");
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("PresentationView server markup", () => {
  it("hydrates the server markup without a mismatch, then annotates the reveals", async () => {
    const tree = (
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" startIndex={1} />
      </MemoryRouter>
    );
    const server = renderToString(tree);
    expect(server).toContain("visibility:hidden");
    expect(server).not.toContain("data-pstep");

    const host = document.createElement("div");
    host.innerHTML = server;
    document.body.appendChild(host);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(host, tree);
      });

      expect(consoleError).not.toHaveBeenCalled();
      expect(revealParagraphs()).toHaveLength(3);
      expect(host.querySelector(".absolute.inset-0.z-20")).not.toBeNull();
      expect(
        host.querySelector<HTMLElement>(".absolute.inset-0.z-20")?.style
          .visibility,
      ).toBe("");
    } finally {
      await act(async () => root?.unmount());
      consoleError.mockRestore();
      host.remove();
    }
  });
});

describe("PresentationView deep-link index across the build-steps flip", () => {
  it("shows the deep-linked slide before and after the build-steps flag flips", () => {
    const tree = (
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" startIndex={1} />
      </MemoryRouter>
    );

    // The flag flips in a layout effect, so this markup is the pre-flip render.
    expect(renderToStaticMarkup(tree)).toContain("2 / 3");

    render(tree);

    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.queryByText("1 / 3")).toBeNull();
    expect(revealParagraphs()).toHaveLength(3);
  });
});
