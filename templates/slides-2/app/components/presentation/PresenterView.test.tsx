// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) => {
    const messages: Record<string, string> = {
      "presentation.nextSlide": "Next slide",
      "presentation.previousSlide": "Previous slide",
      "presentation.voiceNavigation": "Voice navigation",
      "presentation.voiceNavigationNextCommand": "Next slide",
      "presentation.voiceNavigationPreviousCommand": "Previous slide",
      "presentation.voiceNavigationHint":
        "Say “{{next}}” or “{{previous}}” to navigate.",
      "presentation.voiceNavigationListening":
        "Listening for “{{next}}” or “{{previous}}”.",
      "presentation.voiceNavigationUnavailable":
        "Voice navigation is unavailable in this browser.",
      "presentation.voiceNavigationError":
        "Voice navigation stopped. Check microphone permission and connection, then try again.",
    };
    if (transcriptionMock.locale === "zh-CN") {
      messages["presentation.voiceNavigationNextCommand"] = "下一张幻灯片";
      messages["presentation.voiceNavigationPreviousCommand"] = "上一张幻灯片";
    }
    return Object.entries(values ?? {}).reduce(
      (message, [name, value]) => message.replaceAll(`{{${name}}}`, value),
      messages[key] ?? key,
    );
  },
  useLocale: () => ({ locale: transcriptionMock.locale }),
}));

const transcriptionMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  getIncompleteReason: vi.fn((): string | null => null),
  setTranscript: undefined as ((value: string) => void) | undefined,
  setIsActive: undefined as ((value: boolean) => void) | undefined,
  requestedLanguage: "",
  locale: "en-US",
}));

const localStorageState = new Map<string, string>();
const localStorageStub: Storage = {
  get length() {
    return localStorageState.size;
  },
  clear: () => localStorageState.clear(),
  getItem: (key) => localStorageState.get(key) ?? null,
  key: (index) => [...localStorageState.keys()][index] ?? null,
  removeItem: (key) => localStorageState.delete(key),
  setItem: (key, value) => localStorageState.set(key, String(value)),
};

vi.mock(
  "@agent-native/core/client/transcription/use-live-transcription",
  async () => {
    const React = await import("react");
    return {
      useLiveTranscription: ({ lang }: { lang: string }) => {
        const [isActive, setIsActive] = React.useState(false);
        const [transcript, setTranscript] = React.useState("");
        transcriptionMock.setIsActive = setIsActive;
        transcriptionMock.setTranscript = setTranscript;
        transcriptionMock.requestedLanguage = lang;
        transcriptionMock.start.mockImplementation(() => setIsActive(true));
        transcriptionMock.stop.mockImplementation(() => setIsActive(false));
        return {
          supported: true,
          isActive,
          transcript,
          interimText: "",
          start: transcriptionMock.start,
          stop: transcriptionMock.stop,
          getIncompleteReason: transcriptionMock.getIncompleteReason,
        };
      },
    };
  },
);

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: Slide }) => (
    <div
      data-testid={`rendered-${slide.id}`}
      dangerouslySetInnerHTML={{ __html: slide.content }}
    />
  ),
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));

// A stand-in for BroadcastChannel with its delivery rule: a message reaches every
// other open channel of the same name, and never the channel that sent it.
const bus = vi.hoisted(() => {
  type Message = { type: string; [key: string]: unknown };
  class FakeChannel {
    onmessage: ((event: { data: Message }) => void) | null = null;
    closed = false;
    posted: Message[] = [];
    constructor(
      readonly name: string,
      private readonly peers: FakeChannel[],
    ) {
      peers.push(this);
    }
    postMessage(message: Message) {
      this.posted.push(message);
      for (const peer of this.peers) {
        if (peer !== this && !peer.closed && peer.name === this.name) {
          peer.onmessage?.({ data: message });
        }
      }
    }
    close() {
      this.closed = true;
    }
  }
  const peers: FakeChannel[] = [];
  return {
    peers,
    open: (name: string) => new FakeChannel(name, peers),
  };
});

vi.mock("./present-channel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./present-channel")>()),
  openPresentChannel: (deckId: string) =>
    bus.open(`slides-2:present:${deckId}`),
}));

