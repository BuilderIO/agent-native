// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

const mocks = vi.hoisted(() => ({
  channel: {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: Slide }) => (
    <div data-testid={`rendered-${slide.id}`} />
  ),
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));
vi.mock("./present-channel", () => ({
  openPresentChannel: () => mocks.channel,
}));

import PresentationView from "./PresentationView";

// happy-dom has no Web Animations API. Each fake animation finishes only when
// the test says so, which is what makes the transition's timing observable.
interface FakeAnimation {
  finished: Promise<void>;
  cancel: () => void;
  finish: () => void;
  duration: number;
}
let running: FakeAnimation[] = [];

beforeEach(() => {
  running = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: (_keyframes: unknown, options?: KeyframeEffectOptions) => {
      let finish!: () => void;
      let abort!: (error: Error) => void;
      const finished = new Promise<void>((resolve, reject) => {
        finish = resolve;
        abort = reject;
      });
      const animation: FakeAnimation = {
        finished,
        finish,
        duration: Number(options?.duration),
        cancel: () => abort(new DOMException("aborted", "AbortError")),
      };
      running.push(animation);
      return animation;
    },
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
  },
  {
    id: "slide-3",
    content: "",
    notes: "",
    layout: "content",
    transition: "slide-from-right",
  },
  {
    id: "slide-4",
    content: "",
    notes: "",
    layout: "content",
    transition: "flip",
  },
] as unknown as Slide[];

async function landRunningFlight() {
  const batch = running.splice(0);
  await act(async () => {
    for (const animation of batch) animation.finish();
  });
}

function renderView(deck: Slide[] = slides) {
  return render(
    <MemoryRouter>
      <PresentationView slides={deck} deckId="deck-1" />
    </MemoryRouter>,
  );
}

describe("PresentationView transitions", () => {
  it("counts a burst of animated presses as one step each, once each transition lands", async () => {
    renderView();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(screen.getByText("1 / 4")).toBeTruthy();
    expect(running).toHaveLength(2);

    let landed = 0;
    while (running.length > 0) {
      await landRunningFlight();
      landed += 1;
    }

    expect(landed).toBe(3);
    expect(screen.getByText("4 / 4")).toBeTruthy();
  });

  it("does not drop a presenter command that arrives mid-transition", async () => {
    renderView();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    act(() => {
      mocks.channel.onmessage?.({
        data: { type: "command", command: "next" },
      });
    });
    expect(screen.getByText("1 / 4")).toBeTruthy();

    await landRunningFlight();
    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect(running).toHaveLength(2);

    await landRunningFlight();
    expect(screen.getByText("3 / 4")).toBeTruthy();
  });
});

describe("PresentationView transition speed", () => {
  // Slide 1 is the slow one (5 s) and enters on a backward step. Slide 2 owns
  // the 1-2 boundary and runs at 0.5 s.
  const timed = [
    {
      id: "slide-1",
      content: "",
      notes: "",
      layout: "content",
      transitionSpeed: 0,
    },
    {
      id: "slide-2",
      content: "",
      notes: "",
      layout: "content",
      transition: "dissolve",
      transitionSpeed: 45,
    },
  ] as unknown as Slide[];

  it("plays a forward flight at the speed of the slide it enters, which owns the boundary", () => {
    renderView(timed);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(running.map((animation) => animation.duration)).toEqual([500, 500]);
  });

  it("plays a backward flight at the boundary slide's speed, not the entered slide's", async () => {
    renderView(timed);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await landRunningFlight();
    expect(screen.getByText("2 / 2")).toBeTruthy();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(running.map((animation) => animation.duration)).toEqual([500, 500]);
  });
});
