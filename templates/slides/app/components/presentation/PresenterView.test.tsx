// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "presentation.nextSlide": "Next slide",
      "presentation.previousSlide": "Previous slide",
      "presentation.closePresenterView": "Close presenter view",
      "presentation.noSlides": "No slides",
      "presentation.upNext": "Up next",
      "presentation.endOfDeck": "End of deck",
      "presentation.speakerNotes": "Speaker notes",
      "presentation.noNotesForSlide": "No notes for this slide",
    })[key] ?? key,
}));

vi.mock("@tabler/icons-react", () => ({
  IconChevronLeft: () => null,
  IconChevronRight: () => null,
  IconX: () => null,
}));

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: Slide }) => (
    <div data-testid={`rendered-${slide.id}`} />
  ),
}));

import PresenterView from "./PresenterView";

const slides = [
  { id: "slide-1", content: "", notes: "", layout: "content" },
  { id: "slide-2", content: "", notes: "", layout: "content" },
  { id: "slide-3", content: "", notes: "", layout: "content" },
] as unknown as Slide[];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PresenterView", () => {
  it("navigates locally when no presentation owner is available", () => {
    vi.stubGlobal("BroadcastChannel", undefined);

    render(<PresenterView slides={slides} deckId="deck-1" startIndex={1} />);

    expect(screen.getByText("2 / 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByText("3 / 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });
});