import PresentationView from "./PresentationView";
import PresenterView from "./PresenterView";

const revealSlide = `<div class="fmd-slide"><div class="text-box"><p>One</p><p>Two</p><p>Three</p></div></div>`;
const NOTES_TEXT_SIZE_STORAGE_KEY = "slides-2:presenter-notes-text-size";

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

function paragraphStates(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-pstep]"))
    .sort(
      (a, b) =>
        Number(a.getAttribute("data-pstep")) -
        Number(b.getAttribute("data-pstep")),
    )
    .map((element) => element.getAttribute("data-pstep-state") ?? "");
}

function visibility(states: string[]): boolean[] {
  return states.map((state) => state !== "hidden");
}

function clickNext(container: HTMLElement) {
  fireEvent.click(
    within(container).getByRole("button", { name: "Next slide" }),
  );
}

function commandsPosted(channel: { posted: { type: string }[] }) {
  return channel.posted.filter((message) => message.type === "command");
}

beforeEach(() => {
  bus.peers.splice(0);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });
  window.localStorage.clear();
  transcriptionMock.start.mockClear();
  transcriptionMock.stop.mockClear();
  transcriptionMock.getIncompleteReason.mockReturnValue(null);
  transcriptionMock.locale = "en-US";
});

afterEach(() => cleanup());

