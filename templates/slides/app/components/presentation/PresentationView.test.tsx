// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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
      <div data-testid={`rendered-${slide.id}`} />
    ),
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));
vi.mock("./present-channel", () => ({ openPresentChannel: () => null }));

import PresentationView from "./PresentationView";

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
    const mediaKey = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(mediaKey);

    expect(mediaKey.defaultPrevented).toBe(false);
    expect(screen.getByText("1 / 2")).toBeTruthy();

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
});
