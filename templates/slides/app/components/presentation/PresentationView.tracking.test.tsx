// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

const mocks = vi.hoisted(() => ({
  track: vi.fn(
    async (_name: string, _properties?: Record<string, unknown>) => undefined,
  ),
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  track: mocks.track,
  trackEvent: mocks.trackEvent,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: Slide }) => (
    <div data-testid={`rendered-${slide.id}`} />
  ),
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));

vi.mock("./present-channel", () => ({ openPresentChannel: () => null }));

import PresentationView from "./PresentationView";

const slides = [
  { id: "slide-1", content: "", notes: "", layout: "content" },
  { id: "slide-2", content: "", notes: "", layout: "content" },
  { id: "slide-3", content: "", notes: "", layout: "content" },
] as unknown as Slide[];

beforeEach(() => {
  mocks.track.mockClear();
  mocks.trackEvent.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("PresentationView analytics", () => {
  it("relays an owner's presentation and its end", () => {
    const view = render(<PresentationView slides={slides} deckId="deck-1" />);

    expect(mocks.trackEvent).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith("presented", {
      output_id: "deck-1",
      output_type: "deck",
      slide_count: 3,
      is_shared: false,
      app_name: "slides",
      template_name: "slides",
    });

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    view.unmount();

    const ended = mocks.track.mock.calls.filter(
      ([name]) => name === "presentation_ended",
    );
    expect(ended).toHaveLength(1);
    expect(ended[0][1]).toEqual({
      output_id: "deck-1",
      output_type: "deck",
      duration_ms: expect.any(Number),
      slides_advanced: 2,
      max_slide_index: 2,
      fullscreen: false,
      app_name: "slides",
      template_name: "slides",
    });
  });

  it("ends once on the first hide, without a second end on pagehide or unmount", () => {
    const view = render(<PresentationView slides={slides} deckId="deck-1" />);
    const setVisibility = (state: DocumentVisibilityState) =>
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(
      mocks.track.mock.calls.filter(([name]) => name === "presentation_ended"),
    ).toHaveLength(1);
    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    });
    view.unmount();
    setVisibility("visible");

    expect(
      mocks.track.mock.calls.filter(([name]) => name === "presentation_ended"),
    ).toHaveLength(1);
  });

  it("keeps shared views on the beacon without the token", () => {
    const view = render(
      <PresentationView slides={slides} deckId="__shared__/secret-token" />,
    );
    view.unmount();

    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.trackEvent).toHaveBeenCalledWith("presented", {
      output_type: "deck",
      slide_count: 3,
      is_shared: true,
    });
    expect(JSON.stringify(mocks.trackEvent.mock.calls)).not.toContain(
      "secret-token",
    );
  });
});