describe("PresenterView with an audience", () => {
  it("steps the audience once and the presenter once for one press", () => {
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [audienceChannel, presenterChannel] = bus.peers;

    clickNext(presenter.container);

    expect(within(audience.container).getByText("2 / 3")).toBeTruthy();
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(commandsPosted(presenterChannel!)).toEqual([
      { type: "command", command: "next" },
    ]);
    expect(commandsPosted(audienceChannel!)).toEqual([]);
  });

  it("never re-sends the audience's state as a command", () => {
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );
    render(<PresenterView slides={slides} deckId="deck-1" />);
    const [audienceChannel, presenterChannel] = bus.peers;

    // The presenter opened, said hello, and heard the audience's state back.
    expect(presenterChannel?.posted).toEqual([
      { type: "hello" },
      { type: "blackout", mode: null },
    ]);
    expect(commandsPosted(audienceChannel!)).toEqual([]);
    expect(within(audience.container).getByText("1 / 3")).toBeTruthy();
  });

  it("shows the audience's build state at the same step on the presenter's current slide", () => {
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);

    clickNext(presenter.container);
    expect(paragraphStates(presenter.container)).toEqual([
      "hidden",
      "hidden",
      "hidden",
    ]);

    clickNext(presenter.container);
    expect(visibility(paragraphStates(presenter.container))).toEqual(
      visibility(paragraphStates(audience.container)),
    );
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      false,
      false,
    ]);

    clickNext(presenter.container);
    expect(visibility(paragraphStates(presenter.container))).toEqual(
      visibility(paragraphStates(audience.container)),
    );
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("PresenterView after the audience leaves", () => {
  function openAudienceAndPresenter() {
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [audienceChannel] = bus.peers;
    return { audience, presenter, audienceChannel: audienceChannel! };
  }

  it("moves itself on the presenter's keys once the audience window closes", () => {
    const { audience, presenter, audienceChannel } = openAudienceAndPresenter();
    expect(within(presenter.container).getByText("1 / 3")).toBeTruthy();

    window.dispatchEvent(new Event("pagehide"));
    audience.unmount();

    expect(audienceChannel.posted).toContainEqual({ type: "bye" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
  });

  it("moves itself on the presenter's keys once the audience leaves for the editor", () => {
    const { audience, presenter, audienceChannel } = openAudienceAndPresenter();

    audience.unmount();

    expect(audienceChannel.posted).toContainEqual({ type: "bye" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
  });
});

describe("PresenterView without an audience", () => {
  it("keeps the voice status live region mounted before it has a message", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const status = within(presenter.container).getByRole("status");

    expect(status.textContent).toBe("");
    expect(status.getAttribute("aria-live")).toBe("polite");

    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Voice navigation",
      }),
    );

    expect(within(presenter.container).getByRole("status")).toBe(status);
    expect(status.textContent).toBe(
      "Listening for “Next slide” or “Previous slide”.",
    );
  });

  it("moves itself once per press and says so to no one", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [presenterChannel] = bus.peers;

    clickNext(presenter.container);

    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(commandsPosted(presenterChannel!)).toHaveLength(1);
  });

  it("reveals each build step on a press before the slide advances, as the audience does", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);

    clickNext(presenter.container);
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      false,
      false,
      false,
    ]);

    clickNext(presenter.container);
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      false,
      false,
    ]);

    clickNext(presenter.container);
    clickNext(presenter.container);
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      true,
      true,
    ]);

    clickNext(presenter.container);
    expect(within(presenter.container).getByText("3 / 3")).toBeTruthy();
  });

  it("keeps Next enabled on the last slide while its builds remain", () => {
    const presenter = render(
      <PresenterView
        slides={[slides[0], slides[1]] as Slide[]}
        deckId="deck-1"
      />,
    );
    const next = within(presenter.container).getByRole("button", {
      name: "Next slide",
    }) as HTMLButtonElement;

    clickNext(presenter.container);
    expect(within(presenter.container).getByText("2 / 2")).toBeTruthy();
    expect(next.disabled).toBe(false);

    clickNext(presenter.container);
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      false,
      false,
    ]);
    clickNext(presenter.container);
    clickNext(presenter.container);
    expect(next.disabled).toBe(true);
  });

  it("lands a prev press on the earlier slide fully built, as the audience does", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);

    // plain -> reveal (three builds) -> after.
    for (let press = 0; press < 5; press++) clickNext(presenter.container);
    expect(within(presenter.container).getByText("3 / 3")).toBeTruthy();

    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Previous slide",
      }),
    );
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("keeps word boundaries and advances for split speech with no whitespace", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [presenterChannel] = bus.peers;

    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Voice navigation",
      }),
    );
    expect(transcriptionMock.start).toHaveBeenCalledTimes(1);
    expect(transcriptionMock.requestedLanguage).toBe("en-US");

    act(() => transcriptionMock.setTranscript?.("Next"));
    act(() => transcriptionMock.setTranscript?.("Nextslide."));

    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(commandsPosted(presenterChannel!)).toEqual([
      { type: "command", command: "next" },
    ]);
  });

  it("does not complete a partial command after five seconds of silence", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    try {
      const presenter = render(
        <PresenterView slides={slides} deckId="deck-1" />,
      );
      const [presenterChannel] = bus.peers;

      fireEvent.click(
        within(presenter.container).getByRole("button", {
          name: "Voice navigation",
        }),
      );
      act(() => transcriptionMock.setTranscript?.("Next"));

      now.mockReturnValue(15_001);
      act(() => transcriptionMock.setTranscript?.("Nextslide."));

      expect(within(presenter.container).getByText("1 / 3")).toBeTruthy();
      expect(commandsPosted(presenterChannel!)).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it("executes a complete command after an unrelated partial phrase", () => {
    const plainSlides = [
      { id: "one", content: "", layout: "content" },
      { id: "two", content: "", layout: "content" },
      { id: "three", content: "", layout: "content" },
    ] as unknown as Slide[];
    const presenter = render(
      <PresenterView slides={plainSlides} deckId="deck-1" />,
    );
    const [presenterChannel] = bus.peers;

    clickNext(presenter.container);
    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Voice navigation",
      }),
    );
    act(() => transcriptionMock.setTranscript?.("Next"));
    act(() => transcriptionMock.setTranscript?.("NextPrevious slide."));

    expect(within(presenter.container).getByText("1 / 3")).toBeTruthy();
    expect(commandsPosted(presenterChannel!)).toEqual([
      { type: "command", command: "next" },
      { type: "command", command: "prev" },
    ]);
  });

  it("keeps a new partial command after an unrelated partial phrase", () => {
    const plainSlides = [
      { id: "one", content: "", layout: "content" },
      { id: "two", content: "", layout: "content" },
    ] as unknown as Slide[];
    const presenter = render(
      <PresenterView slides={plainSlides} deckId="deck-1" />,
    );
    const [presenterChannel] = bus.peers;

    clickNext(presenter.container);
    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Voice navigation",
      }),
    );
    act(() => transcriptionMock.setTranscript?.("Next"));
    act(() => transcriptionMock.setTranscript?.("NextPrevious"));
    act(() => transcriptionMock.setTranscript?.("NextPrevious slide."));

    expect(within(presenter.container).getByText("1 / 2")).toBeTruthy();
    expect(commandsPosted(presenterChannel!)).toEqual([
      { type: "command", command: "next" },
      { type: "command", command: "prev" },
    ]);
  });

  it("does not intercept Space while the voice button is focused", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [presenterChannel] = bus.peers;
    const button = within(presenter.container).getByRole("button", {
      name: "Voice navigation",
    });
    button.focus();

    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(within(presenter.container).getByText("1 / 3")).toBeTruthy();

    const arrowEvent = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(arrowEvent);
    expect(arrowEvent.defaultPrevented).toBe(true);
    expect(commandsPosted(presenterChannel!)).toEqual([
      { type: "command", command: "next" },
    ]);
  });

  it("matches split Chinese commands without inserting word spaces", () => {
    transcriptionMock.locale = "zh-CN";
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [presenterChannel] = bus.peers;

    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Voice navigation",
      }),
    );
    expect(transcriptionMock.requestedLanguage).toBe("zh-CN");

    act(() => transcriptionMock.setTranscript?.("下一张"));
    act(() => transcriptionMock.setTranscript?.("下一张幻灯片"));

    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(commandsPosted(presenterChannel!)).toEqual([
      { type: "command", command: "next" },
    ]);
  });

  it("shows microphone permission and connection guidance after recognition stops", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Voice navigation",
      }),
    );

    transcriptionMock.getIncompleteReason.mockReturnValue(
      "Browser speech recognition stopped mid-recording (not-allowed).",
    );
    act(() => transcriptionMock.setIsActive?.(false));

    expect(
      within(presenter.container).getByText(
        "Voice navigation stopped. Check microphone permission and connection, then try again.",
      ),
    ).toBeTruthy();
  });

  it("ignores narration that only mentions the next slide", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Voice navigation",
      }),
    );

    act(() =>
      transcriptionMock.setTranscript?.("The next slide explains the idea."),
    );

    expect(within(presenter.container).getByText("1 / 3")).toBeTruthy();
  });
});

describe("PresenterView keyboard navigation", () => {
  it("supports page navigation and leaves modified navigation keys to the browser", () => {
    const plainSlides = [
      { id: "one", content: "", layout: "content" },
      { id: "two", content: "", layout: "content" },
      { id: "three", content: "", layout: "content" },
    ] as unknown as Slide[];
    const presenter = render(
      <PresenterView slides={plainSlides} deckId="deck-1" />,
    );
    const [presenterChannel] = bus.peers;

    const pageDown = new KeyboardEvent("keydown", {
      key: "PageDown",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, pageDown);
    expect(pageDown.defaultPrevented).toBe(true);
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();

    const shiftedPageDown = new KeyboardEvent("keydown", {
      key: "PageDown",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, shiftedPageDown);
    expect(shiftedPageDown.defaultPrevented).toBe(true);
    expect(within(presenter.container).getByText("3 / 3")).toBeTruthy();

    const pageUp = new KeyboardEvent("keydown", {
      key: "PageUp",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, pageUp);
    expect(pageUp.defaultPrevented).toBe(true);
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();

    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      for (const key of ["ArrowRight", "ArrowLeft", "PageDown", "PageUp"]) {
        const event = new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          [modifier]: true,
        });
        fireEvent(window, event);

        expect(event.defaultPrevented, `${modifier}+${key}`).toBe(false);
        expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
      }
    }

    expect(commandsPosted(presenterChannel!)).toEqual([
      { type: "command", command: "next" },
      { type: "command", command: "next" },
      { type: "command", command: "prev" },
    ]);
  });
});

describe("PresenterView projection controls", () => {
  it("toggles black and white projection modes from buttons and shortcuts", () => {
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const blackButton = within(presenter.container).getByRole("button", {
      name: "slides2Presenter.blackout",
    });
    const whiteButton = within(presenter.container).getByRole("button", {
      name: "slides2Presenter.whiteout",
    });

    fireEvent.click(blackButton);
    expect(blackButton.getAttribute("aria-pressed")).toBe("true");
    expect(
      presenter.container.querySelector('[data-presenter-blackout="black"]'),
    ).toBeTruthy();
    expect(
      audience.container.querySelector('[data-presentation-blackout="black"]'),
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: "b" });
    expect(blackButton.getAttribute("aria-pressed")).toBe("false");
    expect(
      audience.container.querySelector("[data-presentation-blackout]"),
    ).toBeNull();

    fireEvent.keyDown(window, { key: "W" });
    expect(whiteButton.getAttribute("aria-pressed")).toBe("true");
    expect(
      audience.container.querySelector('[data-presentation-blackout="white"]'),
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(whiteButton.getAttribute("aria-pressed")).toBe("false");
    expect(
      audience.container.querySelector("[data-presentation-blackout]"),
    ).toBeNull();

    fireEvent.click(whiteButton);
    expect(whiteButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(whiteButton);
    expect(whiteButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("jumps to an in-range slide and ignores values outside the deck", () => {
    const manySlides = Array.from({ length: 12 }, (_, index) => ({
      id: `slide-${index + 1}`,
      content: "",
      layout: "content",
    })) as unknown as Slide[];
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={manySlides} deckId="deck-1" />
      </MemoryRouter>,
    );
    const presenter = render(
      <PresenterView slides={manySlides} deckId="deck-1" />,
    );
    const input = within(presenter.container).getByRole("spinbutton", {
      name: "slides2Presenter.shortcutJump",
    });
    const jumpButton = within(presenter.container).getByRole("button", {
      name: "slides2Presenter.shortcutJump",
    }) as HTMLButtonElement;
    const [, presenterChannel] = bus.peers;

    fireEvent.change(input, { target: { value: "0" } });
    expect(jumpButton.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "13" } });
    expect(jumpButton.disabled).toBe(true);
    expect(
      presenterChannel?.posted.some((message) => message.type === "goto"),
    ).toBe(false);

    fireEvent.change(input, { target: { value: "12" } });
    expect(jumpButton.disabled).toBe(false);
    fireEvent.click(jumpButton);

    expect(within(presenter.container).getByText("12 / 12")).toBeTruthy();
    expect(within(audience.container).getByText("12 / 12")).toBeTruthy();
    expect(
      audience.container.querySelector('[data-testid="rendered-slide-12"]'),
    ).toBeTruthy();
    expect(presenterChannel?.posted).toContainEqual({
      type: "goto",
      index: 11,
    });
  });

  it("resizes speaker notes, stops at both bounds, and restores the saved size", () => {
    const noteSlides = [
      {
        id: "notes",
        content: "",
        layout: "content",
        notes: "Speaker note copy",
      },
    ] as unknown as Slide[];
    const renderPresenter = () =>
      render(<PresenterView slides={noteSlides} deckId="deck-1" />);
    const presenter = renderPresenter();
    const notes = within(presenter.container).getByText("Speaker note copy");
    const controls = within(presenter.container).getByRole("group", {
      name: "slides2Presenter.notesTextSize",
    });
    const decrease = within(controls).getByRole("button", {
      name: "slides2Presenter.decreaseNotesTextSize",
    }) as HTMLButtonElement;
    const increase = within(controls).getByRole("button", {
      name: "slides2Presenter.increaseNotesTextSize",
    }) as HTMLButtonElement;

    expect(notes.classList.contains("text-lg")).toBe(true);
    fireEvent.click(increase);
    expect(notes.classList.contains("text-xl")).toBe(true);
    expect(window.localStorage.getItem(NOTES_TEXT_SIZE_STORAGE_KEY)).toBe("4");
    expect(increase.disabled).toBe(true);

    fireEvent.click(decrease);
    fireEvent.click(decrease);
    fireEvent.click(decrease);
    fireEvent.click(decrease);
    expect(notes.classList.contains("text-xs")).toBe(true);
    expect(decrease.disabled).toBe(true);

    presenter.unmount();
    const restored = renderPresenter();
    expect(
      within(restored.container)
        .getByText("Speaker note copy")
        .classList.contains("text-xs"),
    ).toBe(true);
  });
});
